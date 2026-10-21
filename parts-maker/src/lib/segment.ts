import { partColor } from "./colors";
import type { PartMeta, ProjectState } from "../types";

/**
 * Client editing helpers + offline fallback segmentation.
 *
 * Preferred path: `proposePartsViaApi` → rembg + character isolate + watershed (server/).
 * Fallback here: edge flood-fill FG + marker watershed (no neural net).
 *
 * SAM plug-in: replace server `propose_parts` or the API response mapper;
 * keep returning `{ width, height, source, labels, parts }`.
 */

function idx(x: number, y: number, w: number): number {
  return y * w + x;
}

function colorDist(a: Uint8ClampedArray, ia: number, b: Uint8ClampedArray, ib: number): number {
  const dr = a[ia]! - b[ib]!;
  const dg = a[ia + 1]! - b[ib + 1]!;
  const db = a[ia + 2]! - b[ib + 2]!;
  return dr * dr + dg * dg + db * db;
}

const PART_SEEDS: { name: string; nx: number; ny: number; drawOrder: number }[] = [
  { name: "hat", nx: 0.5, ny: 0.05, drawOrder: 16 },
  { name: "head", nx: 0.5, ny: 0.14, drawOrder: 15 },
  { name: "hair", nx: 0.42, ny: 0.18, drawOrder: 14 },
  { name: "torso", nx: 0.5, ny: 0.36, drawOrder: 10 },
  { name: "vest", nx: 0.5, ny: 0.42, drawOrder: 11 },
  { name: "left_upper_arm", nx: 0.74, ny: 0.34, drawOrder: 3 },
  { name: "right_upper_arm", nx: 0.26, ny: 0.34, drawOrder: 19 },
  { name: "left_forearm", nx: 0.8, ny: 0.48, drawOrder: 2 },
  { name: "right_forearm", nx: 0.2, ny: 0.48, drawOrder: 18 },
  { name: "left_hand", nx: 0.84, ny: 0.58, drawOrder: 1 },
  { name: "right_hand", nx: 0.16, ny: 0.58, drawOrder: 17 },
  { name: "sash", nx: 0.55, ny: 0.52, drawOrder: 12 },
  { name: "pelvis", nx: 0.5, ny: 0.58, drawOrder: 13 },
  { name: "left_thigh", nx: 0.62, ny: 0.7, drawOrder: 6 },
  { name: "right_thigh", nx: 0.38, ny: 0.7, drawOrder: 9 },
  { name: "left_lower_leg", nx: 0.64, ny: 0.84, drawOrder: 5 },
  { name: "right_lower_leg", nx: 0.36, ny: 0.84, drawOrder: 8 },
  { name: "left_foot", nx: 0.66, ny: 0.95, drawOrder: 4 },
  { name: "right_foot", nx: 0.34, ny: 0.95, drawOrder: 7 },
];

/** Flood from edges: mark near-edge colors as background. */
function markBackground(data: ImageData, tolerance = 48): Uint8Array {
  const { width: w, height: h, data: px } = data;
  const bg = new Uint8Array(w * h);
  const tol2 = tolerance * tolerance;
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    const i = idx(x, y, w);
    if (bg[i]) return;
    bg[i] = 1;
    queue.push(i);
  };

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }

  let head = 0;
  while (head < queue.length) {
    const i = queue[head++]!;
    const x = i % w;
    const y = (i / w) | 0;
    const base = i * 4;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = idx(nx, ny, w);
      if (bg[ni]) continue;
      const nb = ni * 4;
      const alpha = px[nb + 3]!;
      const lum = (px[nb]! + px[nb + 1]! + px[nb + 2]!) / 3;
      const nearWhite = lum > 245 && alpha > 200;
      const nearClear = alpha < 20;
      if (nearWhite || nearClear || colorDist(px, base, px, nb) <= tol2) {
        bg[ni] = 1;
        queue.push(ni);
      }
    }
  }
  return bg;
}

function fgBBox(bg: Uint8Array, w: number, h: number) {
  let minX = w,
    minY = h,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bg[idx(x, y, w)]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX) return { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 };
  return { minX, minY, maxX, maxY };
}

