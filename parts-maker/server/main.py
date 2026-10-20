"""Local segmentation API for parts-maker (rembg + watershed)."""

from __future__ import annotations

import base64

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from segment_engine import propose_parts

app = FastAPI(title="parts-maker-segment", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "engine": "rembg:u2net+watershed"}


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
