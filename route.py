from __future__ import annotations
from pathlib import Path
import io
import wave
import uuid
import base64
import zipfile
from dataclasses import dataclass, field
from typing import Dict, Optional, List

import torch
import torchaudio
import av
import numpy as np
from PIL import Image
import uuid
from flask import Flask, jsonify, render_template, request, send_file
import numpy as np

# Internal Module Processors
import image_processing
import face_tensor_processing
import box_tensor_processing
import vector_processing
import torch.nn.functional as F

# Internal Microphone 
import os
import wave
import struct

from flask_socketio import SocketIO, emit

app = Flask(__name__)

socketio = SocketIO(app, cors_allowed_origins="*", logger=False, engineio_logger=False)

@dataclass
class AudioState:
    waveform: torch.Tensor
    original_waveform: torch.Tensor
    sample_rate: int
    filename: str
    image: Optional[torch.Tensor] = None
    image_filename: Optional[str] = None
    pitch_tensors: list[torch.Tensor] = field(default_factory=list)
    random_tensor: Optional[torch.Tensor] = None
    random_stack: list[torch.Tensor] = field(default_factory=list)
    tensor_stacks: list[list[torch.Tensor]] = field(default_factory=list)
    break_seconds: float = 7.0
    clipboard: Optional[torch.Tensor] = None
    backup_waveform: Optional[torch.Tensor] = None
    undo_history: list[torch.Tensor] = field(default_factory=list)

IMAGE_PATH = Path(__file__).with_name("sample.png")



def _session_id() -> str:
    session_id = request.headers.get("X-Audio-Session")
    if not session_id or session_id not in SESSIONS:
        raise ValueError("Upload an audio file before editing.")
    return session_id


SESSIONS: Dict[str, AudioState] = {}


