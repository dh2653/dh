import type { HiddenRegion, ProjectState } from "../types";
import { centroidOf } from "./meta";

let hidSeq = 1;

/**
 * Auto-place hidden-region markers at child↔parent joints
 * (Spine guide “rounded overlap caps”).
 */
export function estimateHiddenRegions(project: ProjectState): HiddenRegion[] {
  const byName = new Map(project.parts.map((p) => [p.name, p]));
  const regions: HiddenRegion[] = [];
  const minDim = Math.min(project.width, project.height);

  for (const child of project.parts) {
    if (!child.parent || child.parent === "root") continue;
    const parent = byName.get(child.parent);
    if (!parent) continue;
    const cc = centroidOf(project, child.id);
    const pc = centroidOf(project, parent.id);
    if (!cc || !pc) continue;

    // Joint sits on the child edge toward the parent
    const jx = cc.x * 0.35 + pc.x * 0.65;
    const jy = cc.y * 0.35 + pc.y * 0.65;
    const radiusPx = Math.max(10, minDim * 0.028);
    regions.push({
      id: `hid_${hidSeq++}`,
      partId: child.id,
      x: jx / project.width,
      y: jy / project.height,
      radius: radiusPx / minDim,
      note: `${child.name} ∩ ${parent.name} overlap cap`,
      inpaint: "none",
    });
  }
  return regions;
}

/**
 * Light local inpaint: fill marker disks on the part mask by sampling
 * nearby same-part pixels (telea-like neighbor average). Not generative AI.
 */
export function applyLightInpaint(project: ProjectState): ProjectState {
  const { width: w, height: h, source, labels } = project;
  const data = new Uint8ClampedArray(source.data);
  const minDim = Math.min(w, h);

  for (const hr of project.hiddenRegions) {
    const cx = Math.round(hr.x * w);
    const cy = Math.round(hr.y * h);
    const r = Math.max(4, Math.round(hr.radius * minDim));
    const r2 = r * r;

    // Collect sample colors from ring around marker on same part
    const samples: number[] = [];
    for (let ang = 0; ang < Math.PI * 2; ang += 0.2) {
      for (const rad of [r + 2, r + 5, r + 8]) {
        const sx = Math.round(cx + Math.cos(ang) * rad);
        const sy = Math.round(cy + Math.sin(ang) * rad);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const i = sy * w + sx;
        if (labels[i] !== hr.partId) continue;
        const o = i * 4;
        if (data[o + 3]! < 16) continue;
        samples.push(data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!);
      }
    }
    if (samples.length < 16) {
      hr.inpaint = "stub";
      continue;
    }
    let sr = 0,
      sg = 0,
      sb = 0,
      sa = 0,
      n = 0;
    for (let i = 0; i < samples.length; i += 4) {
      sr += samples[i]!;
      sg += samples[i + 1]!;
      sb += samples[i + 2]!;
      sa += samples[i + 3]!;
      n++;
    }
    sr = (sr / n) | 0;
    sg = (sg / n) | 0;
    sb = (sb / n) | 0;
    sa = (sa / n) | 0;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        // Only paint where this part already owns the pixel OR empty under parent overlap
        const id = labels[i]!;
        if (id !== hr.partId && id !== 0) continue;
        if (id === 0) labels[i] = hr.partId;
        const o = i * 4;
        const fall = 1 - Math.sqrt(dx * dx + dy * dy) / (r + 0.01);
        const a = Math.min(1, 0.35 + fall * 0.65);
        data[o] = (sr * a + data[o]! * (1 - a)) | 0;
        data[o + 1] = (sg * a + data[o + 1]! * (1 - a)) | 0;
        data[o + 2] = (sb * a + data[o + 2]! * (1 - a)) | 0;
        data[o + 3] = Math.max(data[o + 3]!, (sa * a) | 0);
      }
    }
    hr.inpaint = "approx";
  }

  return {
    ...project,
    source: new ImageData(data, w, h),
    labels: new Uint16Array(labels),
    hiddenRegions: project.hiddenRegions.map((h) => ({ ...h })),
  };
}

export function addHiddenMarker(
  project: ProjectState,
  partId: number,
  xNorm: number,
  yNorm: number,
  radius = 0.03,
): ProjectState {
  const region: HiddenRegion = {
    id: `hid_${hidSeq++}`,
    partId,
    x: xNorm,
    y: yNorm,
    radius,
    note: "manual hidden region",
    inpaint: "none",
  };
  return {
    ...project,
    hiddenRegions: [...project.hiddenRegions, region],
  };
}

export function removeHiddenMarker(project: ProjectState, id: string): ProjectState {
  return {
    ...project,
    hiddenRegions: project.hiddenRegions.filter((h) => h.id !== id),
  };
}
