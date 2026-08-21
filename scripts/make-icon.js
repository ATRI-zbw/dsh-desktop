"use strict";
/**
 * 生成应用图标:
 *   - assets/icon.png  (512×512,窗口图标,打包进 asar)
 *   - build/icon.ico   (多尺寸,electron-builder 安装包/便携版用)
 * 用法: npm run icon
 */
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const png2icons = require("png2icons");

const ROOT = path.join(__dirname, "..");

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4D6BFE"/>
      <stop offset="1" stop-color="#1D2A6E"/>
    </linearGradient>
  </defs>
  <rect x="12" y="12" width="488" height="488" rx="104" fill="url(#bg)"/>
  <text x="256" y="308" font-family="'Segoe UI', Arial, sans-serif" font-size="196" font-weight="700" fill="#FFFFFF" text-anchor="middle">DSH</text>
</svg>`;

(async () => {
  const png = await sharp(Buffer.from(SVG)).resize(512, 512).png().toBuffer();
  const assetsDir = path.join(ROOT, "assets");
  const buildDir = path.join(ROOT, "build");
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(buildDir, { recursive: true });

  await sharp(png).png().toFile(path.join(assetsDir, "icon.png"));
  const ico = png2icons.createICO(png, png2icons.BICUBIC, 0, false);
  fs.writeFileSync(path.join(buildDir, "icon.ico"), ico);
  console.log("OK: assets/icon.png, build/icon.ico");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
