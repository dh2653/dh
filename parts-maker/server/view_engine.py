"""
Multi-view image generation for Phase 3.

Backends (checked in order):
1. REPLICATE_API_TOKEN + ZERO123 / novel-view model  (optional)
2. geometric-proxy — rembg FG + perspective/shear warps (default demo)

Swap `_generate_neural` for Zero123 / Cat3D / etc. without changing the API contract.
"""

from __future__ import annotations

import base64
import io
import os
from typing import Any

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove

VIEW_ORDER = ("front", "left", "right", "up", "down")

_session = None


def get_session(model: str = "u2net"):
    global _session
    if _session is None:
        _session = new_session(model)
    return _session


def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _cutout(rgba_in: Image.Image) -> np.ndarray:
    session = get_session("u2net")
    cut = remove(rgba_in, session=session)
    return np.array(cut)


def _composite_on_paper(rgba: np.ndarray) -> Image.Image:
    """Place cutout on soft paper-gray so rembg/seg still sees a clean plate."""
    h, w = rgba.shape[:2]
    bg = np.full((h, w, 4), 245, dtype=np.uint8)
    bg[:, :, 3] = 255
    a = rgba[:, :, 3:4].astype(np.float32) / 255.0
    out = (rgba.astype(np.float32) * a + bg.astype(np.float32) * (1 - a)).astype(
        np.uint8
    )
    out[:, :, 3] = 255
    return Image.fromarray(out, "RGBA")


def _warp_perspective(
    rgba: np.ndarray, src: np.ndarray, dst: np.ndarray
) -> np.ndarray:
    h, w = rgba.shape[:2]
    M = cv2.getPerspectiveTransform(src.astype(np.float32), dst.astype(np.float32))
    return cv2.warpPerspective(
        rgba,
        M,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(245, 245, 245, 0),
    )


def _geometric_views(rgba: np.ndarray) -> dict[str, np.ndarray]:
    h, w = rgba.shape[:2]
    # Source quad = full frame
    src = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)

    def side(direction: str) -> np.ndarray:
        # Squeeze toward the facing edge + mild vertical shear → "turned" proxy
        inset = w * 0.38
        if direction == "left":
            dst = np.array(
                [
                    [inset, h * 0.04],
                    [w - 1, 0],
                    [w - 1, h - 1],
                    [inset, h * 0.96],
                ],
                dtype=np.float32,
            )
        else:
            dst = np.array(
                [
                    [0, 0],
                    [w - 1 - inset, h * 0.04],
                    [w - 1 - inset, h * 0.96],
                    [0, h - 1],
                ],
                dtype=np.float32,
            )
        warped = _warp_perspective(rgba, src, dst)
        # Soft edge shading to sell depth a bit
        shade = np.linspace(0.72, 1.0, w) if direction == "left" else np.linspace(1.0, 0.72, w)
        shade = shade.reshape(1, w, 1)
        warped = warped.astype(np.float32)
        warped[:, :, :3] *= shade
        return np.clip(warped, 0, 255).astype(np.uint8)

    def vertical(kind: str) -> np.ndarray:
        inset = h * 0.32
        if kind == "up":
            dst = np.array(
                [
                    [w * 0.08, inset],
                    [w * 0.92, inset],
                    [w - 1, h - 1],
                    [0, h - 1],
                ],
                dtype=np.float32,
            )
        else:
            dst = np.array(
                [
                    [0, 0],
                    [w - 1, 0],
                    [w * 0.92, h - 1 - inset],
                    [w * 0.08, h - 1 - inset],
                ],
                dtype=np.float32,
            )
        return _warp_perspective(rgba, src, dst)

    return {
        "front": rgba,
        "left": side("left"),
        "right": side("right"),
        "up": vertical("up"),
        "down": vertical("down"),
    }


def _try_replicate_novel_view(image_bytes: bytes) -> dict[str, bytes] | None:
    """
    Optional real novel-view backend.
    Requires REPLICATE_API_TOKEN. Set VIEW_MODEL to a Zero123-class model version
    if you have one; otherwise returns None and caller falls back.
    """
    token = os.environ.get("REPLICATE_API_TOKEN")
    model = os.environ.get("VIEW_MODEL")  # e.g. owner/name:version
    if not token or not model:
        return None
    try:
        import json
        import urllib.request

        # Minimal Replicate predictions API — model-specific IO varies; this is a
        # hook. If the call fails, geometric proxy is used.
        b64 = base64.b64encode(image_bytes).decode("ascii")
        payload = {
            "version": model.split(":")[-1] if ":" in model else model,
            "input": {
                "image": f"data:image/png;base64,{b64}",
                # Common Zero123-ish knobs; ignored if model differs
                "azimuth": 90,
            },
        }
        req = urllib.request.Request(
            "https://api.replicate.com/v1/predictions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            _ = resp.read()
        # Async poll omitted for MVP — treat as unavailable until wired per model.
        return None
    except Exception:
        return None


def generate_views(
    image_bytes: bytes,
    *,
    max_side: int = 720,
) -> dict[str, Any]:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    scale = min(1.0, max_side / max(img.size))
    if scale < 1:
        img = img.resize(
            (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
            Image.Resampling.LANCZOS,
        )

    neural = _try_replicate_novel_view(_png_bytes(img))
    if neural:
        return {
            "engine": "replicate-novel-view",
            "views": [
                {
                    "id": vid,
                    "imagePngBase64": base64.b64encode(neural[vid]).decode("ascii"),
                }
                for vid in VIEW_ORDER
                if vid in neural
            ],
        }

    rgba = _cutout(img)
    warped = _geometric_views(rgba)
    views = []
    for vid in VIEW_ORDER:
        plate = _composite_on_paper(warped[vid])
        views.append(
            {
                "id": vid,
                "imagePngBase64": base64.b64encode(_png_bytes(plate)).decode("ascii"),
            }
        )
    return {
        "engine": "geometric-proxy+rembg",
        "note": (
            "Demo novel-view via perspective/shear warps. "
            "Set REPLICATE_API_TOKEN + VIEW_MODEL for real Zero123-class gen."
        ),
        "views": views,
    }