def _spectrogram(state: AudioState) -> tuple[torch.Tensor, torch.Tensor]:
    window_length = min(1024, state.waveform.shape[1])
    window_length = max(16, 2 ** int(np.floor(np.log2(window_length))))
    hop_length = max(1, window_length // 4)
    window = torch.hann_window(window_length, device=state.waveform.device)
    transformed = torch.stft(
        state.waveform,
        n_fft=window_length,
        hop_length=hop_length,
        win_length=window_length,
        window=window,
        return_complex=True,
    )
    magnitude = transformed.abs().mean(dim=0)
    frequencies = torch.fft.rfftfreq(window_length, d=1 / (state.sample_rate * 2))
    # 1. Take the absolute value or just downsample the raw sequence
    # Let's say your canvas is 800 pixels wide; 1000 to 2000 points is plenty.
    target_length = 2000
    raw_wave = state.waveform.squeeze()  # Ensure it's a 1D array

    # Downsample using linear interpolation
    downsampled_wave = F.interpolate(
        raw_wave.view(1, 1, -1), size=target_length, mode="linear", align_corners=False
    ).squeeze()

    return magnitude, frequencies, downsampled_wave


def _stack_spectrograms(state: AudioState) -> list[dict]:
    result = []
    for tensor in state.random_stack:
        segment_state = AudioState(
            waveform=tensor,
            original_waveform=tensor,
            sample_rate=state.sample_rate,
            filename=state.filename,
        )
        magnitude, frequencies, downsampled_wave = _spectrogram(segment_state)
        magnitude = torch.log1p(magnitude)
        magnitude = magnitude / magnitude.amax().clamp_min(1e-8)
        max_frames = 300
        if magnitude.shape[1] > max_frames:
            step = (magnitude.shape[1] + max_frames - 1) // max_frames
            magnitude = magnitude[:, ::step]
        if magnitude.shape[0] > 256:
            magnitude = magnitude[::2]
            frequencies = frequencies[::2]
        result.append(
            {
                "values": magnitude.transpose(0, 1).tolist(),
                "pitches": frequencies[magnitude.argmax(dim=0)].tolist(),
                "pitch_magnitudes": magnitude.amax(dim=0).tolist(),
                "duration": tensor.shape[1] / state.sample_rate,
                "waveform": downsampled_wave.tolist(),
            }
        )
    return result


def _spectrogram_payload(waveform: torch.Tensor, sample_rate: int) -> dict:
    segment_state = AudioState(
        waveform=waveform,
        original_waveform=waveform,
        sample_rate=sample_rate,
        filename="stack",
    )
    magnitude, frequencies, downsampled_wave = _spectrogram(segment_state)
    magnitude = torch.log1p(magnitude)
    magnitude = magnitude / magnitude.amax().clamp_min(1e-8)
    max_frames = 900
    if magnitude.shape[1] > max_frames:
        step = (magnitude.shape[1] + max_frames - 1) // max_frames
        magnitude = magnitude[:, ::step]
    if magnitude.shape[0] > 256:
        magnitude = magnitude[::2]
        frequencies = frequencies[::2]
    return {
        "values": magnitude.transpose(0, 1).tolist(),
        "pitches": frequencies[magnitude.argmax(dim=0)].tolist(),
        "pitch_magnitudes": magnitude.amax(dim=0).tolist(),
        "waveform": downsampled_wave.tolist(),
    }


def _audio_metadata(state: AudioState) -> dict:
    return {
        "channels": int(state.waveform.shape[0]),
        "samples": int(state.waveform.shape[1]),
        "sample_rate": state.sample_rate,
        "duration": state.waveform.shape[1] / state.sample_rate,
        "filename": state.filename,
        "min": float(state.waveform.min().item()),
        "max": float(state.waveform.max().item()),
    }


def _image_data_url(image: torch.Tensor) -> str:
    pixels = image.detach().cpu().clamp(0, 1).mul(255).byte().permute(1, 2, 0).numpy()
    output = io.BytesIO()
    Image.fromarray(pixels, mode="RGB").save(output, format="PNG")
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _export(state: AudioState, start: Optional[int] = None, end: Optional[int] = None):
    waveform = (
        state.waveform[:, start:end]
        if start is not None and end is not None
        else state.waveform
    )
    return _export_waveform(waveform, state.sample_rate)


def _export_waveform(waveform: torch.Tensor, sample_rate: int):
    output = io.BytesIO()
    pcm = (
        waveform.cpu().clamp(-1, 1).mul(32767).to(torch.int16).t().contiguous().numpy()
    ).tobytes()
    with wave.open(output, "wb") as writer:
        writer.setnchannels(waveform.shape[0])
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(pcm)
    output.seek(0)
    return output


def _decode_audio(file_stream) -> tuple[torch.Tensor, int]:
    with av.open(file_stream) as container:
        audio_stream = container.streams.audio[0]
        channel_count = int(audio_stream.channels or 0)
        if channel_count < 1:
            raise ValueError("The audio stream does not declare a valid channel count.")

        frames = []
        for frame in container.decode(audio_stream):
            decoded = np.asarray(frame.to_ndarray())
            if decoded.ndim == 1:
                decoded = (
                    decoded.reshape(1, -1)
                    if channel_count == 1
                    else decoded.reshape(-1, channel_count).T
                )
            elif decoded.ndim == 2 and decoded.shape[0] == 1 and channel_count > 1:
                if decoded.shape[1] % channel_count:
                    raise ValueError(
                        "The audio frame has an invalid interleaved channel layout."
                    )
                decoded = decoded.reshape(-1, channel_count).T
            elif decoded.ndim == 2 and decoded.shape[0] != channel_count:
                if decoded.shape[1] == channel_count:
                    decoded = decoded.T
                else:
                    raise ValueError("The audio frame has an invalid channel layout.")
            frames.append(decoded)

        if not frames:
            raise ValueError("The uploaded file does not contain audio frames.")
        decoded = np.concatenate(frames, axis=1)
        if decoded.shape[0] != channel_count or decoded.shape[1] == 0:
            raise ValueError("The uploaded file does not contain valid audio samples.")
        if np.issubdtype(decoded.dtype, np.integer):
            decoded = decoded.astype(np.float32) / np.iinfo(decoded.dtype).max
        waveform = torch.from_numpy(decoded).float()
        return waveform, int(audio_stream.rate)


# ==========================================
# 1. BASE INDEX ROUTE
# ==========================================
@app.get("/")
def index():
    return render_template("index.html")


# ==========================================
# 2. AUDIO MANAGEMENT MODULE
# ==========================================
@app.get("/editaudio")
def edit_audio():
    """Serves the Audio Editor interface."""
    return render_template("editaudio.html")


@app.post("/api/upload")
def upload():
    audio_file = request.files.get("audio")
    # if audio_file is None or not audio_file.filename:
    #     return jsonify({"error": "Choose a WAV or MP3 file to upload."}), 400

    try:
        waveform, sample_rate = _decode_audio(audio_file.stream)
    except Exception as exc:
        return jsonify({"error": f"Could not decode the audio file: {exc}"}), 400

    if waveform.ndim != 2 or waveform.shape[1] == 0:
        return (
            jsonify({"error": "The uploaded file does not contain audio samples."}),
            400,
        )

    session_id = uuid.uuid4().hex
    SESSIONS[session_id] = AudioState(
        waveform=waveform.float().contiguous(),
        original_waveform=waveform.float().contiguous().clone(),
        sample_rate=int(sample_rate),
        filename=audio_file.filename,
    )
    response = jsonify(
        {
            "session_id": session_id,
            **_audio_metadata(SESSIONS[session_id]),
        }
    )
    response.headers["X-Audio-Session"] = session_id
    return response


@app.get("/api/spectrogram")
def spectrogram():
    try:
        state = SESSIONS[_session_id()]
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    magnitude, frequencies, downsampled_wave = _spectrogram(state)
    max_frames = 4000
    if magnitude.shape[1] > max_frames:
        step = (magnitude.shape[1] + max_frames - 1) // max_frames
        magnitude = magnitude[:, ::step]
    magnitude = torch.log1p(magnitude)
    magnitude = magnitude / magnitude.amax().clamp_min(1e-8)
    pitch_bins = magnitude.argmax(dim=0)
    pitches = frequencies[pitch_bins]
    return jsonify(
        {
            "waveform": downsampled_wave.tolist(),
            "values": magnitude.transpose(0, 1).tolist(),
            "pitches": pitches.tolist(),
            "pitch_magnitudes": magnitude.amax(dim=0).tolist(),
            "frequencies": frequencies.tolist(),
            **_audio_metadata(state),
        }
    )


@app.post("/api/image")
def upload_image():
    try:
        state = SESSIONS[_session_id()]
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    image_file = request.files.get("image")
    if image_file is None or not image_file.filename:
        return jsonify({"error": "Choose a PNG, JPEG, or WEBP image."}), 400

    try:
        with Image.open(image_file.stream) as source:
            rgb = source.convert("RGB")
            pixels = np.asarray(rgb, dtype=np.float32) / 255.0
        image = torch.from_numpy(pixels).permute(2, 0, 1).contiguous()
    except Exception as exc:
        return jsonify({"error": f"Could not decode the image: {exc}"}), 400

    state.image = image
    state.image_filename = image_file.filename
    return jsonify(
        {
            "filename": state.image_filename,
            "width": int(image.shape[2]),
            "height": int(image.shape[1]),
            "image": _image_data_url(image),
        }
    )


@app.post("/api/apply")
def apply_changes():
    try:
        state = SESSIONS[_session_id()]
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    payload = request.get_json(silent=True) or {}
    try:
        gain = float(payload.get("gain", 1))
        pitch = int(payload.get("pitch", 0))
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "Provide numeric gain and pitch values."}), 400

    if not 0.0 <= gain <= 2.0:
        return jsonify({"error": "Gain must be between 0 and 2."}), 400
    if not -12 <= pitch <= 12:
        return jsonify({"error": "Pitch must be between -12 and 12 semitones."}), 400

    state.waveform = (state.waveform * gain).clamp(-1.0, 1.0)
    if pitch:
        state.waveform = torchaudio.functional.pitch_shift(
            state.waveform, state.sample_rate, pitch, n_fft=1024, hop_length=256
        ).clamp(-1.0, 1.0)
    return jsonify(_audio_metadata(state))


