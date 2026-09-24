const fileInput = document.querySelector("#audio-file");
const uploadButton = document.querySelector("#upload-button");
const imageFileInput = document.querySelector("#image-file");
const imageUploadButton = document.querySelector("#image-upload-button");
const imageCanvas = document.querySelector("#image-canvas");
const imageNameEl = document.querySelector("#image-name");
const canvas = document.querySelector("#waveform");
const waveformScroll = document.querySelector("#waveform-scroll");
const gainSlider = document.querySelector("#gain-slider");
const pitchSlider = document.querySelector("#pitch-slider");
const pitchBrightnessSlider = document.querySelector("#pitch-brightness-slider");
const rateSlider = document.querySelector("#rate-slider");
const saveButton = document.querySelector("#save-button");
const breakTensorButton = document.querySelector("#break-tensor-button");
const breakDurationInput = document.querySelector("#break-duration");
const randomTensorButton = document.querySelector("#random-tensor-button");
const playButton = document.querySelector("#play-button");
const playRandomButton = document.querySelector("#play-random-button");
const stopButton = document.querySelector("#stop-button");
const downloadButton = document.querySelector("#download-selection");
const statusEl = document.querySelector("#status");
const metadataEl = document.querySelector("#metadata");
const errorEl = document.querySelector("#error");
const fileNameEl = document.querySelector("#file-name");
const gainValue = document.querySelector("#gain-value");
const pitchValue = document.querySelector("#pitch-value");
const pitchBrightnessValue = document.querySelector("#pitch-brightness-value");
const rateValue = document.querySelector("#rate-value");
const loadOriginalButton = document.querySelector("#load-original-button");
const selectTensorButton = document.querySelector("#select-tensor-button");
const clearSelectionButton = document.querySelector("#clear-selection-button");
const copyTensorButton = document.querySelector("#copy-tensor-button");
const cutTensorButton = document.querySelector("#cut-tensor-button");
const pasteTensorButton = document.querySelector("#paste-tensor-button");
const deleteTensorButton = document.querySelector("#delete-tensor-button");
const backupTensorButton = document.querySelector("#backup-tensor-button");
const downloadTensorButton = document.querySelector("#download-tensor-button");
const undoTensorButton = document.querySelector("#undo-tensor-button");
const playLatestTensorButton = document.querySelector("#play-latest-tensor-button");
const playSelectedTensorButton = document.querySelector("#play-selected-tensor-button");

let sessionId = null;
let metadata = null;
let spectrogram = [];
let pitches = [];
let pitchMagnitudes = [];
let randomSegments = [];
let randomStackSpectrogram = [];
let sourceImageData = null;
let audioContext = null;
let playback = null;
let activeRandomSegment = -1;
let selection = null;
let selectionMode = false;
let pasteMode = false;
let selectionPoints = [];
let pastePosition = null;
let clipboardMode = null;
const PIXELS_PER_FRAME = 3;

function setError(message = "") { errorEl.textContent = message; }
function setStatus(message) { if (statusEl) statusEl.textContent = message; }
function headers() { return { "Content-Type": "application/json", "X-Audio-Session": sessionId }; }

const tensorEditButtons = [
  playLatestTensorButton, loadOriginalButton, playSelectedTensorButton, selectTensorButton, clearSelectionButton, copyTensorButton,
  cutTensorButton, pasteTensorButton, deleteTensorButton, backupTensorButton,
  downloadTensorButton, undoTensorButton,
];

function updateTensorEditButtons() {
  const hasSelection = selection && selection.end > selection.start;
  [clearSelectionButton, copyTensorButton, cutTensorButton, deleteTensorButton]
    .filter(Boolean).forEach((button) => { button.disabled = !hasSelection; });
  if (playSelectedTensorButton) playSelectedTensorButton.disabled = !hasSelection;
  if (undoTensorButton) undoTensorButton.disabled = !undoTensorButton.dataset.canUndo;
  if (pasteTensorButton) pasteTensorButton.disabled = !pasteTensorButton.dataset.hasClipboard;
  if (selectTensorButton) selectTensorButton.classList.toggle("active", selectionMode);
  if (copyTensorButton) copyTensorButton.classList.toggle("active", clipboardMode === "copy");
  if (cutTensorButton) cutTensorButton.classList.toggle("active", clipboardMode === "cut");
}

