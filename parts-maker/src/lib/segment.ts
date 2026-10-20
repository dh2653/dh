import { partColor } from "./colors";
import type { PartMeta, ProjectState } from "../types";

/**
 * Client-side demo segmentation (no API keys required).
 *
 * Pipeline:
 * 1. Edge flood-fill → background mask
 * 2. Spatial + color k-means on foreground → regions
 * 3. Position heuristics → Spine-style names + drawOrder
 *
 * Swap `proposeParts` for a real SAM / vision API later (see README).
 */

const BG = 0;

function idx(x: number, y: number, w: number): number {
  return y * w + x;
}

function colorDist(a: Uint8ClampedArray, ia: number, b: Uint8ClampedArray, ib: number): number {
  const dr = a[ia]! - b[ib]!;
  const dg = a[ia + 1]! - b[ib + 1]!;
  const db = a[ia + 2]! - b[ib + 2]!;
  return dr * dr + dg * dg + db * db;
}

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

  // Seed color = average of edge pixels already queued (first wave)
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
      // Compare to seed pixel AND treat near-white / near-transparent as bg
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

interface Sample {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  i: number;
}

function collectForeground(data: ImageData, bg: Uint8Array): Sample[] {
  const { width: w, height: h, data: px } = data;
  const samples: Sample[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 12000)));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = idx(x, y, w);
      if (bg[i]) continue;
      const o = i * 4;
      samples.push({
        x,
        y,
        r: px[o]!,
        g: px[o + 1]!,
        b: px[o + 2]!,
        i,
      });
    }
  }
  return samples;
}

function kmeans(samples: Sample[], k: number, iters = 12): number[] {
  if (samples.length === 0) return [];
  const kk = Math.min(k, samples.length);
  // Init: spread by y then x
  const sorted = [...samples].sort((a, b) => a.y - b.y || a.x - b.x);
  const centroids = Array.from({ length: kk }, (_, ci) => {
    const s = sorted[Math.floor((ci + 0.5) * (sorted.length / kk))]!;
    return { x: s.x, y: s.y, r: s.r, g: s.g, b: s.b };
  });
  const assign = new Array<number>(samples.length).fill(0);

  for (let iter = 0; iter < iters; iter++) {
    for (let si = 0; si < samples.length; si++) {
      const s = samples[si]!;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kk; c++) {
        const ct = centroids[c]!;
        const dx = (s.x - ct.x) * 0.35;
        const dy = (s.y - ct.y) * 0.55;
        const dr = (s.r - ct.r) * 0.9;
        const dg = (s.g - ct.g) * 0.9;
        const db = (s.b - ct.b) * 0.9;
        const d = dx * dx + dy * dy + dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assign[si] = best;
    }
    const sums = Array.from({ length: kk }, () => ({
      x: 0,
      y: 0,
      r: 0,
      g: 0,
      b: 0,
      n: 0,
    }));
    for (let si = 0; si < samples.length; si++) {
      const s = samples[si]!;
      const c = assign[si]!;
      const t = sums[c]!;
      t.x += s.x;
      t.y += s.y;
      t.r += s.r;
      t.g += s.g;
      t.b += s.b;
      t.n++;
    }
    for (let c = 0; c < kk; c++) {
      const t = sums[c]!;
      if (t.n === 0) continue;
      centroids[c] = {
        x: t.x / t.n,
        y: t.y / t.n,
        r: t.r / t.n,
        g: t.g / t.n,
        b: t.b / t.n,
      };
    }
  }
  return assign;
}

