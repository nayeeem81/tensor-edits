const canvas = document.querySelector('#tensor-canvas');
const selectionCanvas = document.querySelector('#selection-canvas');
const context = canvas.getContext('2d', { alpha: false });
const selectionContext = selectionCanvas.getContext('2d');
const shape = document.querySelector('#shape');
const position = document.querySelector('#pixel-position');
const pixelValues = document.querySelector('#pixel-values');
const downloadButton = document.querySelector('#download-button');
const imageUpload = document.querySelector('#image-upload');
const imageName = document.querySelector('#image-name');
const controls = [
  document.querySelector('#red-control'),
  document.querySelector('#green-control'),
  document.querySelector('#blue-control'),
];
const numberControls = [
  document.querySelector('#red-number'),
  document.querySelector('#green-number'),
  document.querySelector('#blue-number'),
];
const outputs = [
  document.querySelector('#red-value'),
  document.querySelector('#green-value'),
  document.querySelector('#blue-value'),
];
let tensor;
let originalTensor;
let tensorStack = [];
let dots = [];
let selectedPolygon = null;
let selectionSource = 'latest';

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}

function pixelIsSelected(x, y) {
  return !selectedPolygon || isPointInPolygon({ x, y }, selectedPolygon);
}

function cloneTensor(source) {
  return {
    width: source.width,
    height: source.height,
    channels: [...source.channels],
    pixels: source.pixels.map((row) => row.map((pixel) => [...pixel])),
  };
}

function setTensorStack(initialTensor) {
  originalTensor = cloneTensor(initialTensor);
  tensorStack = [cloneTensor(initialTensor)];
  tensor = tensorStack[0];
  updateTensorReadout();
}

function updateTensorReadout() {
  if (!tensor) return;
  shape.textContent = `${tensor.height} × ${tensor.width} × 3 uint8`;
  document.querySelector('#tensor-count').textContent = `Stack ${tensorStack.length}`;
  document.querySelector('#undo-button').disabled = tensorStack.length <= 1;
}

function displayPixel(x, y) {
  const latest = tensor.pixels[y][x];
  if (!selectedPolygon || !pixelIsSelected(x, y) || selectionSource === 'latest') {
    return latest;
  }
  return originalTensor.pixels[y][x];
}

function render() {
  const { width, height, pixels } = tensor;
  const image = context.createImageData(width, height);
  const offsets = controls.map((control) => Number(control.value));
  outputs.forEach((output, index) => { output.value = offsets[index] > 0 ? `+${offsets[index]}` : offsets[index]; });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = displayPixel(x, y);
      const index = (y * width + x) * 4;
      image.data[index] = clamp(source[0] + offsets[0]);
      image.data[index + 1] = clamp(source[1] + offsets[1]);
      image.data[index + 2] = clamp(source[2] + offsets[2]);
      image.data[index + 3] = 255;
    }

  }
  context.putImageData(image, 0, 0);
  drawSelection();
}

function syncNumberControls() {
  controls.forEach((control, index) => {
    numberControls[index].value = control.value;
  });
}

function setControlValue(index, value) {
  const control = controls[index];
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    numberControls[index].value = control.value;
    return;
  }
  const clampedValue = Math.max(Number(control.min), Math.min(Number(control.max), numericValue));
  control.value = clampedValue;
  numberControls[index].value = clampedValue;
  render();
}

function isPointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses = currentPoint.y > point.y !== previousPoint.y > point.y;
    const intersects = point.x < (previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)
      / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses && intersects) inside = !inside;
  }
  return inside;
}

function drawSelection() {
  selectionContext.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
  if (!dots.length) return;

  selectionContext.save();
  selectionContext.lineWidth = Math.max(1, tensor.width / 360);
  selectionContext.lineJoin = 'round';
  selectionContext.lineCap = 'round';
  selectionContext.strokeStyle = '#f5c451';
  selectionContext.fillStyle = 'rgba(245, 196, 81, 0.2)';
  selectionContext.beginPath();
  selectionContext.moveTo(dots[0].x, dots[0].y);
  dots.slice(1).forEach((dot) => selectionContext.lineTo(dot.x, dot.y));
  if (selectedPolygon) {
    selectionContext.closePath();
    selectionContext.fill();
  }
  selectionContext.stroke();
  dots.forEach((dot) => {
    selectionContext.beginPath();
    selectionContext.fillStyle = '#fffdf8';
    selectionContext.arc(dot.x, dot.y, Math.max(2.5, tensor.width / 180), 0, Math.PI * 2);
    selectionContext.fill();
    selectionContext.lineWidth = 2;
    selectionContext.strokeStyle = '#202426';
    selectionContext.stroke();
  });
  selectionContext.restore();
}

function canvasPoint(event) {
  const bounds = selectionCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * tensor.width / bounds.width,
    y: (event.clientY - bounds.top) * tensor.height / bounds.height,
  };
}