async function tensorEdit(action, extra = {}) {
  const body = await requestJson("/api/tensor-edit", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ action, ...extra }),
  });
  await refreshSpectrogram();
  if (undoTensorButton) undoTensorButton.dataset.canUndo = body.can_undo ? "true" : "";
  if (pasteTensorButton) pasteTensorButton.dataset.hasClipboard = body.clipboard_samples > 0 ? "true" : "";
  selection = null;
  selectionPoints = [];
  selectionMode = false;
  pasteMode = false;
  updateTensorEditButtons();
  return body;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`The server returned an invalid response (${response.status}).`);
  }
  if (!response.ok) throw new Error(body.error || "The request failed.");
  return body;
}

function updateLabels() {
  gainValue.textContent = `${Number(gainSlider.value).toFixed(2)}x`;
  pitchBrightnessValue.textContent = `${pitchBrightnessSlider.value}%`;
  rateValue.textContent = `${rateSlider.value} Hz`;
}

// function renderImageCanvas(progress = 0) {
//   if (!sourceImageData || !metadata) return;
//   const width = sourceImageData.width;
//   const height = sourceImageData.height;
//   imageCanvas.width = width;
//   imageCanvas.height = height;
//   const context = imageCanvas.getContext("2d");
//   const frame = Math.min(pitches.length - 1, Math.floor(progress * Math.max(0, pitches.length - 1)));
//   const magnitude = pitchMagnitudes[frame] || 0;
//   const transformed = new ImageData(new Uint8ClampedArray(sourceImageData.data), width, height);
//   const magnitudeOffset = magnitude * 255;
//   for (let index = 0; index < transformed.data.length; index += 4) {
//     transformed.data[index] = Math.min(255, transformed.data[index] + magnitudeOffset);
//     transformed.data[index + 1] = Math.min(255, transformed.data[index + 1] + magnitudeOffset);
//     transformed.data[index + 2] = Math.min(255, transformed.data[index + 2] + magnitudeOffset);
//   }
//   context.putImageData(transformed, 0, 0);
// }

function renderImageCanvas(progress = 0) {
  if (!sourceImageData || !metadata) return;
  const width = sourceImageData.width;
  const height = sourceImageData.height;
  imageCanvas.width = width;
  imageCanvas.height = height;
  const context = imageCanvas.getContext("2d");
  
  const frame = Math.min(pitches.length - 1, Math.floor(progress * Math.max(0, pitches.length - 1)));
  const magnitude = pitchMagnitudes[frame] || 0;
  
  const transformed = new ImageData(new Uint8ClampedArray(sourceImageData.data), width, height);
  const magnitudeOffset = magnitude * 255;

  // 1. Determine which of the 8 slices is currently active (0 to 7)
  const TOTAL_SLICES = 1;
  const activeSlice = Math.min(TOTAL_SLICES - 1, Math.floor(progress * TOTAL_SLICES));

  // 2. Calculate the dynamic height ceiling for the active slice based on magnitude
  // A magnitude of 1.0 means the effect fills 100% of the canvas height.
  const dynamicHeight = height * magnitude; 
  const yThreshold = height - dynamicHeight; // Bottom-up threshold

  // 3. Process every pixel
  for (let index = 0; index < transformed.data.length; index += 4) {
    const pixelIndex = index / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width); // Extract the structural vertical coordinate

    // 4. Find which vertical slice this pixel belongs to
    const sliceWidth = width / TOTAL_SLICES;
    const currentPixelSlice = Math.floor(x / sliceWidth);

    // 5. Apply brightness if it's the active slice AND within the magnitude-based height zone
    if (currentPixelSlice === activeSlice && y >= yThreshold) {
      transformed.data[index] = Math.min(255, transformed.data[index] + magnitudeOffset);
      transformed.data[index + 1] = Math.min(255, transformed.data[index + 1] + magnitudeOffset);
      transformed.data[index + 2] = Math.min(255, transformed.data[index + 2] + magnitudeOffset);
    }
  }
  
  context.putImageData(transformed, 0, 0);
}


