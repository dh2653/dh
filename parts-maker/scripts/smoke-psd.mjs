import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import JSZip from "jszip";

const OUT = "/cursor/stores/bc-58417747-cec9-4b0a-a386-a97adc40b555/media/psd-export";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(180_000);

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "샘플로 체험" }).click();
await page.waitForSelector(".view-thumb[data-view-id='front'].active", {
  timeout: 180_000,
});
await page.waitForFunction(() => !document.querySelector(".canvas-stage.busy"), null, {
  timeout: 180_000,
});
await page.screenshot({ path: path.join(OUT, "workspace-before-export.png") });

const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 120_000 }),
  page.getByRole("button", { name: "파츠이미지다운" }).click(),
]);
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(OUT, "export-button.png") });

const zipPath = path.join(OUT, await download.suggestedFilename());
await download.saveAs(zipPath);

const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
const names = Object.keys(zip.files);
console.log("zip entries", names);

const psdEntry = names.find((n) => n.endsWith(".psd"));
const jsonEntry = names.find((n) => n.endsWith(".json"));
const pngEntries = names.filter((n) => n.startsWith("png/") && n.endsWith(".png"));
const preview = names.find((n) => n.includes("preview-composite"));
if (!psdEntry || !jsonEntry) throw new Error("missing psd or json");
if (!pngEntries.length) throw new Error("missing png/ part images");
if (!preview) throw new Error("missing preview-composite.png");
console.log("png parts", pngEntries.length, "preview", preview);

const psdBuf = await zip.file(psdEntry).async("nodebuffer");
fs.writeFileSync(path.join(OUT, "parts-front.psd"), psdBuf);
const meta = JSON.parse(await zip.file(jsonEntry).async("string"));

const sig = psdBuf.subarray(0, 4).toString("ascii");
if (sig !== "8BPS") throw new Error(`bad PSD signature ${sig}`);

const layerNames = (meta.parts || []).map(
  (p) => `${String(p.drawOrder).padStart(2, "0")}_${p.name}`,
);

const status = (await page.locator(".canvas-panel .status").textContent()) || "";

const html = `<!DOCTYPE html><html lang="ko"><meta charset="utf-8"/>
<title>PSD layer proof</title>
<body style="font:15px/1.45 sans-serif;background:#0c1219;color:#f2ebe0;padding:28px">
<h1 style="color:#e8a54b">PSD export proof</h1>
<p>Signature: <b>${sig}</b> · ${psdBuf.byteLength.toLocaleString()} bytes</p>
<p>Expected layers: <b>${layerNames.length}</b> · meta parts: ${meta.parts?.length} · view: ${meta.view}</p>
<p>App status: ${status}</p>
<ol style="columns:2;gap:2rem">${layerNames.map((n) => `<li>${n}</li>`).join("")}</ol>
<p style="color:#c9c0b2;font-size:13px">ag-psd raster layers · normal blend · stack = drawOrder (bottom→top) · sidecar parts.json</p>
</body></html>`;
fs.writeFileSync(path.join(OUT, "layer-list.html"), html);
fs.writeFileSync(
  path.join(OUT, "layer-list.json"),
  JSON.stringify(
    {
      signature: sig,
      bytes: psdBuf.byteLength,
      zipEntries: names,
      layers: layerNames,
      metaParts: meta.parts?.length,
      status,
    },
    null,
    2,
  ),
);

await page.setContent(html);
await page.screenshot({ path: path.join(OUT, "layer-list.png") });
await browser.close();

for (const f of ["workspace-before-export", "export-button", "layer-list"]) {
  const a = path.join(OUT, `${f}.png`);
  const b = path.join(OUT, `${f}.webp`);
  if (fs.existsSync(a)) fs.renameSync(a, b);
}

if (layerNames.length < 1) throw new Error("no layers");
console.log("PSD SMOKE OK", { layers: layerNames.length, bytes: psdBuf.byteLength });