function showPixel(event) {
  const point = canvasPoint(event);
  const x = Math.min(tensor.width - 1, Math.max(0, Math.floor(point.x)));
  const y = Math.min(tensor.height - 1, Math.max(0, Math.floor(point.y)));
  const source = displayPixel(x, y);
  const adjusted = source.map((value, index) => clamp(value + Number(controls[index].value)));
  position.textContent = `x ${x} / y ${y}`;
  pixelValues.textContent = `R ${adjusted[0]}   G ${adjusted[1]}   B ${adjusted[2]}`;
}

async function loadTensor() {
  const response = await fetch('/api/tensor');
  if (!response.ok) throw new Error('Tensor request failed');
  setTensorStack(await response.json());
  canvas.width = tensor.width;
  canvas.height = tensor.height;
  selectionCanvas.width = tensor.width;
  selectionCanvas.height = tensor.height;
  render();
}

function readImageAsTensor(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const sourceCanvas = document.createElement('canvas');
      const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;
      sourceContext.drawImage(image, 0, 0);
      const pixels = sourceContext.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data;
      const tensorPixels = [];

      for (let y = 0; y < image.naturalHeight; y += 1) {
        const row = [];
        for (let x = 0; x < image.naturalWidth; x += 1) {
          const index = (y * image.naturalWidth + x) * 4;
          row.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
        }
        tensorPixels.push(row);
      }
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight, channels: ['r', 'g', 'b'], pixels: tensorPixels });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('The selected file is not a readable image'));
    };
    image.src = objectUrl;
  });
}

controls.forEach((control, index) => control.addEventListener('input', () => {
  numberControls[index].value = control.value;
  render();
}));
numberControls.forEach((control, index) => control.addEventListener('change', () => {
  setControlValue(index, control.value);
}));
selectionCanvas.addEventListener('pointermove', showPixel);
selectionCanvas.addEventListener('click', (event) => {
  if (selectedPolygon) return;
  dots.push(canvasPoint(event));
  drawSelection();
});
downloadButton.addEventListener('click', () => {
  if (!tensor) return;
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = tensor.width;
  outputCanvas.height = tensor.height;
  const outputContext = outputCanvas.getContext('2d', { alpha: false });
  const image = outputContext.createImageData(tensor.width, tensor.height);
  tensor.pixels.forEach((row, y) => row.forEach((pixel, x) => {
    const index = (y * tensor.width + x) * 4;
    image.data[index] = pixel[0];
    image.data[index + 1] = pixel[1];
    image.data[index + 2] = pixel[2];
    image.data[index + 3] = 255;
  }));
  outputContext.putImageData(image, 0, 0);
  outputCanvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.download = 'tensor-lens-adjusted.png';
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }, 'image/png');
});
document.querySelector('#upload-button').addEventListener('click', () => imageUpload.click());
imageUpload.addEventListener('change', async () => {
  const [file] = imageUpload.files;
  if (!file) return;
  try {
    setTensorStack(await readImageAsTensor(file));
    canvas.width = tensor.width;
    canvas.height = tensor.height;
    selectionCanvas.width = tensor.width;
    selectionCanvas.height = tensor.height;
    dots = [];
    selectedPolygon = null;
    selectionSource = 'latest';
    imageName.textContent = file.name;
    render();
  } catch (error) {
    imageName.textContent = error.message;
  }
});
document.querySelector('#create-selection-button').addEventListener('click', () => {
  if (dots.length < 3) return;
  selectedPolygon = [...dots];
  selectionSource = 'latest';
  render();
});
document.querySelector('#create-original-selection-button').addEventListener('click', () => {
  if (dots.length < 3) return;
  selectedPolygon = [...dots];
  selectionSource = 'original';
  render();
});
document.querySelector('#clear-selection-button').addEventListener('click', () => {
  dots = [];
  selectedPolygon = null;
  selectionSource = 'latest';
  render();
});
document.querySelector('#update-button').addEventListener('click', () => {
  if (!tensor) return;
  const offsets = controls.map((control) => Number(control.value));
  const nextTensor = cloneTensor(tensor);

  for (let y = 0; y < nextTensor.height; y += 1) {
    for (let x = 0; x < nextTensor.width; x += 1) {
      if (!pixelIsSelected(x, y)) continue;
      const source = selectionSource === 'original'
        ? originalTensor.pixels[y][x]
        : tensor.pixels[y][x];
      nextTensor.pixels[y][x] = source.map((value, index) => clamp(value + offsets[index]));
    }
  }

  tensorStack.push(nextTensor);
  tensor = nextTensor;
  updateTensorReadout();
  controls.forEach((control) => { control.value = 0; });
  syncNumberControls();
  dots = [];
  selectedPolygon = null;
  selectionSource = 'latest';
  render();
});
document.querySelector('#undo-button').addEventListener('click', () => {
  if (tensorStack.length <= 1) return;
  tensorStack.pop();
  tensor = tensorStack[tensorStack.length - 1];
  controls.forEach((control) => { control.value = 0; });
  syncNumberControls();
  dots = [];
  selectedPolygon = null;
  selectionSource = 'latest';
  updateTensorReadout();
  render();
});
document.querySelector('#reset-button').addEventListener('click', () => {
  controls.forEach((control) => { control.value = 0; });
  syncNumberControls();
  render();
});
loadTensor().catch((error) => {
  shape.textContent = 'Tensor unavailable';
  position.textContent = error.message;
});