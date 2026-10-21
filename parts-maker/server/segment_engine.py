"""
Neural FG (rembg/U2Net) + marker watershed part proposal.

Swap `propose_parts` internals for SAM later; keep the JSON contract stable.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove

# Spine-ish anatomical seed layout (normalized within FG bbox)
PART_SEEDS: list[tuple[str, float, float, int]] = [
    # name, nx, ny, drawOrder
    ("hat", 0.50, 0.05, 16),
    ("head", 0.50, 0.14, 15),
    ("hair", 0.42, 0.18, 14),
    ("torso", 0.50, 0.36, 10),
    ("vest", 0.50, 0.42, 11),
    ("left_upper_arm", 0.74, 0.34, 3),
    ("right_upper_arm", 0.26, 0.34, 19),
    ("left_forearm", 0.80, 0.48, 2),
    ("right_forearm", 0.20, 0.48, 18),
    ("left_hand", 0.84, 0.58, 1),
    ("right_hand", 0.16, 0.58, 17),
    ("sash", 0.55, 0.52, 12),
    ("pelvis", 0.50, 0.58, 13),
    ("left_thigh", 0.62, 0.70, 6),
    ("right_thigh", 0.38, 0.70, 9),
    ("left_lower_leg", 0.64, 0.84, 5),
    ("right_lower_leg", 0.36, 0.84, 8),
    ("left_foot", 0.66, 0.95, 4),
    ("right_foot", 0.34, 0.95, 7),
]

DEFAULT_PARENT = {
    "pelvis": "root",
    "torso": "pelvis",
    "vest": "torso",
    "sash": "pelvis",
    "head": "torso",
    "hair": "head",
    "hat": "head",
    "left_upper_arm": "torso",
    "left_forearm": "left_upper_arm",
    "left_hand": "left_forearm",
    "right_upper_arm": "torso",
    "right_forearm": "right_upper_arm",
    "right_hand": "right_forearm",
    "left_thigh": "pelvis",
    "left_lower_leg": "left_thigh",
    "left_foot": "left_lower_leg",
    "right_thigh": "pelvis",
    "right_lower_leg": "right_thigh",
    "right_foot": "right_lower_leg",
}

PALETTE = [
    "#E8A54B",
    "#3DB8A0",
    "#D45D5D",
    "#6B8FD4",
    "#C4A35A",
    "#8F6BC9",
    "#5BA85B",
    "#D4783A",
    "#4AA8C9",
    "#C96B8F",
    "#7A9E4E",
    "#B87A4A",
    "#5C7A9E",
    "#A85C7A",
    "#6A9E8A",
    "#C9A06B",
    "#5A8FA8",
    "#A86B5A",
    "#7A6BA8",
]

_session = None


def get_session(model: str = "u2net"):
    global _session
    if _session is None or getattr(_session, "_parts_model", None) != model:
        _session = new_session(model)
        setattr(_session, "_parts_model", model)
    return _session


@dataclass
class SegmentResult:
    width: int
    height: int
    # RGBA PNG bytes of (possibly resized) working image
    image_png: bytes
    # row-major labels: 0 = bg, else part id
    labels: list[int]
    parts: list[dict]
    engine: str


def _fg_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    if len(xs) == 0:
        h, w = mask.shape
        return 0, 0, w - 1, h - 1
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def _place_markers(
    fg: np.ndarray, seeds: list[tuple[str, float, float, int]]
) -> tuple[np.ndarray, list[tuple[int, str, int]]]:
    h, w = fg.shape
    markers = np.zeros((h, w), dtype=np.int32)
    min_x, min_y, max_x, max_y = _fg_bbox(fg)
    bw = max(1, max_x - min_x)
    bh = max(1, max_y - min_y)
    used: list[tuple[int, str, int]] = []
    mid = 1
    for name, nx, ny, draw in seeds:
        x = int(min_x + nx * bw)
        y = int(min_y + ny * bh)
        # snap to nearest FG pixel in a small radius
        found = False
        for r in range(0, 28):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < w and 0 <= yy < h and fg[yy, xx]:
                        cv2.circle(markers, (xx, yy), 4, mid, -1)
                        used.append((mid, name, draw))
                        mid += 1
                        found = True
                        break
                if found:
                    break
            if found:
                break
    # sure background marker
    markers[~fg] = 255
    return markers, used


def _watershed_parts(bgr: np.ndarray, fg: np.ndarray) -> tuple[np.ndarray, list[tuple[int, str, int]]]:
    # Edge-aware gradient for watershed
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    # Suppress gradients outside FG
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    grad = cv2.magnitude(gx, gy)
    grad[~fg] = 0
    # Normalize to 8-bit
    g8 = cv2.normalize(grad, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

    markers, used = _place_markers(fg, PART_SEEDS)
    if not used:
        return np.zeros(fg.shape, dtype=np.uint16), []

    # Gradient surface encourages cuts along character edges
    surface = cv2.cvtColor(g8, cv2.COLOR_GRAY2BGR)
    cv2.watershed(surface, markers)

    labels = np.zeros(fg.shape, dtype=np.uint16)
    for mid, _name, _draw in used:
        labels[markers == mid] = mid

    unassigned = fg & (labels == 0)
    if unassigned.any() and used:
        best_d = np.full(fg.shape, np.inf, dtype=np.float32)
        best_id = np.zeros(fg.shape, dtype=np.uint16)
        for mid, _, _ in used:
            mask = (labels == mid).astype(np.uint8)
            if not mask.any():
                continue
            d = cv2.distanceTransform(1 - mask, cv2.DIST_L2, 3)
            better = d < best_d
            best_d = np.where(better, d, best_d)
            best_id = np.where(better, mid, best_id)
        labels[unassigned] = best_id[unassigned]

    labels[~fg] = 0
    alive = [(mid, name, draw) for mid, name, draw in used if (labels == mid).any()]
    return labels, alive


def _compact_ids(
    labels: np.ndarray, used: list[tuple[int, str, int]]
) -> tuple[np.ndarray, list[dict]]:
    parts: list[dict] = []
    out = np.zeros_like(labels)
    new_id = 1
    h, w = labels.shape
    for mid, name, draw in used:
        mask = labels == mid
        if not mask.any():
            continue
        out[mask] = new_id
        ys, xs = np.where(mask)
        parts.append(
            {
                "id": new_id,
                "name": name,
                "drawOrder": draw,
                "color": PALETTE[(new_id - 1) % len(PALETTE)],
                "parent": DEFAULT_PARENT.get(name),
                "pivot": {
                    "x": float(xs.mean() / max(1, w - 1)),
                    "y": float(ys.mean() / max(1, h - 1)),
                },
            }
        )
        new_id += 1
    return out, parts


def crop_and_fit_foreground(
    rgba: np.ndarray,
    fg: np.ndarray,
    *,
    max_side: int = 720,
    pad_ratio: float = 0.06,
) -> tuple[np.ndarray, np.ndarray]:
    """Tight-crop to FG bbox (with padding), then upscale so the subject fills the canvas.

    Fixes uploads where the character sits in a large scene/icon frame and appears
    tiny at the bottom of the workspace.
    """
    ys, xs = np.where(fg)
    if len(xs) == 0:
        return rgba, fg
    min_x, max_x = int(xs.min()), int(xs.max())
    min_y, max_y = int(ys.min()), int(ys.max())
    bw = max(1, max_x - min_x + 1)
    bh = max(1, max_y - min_y + 1)
    pad = int(max(bw, bh) * pad_ratio) + 8
    h, w = fg.shape
    x0 = max(0, min_x - pad)
    y0 = max(0, min_y - pad)
    x1 = min(w, max_x + pad + 1)
    y1 = min(h, max_y + pad + 1)
    rgba = rgba[y0:y1, x0:x1].copy()
    fg = fg[y0:y1, x0:x1].copy()

    ch, cw = fg.shape
    side = max(cw, ch)
    if side < 32:
        return rgba, fg
    # Fit longest side to max_side (upscale small subjects, downscale huge ones)
    scale = max_side / side
    if abs(scale - 1.0) > 0.02:
        nw = max(1, int(round(cw * scale)))
        nh = max(1, int(round(ch * scale)))
        rgba = cv2.resize(rgba, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
        fg_u8 = cv2.resize(
            fg.astype(np.uint8) * 255,
            (nw, nh),
            interpolation=cv2.INTER_NEAREST,
        )
        fg = fg_u8 > 127
    return rgba, fg


def propose_parts(
    image_bytes: bytes,
    *,
    max_side: int = 720,
    model: str = "u2net",
) -> SegmentResult:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    # Keep enough resolution for rembg; final fit happens after FG crop
    pre_side = max(max_side, 900)
    scale = min(1.0, pre_side / max(img.size))
    if scale < 1:
        img = img.resize(
            (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
            Image.Resampling.LANCZOS,
        )

    session = get_session(model)
    cut = remove(img, session=session)
    rgba = np.array(cut)
    alpha = rgba[:, :, 3]
    fg = alpha > 40

    # Morphology cleanup
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_OPEN, k).astype(bool)
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, k).astype(bool)

    rgba, fg = crop_and_fit_foreground(rgba, fg, max_side=max_side)
    # Clear RGB outside FG so leftover scene doesn't confuse watershed
    rgba[~fg, :3] = 0
    rgba[~fg, 3] = 0

    bgr = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2BGR)
    raw_labels, used = _watershed_parts(bgr, fg)
    labels, parts = _compact_ids(raw_labels, used)

    # Encode working image (original colors with alpha from rembg)
    out_img = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    out_img.save(buf, format="PNG")

    return SegmentResult(
        width=labels.shape[1],
        height=labels.shape[0],
        image_png=buf.getvalue(),
        labels=labels.astype(np.uint16).reshape(-1).tolist(),
        parts=parts,
        engine=f"rembg:{model}+watershed",
    )
