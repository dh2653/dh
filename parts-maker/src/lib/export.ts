import { saveAs } from "file-saver";
import { GIFEncoder, quantize, applyPalette } from "gifenc";
import JSZip from "jszip";
import type { PartMeta, ProjectState } from "../types";

function partBounds(labels: Uint16Array, w: number, h: number, id: number) {
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (labels[y * w + x] !== id) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { minX, minY, maxX, maxY };
}

export function extractPartPng(project: ProjectState, part: PartMeta): Blob | null {
  const { width: w, height: h, source, labels } = project;
  const b = partBounds(labels, w, h, part.id);
  if (!b) return null;
  const pw = b.maxX - b.minX + 1;
  const ph = b.maxY - b.minY + 1;
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext("2d")!;
  const out = ctx.createImageData(pw, ph);
  for (let y = b.minY; y <= b.maxY; y++) {
    for (let x = b.minX; x <= b.maxX; x++) {
      if (labels[y * w + x] !== part.id) continue;
      const si = (y * w + x) * 4;
      const di = ((y - b.minY) * pw + (x - b.minX)) * 4;
      out.data[di] = source.data[si]!;
      out.data[di + 1] = source.data[si + 1]!;
      out.data[di + 2] = source.data[si + 2]!;
      out.data[di + 3] = source.data[si + 3]!;
    }
  }
  ctx.putImageData(out, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  const bin = atob(dataUrl.split(",")[1]!);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: "image/png" });
}

export async function exportPartsZip(
  project: ProjectState,
  opts?: { viewId?: string; viewBlob?: Blob | null },
): Promise<void> {
  const zip = new JSZip();
  const folder = zip.folder("parts");
  if (!folder) throw new Error("zip folder failed");

  const meta = {
    version: 3,
    view: opts?.viewId ?? "front",
    width: project.width,
    height: project.height,
    parts: [...project.parts]
      .sort((a, b) => a.drawOrder - b.drawOrder)
      .map((p) => ({
        id: p.id,
        name: p.name,
        drawOrder: p.drawOrder,
        parent: p.parent,
        pivot: p.pivot,
        color: p.color,
      })),
    hiddenRegions: (project.hiddenRegions ?? []).map((h) => ({
      id: h.id,
      partId: h.partId,
      x: h.x,
      y: h.y,
      radius: h.radius,
      note: h.note,
      inpaint: h.inpaint,
    })),
  };
  folder.file("parts.json", JSON.stringify(meta, null, 2));
  if (opts?.viewBlob) {
    folder.file(`view_${opts.viewId ?? "front"}.png`, opts.viewBlob);
  }

  const sorted = [...project.parts].sort((a, b) => a.drawOrder - b.drawOrder);
  for (const part of sorted) {
    const blob = extractPartPng(project, part);
    if (!blob) continue;
    const safe = part.name.replace(/[^\w\-]+/g, "_");
    folder.file(`${String(part.drawOrder).padStart(2, "0")}_${safe}.png`, blob);
  }

  const out = await zip.generateAsync({ type: "blob" });
  const suffix = opts?.viewId ? `-${opts.viewId}` : "";
  saveAs(out, `parts-export${suffix}.zip`);
}

function compositeFrame(
  project: ProjectState,
  visibleIds: Set<number>,
): Uint8ClampedArray {
  const { width: w, height: h, source, labels } = project;
  const rgba = new Uint8ClampedArray(w * h * 4);
  // checker-ish dark bg for GIF
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = (i / w) | 0;
    const c = ((x >> 3) + (y >> 3)) & 1 ? 28 : 36;
    const o = i * 4;
    rgba[o] = c;
    rgba[o + 1] = c + 2;
    rgba[o + 2] = c + 6;
    rgba[o + 3] = 255;
  }

  const byOrder = [...project.parts].sort((a, b) => a.drawOrder - b.drawOrder);
  for (const part of byOrder) {
    if (!visibleIds.has(part.id)) continue;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] !== part.id) continue;
      const o = i * 4;
      const a = source.data[o + 3]! / 255;
      if (a < 0.01) continue;
      rgba[o] = Math.round(source.data[o]! * a + rgba[o]! * (1 - a));
      rgba[o + 1] = Math.round(source.data[o + 1]! * a + rgba[o + 1]! * (1 - a));
      rgba[o + 2] = Math.round(source.data[o + 2]! * a + rgba[o + 2]! * (1 - a));
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

export async function buildReassemblyGif(project: ProjectState): Promise<Blob> {
  const { width: w, height: h } = project;
  const ordered = [...project.parts].sort((a, b) => a.drawOrder - b.drawOrder);
  const gif = GIFEncoder();
  const visible = new Set<number>();

  // empty frame
  {
    const rgba = compositeFrame(project, visible);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, w, h, { palette, delay: 40 });
  }

  for (const part of ordered) {
    visible.add(part.id);
    const rgba = compositeFrame(project, visible);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, w, h, { palette, delay: 35 });
  }

  // hold final
  {
    const rgba = compositeFrame(project, visible);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, w, h, { palette, delay: 120 });
  }

  gif.finish();
  const bytes = gif.bytes();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "image/gif" });
}

export async function downloadReassemblyGif(project: ProjectState): Promise<void> {
  const blob = await buildReassemblyGif(project);
  saveAs(blob, "reassembly.gif");
}
