import { hexToRgba } from "./colors";
import type { PartMeta, ProjectState } from "../types";

export function drawProject(
  ctx: CanvasRenderingContext2D,
  project: ProjectState,
  opts: {
    overlayOpacity: number;
    showLabels: boolean;
    showPivots: boolean;
    showBones: boolean;
    showHidden: boolean;
    selectedId: number | null;
    dimOthers: boolean;
  },
): void {
  const { width: w, height: h, source, labels, parts } = project;
  ctx.clearRect(0, 0, w, h);
  ctx.putImageData(source, 0, 0);

  const overlay = ctx.createImageData(w, h);
  const colorMap = new Map<number, [number, number, number, number]>();
  for (const p of parts) {
    colorMap.set(p.id, hexToRgba(p.color, opts.overlayOpacity));
  }

  if (opts.overlayOpacity > 0) {
    for (let i = 0; i < labels.length; i++) {
      const id = labels[i]!;
      if (!id) continue;
      if (opts.dimOthers && opts.selectedId != null && id !== opts.selectedId) {
        const o = i * 4;
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
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    tmp.getContext("2d")!.putImageData(overlay, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  }

  const byName = new Map(parts.map((p) => [p.name, p]));

  if (opts.showBones) {
    ctx.save();
    ctx.strokeStyle = "rgba(244, 237, 224, 0.55)";
    ctx.lineWidth = Math.max(1, w / 400);
    for (const p of parts) {
      if (!p.parent || p.parent === "root") continue;
      const parent = byName.get(p.parent);
      if (!parent) continue;
      ctx.beginPath();
      ctx.moveTo(parent.pivot.x * w, parent.pivot.y * h);
      ctx.lineTo(p.pivot.x * w, p.pivot.y * h);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (opts.showHidden) {
    ctx.save();
    const minDim = Math.min(w, h);
    for (const hr of project.hiddenRegions ?? []) {
      const cx = hr.x * w;
      const cy = hr.y * h;
      const r = hr.radius * minDim;
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle =
        hr.inpaint === "approx"
          ? "rgba(61, 184, 160, 0.95)"
          : "rgba(232, 165, 75, 0.95)";
      ctx.lineWidth = 1.5;
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(232, 165, 75, 0.18)";
      ctx.fill();
    }
    ctx.restore();
  }

  if (opts.showPivots) {
    ctx.save();
    for (const p of parts) {
      const px = p.pivot.x * w;
      const py = p.pivot.y * h;
      const sel = p.id === opts.selectedId;
      const r = sel ? 7 : 5;
      ctx.beginPath();
      ctx.fillStyle = sel ? "#E8A54B" : "rgba(244, 237, 224, 0.9)";
      ctx.strokeStyle = "#0c1219";
      ctx.lineWidth = 1.5;
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // crosshair
      ctx.beginPath();
      ctx.moveTo(px - r - 3, py);
      ctx.lineTo(px + r + 3, py);
      ctx.moveTo(px, py - r - 3);
      ctx.lineTo(px, py + r + 3);
      ctx.stroke();
    }
    ctx.restore();
  }

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
    const cy = c.y / c.n - Math.max(14, h * 0.02);
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
