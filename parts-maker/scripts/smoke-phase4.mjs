import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/cursor/stores/bc-58417747-cec9-4b0a-a386-a97adc40b555/media/phase4";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(180_000);

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(OUT, "landing.png") });

await page.getByRole("button", { name: "샘플로 체험" }).click();
await page.waitForSelector(".view-thumb[data-view-id='front'].active", {
  timeout: 180_000,
});
await page.waitForFunction(() => !document.querySelector(".canvas-stage.busy"), null, {
  timeout: 180_000,
});
await page.screenshot({ path: path.join(OUT, "workspace.png") });

await page.getByRole("button", { name: "깊이→메시 생성" }).click();
await page.waitForSelector(".viewer3d-engine.real, .viewer3d-maps img", {
  timeout: 180_000,
});
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, "depth-mesh.png") });

const engine = await page.locator(".viewer3d-engine").textContent();
console.log("engine label:", engine);

// drag orbit a bit
const box = await page.locator(".viewer3d-canvas").boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 - 40);
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "orbit.png") });
}

await browser.close();
console.log("PHASE4 SMOKE OK");