function luminanceAt(px: Uint8ClampedArray, i: number): number {
  const o = i * 4;
  return 0.299 * px[o]! + 0.587 * px[o + 1]! + 0.114 * px[o + 2]!;
}

/** Crop + fit FG so icon/scene uploads don't leave huge empty canvas. */
function cropFitForeground(source: ImageData, maxSide = 720): ImageData {
  const bg = markBackground(source);
  const box = fgBBox(bg, source.width, source.height);
  const pad = Math.floor(Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.06) + 8;
  const x0 = Math.max(0, box.minX - pad);
  const y0 = Math.max(0, box.minY - pad);
  const x1 = Math.min(source.width - 1, box.maxX + pad);
  const y1 = Math.min(source.height - 1, box.maxY + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const cropped = new ImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = ((y0 + y) * source.width + (x0 + x)) * 4;
      const di = (y * cw + x) * 4;
      // Drop near-bg pixels
      const bi = (y0 + y) * source.width + (x0 + x);
      if (bg[bi]) {
        cropped.data[di + 3] = 0;
        continue;
      }
      cropped.data[di] = source.data[si]!;
      cropped.data[di + 1] = source.data[si + 1]!;
      cropped.data[di + 2] = source.data[si + 2]!;
      cropped.data[di + 3] = source.data[si + 3]!;
    }
  }
  const side = Math.max(cw, ch);
  const scale = maxSide / Math.max(1, side);
  if (Math.abs(scale - 1) < 0.02) return cropped;
  const nw = Math.max(1, Math.round(cw * scale));
  const nh = Math.max(1, Math.round(ch * scale));
  const c = document.createElement("canvas");
  c.width = nw;
  c.height = nh;
  const tmp = document.createElement("canvas");
  tmp.width = cw;
  tmp.height = ch;
  tmp.getContext("2d")!.putImageData(cropped, 0, 0);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, nw, nh);
  return ctx.getImageData(0, 0, nw, nh);
}

/**
 * Offline fallback: anatomical seed markers + priority-flood (edge-aware),
 * replacing the old k-means stub.
 */