/** Canonical Spine-ish names ordered by typical vertical layout. */
const NAME_TEMPLATES = [
  { name: "hat", y: 0.06, x: 0.5 },
  { name: "head", y: 0.14, x: 0.5 },
  { name: "hair", y: 0.18, x: 0.42 },
  { name: "torso", y: 0.38, x: 0.5 },
  { name: "vest", y: 0.42, x: 0.48 },
  { name: "left_upper_arm", y: 0.36, x: 0.72 },
  { name: "right_upper_arm", y: 0.36, x: 0.28 },
  { name: "left_forearm", y: 0.48, x: 0.78 },
  { name: "right_forearm", y: 0.48, x: 0.22 },
  { name: "left_hand", y: 0.58, x: 0.82 },
  { name: "right_hand", y: 0.58, x: 0.18 },
  { name: "sash", y: 0.52, x: 0.55 },
  { name: "pelvis", y: 0.58, x: 0.5 },
  { name: "left_thigh", y: 0.7, x: 0.62 },
  { name: "right_thigh", y: 0.7, x: 0.38 },
  { name: "left_lower_leg", y: 0.84, x: 0.64 },
  { name: "right_lower_leg", y: 0.84, x: 0.36 },
  { name: "left_foot", y: 0.95, x: 0.66 },
  { name: "right_foot", y: 0.95, x: 0.34 },
];

/** Back → front draw order stubs (higher = front). */
const DEFAULT_DRAW: Record<string, number> = {
  left_hand: 1,
  left_forearm: 2,
  left_upper_arm: 3,
  left_foot: 4,
  left_lower_leg: 5,
  left_thigh: 6,
  right_foot: 7,
  right_lower_leg: 8,
  right_thigh: 9,
  torso: 10,
  vest: 11,
  sash: 12,
  pelvis: 13,
  hair: 14,
  head: 15,
  hat: 16,
  right_hand: 17,
  right_forearm: 18,
  right_upper_arm: 19,
};

function nameClusters(
  centroids: { x: number; y: number; n: number }[],
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
): string[] {
  const bw = Math.max(1, bbox.maxX - bbox.minX);
  const bh = Math.max(1, bbox.maxY - bbox.minY);
  const used = new Set<string>();
  return centroids.map((c) => {
    const nx = (c.x - bbox.minX) / bw;
    const ny = (c.y - bbox.minY) / bh;
    let best = `part_${centroids.indexOf(c) + 1}`;
    let bestD = Infinity;
    for (const t of NAME_TEMPLATES) {
      if (used.has(t.name)) continue;
      const d = (nx - t.x) ** 2 + (ny - t.y) ** 2 * 1.4;
      if (d < bestD) {
        bestD = d;
        best = t.name;
      }
    }
    used.add(best);
    return best;
  });
}

function paintNearest(
  data: ImageData,
  bg: Uint8Array,
  samples: Sample[],
  assign: number[],
  clusterCount: number,
): Uint16Array {
  const { width: w, height: h, data: px } = data;
  const labels = new Uint16Array(w * h);
  const centroids = Array.from({ length: clusterCount }, () => ({
    x: 0,
    y: 0,
    r: 0,
    g: 0,
    b: 0,
    n: 0,
  }));
  for (let si = 0; si < samples.length; si++) {
    const s = samples[si]!;
    const c = assign[si]!;
    const t = centroids[c]!;
    t.x += s.x;
    t.y += s.y;
    t.r += s.r;
    t.g += s.g;
    t.b += s.b;
    t.n++;
  }
  for (const t of centroids) {
    if (t.n === 0) continue;
    t.x /= t.n;
    t.y /= t.n;
    t.r /= t.n;
    t.g /= t.n;
    t.b /= t.n;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y, w);
      if (bg[i]) {
        labels[i] = BG;
        continue;
      }
      const o = i * 4;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < clusterCount; c++) {
        const ct = centroids[c]!;
        if (ct.n === 0) continue;
        const dx = (x - ct.x) * 0.35;
        const dy = (y - ct.y) * 0.55;
        const dr = (px[o]! - ct.r) * 0.9;
        const dg = (px[o + 1]! - ct.g) * 0.9;
        const db = (px[o + 2]! - ct.b) * 0.9;
        const d = dx * dx + dy * dy + dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      labels[i] = (best + 1) as number; // 1-based part ids
    }
  }
  return labels;
}

