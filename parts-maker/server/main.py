"""Local API for parts-maker: segment + multi-view + depth/3D."""

from __future__ import annotations

import base64

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from depth_engine import estimate_depth
from segment_engine import DEFAULT_REMBG_MODEL, cutout_character, propose_parts
from view_engine import generate_views

app = FastAPI(title="parts-maker-api", version="0.5.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": f"rembg:{DEFAULT_REMBG_MODEL}+isolate+watershed",
        "cutout": f"rembg:{DEFAULT_REMBG_MODEL}+isolate",
        "views": "geometric-proxy (Replicate hook if env set)",
        "depth": "depth-anything-v2-small-onnx (heuristic fallback)",
    }


@app.post("/cutout")
async def cutout(
    file: UploadFile = File(...),
    max_side: int = 1024,
    model: str = DEFAULT_REMBG_MODEL,
):
    """Transparent character plate for ChatGPT reference (no part labels)."""
    raw = await file.read()
    rgba, _fg, tag = cutout_character(raw, max_side=max_side, model=model)
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
    return {
        "width": int(rgba.shape[1]),
        "height": int(rgba.shape[0]),
        "engine": tag,
        "imagePngBase64": base64.b64encode(buf.getvalue()).decode("ascii"),
    }


@app.post("/segment")
async def segment(
    file: UploadFile = File(...),
    max_side: int = 720,
    model: str = DEFAULT_REMBG_MODEL,
):
    raw = await file.read()
    result = propose_parts(raw, max_side=max_side, model=model)
    return {
        "width": result.width,
        "height": result.height,
        "engine": result.engine,
        "parts": result.parts,
        "labels": result.labels,
        "imagePngBase64": base64.b64encode(result.image_png).decode("ascii"),
    }


@app.post("/views")
async def views(file: UploadFile = File(...), max_side: int = 720):
    raw = await file.read()
    try:
        return generate_views(raw, max_side=max_side)
    except Exception as e:
        return {
            "engine": "error",
            "error": str(e),
            "views": [],
            "note": "view generation failed; use front image only or upload per-angle",
        }


@app.post("/depth")
async def depth(file: UploadFile = File(...), max_side: int = 512):
    raw = await file.read()
    try:
        return estimate_depth(raw, max_side=max_side)
    except Exception as e:
        return {
            "engine": "error",
            "error": str(e),
            "note": "depth failed — 3D preview unavailable",
        }