export function proposePartsLocal(sourceIn: ImageData): ProjectState {
  const source = cropFitForeground(sourceIn);
  const { width: w, height: h, data: px } = source;
  const bg = markBackground(source);
  const box = fgBBox(bg, w, h);
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);

  type Seed = { id: number; name: string; drawOrder: number; x: number; y: number };
  const seeds: Seed[] = [];
  let nextId = 1;
  for (const s of PART_SEEDS) {
    const sx = Math.round(box.minX + s.nx * bw);
    const sy = Math.round(box.minY + s.ny * bh);
    let placed = false;
    for (let r = 0; r < 28 && !placed; r++) {
      for (let dy = -r; dy <= r && !placed; dy++) {
        for (let dx = -r; dx <= r && !placed; dx++) {
          const x = sx + dx;
          const y = sy + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (bg[idx(x, y, w)]) continue;
          seeds.push({ id: nextId++, name: s.name, drawOrder: s.drawOrder, x, y });
          placed = true;
        }
      }
    }
  }

  const labels = new Uint16Array(w * h);
  if (seeds.length === 0) {
    return { width: w, height: h, source, labels, parts: [], hiddenRegions: [] };
  }

  // Dijkstra-like region grow with color+edge cost
  type Node = { i: number; cost: number; id: number };
  const heap: Node[] = [];
  const push = (n: Node) => {
    heap.push(n);
    let ci = heap.length - 1;
    while (ci > 0) {
      const pi = (ci - 1) >> 1;
      if (heap[pi]!.cost <= heap[ci]!.cost) break;
      [heap[pi], heap[ci]] = [heap[ci]!, heap[pi]!];
      ci = pi;
    }
  };
  const pop = (): Node | undefined => {
    if (!heap.length) return undefined;
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heap.length && heap[l]!.cost < heap[smallest]!.cost) smallest = l;
        if (r < heap.length && heap[r]!.cost < heap[smallest]!.cost) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest]!, heap[i]!];
        i = smallest;
      }
    }
    return top;
  };

  const best = new Float32Array(w * h);
  best.fill(Infinity);
  for (const s of seeds) {
    const i = idx(s.x, s.y, w);
    best[i] = 0;
    labels[i] = s.id;
    push({ i, cost: 0, id: s.id });
  }

  while (heap.length) {
    const cur = pop()!;
    if (cur.cost !== best[cur.i]) continue;
    const x = cur.i % w;
    const y = (cur.i / w) | 0;
    const baseLum = luminanceAt(px, cur.i);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = idx(nx, ny, w);
      if (bg[ni]) continue;
      const edge = Math.abs(luminanceAt(px, ni) - baseLum);
      const step = 1 + edge * 0.35 + colorDist(px, cur.i * 4, px, ni * 4) * 0.002;
      const nc = cur.cost + step;
      if (nc < best[ni]!) {
        best[ni] = nc;
        labels[ni] = cur.id;
        push({ i: ni, cost: nc, id: cur.id });
      }
    }
  }

  const parts: PartMeta[] = seeds.map((s, i) => {
    let sx = 0,
      sy = 0,
      n = 0;
    for (let p = 0; p < labels.length; p++) {
      if (labels[p] !== s.id) continue;
      sx += p % w;
      sy += (p / w) | 0;
      n++;
    }
    return {
      id: s.id,
      name: s.name,
      drawOrder: s.drawOrder,
      color: partColor(i),
      parent: null,
      pivot: n
        ? { x: sx / n / w, y: sy / n / h }
        : { x: 0.5, y: 0.5 },
    };
  }).filter((p) => {
    for (let i = 0; i < labels.length; i++) if (labels[i] === p.id) return true;
    return false;
  });

  // Remap contiguous
  const idMap = new Map(parts.map((p, i) => [p.id, i + 1]));
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i]!;
    if (!id) continue;
    labels[i] = idMap.get(id) ?? 0;
  }
  const finalParts = parts.map((p, i) => ({
    ...p,
    id: i + 1,
    color: partColor(i),
  }));

  return { width: w, height: h, source, labels, parts: finalParts, hiddenRegions: [] };
}

/** @deprecated use proposePartsLocal — kept for call sites during migration */
export function proposeParts(source: ImageData, _targetParts = 12): ProjectState {
  return proposePartsLocal(source);
}

export async function loadImageData(file: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(file);
  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function floodFill(
  project: ProjectState,
  x: number,
  y: number,
  partId: number,
  tolerance = 36,
): void {
  const { width: w, height: h, source, labels } = project;
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const start = idx(x, y, w);
  const target = labels[start]!;
  if (target === partId) return;
  const px = source.data;
  const tol2 = tolerance * tolerance;
  const base = start * 4;
  const q = [start];
  labels[start] = partId;
  let qi = 0;
  while (qi < q.length) {
    const i = q[qi++]!;
    const cx = i % w;
    const cy = (i / w) | 0;
    for (const [nx, ny] of [
      [cx - 1, cy],
      [cx + 1, cy],
      [cx, cy - 1],
      [cx, cy + 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = idx(nx, ny, w);
      if (labels[ni] !== target) continue;
      if (colorDist(px, base, px, ni * 4) > tol2) continue;
      labels[ni] = partId;
      q.push(ni);
    }
  }
}

export function paintBrush(
  labels: Uint16Array,
  w: number,
  h: number,
  x: number,
  y: number,
  radius: number,
  partId: number,
): void {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(x - radius));
  const x1 = Math.min(w - 1, Math.ceil(x + radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const y1 = Math.min(h - 1, Math.ceil(y + radius));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dx = px - x;
      const dy = py - y;
      if (dx * dx + dy * dy > r2) continue;
      labels[idx(px, py, w)] = partId;
    }
  }
}

export function addPart(project: ProjectState, name?: string): PartMeta {
  const id = project.parts.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  const part: PartMeta = {
    id,
    name: name ?? `part_${id}`,
    drawOrder: project.parts.length + 1,
    color: partColor(project.parts.length),
    parent: null,
    pivot: { x: 0.5, y: 0.5 },
  };
  project.parts = [...project.parts, part];
  return part;
}
