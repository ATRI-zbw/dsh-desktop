"use strict";
/**
 * electron-builder afterPack 钩子
 *
 * electron-builder 对 extraResources 有强制规则：任何含 node_modules 的
 * 模式都会被排除（app-builder-lib/out/fileMatcher.js），无法用 filter 覆盖。
 * 因此内置 dsh 的依赖树在打包完成后由本钩子手动复制进 resources\dsh。
 *
 * 用法：package.json build.afterPack = "scripts/afterPack.js"
 */
const fs = require("node:fs");
const path = require("node:path");

async function afterPack(context) {
  const { appOutDir, packager } = context;
  const projectDir = packager.projectDir;

  const vendorDsh = path.join(projectDir, "vendor", "dsh");
  const destDsh = path.join(appOutDir, "resources", "dsh");

  if (!fs.existsSync(path.join(vendorDsh, "node_modules"))) {
    console.log("[afterPack] vendor/dsh/node_modules 不存在，跳过依赖复制");
    return;
  }

  console.log("[afterPack] 复制 dsh 依赖树 node_modules ...");
  fs.cpSync(
    path.join(vendorDsh, "node_modules"),
    path.join(destDsh, "node_modules"),
    { recursive: true, force: true, verbatimSymlinks: false }
  );
  console.log("[afterPack] 完成：resources\\dsh\\node_modules");

  // 顺带把顶层 package.json 保留（extraResources 已复制，这里确保存在）
  if (!fs.existsSync(path.join(destDsh, "package.json")) && fs.existsSync(path.join(vendorDsh, "package.json"))) {
    fs.copyFileSync(path.join(vendorDsh, "package.json"), path.join(destDsh, "package.json"));
  }
}

module.exports = afterPack;