function renderSpectrogram() {
  const frameCount = randomSegments.length
    ? randomSegments.reduce((total, segment) => total + segment.values.length, 0)
    : spectrogram.length;
  const frequencyCount = randomSegments[0]?.values[0]?.length || spectrogram[0]?.length || 0;
  const chartWidth = Math.max(waveformScroll.clientWidth, frameCount * PIXELS_PER_FRAME);
  const chartHeight = canvas.clientHeight || 270;
  const ratio = window.devicePixelRatio || 1;
  canvas.style.width = `${chartWidth}px`;
  canvas.width = chartWidth * ratio;
  canvas.height = chartHeight * ratio;
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, chartWidth, chartHeight);
  if (!frequencyCount) return;

  const image = context.createImageData(chartWidth, chartHeight);
  for (let x = 0; x < chartWidth; x += 1) {
    let frame;
    let stackSegment = null;
    if (randomSegments.length) {
      const frameIndex = Math.min(
        randomStackSpectrogram.length - 1,
        Math.floor(x / chartWidth * randomStackSpectrogram.length),
      );
      frame = randomStackSpectrogram[frameIndex];
      const progress = x / chartWidth;
      const totalDuration = randomSegments.reduce((total, item) => total + item.duration, 0);
      let elapsed = 0;
      for (const segment of randomSegments) {
        elapsed += segment.duration / totalDuration;
        if (progress < elapsed) {
          stackSegment = segment;
          break;
        }
      }
    } else {
      const frameIndex = Math.min(frameCount - 1, Math.floor(x / chartWidth * frameCount));
      frame = spectrogram[frameIndex];
    }
    for (let y = 0; y < chartHeight; y += 1) {
      const bin = Math.min(frequencyCount - 1, Math.floor((1 - y / chartHeight) * frequencyCount));
      const intensity = Math.min(1, Math.max(0, Math.pow(Number(frame?.[bin]) || 0, 0.42)));
      const offset = (y * chartWidth + x) * 4;
      const color = stackSegment?.color || [8, 31, 55];
      const heat = stackSegment ? intensity : intensity * 0.9;
      image.data[offset] = Math.round(color[0] + heat * (255 - color[0]));
      image.data[offset + 1] = Math.round(color[1] + heat * (220 - color[1]));
      image.data[offset + 2] = Math.round(color[2] + heat * (150 - color[2]));
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  if (selectionPoints.length) {
    context.strokeStyle = "#334d3b";
    context.lineWidth = 50;
    selectionPoints.forEach((point) => {
      const x = chartWidth * point / (metadata?.samples || 1);
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, chartHeight);
      context.stroke();
    });
  }

  if (selection && metadata?.samples) {
    const startX = chartWidth * selection.start / metadata.samples;
    const endX = chartWidth * selection.end / metadata.samples;
    context.fillStyle = "rgb(255 215 0 / 0.28)";
    context.fillRect(startX, 0, Math.max(2, endX - startX), chartHeight);
    context.strokeStyle = "#ffd700";
    context.lineWidth = 200;
    context.strokeRect(startX, 0, Math.max(2, endX - startX), chartHeight);
  }

  if (pasteMode && pastePosition !== null && metadata?.samples) {
    const x = chartWidth * pastePosition / metadata.samples;
    context.strokeStyle = "#145a32";
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, chartHeight);
    context.stroke();
  }

  if (playback && audioContext) {
    const elapsed = Math.min(
      playback.duration,
      Math.max(0, audioContext.currentTime - playback.startedAt),
    );
    const progress = elapsed / playback.duration;
    const playedX = chartWidth * progress;
    const viewportWidth = waveformScroll.clientWidth;
    const maxScroll = Math.max(0, chartWidth - viewportWidth);
    waveformScroll.scrollLeft = Math.min(maxScroll, Math.max(0, playedX - viewportWidth * 0.35));

    const windowStart = Math.floor(elapsed / 3) * 3;
    const windowEnd = Math.min(playback.duration, windowStart + 3);
    context.fillStyle = "rgb(235 45 45 / 0.58)";
    context.fillRect(
      chartWidth * windowStart / playback.duration,
      0,
      chartWidth * (windowEnd - windowStart) / playback.duration,
      chartHeight,
    );
  }

  if (randomSegments.length) {
    let elapsed = 0;
    randomSegments.forEach((segment, index) => {
      const totalDuration = randomSegments.reduce((total, item) => total + item.duration, 0);
      const x = chartWidth * elapsed / totalDuration;
      elapsed += segment.duration;
      const endX = chartWidth * elapsed / totalDuration;
      context.strokeStyle = index === activeRandomSegment ? "#ff3b30" : "rgb(255 255 255 / 0.45)";
      context.lineWidth = index === activeRandomSegment ? 3 : 1;
      context.strokeRect(x, 0, Math.max(1, endX - x), chartHeight);
    });
  }

  context.strokeStyle = `rgb(247 200 115 / ${Number(pitchBrightnessSlider.value) / 100})`;
  context.lineWidth = 2;
  context.beginPath();
  pitches.forEach((pitch, index) => {
    const x = index / Math.max(1, pitches.length - 1) * chartWidth;
    const y = chartHeight * (1 - Math.min(1, pitch / (metadata.sample_rate / 2)));
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  });
  context.stroke();

  if (playback && audioContext) {
    const progress = Math.min(1, Math.max(0, (audioContext.currentTime - playback.startedAt) / playback.duration));
    const playedX = chartWidth * progress;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(playedX, 0);
    context.lineTo(playedX, chartHeight);
    context.stroke();
  }
}

