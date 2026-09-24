from __future__ import annotations

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
    return magnitude, frequencies


def _stack_spectrograms(state: AudioState) -> list[dict]:
    result = []
    for tensor in state.random_stack:
        segment_state = AudioState(
            waveform=tensor,
            original_waveform=tensor,
            sample_rate=state.sample_rate,
            filename=state.filename,
        )
        magnitude, frequencies = _spectrogram(segment_state)
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
    magnitude, frequencies = _spectrogram(segment_state)
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