function bboxOf(bg: Uint8Array, w: number, h: number) {
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

function remapCompact(labels: Uint16Array, names: string[]): { labels: Uint16Array; parts: PartMeta[] } {
  const counts = new Map<number, number>();
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i]!;
    if (id === BG) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  // Drop tiny clusters (< 0.15% of fg)
  let fg = 0;
  for (const n of counts.values()) fg += n;
  const minPix = Math.max(40, fg * 0.0015);
  const keep = [...counts.entries()]
    .filter(([, n]) => n >= minPix)
    .sort((a, b) => a[0] - b[0])
    .map(([id]) => id);

  const map = new Map<number, number>();
  keep.forEach((old, i) => map.set(old, i + 1));

  const next = new Uint16Array(labels.length);
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i]!;
    if (id === BG) {
      next[i] = BG;
      continue;
    }
    const m = map.get(id);
    next[i] = m ?? 0xffff;
  }

  const parts: PartMeta[] = keep.map((oldId, i) => {
    const name = names[oldId - 1] ?? `part_${i + 1}`;
    return {
      id: i + 1,
      name,
      drawOrder: DEFAULT_DRAW[name] ?? i + 1,
      color: partColor(i),
      parent: null,
      pivot: { x: 0.5, y: 0.5 },
    };
  });

  return { labels: next, parts };
}

function absorbOrphans(labels: Uint16Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y, w);
      if (labels[i] !== 0xffff) continue;
      let found = BG;
      for (let r = 1; r < 24 && found === BG; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const v = labels[idx(nx, ny, w)]!;
            if (v !== BG && v !== 0xffff) {
              found = v;
              break;
            }
          }
          if (found !== BG) break;
        }
      }
      labels[i] = found;
    }
  }
}

function computePivots(labels: Uint16Array, w: number, h: number, parts: PartMeta[]): void {
  for (const p of parts) {
    let sx = 0,
      sy = 0,
      n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (labels[idx(x, y, w)] !== p.id) continue;
        sx += x;
        sy += y;
        n++;
      }
    }
    if (n > 0) {
      p.pivot = { x: sx / n / w, y: sy / n / h };
    }
  }
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

export function proposeParts(source: ImageData, targetParts = 12): ProjectState {
  const { width: w, height: h } = source;
  const bg = markBackground(source);
  const samples = collectForeground(source, bg);
  if (samples.length < 10) {
    return {
      width: w,
      height: h,
      source,
      labels: new Uint16Array(w * h),
      parts: [],
    };
  }

  const k = Math.min(targetParts, Math.max(4, Math.round(samples.length / 80)));
  const assign = kmeans(samples, k);
  const rawLabels = paintNearest(source, bg, samples, assign, k);

  // Centroids for naming
  const cents = Array.from({ length: k }, () => ({ x: 0, y: 0, n: 0 }));
  for (let si = 0; si < samples.length; si++) {
    const s = samples[si]!;
    const c = assign[si]!;
    cents[c]!.x += s.x;
    cents[c]!.y += s.y;
    cents[c]!.n++;
  }
  for (const c of cents) {
    if (c.n) {
      c.x /= c.n;
      c.y /= c.n;
    }
  }
  const box = bboxOf(bg, w, h);
  const names = nameClusters(cents, box);

  const { labels, parts } = remapCompact(rawLabels, names);
  absorbOrphans(labels, w, h);

  // Re-number after absorb if any orphan became bg incorrectly — ok
  // Filter parts that still have pixels
  const alive = new Set<number>();
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i]!;
    if (id) alive.add(id);
  }
  const kept = parts.filter((p) => alive.has(p.id));
  // Remap ids contiguous
  const idMap = new Map(kept.map((p, i) => [p.id, i + 1]));
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i]!;
    if (!id) continue;
    labels[i] = idMap.get(id) ?? 0;
  }
  const finalParts = kept.map((p, i) => ({
    ...p,
    id: i + 1,
    color: partColor(i),
  }));
  computePivots(labels, w, h, finalParts);

  return { width: w, height: h, source, labels, parts: finalParts };
}

/** Flood-fill by color similarity; assign to partId (or 0 to erase). */
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
