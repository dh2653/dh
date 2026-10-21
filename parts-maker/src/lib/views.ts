export type ViewId = "front" | "left" | "right" | "up" | "down";

export const VIEW_DEFS: { id: ViewId; label: string; short: string }[] = [
  { id: "front", label: "정면", short: "F" },
  { id: "left", label: "좌측", short: "L" },
  { id: "right", label: "우측", short: "R" },
  { id: "up", label: "위", short: "U" },
  { id: "down", label: "아래", short: "D" },
];

export type ViewSlot = {
  id: ViewId;
  label: string;
  blob: Blob | null;
  url: string | null;
  engine: string | null;
  status: "empty" | "ready" | "error";
};

export function emptyViewSlots(): ViewSlot[] {
  return VIEW_DEFS.map((d) => ({
    id: d.id,
    label: d.label,
    blob: null,
    url: null,
    engine: null,
    status: "empty" as const,
  }));
}

function b64ToBlob(b64: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

/** Client geometric fallback if /api/views is down. */
async function localGeometricViews(source: Blob): Promise<{
  engine: string;
  note: string;
  slots: ViewSlot[];
}> {
  const bmp = await createImageBitmap(source);
  const maxSide = 720;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));

  const make = async (
    id: ViewId,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ): Promise<ViewSlot> => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(0, 0, w, h);
    draw(ctx);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
    const b = blob ?? new Blob();
    return {
      id,
      label: VIEW_DEFS.find((d) => d.id === id)!.label,
      blob: b,
      url: URL.createObjectURL(b),
      engine: "local-geometric-proxy",
      status: "ready",
    };
  };

  const front = await make("front", (ctx) => {
    ctx.drawImage(bmp, 0, 0, w, h);
  });
  const left = await make("left", (ctx) => {
    ctx.save();
    ctx.transform(0.55, 0, 0.12, 1, w * 0.2, 0);
    ctx.drawImage(bmp, 0, 0, w, h);
    ctx.restore();
  });
  const right = await make("right", (ctx) => {
    ctx.save();
    ctx.transform(0.55, 0, -0.12, 1, w * 0.25, 0);
    ctx.drawImage(bmp, 0, 0, w, h);
    ctx.restore();
  });
  const up = await make("up", (ctx) => {
    ctx.save();
    ctx.transform(1, 0.08, 0, 0.62, 0, h * 0.2);
    ctx.drawImage(bmp, 0, 0, w, h);
    ctx.restore();
  });
  const down = await make("down", (ctx) => {
    ctx.save();
    ctx.transform(1, -0.08, 0, 0.62, 0, h * 0.05);
    ctx.drawImage(bmp, 0, 0, w, h);
    ctx.restore();
  });

  return {
    engine: "local-geometric-proxy",
    note: "API 없음 · 클라이언트 geometric proxy",
    slots: [front, left, right, up, down],
  };
}

export async function generateViewSlots(source: Blob): Promise<{
  engine: string;
  note?: string;
  slots: ViewSlot[];
}> {
  try {
    const form = new FormData();
    form.append("file", source, "character.png");
    const res = await fetch("/api/views?max_side=720", {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error(`views ${res.status}`);
    const data = (await res.json()) as {
      engine: string;
      note?: string;
      error?: string;
      views: { id: ViewId; imagePngBase64: string }[];
    };
    if (!data.views?.length || data.engine === "error") {
      throw new Error(data.error || data.note || "empty views");
    }
    const slots: ViewSlot[] = VIEW_DEFS.map((d) => {
      const hit = data.views.find((v) => v.id === d.id);
      if (!hit) {
        return {
          id: d.id,
          label: d.label,
          blob: null,
          url: null,
          engine: data.engine,
          status: "error" as const,
        };
      }
      const blob = b64ToBlob(hit.imagePngBase64);
      return {
        id: d.id,
        label: d.label,
        blob,
        url: URL.createObjectURL(blob),
        engine: data.engine,
        status: "ready" as const,
      };
    });
    // Ensure front exists — if missing, use source
    const front = slots.find((s) => s.id === "front");
    if (front && !front.blob) {
      front.blob = source;
      front.url = URL.createObjectURL(source);
      front.status = "ready";
    }
    return { engine: data.engine, note: data.note, slots };
  } catch {
    return localGeometricViews(source);
  }
}

export function revokeViewUrls(slots: ViewSlot[]) {
  for (const s of slots) {
    if (s.url) URL.revokeObjectURL(s.url);
  }
}
