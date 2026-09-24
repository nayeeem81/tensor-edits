import io
import base64
import torch
from PIL import Image


def get_image_data_url(image_tensor: torch.Tensor) -> str:
    """Converts a standard image tensor into a base64 encoded data URI."""
    pixels = (
        image_tensor.detach().cpu().clamp(0, 1).mul(255).byte().permute(1, 2, 0).numpy()
    )
    output = io.BytesIO()
    Image.fromarray(pixels, mode="RGB").save(output, format="PNG")
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"
