export type DepthResult = {
  engine: string;
  width: number;
  height: number;
  colorUrl: string;
  depthUrl: string;
  normalUrl: string;
  depth: Float32Array;
  note: string;
};

function b64ToUrl(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
}

export function revokeDepthResult(r: DepthResult | null) {
  if (!r) return;
  URL.revokeObjectURL(r.colorUrl);
  URL.revokeObjectURL(r.depthUrl);
  URL.revokeObjectURL(r.normalUrl);
}

export async function fetchDepth(file: Blob): Promise<DepthResult> {
  const form = new FormData();
  form.append("file", file, "character.png");
  const res = await fetch("/api/depth?max_side=512", { method: "POST", body: form });
  if (!res.ok) throw new Error(`depth ${res.status}`);
  const data = (await res.json()) as {
    engine: string;
    error?: string;
    note?: string;
    width: number;
    height: number;
    colorPngBase64?: string;
    depthPngBase64?: string;
    normalPngBase64?: string;
    depth?: number[];
  };
  if (data.engine === "error" || !data.depth || !data.colorPngBase64) {
    throw new Error(data.error || data.note || "depth failed");
  }
  return {
    engine: data.engine,
    width: data.width,
    height: data.height,
    colorUrl: b64ToUrl(data.colorPngBase64),
    depthUrl: b64ToUrl(data.depthPngBase64!),
    normalUrl: b64ToUrl(data.normalPngBase64!),
    depth: Float32Array.from(data.depth),
    note: data.note ?? "",
  };
}