@app.post("/api/tensor-edit")
def tensor_edit():
    try:
        state = SESSIONS[_session_id()]
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    payload = request.get_json(silent=True) or {}
    action = payload.get("action")
    start = payload.get("start")
    end = payload.get("end")
    position = payload.get("position")

    def range_value(value, name):
        if not isinstance(value, int):
            raise ValueError(f"{name} must be an integer.")
        if not 0 <= value <= state.waveform.shape[1]:
            raise ValueError(f"{name} is outside the tensor.")
        return value

    try:
        if action in {"copy", "cut", "delete"}:
            start = range_value(start, "Selection start")
            end = range_value(end, "Selection end")
            if end <= start:
                raise ValueError("The selection must contain audio.")
        if action == "load_original":
            state.undo_history.append(state.waveform.clone())
            state.waveform = state.original_waveform.clone()
        elif action == "backup":
            state.backup_waveform = state.waveform.clone()
        elif action == "copy":
            state.clipboard = state.waveform[:, start:end].clone()
        elif action == "cut":
            state.undo_history.append(state.waveform.clone())
            state.clipboard = state.waveform[:, start:end].clone()
            state.waveform = torch.cat(
                (state.waveform[:, :start], state.waveform[:, end:]), dim=1
            ).contiguous()
        elif action == "delete":
            state.undo_history.append(state.waveform.clone())
            state.waveform = torch.cat(
                (state.waveform[:, :start], state.waveform[:, end:]), dim=1
            ).contiguous()
        elif action == "paste":
            if state.clipboard is None:
                raise ValueError("Copy or cut a selection before pasting.")
            position = range_value(position, "Paste position")
            state.undo_history.append(state.waveform.clone())
            state.waveform = torch.cat(
                (
                    state.waveform[:, :position],
                    state.clipboard,
                    state.waveform[:, position:],
                ),
                dim=1,
            ).contiguous()
        elif action == "undo":
            if not state.undo_history:
                raise ValueError("There is no earlier tensor state to restore.")
            state.waveform = state.undo_history.pop()
        else:
            return jsonify({"error": "Unknown tensor edit action."}), 400
    except (TypeError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(
        {
            **_audio_metadata(state),
            "clipboard_samples": (
                int(state.clipboard.shape[1]) if state.clipboard is not None else 0
            ),
            "can_undo": bool(state.undo_history),
            "has_backup": state.backup_waveform is not None,
        }
    )


@app.post("/api/break-tensor")
def break_tensor():
    try:
        state = SESSIONS[_session_id()]
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    payload = request.get_json(silent=True) or {}
    try:
        break_seconds = float(payload.get("seconds", 7))
    except (TypeError, ValueError):
        return jsonify({"error": "Break time must be a number of seconds."}), 400
    if not 0.1 <= break_seconds <= 3600:
        return (
            jsonify({"error": "Break time must be between 0.1 and 3600 seconds."}),
            400,
        )

    chunk_samples = max(1, int(round(state.sample_rate * break_seconds)))
    sample_count = state.original_waveform.shape[1]
    segments: list[torch.Tensor] = []
    for start in range(0, sample_count, chunk_samples):
        stop = min(start + chunk_samples, sample_count)
        segment = state.original_waveform[:, start:stop].contiguous()
        if segment.shape[1] > 0:
            segments.append(segment)

    state.pitch_tensors = segments
    state.random_tensor = None
    state.random_stack = []
    state.tensor_stacks = []
    state.break_seconds = break_seconds
    return jsonify(
        {
            "tensor_count": len(state.pitch_tensors),
            "chunk_seconds": break_seconds,
            "chunk_samples": chunk_samples,
            "samples": int(sample_count),
        }
    )


@app.post("/api/random-tensor")
def random_tensor():
    try:
        state = SESSIONS[_session_id()]
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    if not state.pitch_tensors:
        return (
            jsonify(
                {"error": "Break the original tensor into 7-second tensors first."}
            ),
            400,
        )

    if state.random_stack:
        state.tensor_stacks.append([tensor.clone() for tensor in state.random_stack])

    state.random_stack = [
        state.pitch_tensors[index].clone()
        for index in np.random.permutation(len(state.pitch_tensors))
    ]
    state.random_tensor = torch.cat(state.random_stack, dim=1)
    stack_spectrogram = _spectrogram_payload(state.random_tensor, state.sample_rate)
    return jsonify(
        {
            "tensor_count": len(state.pitch_tensors),
            "stack_count": len(state.random_stack),
            "stack_history_count": len(state.tensor_stacks),
            "random_samples": int(state.random_tensor.shape[1]),
            "random_duration": state.random_tensor.shape[1] / state.sample_rate,
            "segments": _stack_spectrograms(state),
            "stack_spectrogram": stack_spectrogram,
        }
    )


@app.get("/api/random-spectrogram")
def random_spectrogram():
    try:
        state = SESSIONS[_session_id()]
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    if not state.random_stack:
        return jsonify({"error": "Create a random tensor stack first."}), 400
    return jsonify(
        {
            "segments": _stack_spectrograms(state),
            "sample_rate": state.sample_rate,
            "duration": state.random_tensor.shape[1] / state.sample_rate,
        }
    )


@app.post("/api/resample")
def resample():
    try:
        state = SESSIONS[_session_id()]
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    payload = request.get_json(silent=True) or {}
    target_rate = payload.get("sample_rate")
    if not isinstance(target_rate, int) or not 8000 <= target_rate <= 192000:
        return (
            jsonify(
                {"error": "Sample rate must be an integer between 8000 and 192000 Hz."}
            ),
            400,
        )

    if target_rate != state.sample_rate:
        state.waveform = torchaudio.functional.resample(
            state.waveform, state.sample_rate, target_rate
        )
        state.sample_rate = target_rate
    return jsonify(_audio_metadata(state))


@app.get("/api/download")
def download():
    try:
        state = SESSIONS[_session_id()]
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    tensor_name = request.args.get("tensor", "current")
    if tensor_name == "stacks":
        stacks = [*state.tensor_stacks]
        if state.random_stack:
            stacks.append(state.random_stack)
        if not stacks:
            return (
                jsonify(
                    {
                        "error": "Create at least one random tensor stack before downloading."
                    }
                ),
                400,
            )

        archive = io.BytesIO()
        base_name = state.filename.rsplit(".", 1)[0]
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            for index, stack in enumerate(stacks, start=1):
                waveform = torch.cat(stack, dim=1)
                wav = _export_waveform(waveform, state.sample_rate)
                output.writestr(f"{base_name}_stack_{index}.wav", wav.getvalue())
        archive.seek(0)
        return send_file(
            archive,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"{base_name}_stacks.zip",
        )
    if tensor_name == "original":
        return send_file(
            _export_waveform(state.original_waveform, state.sample_rate),
            mimetype="audio/wav",
            as_attachment=True,
            download_name=f"{state.filename.rsplit('.', 1)[0]}_original.wav",
        )
    if tensor_name == "random":
        if state.random_tensor is None:
            return jsonify({"error": "Create a random tensor before playing it."}), 400
        return send_file(
            _export_waveform(state.random_tensor, state.sample_rate),
            mimetype="audio/wav",
            as_attachment=True,
            download_name=f"{state.filename.rsplit('.', 1)[0]}_random.wav",
        )

    start = request.args.get("start", type=int)
    end = request.args.get("end", type=int)
    if (start is None) != (end is None):
        return jsonify({"error": "Both selection start and end are required."}), 400
    if start is not None and (
        start < 0 or end <= start or end > state.waveform.shape[1]
    ):
        return jsonify({"error": "The requested selection is invalid."}), 400

    suffix = "_selection" if start is not None else ""
    name = f"{state.filename.rsplit('.', 1)[0]}{suffix}.wav"
    return send_file(
        _export(state, start, end),
        mimetype="audio/wav",
        as_attachment=True,
        download_name=name,
    )


# =========================================
# 3. IMAGE MANAGEMENT MODULE
# ==========================================
@app.get("/editimage")
def edit_image():
    """Serves the Image Editor interface."""
    return render_template("editimage.html")


@app.post("/api/editimage")
def api_edit_image():
    """API endpoint explicitly handling standalone image modifications."""
    try:
        data = request.get_json() or {}
        # Parse inputs out of JSON data payload
        return (
            jsonify(
                {"status": "success", "message": "Image tensor processing complete."}
            ),
            200,
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

@app.get("/api/tensor")
def tensor():
        return jsonify(image_processing.tensor_payload(image_processing.load_rgb_tensor(IMAGE_PATH)))


# ==========================================
# 4. FACE MATRIX TENSOR MODULE
# ==========================================
@app.get("/rotateface")
def face_rotate():
    return render_template("rotateface.html")


@app.route("/api/facerender", methods=["GET"])
def render_face_api():
    angle_x = float(request.args.get("x", 0))
    angle_y = float(request.args.get("y", 0))
    result = face_tensor_processing.get_rotated_and_colored_mesh(angle_x, angle_y)
    return jsonify(result)


# ==========================================
# 5. BOUNDING BOX TENSOR MODULE
# ==========================================
@app.get("/rotatebox")
def box_rotate():
    return render_template("rotatebox.html")


@app.route("/api/boxrender", methods=["GET"])
def render_box_api():
    angle_x = float(request.args.get("x", 0))
    angle_y = float(request.args.get("y", 0))
    result = box_tensor_processing.get_rotated_and_colored_boxmesh(angle_x, angle_y)
    return jsonify(result)


# ==========================================
# 6. BOUNDING VECTOR 3D TENSOR MODULE
# ==========================================


@app.route("/vector")
def vector():
    return render_template("3dvector.html")


@app.route("/api/rendervector", methods=["GET"])
def render_api():
    ax = float(request.args.get("x", 30))
    ay = float(request.args.get("y", 45))
    lx = float(request.args.get("lx", 1.0))
    ly = float(request.args.get("ly", 1.0))
    lz = float(request.args.get("lz", 1.0))

    return jsonify(vector_processing.get_lighted_3d_mesh(ax, ay, lx, ly, lz))


# ==========================================
# 7. BOUNDING MIC SOCKET IO AUDIO WAVFORM TENSOR MODULE
# ==========================================

# Global audio buffer to store chunks during an active recording session
audio_buffer = []
is_recording = False
SAMPLE_RATE = 44100  # Default browser audio context sample rate

@app.route("/audiowavformfrommic")
def audiowavformfrommic():
    return render_template("audiowavformfrommic.html")

@socketio.on('start_recording')
def handle_start():
    global audio_buffer, is_recording
    audio_buffer = []  # Clear any previous recordings
    is_recording = True
    print("Recording started...")

@socketio.on('mic_data')
def handle_mic_data(json_data):
    global audio_buffer, is_recording
    raw_audio_chunk = json_data.get('data', [])
    
    # If the user has toggled recording on, accumulate the samples
    if is_recording:
        audio_buffer.extend(raw_audio_chunk)
        
    # Echo back to the frontend immediately for continuous canvas visualization
    emit('audio_waveform', {'data': raw_audio_chunk})

@socketio.on('stop_recording')
def handle_stop():
    global audio_buffer, is_recording
    if not is_recording:
        return
        
    is_recording = False
    print(f"Recording stopped. Processing {len(audio_buffer)} samples...")

    if len(audio_buffer) == 0:
        print("No audio data received.")
        return

    output_filename = "recorded_audio.wav"
    
    # Open a new wave file structure
    # 1 channel (Mono), 2 bytes per sample (16-bit PCM), at standard Sample Rate
    with wave.open(output_filename, 'wb') as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2) 
        wav_file.setframerate(SAMPLE_RATE)
        
        # Convert Float32 (-1.0 to 1.0) from browser into Int16 (-32768 to 32767) for standard WAV format
        binary_data = bytearray()
        for sample in audio_buffer:
            # Clip the sample boundaries to prevent overflow distortion
            sample = max(-1.0, min(1.0, sample))
            int_sample = int(sample * 32767)

            # Pack integer into 2-byte short little-endian configuration
            binary_data.extend(struct.pack('<h', int_sample))
            
        wav_file.writeframes(binary_data)
        
        print(f"Successfully saved recording to: {os.path.abspath(output_filename)}")
