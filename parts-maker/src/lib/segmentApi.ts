import type { PartMeta, ProjectState } from "../types";

export type SegmentEngineInfo = {
  engine: string;
  via: "api" | "local-fallback";
};

type ApiResponse = {
  width: number;
  height: number;
  engine: string;
  parts: PartMeta[];
  labels: number[];
  imagePngBase64: string;
};

async function pngBase64ToImageData(b64: string, w: number, h: number): Promise<ImageData> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Prefer local FastAPI segmenter; callers should catch and fall back. */
export async function proposePartsViaApi(
  file: Blob,
  opts?: { maxSide?: number; model?: string },
): Promise<{ project: ProjectState; info: SegmentEngineInfo }> {
  const form = new FormData();
  form.append("file", file, "character.png");
  const qs = new URLSearchParams({
    max_side: String(opts?.maxSide ?? 720),
    model: opts?.model ?? "u2net",
  });
  const res = await fetch(`/api/segment?${qs}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`segment API ${res.status}`);
  }
  const data = (await res.json()) as ApiResponse;
  const source = await pngBase64ToImageData(data.imagePngBase64, data.width, data.height);
  const labels = Uint16Array.from(data.labels);
  return {
    project: {
      width: data.width,
      height: data.height,
      source,
      labels,
      parts: data.parts,
      hiddenRegions: [],
    },
    info: { engine: data.engine, via: "api" },
  };
}
