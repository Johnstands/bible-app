// Renders assets/icon.svg to assets/icon.png (1024 px, transparent corners). Then: npx tauri icon assets/icon.png
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const svg = fs.readFileSync(path.join(ROOT, "assets/icon.svg"), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
await page.screenshot({ path: path.join(ROOT, "assets/icon.png"), omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await browser.close();
console.log("Wrote assets/icon.png");
