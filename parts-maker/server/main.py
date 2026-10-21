"""Local API for parts-maker: segment + multi-view."""

from __future__ import annotations

import base64

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from segment_engine import propose_parts
from view_engine import generate_views

app = FastAPI(title="parts-maker-api", version="0.3.0")
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
        "engine": "rembg:u2net+watershed",
        "views": "geometric-proxy (Replicate hook if env set)",
    }


@app.post("/segment")
async def segment(file: UploadFile = File(...), max_side: int = 720, model: str = "u2net"):
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
        # Never take down the app — client falls back / keeps front only
        return {
            "engine": "error",
            "error": str(e),
            "views": [],
            "note": "view generation failed; use front image only or upload per-angle",
        }
