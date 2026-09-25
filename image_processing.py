from pathlib import Path
import io
import base64
import torch
from PIL import Image
import numpy as np

DEFAULT_IMAGE = Path(__file__).with_name("sample.png")

def get_image_data_url(image_tensor: torch.Tensor) -> str:
    """Converts a standard image tensor into a base64 encoded data URI."""
    pixels = (
        image_tensor.detach().cpu().clamp(0, 1).mul(255).byte().permute(1, 2, 0).numpy()
    )
    output = io.BytesIO()
    Image.fromarray(pixels, mode="RGB").save(output, format="PNG")
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def create_sample_image(path: Path = DEFAULT_IMAGE) -> Path:
    """Create a small RGB test image when no source image has been supplied."""
    height, width = 96, 144
    y, x = np.mgrid[0:height, 0:width]
    red = (x / (width - 1) * 255).astype(np.uint8)
    green = (y / (height - 1) * 255).astype(np.uint8)
    blue = (((x + y) / (width + height - 2)) * 255).astype(np.uint8)
    tensor = np.stack((red, green, blue), axis=-1)
    Image.fromarray(tensor, mode="RGB").save(path)
    return path


def load_rgb_tensor(path: Path = DEFAULT_IMAGE) -> np.ndarray:
    """Load an image as an H x W x 3 uint8 RGB tensor."""
    if not path.exists():
        create_sample_image(path)
    with Image.open(path) as image:
        return np.asarray(image.convert("RGB"), dtype=np.uint8).copy()


def tensor_payload(tensor: np.ndarray) -> dict:
    """Convert the tensor into JSON-friendly data for the canvas."""
    height, width, channels = tensor.shape
    if channels != 3:
        raise ValueError("Expected an RGB tensor with three channels")
    return {
        "width": width,
        "height": height,
        "channels": ["r", "g", "b"],
        "pixels": tensor.tolist(),
    }