// 3. The Animation Loop (Breaks the image vertically)
function animate() {
    if (!imageLoaded) return;
    
    // Request next animation frame
    requestAnimationFrame(animate);
    
    // Grab the current real-time frequency/magnitude data
    analyser.getByteFrequencyData(dataArray);
    
    // Clear canvas frame
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Determine how wide each slice should be relative to canvas and data points
    const sliceWidth = canvas.width / bufferLength;
    
    for (let i = 0; i < bufferLength; i++) {
        // Normalize magnitude value (0.0 to 1.0)
        const magnitude = dataArray[i] / 255; 
        
        // Calculate dynamic physical displacement (Break effect intensity)
        const verticalShift = magnitude * 80; // Shakes image vertically by up to 80px
        
        // Target positioning variables
        const sourceX = i * sliceWidth;
        const sourceY = 0;
        const sourceWidth = sliceWidth;
        const sourceHeight = canvas.height;
        
        // We draw vertical columns extracted out of the image asset, 
        // shifting their rendering position based on frequency energy.
        ctx.drawImage(
            bgImage,
            sourceX, sourceY, sourceWidth, sourceHeight,           // Source crop box
            sourceX, sourceY + verticalShift, sourceWidth, sourceHeight // Destination draw box
        );
        
        // Optional: Overlay a visible indicator line showing the magnitude edge
        ctx.strokeStyle = `rgba(255, 255, 255, ${magnitude})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sourceX, sourceY + verticalShift);
        ctx.lineTo(sourceX + sliceWidth, sourceY + verticalShift);
        ctx.stroke();
    }
}

function animatePlayback(timestamp) {
  if (!playback) return;
  if (timestamp - playback.lastPaint >= 100) {
    playback.lastPaint = timestamp;
    if (playback.random) {
      const elapsed = audioContext.currentTime - playback.startedAt;
      let accumulated = 0;
      activeRandomSegment = randomSegments.findIndex((segment) => {
        accumulated += segment.duration;
        return elapsed < accumulated;
      });
    }
    renderSpectrogram();
    renderImageCanvas(Math.min(1, (audioContext.currentTime - playback.startedAt) / playback.duration));
  }
  if (audioContext.currentTime - playback.startedAt < playback.duration) {
    playback.animationFrame = requestAnimationFrame(animatePlayback);
  }
}

async function refreshSpectrogram() {
  const body = await requestJson("/api/spectrogram", { headers: { "X-Audio-Session": sessionId } });
  metadata = body;
  spectrogram = body.values;
  pitches = body.pitches;
  pitchMagnitudes = body.pitch_magnitudes;
  randomSegments = [];
  randomStackSpectrogram = [];
  activeRandomSegment = -1;
  rateSlider.value = body.sample_rate;
  if (metadataEl) {
    metadataEl.textContent = `${body.filename} · ${body.channels} channel(s) · ${body.sample_rate} Hz · ${body.duration.toFixed(2)} seconds`;
  }
  updateLabels();
  renderSpectrogram();
}

async function uploadImage() {
  if (!sessionId) return setError("Upload audio before loading an image.");
  if (!imageFileInput.files.length) return setError("Choose an image file first.");
  setError("");
  setStatus("Loading image...");
  const form = new FormData();
  form.append("image", imageFileInput.files[0]);
  try {
    const body = await requestJson("/api/image", { method: "POST", headers: { "X-Audio-Session": sessionId }, body: form });
    const image = new Image();
    image.onload = () => {
      imageCanvas.width = image.width;
      imageCanvas.height = image.height;
      imageCanvas.getContext("2d").drawImage(image, 0, 0);
      sourceImageData = imageCanvas.getContext("2d").getImageData(0, 0, image.width, image.height);
      renderImageCanvas();
    };
    image.src = body.image;
    imageNameEl.textContent = `${body.filename} · ${body.width} x ${body.height}`;
    setStatus("Image loaded");
  } catch (error) {
    setError(error.message);
    setStatus("Error");
  }
}

async function upload() {
  if (!fileInput.files.length) return setError("Choose a WAV or MP3 file first.");
  setError("");
  setStatus("Uploading...");
  const form = new FormData();
  form.append("audio", fileInput.files[0]);
  try {
    const response = await fetch("/api/upload", { method: "POST", body: form });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    sessionId = body.session_id;
    await refreshSpectrogram();
    [saveButton, breakTensorButton, playButton, stopButton, downloadButton, imageUploadButton, breakDurationInput]
      .filter(Boolean)
      .forEach((button) => { button.disabled = false; });
    tensorEditButtons.filter(Boolean).forEach((button) => { button.disabled = false; });
    updateTensorEditButtons();
    setStatus("Loaded");
  } catch (error) {
    setError(error.message);
    setStatus("Error");
  }
}

async function saveChanges() {
  setError("");
  try {
    await requestJson("/api/apply", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ gain: Number(gainSlider.value), pitch: 0 }),
    });
    await requestJson("/api/resample", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ sample_rate: Number(rateSlider.value) }),
    });
    gainSlider.value = "1";
    await refreshSpectrogram();
    setStatus("Changes kept");
  } catch (error) {
    setError(error.message);
    setStatus("Error");
  }
}

async function breakTensor() {
  setError("");
  try {
    const body = await requestJson("/api/break-tensor", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ seconds: Number(breakDurationInput.value) }),
    });
    breakDurationInput.value = body.chunk_seconds;
    breakDurationInput.disabled = false;
    randomTensorButton.disabled = false;
    playRandomButton.disabled = true;
    randomSegments = [];
    renderSpectrogram();
    setStatus(`Original tensor broken into ${body.tensor_count} ${body.chunk_seconds}-second tensors`);
  } catch (error) {
    setError(error.message);
    setStatus("Error");
  }
}

async function createRandomTensor() {
  setError("");
  try {
    const body = await requestJson("/api/random-tensor", { method: "POST", headers: headers() });
    randomSegments = body.segments.map((segment, index) => ({
      ...segment,
      color: index % 2 === 0 ? [18, 83, 190] : [22, 145, 92],
    }));
    randomStackSpectrogram = body.stack_spectrogram.values;
    spectrogram = randomStackSpectrogram;
    pitches = body.stack_spectrogram.pitches;
    pitchMagnitudes = body.stack_spectrogram.pitch_magnitudes;
    renderSpectrogram();
    playRandomButton.disabled = false;
    setStatus(`Random stack has ${body.stack_count} tensors (${body.random_duration.toFixed(2)} seconds)`);
  } catch (error) {
    setError(error.message);
    setStatus("Error");
  }
}

async function playAudio(tensor = "original", start = null, end = null) {
  try {
    const params = new URLSearchParams({ tensor });
    if (start !== null && end !== null) {
      params.set("start", start);
      params.set("end", end);
    }
    const response = await fetch(`/api/download?${params.toString()}`, { headers: { "X-Audio-Session": sessionId } });
    if (!response.ok) throw new Error("Could not load the audio.");
    audioContext = audioContext || new AudioContext();
    await audioContext.resume();
    const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
    if (playback) playback.source.stop();
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    playback = {
      source,
      startedAt: audioContext.currentTime,
      duration: buffer.duration,
      lastPaint: 0,
      random: tensor === "random",
    };
    playback.animationFrame = requestAnimationFrame(animatePlayback);
    source.onended = () => {
      if (playback?.source !== source) return;
      playback = null;
      activeRandomSegment = -1;
      renderSpectrogram();
      setStatus("Loaded");
    };
    source.start();
    setStatus("Playing");
  } catch (error) {
    setError(error.message);
  }
}

function stopPlayback() {
  if (!playback) return;
  if (playback.animationFrame) cancelAnimationFrame(playback.animationFrame);
  playback.source.onended = null;
  playback.source.stop();
  playback = null;
  activeRandomSegment = -1;
  renderSpectrogram();
  setStatus("Stopped");
}

async function downloadStacks() {
  setError("");
  try {
    const response = await fetch("/api/download?tensor=stacks", {
      headers: { "X-Audio-Session": sessionId },
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error || "Could not download the tensor stacks.");
    }

    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(await response.blob());
    link.href = objectUrl;
    link.download = "tensor_stacks.zip";
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    setStatus("Tensor stacks downloaded");
  } catch (error) {
    setError(error.message);
  }
}

function canvasSamplePosition(event) {
  if (!metadata?.samples) return 0;
  const rect = canvas.getBoundingClientRect();
  return Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * metadata.samples);
}

canvas.addEventListener("click", (event) => {
  if (!sessionId) return;
  const position = canvasSamplePosition(event);
  if (pasteMode) {
    pastePosition = position;
    renderSpectrogram();
    tensorEdit("paste", { position }).catch((error) => setError(error.message));
    return;
  }
  if (!selectionMode || selectionPoints.length >= 2) return;
  selectionPoints.push(position);
  renderSpectrogram();
  updateTensorEditButtons();
});

fileInput.addEventListener("change", () => { fileNameEl.textContent = fileInput.files[0]?.name || "No file selected"; });
imageFileInput.addEventListener("change", () => { imageNameEl.textContent = imageFileInput.files[0]?.name || "Choose an image"; });
uploadButton.addEventListener("click", upload);
imageUploadButton.addEventListener("click", uploadImage);
gainSlider.addEventListener("input", updateLabels);
pitchBrightnessSlider.addEventListener("input", () => {
  updateLabels();
  renderSpectrogram();
});
rateSlider.addEventListener("input", updateLabels);
if (saveButton) saveButton.addEventListener("click", saveChanges);
playButton.addEventListener("click", playAudio);
breakTensorButton.addEventListener("click", breakTensor);
randomTensorButton.addEventListener("click", createRandomTensor);
playRandomButton.addEventListener("click", () => playAudio("random"));
downloadButton.addEventListener("click", downloadStacks);
if (stopButton) stopButton.addEventListener("click", stopPlayback);
loadOriginalButton?.addEventListener("click", () => tensorEdit("load_original").catch((error) => setError(error.message)));
playLatestTensorButton?.addEventListener("click", () => playAudio("current"));
playSelectedTensorButton?.addEventListener("click", () => {
  if (selection) playAudio("current", selection.start, selection.end);
});
selectTensorButton?.addEventListener("click", () => {
  if (selectionPoints.length === 2) {
    selection = {
      start: Math.min(selectionPoints[0], selectionPoints[1]),
      end: Math.max(selectionPoints[0], selectionPoints[1]),
    };
    selectionMode = false;
  } else {
    selectionMode = true;
    selectionPoints = [];
    selection = null;
  }
  pasteMode = false;
  updateTensorEditButtons();
  renderSpectrogram();
});
clearSelectionButton?.addEventListener("click", () => {
  selection = null;
  selectionPoints = [];
  pastePosition = null;
  selectionMode = false;
  updateTensorEditButtons();
  renderSpectrogram();
});
copyTensorButton?.addEventListener("click", () => {
  clipboardMode = "copy";
  updateTensorEditButtons();
  tensorEdit("copy", selection).catch((error) => setError(error.message));
});
cutTensorButton?.addEventListener("click", () => {
  clipboardMode = "cut";
  updateTensorEditButtons();
  tensorEdit("cut", selection).catch((error) => setError(error.message));
});
pasteTensorButton?.addEventListener("click", () => {
  pasteMode = true;
  pastePosition = null;
  selectionMode = false;
  updateTensorEditButtons();
  renderSpectrogram();
});
deleteTensorButton?.addEventListener("click", () => tensorEdit("delete", selection).catch((error) => setError(error.message)));
backupTensorButton?.addEventListener("click", () => tensorEdit("backup").catch((error) => setError(error.message)));
downloadTensorButton?.addEventListener("click", async () => {
  try {
    const response = await fetch("/api/download?tensor=current", {
      headers: { "X-Audio-Session": sessionId },
    });
    if (!response.ok) throw new Error("Could not download the latest tensor.");
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "latest_tensor.wav";
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  } catch (error) {
    setError(error.message);
  }
});
undoTensorButton?.addEventListener("click", () => tensorEdit("undo").catch((error) => setError(error.message)));
window.addEventListener("resize", renderSpectrogram);