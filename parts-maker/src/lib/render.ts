import { hexToRgba } from "./colors";
import type { PartMeta, ProjectState } from "../types";

export function drawProject(
  ctx: CanvasRenderingContext2D,
  project: ProjectState,
  opts: {
    overlayOpacity: number;
    showLabels: boolean;
    selectedId: number | null;
    dimOthers: boolean;
  },
): void {
  const { width: w, height: h, source, labels, parts } = project;
  ctx.clearRect(0, 0, w, h);
  ctx.putImageData(source, 0, 0);

  if (opts.overlayOpacity <= 0) return;

  const overlay = ctx.createImageData(w, h);
  const colorMap = new Map<number, [number, number, number, number]>();
  for (const p of parts) {
    colorMap.set(p.id, hexToRgba(p.color, opts.overlayOpacity));
  }

  for (let i = 0; i < labels.length; i++) {
    const id = labels[i]!;
    if (!id) continue;
    if (opts.dimOthers && opts.selectedId != null && id !== opts.selectedId) {
      const o = i * 4;
      overlay.data[o] = 0;
      overlay.data[o + 1] = 0;
      overlay.data[o + 2] = 0;
      overlay.data[o + 3] = 90;
      continue;
    }
    const c = colorMap.get(id);
    if (!c) continue;
    const o = i * 4;
    overlay.data[o] = c[0];
    overlay.data[o + 1] = c[1];
    overlay.data[o + 2] = c[2];
    overlay.data[o + 3] = c[3];
  }
  ctx.putImageData(overlay, 0, 0);
  // Multiply-ish: redraw source under with destination-over then source-atop — simpler: draw source then overlay with globalAlpha
  // Actually putImageData ignores composite. Redraw properly:
  ctx.clearRect(0, 0, w, h);
  ctx.putImageData(source, 0, 0);
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  tmp.getContext("2d")!.putImageData(overlay, 0, 0);
  ctx.drawImage(tmp, 0, 0);

  if (!opts.showLabels) return;

  const centroids = new Map<number, { x: number; y: number; n: number }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = labels[y * w + x]!;
      if (!id) continue;
      const c = centroids.get(id) ?? { x: 0, y: 0, n: 0 };
      c.x += x;
      c.y += y;
      c.n++;
      centroids.set(id, c);
    }
  }

  const byId = new Map(parts.map((p) => [p.id, p]));
  ctx.save();
  ctx.font = `600 ${Math.max(11, Math.round(w / 48))}px "IBM Plex Sans KR", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [id, c] of centroids) {
    if (!c.n) continue;
    const part = byId.get(id) as PartMeta | undefined;
    if (!part) continue;
    const cx = c.x / c.n;
    const cy = c.y / c.n;
    const num = String(part.drawOrder).padStart(2, "0");
    const label = `${num} ${part.name}`;
    const padX = 6;
    const padY = 4;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(8, 12, 18, 0.82)";
    ctx.fillRect(cx - tw / 2 - padX, cy - 9 - padY, tw + padX * 2, 18 + padY * 2);
    ctx.fillStyle = "#F4EDE0";
    ctx.fillText(label, cx, cy);
  }
  ctx.restore();
}
