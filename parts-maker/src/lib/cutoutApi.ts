/** Transparent character cutout for ChatGPT reference attachment. */

export async function fetchCutoutPng(
  file: Blob,
  opts?: { maxSide?: number },
): Promise<{ pngBlob: Blob; width: number; height: number; engine: string }> {
  const form = new FormData();
  form.append("file", file, "character.png");
  const qs = new URLSearchParams({
    max_side: String(opts?.maxSide ?? 1024),
  });
  const res = await fetch(`/api/cutout?${qs}`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`cutout API ${res.status}`);
  const data = (await res.json()) as {
    width: number;
    height: number;
    engine: string;
    imagePngBase64: string;
  };
  const bin = atob(data.imagePngBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return {
    pngBlob: new Blob([bytes], { type: "image/png" }),
    width: data.width,
    height: data.height,
    engine: data.engine,
  };
}
