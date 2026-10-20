import type { PartMeta, ProjectState } from "../types";

/** Spine Separation Guide–style default parents (by part name). */
export const DEFAULT_PARENT: Record<string, string> = {
  pelvis: "root",
  torso: "pelvis",
  vest: "torso",
  sash: "pelvis",
  head: "torso",
  hair: "head",
  hat: "head",
  left_upper_arm: "torso",
  left_forearm: "left_upper_arm",
  left_hand: "left_forearm",
  right_upper_arm: "torso",
  right_forearm: "right_upper_arm",
  right_hand: "right_forearm",
  left_thigh: "pelvis",
  left_lower_leg: "left_thigh",
  left_foot: "left_lower_leg",
  right_thigh: "pelvis",
  right_lower_leg: "right_thigh",
  right_foot: "right_lower_leg",
};

function partBounds(
  labels: Uint16Array,
  w: number,
  h: number,
  id: number,
): { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number; n: number } | null {
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1,
    sx = 0,
    sy = 0,
    n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] !== id) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      sx += x;
      sy += y;
      n++;
    }
  }
  if (n === 0) return null;
  return { minX, minY, maxX, maxY, cx: sx / n, cy: sy / n, n };
}

/**
 * Estimate pivot: bias toward the edge facing the parent centroid
 * (joint-like), else mask centroid.
 */
export function estimatePivot(
  project: ProjectState,
  part: PartMeta,
  parentCentroid: { x: number; y: number } | null,
): { x: number; y: number } {
  const { width: w, height: h, labels } = project;
  const b = partBounds(labels, w, h, part.id);
  if (!b) return { x: 0.5, y: 0.5 };

  if (!parentCentroid || part.parent === "root" || !part.parent) {
    return { x: b.cx / w, y: b.cy / h };
  }

  // Sample points in mask; pick the one closest to parent centroid (joint)
  let bestX = b.cx;
  let bestY = b.cy;
  let bestD = Infinity;
  const step = Math.max(1, Math.floor(Math.sqrt(b.n) / 40));
  for (let y = b.minY; y <= b.maxY; y += step) {
    for (let x = b.minX; x <= b.maxX; x += step) {
      if (labels[y * w + x] !== part.id) continue;
      const d =
        (x - parentCentroid.x) ** 2 + (y - parentCentroid.y) ** 2;
      if (d < bestD) {
        bestD = d;
        bestX = x;
        bestY = y;
      }
    }
  }
  // Blend joint bias with centroid so pivot sits slightly inside the part
  const jx = bestX * 0.65 + b.cx * 0.35;
  const jy = bestY * 0.65 + b.cy * 0.35;
  return { x: jx / w, y: jy / h };
}

export function centroidOf(
  project: ProjectState,
  partId: number,
): { x: number; y: number } | null {
  const b = partBounds(project.labels, project.width, project.height, partId);
  if (!b) return null;
  return { x: b.cx, y: b.cy };
}

/** Apply Spine-ish parents + re-estimate pivots from masks. */
export function enrichSpineMeta(project: ProjectState): ProjectState {
  const parts: PartMeta[] = project.parts.map((p) => {
    const parent = p.parent != null ? p.parent : (DEFAULT_PARENT[p.name] ?? null);
    return { ...p, parent, pivot: { ...p.pivot } };
  });

  // Centroids first pass
  const cents = new Map<string, { x: number; y: number }>();
  for (const p of parts) {
    const c = centroidOf({ ...project, parts }, p.id);
    if (c) cents.set(p.name, c);
  }

  for (const p of parts) {
    const parentName = p.parent && p.parent !== "root" ? p.parent : null;
    const parentC = parentName ? (cents.get(parentName) ?? null) : null;
    p.pivot = estimatePivot({ ...project, parts }, p, parentC);
  }

  return { ...project, parts, hiddenRegions: project.hiddenRegions ?? [] };
}

export function updatePart(
  project: ProjectState,
  id: number,
  patch: Partial<PartMeta>,
): ProjectState {
  return {
    ...project,
    parts: project.parts.map((p) => {
      if (p.id !== id) return p;
      const next = { ...p, ...patch };
      if (patch.pivot) next.pivot = { ...patch.pivot };
      return next;
    }),
  };
}

export function moveDrawOrder(
  project: ProjectState,
  id: number,
  direction: -1 | 1,
): ProjectState {
  const sorted = [...project.parts].sort((a, b) => a.drawOrder - b.drawOrder);
  const i = sorted.findIndex((p) => p.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= sorted.length) return project;
  const a = sorted[i]!;
  const b = sorted[j]!;
  const tmp = a.drawOrder;
  a.drawOrder = b.drawOrder;
  b.drawOrder = tmp;
  return {
    ...project,
    parts: project.parts.map((p) => {
      if (p.id === a.id) return { ...p, drawOrder: a.drawOrder };
      if (p.id === b.id) return { ...p, drawOrder: b.drawOrder };
      return p;
    }),
  };
}

export function setDrawOrderValue(
  project: ProjectState,
  id: number,
  drawOrder: number,
): ProjectState {
  const v = Math.max(1, Math.round(drawOrder));
  return updatePart(project, id, { drawOrder: v });
}

export function parentOptions(parts: PartMeta[]): string[] {
  const names = parts.map((p) => p.name);
  return ["root", ...names];
}
