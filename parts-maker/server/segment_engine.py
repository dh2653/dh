"""
Neural FG (rembg) + character isolation + marker watershed part proposal.

Parts are for the character only — scenic leftovers are stripped before watershed.
Swap `propose_parts` internals for SAM later; keep the JSON contract stable.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove

# Better general subject cutout than u2net for icon/scene plates.
DEFAULT_REMBG_MODEL = "isnet-general-use"

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


def get_session(model: str = DEFAULT_REMBG_MODEL):
    global _session
    if _session is None or getattr(_session, "_parts_model", None) != model:
        _session = new_session(model)
        setattr(_session, "_parts_model", model)
    return _session


def isolate_character(rgba_rembg: np.ndarray, rgb_orig: np.ndarray) -> np.ndarray:
    """Keep the main character (+ props); drop scenic leftovers from rembg FG.

    Clean tall cutouts get a light GrabCut refine. Squarish scene/icon plates
    (beach, buildings still in the alpha) use GrabCut on the original RGB with
    a subject rect, then strip soft left-fringe haze.
    """
    h, w = rgba_rembg.shape[:2]
    if rgb_orig.shape[0] != h or rgb_orig.shape[1] != w:
        rgb_orig = cv2.resize(rgb_orig, (w, h), interpolation=cv2.INTER_AREA)

    fg_r = (rgba_rembg[:, :, 3] > 40).astype(np.uint8)
    if fg_r.mean() < 0.02:
        return fg_r.astype(bool)

    ys, xs = np.where(fg_r)
    bw = int(xs.max() - xs.min() + 1)
    bh = int(ys.max() - ys.min() + 1)
    fill = float(fg_r.mean())
    aspect = bh / max(1, bw)
    bbox_fill = (bw * bh) / float(w * h)
    touches = (
        int(fg_r[:, 0].any())
        + int(fg_r[:, w - 1].any())
        + int(fg_r[0, :].any())
    )
    # Scene icons: squarish plate where rembg still keeps a large area.
    # Tall portraits skip the aggressive path (protects dark clothing).
    scenic = (
        (fill > 0.35 and bbox_fill > 0.55 and aspect < 1.55)
        or (touches >= 2 and fill > 0.30)
        or (fill > 0.45 and aspect < 1.35)
    )

    bgr = cv2.cvtColor(rgb_orig, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(rgb_orig, cv2.COLOR_RGB2GRAY).astype(np.float32)
    lap = cv2.Laplacian(gray, cv2.CV_32F, ksize=3)
    sharp = cv2.GaussianBlur(np.abs(lap), (7, 7), 0)

    if not scenic:
        mask = np.full((h, w), cv2.GC_BGD, np.uint8)
        mask[fg_r > 0] = cv2.GC_PR_FGD
        band = max(4, min(h, w) // 20)
        mask[:band, :] = cv2.GC_BGD
        mask[-band:, :] = cv2.GC_BGD
        mask[:, :band] = cv2.GC_BGD
        mask[:, -band:] = cv2.GC_BGD
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
        core = cv2.erode(fg_r, k)
        yy, xx = np.ogrid[:h, :w]
        dist = np.sqrt((yy - h / 2.0) ** 2 + (xx - w / 2.0) ** 2)
        mask[(core > 0) & (dist < 0.4 * max(h, w))] = cv2.GC_FGD
        bgd = np.zeros((1, 65), np.float64)
        fgd = np.zeros((1, 65), np.float64)
        try:
            cv2.grabCut(bgr, mask, None, bgd, fgd, 4, cv2.GC_INIT_WITH_MASK)
            char = np.where((mask == 1) | (mask == 3), 1, 0).astype(np.uint8)
        except Exception:
            char = fg_r.copy()
        if char.mean() < 0.85 * fill:
            char = fg_r.copy()
        n, lab, stats, _ = cv2.connectedComponentsWithStats(char, 8)
        if n > 1:
            best = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
            char = (lab == best).astype(np.uint8)
        return char.astype(bool)

    # Deterministic mask-init GrabCut (more stable than RECT-only).
    pad_x, pad_y = int(0.12 * w), int(0.08 * h)
    x0 = max(pad_x, int(xs.min() + 0.05 * bw))
    y0 = max(pad_y // 2, int(ys.min()))
    x1 = min(w - pad_x, int(xs.max() - 0.02 * bw))
    y1 = min(h - pad_y // 3, int(ys.max()))
    mask = np.full((h, w), cv2.GC_BGD, np.uint8)
    mask[fg_r > 0] = cv2.GC_PR_BGD
    mask[y0:y1, x0:x1] = np.where(
        fg_r[y0:y1, x0:x1] > 0, cv2.GC_PR_FGD, cv2.GC_BGD
    )
    yy, xx = np.ogrid[:h, :w]
    # Definite FG: central vertical ellipse inside rembg
    cx, cy = 0.48 * w, 0.42 * h
    rx, ry = 0.16 * w, 0.28 * h
    ellipse = ((xx - cx) / max(1.0, rx)) ** 2 + ((yy - cy) / max(1.0, ry)) ** 2 <= 1.0
    mask[(ellipse) & (fg_r > 0)] = cv2.GC_FGD
    # Far-left rembg leftovers → definite BG (beach/mountain stubs)
    mask[(fg_r > 0) & (xx < 0.18 * w)] = cv2.GC_BGD
    band = max(4, min(h, w) // 18)
    mask[:band, :] = cv2.GC_BGD
    mask[-band:, :] = cv2.GC_BGD
    mask[:, :band] = cv2.GC_BGD
    mask[:, -band:] = cv2.GC_BGD
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(bgr, mask, None, bgd, fgd, 5, cv2.GC_INIT_WITH_MASK)
        grab = np.where((mask == 1) | (mask == 3), 1, 0).astype(np.uint8)
    except Exception:
        grab = fg_r.copy()
    grab = grab & cv2.dilate(
        fg_r, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    )
    if not grab.any():
        grab = fg_r.copy()

    # Grow from bright/sharp body core inside an allowed domain that
    # excludes soft left haze — keeps limbs, drops scenic blobs even when
    # GrabCut flickers between runs.
    med_sh = float(np.median(sharp[grab > 0])) if grab.any() else 10.0
    lum = gray
    seed = (
        (grab > 0)
        & (lum > 85)
        & (sharp > max(4.0, med_sh * 0.35))
        & (xx > 0.22 * w)
    ).astype(np.uint8)
    seed = cv2.erode(seed, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    if seed.sum() < 40:
        seed = ((grab > 0) & (lum > 70) & (xx > 0.2 * w)).astype(np.uint8)

    gcx = float(np.where(grab > 0)[1].mean()) if grab.any() else w * 0.5
    allowed = cv2.dilate(grab, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    allowed = allowed & fg_r
    # Soft / haze left of the body — scenic leftovers cling here
    soft_left = (sharp < med_sh * 0.40) & (xx < gcx - 0.08 * w)
    allowed[soft_left] = 0
    allowed[(lum < 85) & (sharp < med_sh * 0.55) & (xx < 0.34 * w)] = 0
    # Tiny soft blobs anywhere left of body centroid
    soft_all = ((allowed > 0) & (sharp < med_sh * 0.28)).astype(np.uint8)
    n_s, lab_s, stats_s, cents_s = cv2.connectedComponentsWithStats(soft_all, 8)
    for i in range(1, n_s):
        if stats_s[i, cv2.CC_STAT_AREA] < 30:
            continue
        if cents_s[i][0] < gcx - 0.05 * w:
            allowed[lab_s == i] = 0

    char = seed.copy()
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    for _ in range(64):
        nxt = cv2.dilate(char, k3) & allowed
        if np.array_equal(nxt, char):
            break
        char = nxt
    if char.mean() < 0.05:
        char = grab

    char = cv2.morphologyEx(char, cv2.MORPH_CLOSE, k3)
    n, lab, stats, cents = cv2.connectedComponentsWithStats(char, 8)
    if n > 1:
        best_i, best_s = 1, -1.0
        for i in range(1, n):
            area = float(stats[i, cv2.CC_STAT_AREA])
            ccx, ccy = cents[i]
            nd = np.hypot(ccx - w / 2, ccy - h / 2) / (np.hypot(w, h) / 2)
            score = area * (1.0 - 0.4 * nd)
            if score > best_s:
                best_s, best_i = score, i
        char = (lab == best_i).astype(np.uint8)
    return char.astype(bool)


def cutout_character(
    image_bytes: bytes,
    *,
    max_side: int = 720,
    model: str = DEFAULT_REMBG_MODEL,
) -> tuple[np.ndarray, np.ndarray, str]:
    """rembg → isolate character → crop/fit. Returns (rgba, fg, engine_tag)."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    pre_side = max(max_side, 900)
    scale = min(1.0, pre_side / max(img.size))
    if scale < 1:
        img = img.resize(
            (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
            Image.Resampling.LANCZOS,
        )
    rgb_orig = np.array(img)[:, :, :3].copy()

    session = get_session(model)
    cut = remove(img, session=session)
    rgba = np.array(cut)
    fg = isolate_character(rgba, rgb_orig)

    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_OPEN, k).astype(bool)
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, k).astype(bool)

    rgba, fg = crop_and_fit_foreground(rgba, fg, max_side=max_side)
    rgba[~fg, :3] = 0
    rgba[~fg, 3] = 0
    return rgba, fg, f"rembg:{model}+isolate"


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
    model: str = DEFAULT_REMBG_MODEL,
) -> SegmentResult:
    rgba, fg, cut_tag = cutout_character(
        image_bytes, max_side=max_side, model=model
    )

    bgr = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2BGR)
    raw_labels, used = _watershed_parts(bgr, fg)
    labels, parts = _compact_ids(raw_labels, used)

    out_img = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    out_img.save(buf, format="PNG")

    return SegmentResult(
        width=labels.shape[1],
        height=labels.shape[0],
        image_png=buf.getvalue(),
        labels=labels.astype(np.uint16).reshape(-1).tolist(),
        parts=parts,
        engine=f"{cut_tag}+watershed",
    )
