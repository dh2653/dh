import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const OUT = "/cursor/stores/bc-58417747-cec9-4b0a-a386-a97adc40b555/media/phase3";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(120_000);

const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(OUT, "landing.webp"), type: "png" });

await page.getByRole("button", { name: "샘플로 체험" }).click();
await page.waitForSelector(".view-thumb[data-view-id='front']", { timeout: 120_000 });
await page.waitForFunction(() => {
  const s = document.querySelector(".status");
  return s && !s.textContent.includes("중…") && !s.textContent.includes("처리 중");
}, null, { timeout: 120_000 });

await page.screenshot({ path: path.join(OUT, "view-strip.webp"), type: "png" });

const frontActive = await page.locator('.view-thumb[data-view-id="front"].active').count();
console.log("front active before switch:", frontActive);

await page.locator('.view-thumb[data-view-id="left"]').click();
await page.waitForFunction(() => {
  return !!document.querySelector('.view-thumb[data-view-id="left"].active');
}, null, { timeout: 120_000 });
await page.waitForFunction(() => {
  const s = document.querySelector(".status");
  return s && (s.textContent.includes("좌측") || s.textContent.includes("left"));
}, null, { timeout: 120_000 }).catch(() => {});
// wait busy overlay gone
await page.waitForFunction(() => !document.querySelector(".canvas-stage.busy"), null, {
  timeout: 120_000,
});
await page.screenshot({ path: path.join(OUT, "left-view-parts.webp"), type: "png" });

await page.locator('.view-thumb[data-view-id="right"]').click();
await page.waitForFunction(() => {
  return !!document.querySelector('.view-thumb[data-view-id="right"].active');
}, null, { timeout: 120_000 });
await page.waitForFunction(() => !document.querySelector(".canvas-stage.busy"), null, {
  timeout: 120_000,
});
await page.screenshot({ path: path.join(OUT, "right-view-parts.webp"), type: "png" });

const status = await page.locator(".status").last().textContent();
console.log("final status:", status);
console.log("console logs (last 20):\n", logs.slice(-20).join("\n"));
await browser.close();
console.log("SMOKE OK");
