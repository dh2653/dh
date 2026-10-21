"""
Depth estimation for Phase 4 3D preview.

Primary: Depth Anything V2 Small (ONNX) — real monocular depth.
Fallback: rembg FG distance-transform + luminance (heuristic stub).

Model auto-downloads to server/models/ on first use (not committed).
"""

from __future__ import annotations

import base64
import io
import os
import urllib.request
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image
from rembg import new_session, remove

from segment_engine import crop_and_fit_foreground

MODELS_DIR = Path(__file__).resolve().parent / "models"
MODEL_PATH = MODELS_DIR / "depth_anything_v2_vits.onnx"
MODEL_URL = (
    "https://huggingface.co/onnx-community/depth-anything-v2-small/"
    "resolve/main/onnx/model.onnx"
)

_session = None
_rembg = None


def ensure_model() -> bool:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size > 1_000_000:
        return True
    try:
        print(f"Downloading depth model → {MODEL_PATH}")
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
        return MODEL_PATH.exists() and MODEL_PATH.stat().st_size > 1_000_000
    except Exception as e:
        print("depth model download failed:", e)
        return False


def get_ort():
    global _session
    if _session is None:
        if not ensure_model():
            return None
        _session = ort.InferenceSession(
            str(MODEL_PATH), providers=["CPUExecutionProvider"]
        )
    return _session


def get_rembg():
    global _rembg
    if _rembg is None:
        _rembg = new_session("u2net")
    return _rembg


def _png_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _normals_from_depth(depth01: np.ndarray) -> np.ndarray:
    """Sobel-based normals from depth (RGB, 0..255)."""
    gx = cv2.Sobel(depth01, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(depth01, cv2.CV_32F, 0, 1, ksize=3)
    # z component — stronger scale = flatter
    gz = np.ones_like(depth01) * 0.15
    n = np.stack([-gx, -gy, gz], axis=-1)
    norm = np.linalg.norm(n, axis=-1, keepdims=True) + 1e-8
    n = n / norm
    rgb = ((n * 0.5 + 0.5) * 255).astype(np.uint8)
    return rgb


def _heuristic_depth(rgba: np.ndarray) -> np.ndarray:
    alpha = rgba[:, :, 3]
    fg = (alpha > 40).astype(np.uint8)
    dist = cv2.distanceTransform(fg, cv2.DIST_L2, 5)
    if dist.max() > 0:
        dist = dist / dist.max()
    gray = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    # closer = brighter / center of body
    d = dist * 0.65 + (1.0 - gray) * 0.35
    d *= fg
    if d.max() > 0:
        d = d / d.max()
    return d.astype(np.float32)


def _run_depth_anything(rgb: np.ndarray) -> np.ndarray:
    sess = get_ort()
    if sess is None:
        raise RuntimeError("onnx model unavailable")
    h, w = rgb.shape[:2]
    # multiple of 14
    th = max(14, (h // 14) * 14)
    tw = max(14, (w // 14) * 14)
    resized = cv2.resize(rgb, (tw, th), interpolation=cv2.INTER_AREA)
    x = resized.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    x = ((x - mean) / std).transpose(2, 0, 1)[None]
    out = sess.run(None, {"pixel_values": x})[0][0]
    d = cv2.resize(out.astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)
    d = (d - d.min()) / (d.max() - d.min() + 1e-8)
    return d


def estimate_depth(image_bytes: bytes, *, max_side: int = 512) -> dict[str, Any]:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    scale = min(1.0, max_side / max(img.size))
    if scale < 1:
        img = img.resize(
            (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
            Image.Resampling.LANCZOS,
        )
    cut = remove(img, session=get_rembg())
    rgba = np.array(cut)
    alpha = rgba[:, :, 3]
    fg = alpha > 40
    rgba, fg = crop_and_fit_foreground(rgba, fg, max_side=max_side)
    rgba[~fg, :3] = 0
    rgba[~fg, 3] = 0
    rgb = rgba[:, :, :3]
    alpha = rgba[:, :, 3]

    engine = "depth-anything-v2-small-onnx"
    try:
        depth = _run_depth_anything(rgb)
        # zero out background
        depth = depth * (alpha > 40).astype(np.float32)
        if depth.max() > 0:
            depth = depth / depth.max()
    except Exception as e:
        print("DA-V2 failed, heuristic:", e)
        depth = _heuristic_depth(rgba)
        engine = "heuristic-depth-stub"

    depth_u8 = (depth * 255).astype(np.uint8)
    # Apply alpha for nicer preview
    depth_rgba = np.dstack([depth_u8, depth_u8, depth_u8, alpha])
    normals = _normals_from_depth(depth)
    normals_rgba = np.dstack([normals, alpha])

    color_plate = Image.fromarray(rgba, "RGBA")
    depth_img = Image.fromarray(depth_rgba, "RGBA")
    normal_img = Image.fromarray(normals_rgba, "RGBA")

    # Float depth row-major for mesh (normalized 0..1)
    depth_list = depth.astype(np.float32).reshape(-1).tolist()

    return {
        "engine": engine,
        "width": int(rgba.shape[1]),
        "height": int(rgba.shape[0]),
        "colorPngBase64": _png_b64(color_plate),
        "depthPngBase64": _png_b64(depth_img),
        "normalPngBase64": _png_b64(normal_img),
        "depth": depth_list,
        "note": (
            "Real monocular depth (Depth Anything V2 Small ONNX)."
            if engine.startswith("depth-anything")
            else "Stub heuristic depth — install/download ONNX model for real depth."
        ),
    }
