"use strict";
/**
 * DeepSeek Harness 桌面版 —— Electron 主进程
 *
 * 工作方式:用系统 Node 以子进程方式启动 `dsh web --port <空闲端口> --no-open`,
 * 轮询 HTTP 就绪后把窗口指向该地址;退出时用 taskkill 杀进程树。
 *
 * 环境变量覆盖(便于排障):
 *   DSH_DESKTOP_NODE  指定 node.exe 的绝对路径
 *   DSH_DESKTOP_DSH   指定 dsh CLI 的 lib/bin.js 绝对路径
 */
const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, shell } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const { createServer } = require("node:net");
const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");

const APP_TITLE = "DeepSeek Harness 桌面版";
const READY_TIMEOUT_MS = 120_000; // dsh web 首次启动可能较慢
const GITHUB_REPO = "ATRI-zbw/dsh-desktop";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

let mainWindow = null;
let serverProcess = null;
let serverPort = 0;
let serverReady = false;
let quitting = false;
let logStream = null;

/** 冒烟测试模式:启动服务、打印就绪地址、退出(供自动化验证,不开窗口)。 */
const SMOKE_TEST = process.argv.includes("--smoke-test");

// ---------------------------------------------------------------- 路径解析
function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** 内置 node.exe(安装包自带: resources\node\node.exe;开发: vendor\node\node.exe)。 */
function bundledNode() {
  const pkg = process.resourcesPath ? path.join(process.resourcesPath, "node", "node.exe") : null;
  if (pkg && exists(pkg)) return pkg;
  const dev = path.join(__dirname, "vendor", "node", "node.exe");
  if (exists(dev)) return dev;
  return null;
}

/** 解析系统 node.exe(优先内置,退回系统安装;环境变量可覆盖)。 */
function resolveNode() {
  const over = process.env.DSH_DESKTOP_NODE;
  if (over && exists(over)) return over;
  const bundled = bundledNode();
  if (bundled) return bundled;
  const candidates = [
    "C:\\Program Files\\nodejs\\node.exe",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs", "node.exe") : null,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "nodejs", "node.exe") : null,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "nodejs", "node.exe") : null,
  ].filter(Boolean);
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    const p = path.join(dir, "node.exe");
    if (exists(p)) return p;
  }
  return "node"; // 兜底:完全依赖 PATH
}

function npmGlobalRoot(node) {
  try {
    const out = execFileSync(
      node,
      ["-e", "process.stdout.write(require('child_process').execSync('npm root -g',{encoding:'utf8'}).trim())"],
      { encoding: "utf8", timeout: 20_000, windowsHide: true }
    );
    return out.trim();
  } catch {
    return null;
  }
}

/** 内置 dsh 的 lib/bin.js(安装包: resources\dsh;开发: vendor\dsh)。 */
function bundledDshBin() {
  const pkg = process.resourcesPath ? path.join(process.resourcesPath, "dsh", "lib", "bin.js") : null;
  if (pkg && exists(pkg)) return pkg;
  const dev = path.join(__dirname, "vendor", "dsh", "lib", "bin.js");
  if (exists(dev)) return dev;
  return null;
}

/** 用户级 dsh 更新副本(userData\dsh-update),优先级最高(不修改安装目录)。 */
function userDshBin() {
  const p = path.join(app.getPath("userData"), "dsh-update", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  return exists(p) ? p : null;
}

/** 解析 @deepseek-ai/dsh 的 lib/bin.js(优先用户更新副本→内置→系统全局;环境变量可覆盖)。 */
function resolveDshBin(node) {
  const over = process.env.DSH_DESKTOP_DSH;
  if (over && exists(over)) return over;
  const user = userDshBin();
  if (user) return user;
  const bundled = bundledDshBin();
  if (bundled) return bundled;
  const candidates = [];
  const npmRoot = npmGlobalRoot(node);
  if (npmRoot) candidates.push(path.join(npmRoot, "@deepseek-ai", "dsh", "lib", "bin.js"));
  candidates.push(
    path.join(process.env.APPDATA || "", "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
  );
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------- 端口与服务
/** 借一个 OS 空闲端口(仅用于探测,随后交给 dsh web 监听)。 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

/** 轮询直到 http://127.0.0.1:port 可访问。 */
function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error("dsh web 服务启动超时"));
      setTimeout(tick, 500);
    };
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(); // 2xx 才算就绪
        } else {
          retry(); // 404/500 等说明服务还在启动或异常，继续等待
        }
      });
      req.on("timeout", () => req.destroy());
      req.on("error", retry);
    };
    tick();
  });
}

function startDshWeb(node, dshBin) {
  return findFreePort().then(
    (port) =>
      new Promise((resolve, reject) => {
        serverPort = port;
        const logsDir = path.join(app.getPath("userData"), "logs");
        fs.mkdirSync(logsDir, { recursive: true });
        const logFile = path.join(logsDir, `dsh-web-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
        logStream = fs.createWriteStream(logFile, { flags: "a" });

        const child = spawn(node, [dshBin, "web", "--port", String(port), "--no-open"], {
          env: { ...process.env },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        serverProcess = child;
        child.stdout.on("data", (d) => {
          logStream.write(d);
          if (!app.isPackaged) process.stdout.write(d);
        });
        child.stderr.on("data", (d) => {
          logStream.write(d);
          if (!app.isPackaged) process.stderr.write(d);
        });
        child.on("error", (err) => reject(err));
        child.on("exit", (code, signal) => {
          try {
            logStream.end();
          } catch {}
          if (!quitting && !serverReady) {
            reject(new Error(`dsh web 提前退出 (code=${code}, signal=${signal})`));
            return;
          }
          if (!quitting && serverReady) {
            dialog.showErrorBox(APP_TITLE, `dsh web 服务已退出 (code=${code}, signal=${signal})。\n日志: ${logFile}`);
            app.quit();
          }
        });

        waitForServer(port, READY_TIMEOUT_MS)
          .then(() => {
            serverReady = true;
            resolve(port);
          })
          .catch(reject);
      })
  );
}

/** 退出时清理:先 taskkill 整棵进程树,再兜底 kill。 */
function killServerTree() {
  if (!serverProcess || serverProcess.killed) return;
  try {
    execFileSync("taskkill", ["/pid", String(serverProcess.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch {
    try {
      serverProcess.kill();
    } catch {}
  }
}

// ---------------------------------------------------------------- 版本与更新
function parseVersion(v) {
  const m = String(v || "").replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

/** 比较两个版本: a > b 返回 1, a === b 返回 0, a < b 返回 -1, 无法解析返回 null。 */
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (const k of ["major", "minor", "patch"]) {
    if (pa[k] !== pb[k]) return pa[k] > pb[k] ? 1 : -1;
  }
  return 0;
}

/** 查询 GitHub 最新 Release(静默失败:无网/非 2xx/超时都返回 null)。 */
function fetchLatestRelease(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = https.get(
      GITHUB_API,
      { headers: { "User-Agent": `dsh-desktop/${app.getVersion()}` }, timeout: timeoutMs },
      (res) => {
        res.resume();
        if (res.statusCode !== 200) return resolve(null);
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            const j = JSON.parse(body);
            resolve({ tag: j.tag_name || "", url: j.html_url || "", publishedAt: j.published_at || null });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

/** 半自动更新检查:有新版时弹窗提示。返回 { update, latest, url }。 */
async function checkForUpdates(interactive = false) {
  const rel = await fetchLatestRelease();
  if (!rel) {
    if (interactive) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: APP_TITLE,
        message: "无法检查更新",
        detail: "网络不可用或 GitHub 暂时无法访问，请稍后再试。",
        buttons: ["知道了"],
      });
    }
    return { update: false, error: "network" };
  }
  const cmp = compareVersions(rel.tag, app.getVersion());
  if (cmp === null) return { update: false, error: "parse" };
  if (cmp <= 0) return { update: false, latest: rel.tag };
  if (interactive || true) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: APP_TITLE,
      message: `发现新版本 v${rel.tag.replace(/^v/i, "")}`,
      detail: `当前版本 v${app.getVersion()}。是否前往 GitHub Releases 下载新版本？`,
      buttons: ["前往下载", "以后再说"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) shell.openExternal(rel.url);
  }
  return { update: true, latest: rel.tag, url: rel.url };
}

// ---------------------------------------------------------------- API Key 管理
function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}
function credentialsFile() {
  return path.join(dshHome(), ".credentials.yaml");
}

function readStoredKey() {
  try {
    const f = credentialsFile();
    if (!fs.existsSync(f)) return null;
    const line = fs.readFileSync(f, "utf8").split(/\r?\n/).find((l) => /^\s*DEEPSEEK_API_KEY\s*:/.test(l));
    if (!line) return null;
    return line.split(":", 2)[1].trim().trim('"').trim("'") || null;
  } catch {
    return null;
  }
}

function writeStoredKey(key) {
  const f = credentialsFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const existing = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split(/\r?\n/) : [];
  const kept = existing.filter((l) => !/^\s*DEEPSEEK_API_KEY\s*:/.test(l));
  kept.push(`DEEPSEEK_API_KEY: ${key}`);
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, kept.join("\n") + "\n", "utf8");
  fs.renameSync(tmp, f);
}

// ---------------------------------------------------------------- token 统计
/**
 * 从 DSH_HOME 下所有会话日志聚合 token 用量。
 * 会话日志是 .jsonl.zstd(多帧拼接),用 Node 内置 zstd 逐帧解压,
 * 统计 assistant/chunk 事件里的 usage 字段。
 * 返回 { sessions, inputTokens, outputTokens, cacheReadTokens, reasoningTokens, totalTokens }。
 */
function zstdFrames(buf) {
  const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const starts = [];
  let i = 0;
  while (i < buf.length - 3) {
    const idx = buf.indexOf(MAGIC, i);
    if (idx === -1) break;
    starts.push(idx);
    i = idx + 4;
  }
  const parts = [];
  for (let f = 0; f < starts.length; f++) {
    const s = starts[f];
    const e = f + 1 < starts.length ? starts[f + 1] : buf.length;
    try {
      parts.push(zlib.zstdDecompressSync(buf.subarray(s, e)));
    } catch {}
  }
  return Buffer.concat(parts).toString("utf8");
}

function collectTokenUsage() {
  const home = dshHome();
  const sessionsDir = path.join(home, "sessions");
  const acc = { sessions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, totalTokens: 0, files: 0 };
  if (!fs.existsSync(sessionsDir)) return acc;
  let roots;
  try {
    roots = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const root of roots) {
    if (!root.isDirectory()) continue;
    const sub = path.join(sessionsDir, root.name);
    let sessionDirs;
    try {
      sessionDirs = fs.readdirSync(sub, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of sessionDirs) {
      if (!d.isDirectory()) continue;
      const logFile = path.join(sub, d.name, "session.jsonl.zstd");
      if (!fs.existsSync(logFile)) continue;
      acc.files++;
      try {
        const text = zstdFrames(fs.readFileSync(logFile));
        // 逐行解析,命中 usage 事件
        for (const line of text.split(/\r?\n/)) {
          if (!line.includes('"usage"')) continue;
          try {
            const ev = JSON.parse(line);
            const u = ev && ev.data && ev.data.chunk && ev.data.chunk.usage;
            if (!u) continue;
            acc.inputTokens += u.inputTokens || 0;
            acc.outputTokens += u.outputTokens || 0;
            acc.cacheReadTokens += u.cacheReadTokens || 0;
            acc.reasoningTokens += u.reasoningTokens || 0;
          } catch {}
        }
      } catch {}
    }
  }
  acc.totalTokens = acc.inputTokens + acc.outputTokens + acc.cacheReadTokens + acc.reasoningTokens;
  // sessions 计数:统计到日志文件即视为一个会话(活跃中亦计入)
  acc.sessions = acc.files;
  return acc;
}

// ---------------------------------------------------------------- DeepSeek 余额
/**
 * 查询 DeepSeek 账户余额(GET /user/balance)。
 * API key 由主进程从凭据读取,绝不进入浏览器。失败返回 { ok:false }。
 */
function fetchBalance(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const key = readStoredKey();
    if (!key) return resolve({ ok: false, error: "未配置 API Key" });
    const req = https.get(
      "https://api.deepseek.com/user/balance",
      { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, timeout: timeoutMs },
      (res) => {
        res.resume();
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          if (res.statusCode !== 200) return resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          try {
            const j = JSON.parse(body);
            resolve({ ok: true, isAvailable: j.is_available, balanceInfos: j.balance_infos || [] });
          } catch {
            resolve({ ok: false, error: "响应解析失败" });
          }
        });
      }
    );
    req.on("timeout", () => req.destroy());
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
  });
}

// ---------------------------------------------------------------- 更新内置 dsh
function updateBundledDsh() {
  return new Promise((resolve) => {
    const node = resolveNode();
    if (!node) return resolve({ ok: false, error: "未找到 node.exe" });
    const targetDir = path.join(app.getPath("userData"), "dsh-update");
    const npmCli = path.join(path.dirname(node), "node_modules", "npm", "bin", "npm-cli.js");
    const args = [npmCli, "install", "-g", "@deepseek-ai/dsh", "--prefix", targetDir, "--no-fund", "--no-audit"];
    const child = spawn(node, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let errTail = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (d) => {
      errTail = (errTail + d.toString()).slice(-2000);
    });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
    child.on("exit", (code) => {
      const bin = path.join(targetDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
      if (code === 0 && fs.existsSync(bin)) {
        resolve({ ok: true, path: bin });
      } else {
        resolve({ ok: false, error: `安装失败 (code=${code})`, log: errTail });
      }
    });
  });
}

// ---------------------------------------------------------------- 外观主题
const DEFAULT_THEME = {
  primary: "#4D6BFE",
  dark: "#1D2A6E",
  backgroundImage: "", // 用户自定义背景图（绝对路径），空 = 默认渐变
  injectedCss: "",     // 注入 dsh web 页面的自定义 CSS
};

function prefsFile() {
  return path.join(app.getPath("userData"), "prefs.json");
}

function loadPrefs() {
  try {
    const raw = fs.readFileSync(prefsFile(), "utf8");
    const j = JSON.parse(raw);
    return { ...DEFAULT_THEME, ...(j && typeof j === "object" ? j : {}) };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

function savePrefs(prefs) {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const tmp = prefsFile() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(prefs, null, 2), "utf8");
  fs.renameSync(tmp, prefsFile());
}

/** 组装注入 dsh web 页面的主题 CSS(主题色 + 自定义背景 + 用户 CSS)。 */
function themeCss(prefs) {
  let css = "";
  if (prefs.backgroundImage) {
    // file:// 会被 Chromium 拦截(http 页面禁止加载本地文件),
    // 改为读取文件转 base64 data URL,保证跨源可用。
    try {
      const buf = fs.readFileSync(prefs.backgroundImage);
      const ext = path.extname(prefs.backgroundImage).toLowerCase().replace(".", "");
      const mime =
        { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", bmp: "image/bmp", gif: "image/gif" }[ext] ||
        "image/png";
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
      // 多容器覆盖 + 顶层容器透明化:SPA 常在主容器上设背景色盖住 body
      css += [
        `html,body{background-image:url("${dataUrl}") !important;background-size:cover !important;background-position:center !important;background-repeat:no-repeat !important;background-attachment:fixed !important;background-color:transparent !important;}`,
        `body>div,body>#root,body>#app,#root,#app{background:transparent !important;background-image:none !important;background-color:transparent !important;}`,
      ].join("\n");
    } catch {
      // 图片不可读则退回渐变
      if (prefs.primary) {
        css += `html,body{background:linear-gradient(160deg,${prefs.primary} 0%,${prefs.primary} 32%,${prefs.dark || "#1D2A6E"} 100%) !important;}`;
      }
    }
  } else if (prefs.primary) {
    css += `html,body{background:linear-gradient(160deg,${prefs.primary} 0%,${prefs.primary} 32%,${prefs.dark || "#1D2A6E"} 100%) !important;}`;
  }
  if (prefs.injectedCss) css += "\n" + prefs.injectedCss;
  return css;
}

/** 把主题应用到已加载的 dsh web 页面。
 * 用 executeJavaScript 注入带唯一 id 的 <style> 标签(替换式),
 * 比 insertCSS 更可靠且可重复调用。 */
const THEME_STYLE_ID = "dsh-desktop-theme-style";
function applyThemeToWeb(prefs) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const css = themeCss(prefs);
  const script = `(() => {
    try {
      let s = document.getElementById(${JSON.stringify(THEME_STYLE_ID)});
      if (!s) {
        s = document.createElement("style");
        s.id = ${JSON.stringify(THEME_STYLE_ID)};
        document.head.appendChild(s);
      }
      s.textContent = ${JSON.stringify(css)};
      return true;
    } catch (e) { return false; }
  })()`;
  mainWindow.webContents.executeJavaScript(script).catch(() => {});
}

// ---------------------------------------------------------------- 设置窗口
let settingsWindow = null;
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 620,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: `${APP_TITLE} · 桌面版设置`,
    parent: mainWindow || undefined,
    modal: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "settings", "settings-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.loadFile(path.join(__dirname, "settings", "settings.html"));
  settingsWindow.on("closed", () => (settingsWindow = null));
  return settingsWindow;
}

function registerIpc() {
  ipcMain.handle("settings:get-status", () => {
    const node = resolveNode();
    let nodeVersion = null;
    if (node) {
      try {
        nodeVersion = execFileSync(node, ["--version"], { encoding: "utf8", timeout: 10_000, windowsHide: true }).trim();
      } catch {}
    }
    const dshBin = resolveDshBin(node);
    let dshVersion = null;
    if (dshBin) {
      try {
        dshVersion = execFileSync(node, [dshBin, "--version"], { encoding: "utf8", timeout: 10_000, windowsHide: true }).trim();
      } catch {}
    }
    const key = readStoredKey();
    return {
      appVersion: app.getVersion(),
      nodeVersion,
      dshVersion,
      hasKey: !!key,
      keyHint: key ? key.slice(0, 8) : null,
      usingUserDsh: !!userDshBin(),
    };
  });

  ipcMain.handle("settings:set-api-key", (_e, key) => {
    const k = String(key || "").trim();
    if (!/^sk-[A-Za-z0-9]{16,}$/.test(k)) {
      return { ok: false, error: "Key 格式不正确（应以 sk- 开头）" };
    }
    try {
      writeStoredKey(k);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("settings:check-update", async () => {
    const rel = await fetchLatestRelease();
    if (!rel) return { ok: false, error: "网络不可用" };
    const cmp = compareVersions(rel.tag, app.getVersion());
    return { ok: true, update: cmp > 0, latest: rel.tag, url: rel.url };
  });

  ipcMain.handle("settings:update-dsh", async () => updateBundledDsh());

  ipcMain.handle("settings:open-download", (_e, url) => {
    if (typeof url === "string" && url.startsWith("https://")) shell.openExternal(url);
    return true;
  });

  ipcMain.handle("settings:get-tokens", () => collectTokenUsage());

  // ---- 主窗口挂饰用(dsh:* 命名空间,与设置窗口区分) ----
  ipcMain.handle("dsh:open-settings", () => {
    openSettings();
    return true;
  });
  ipcMain.handle("dsh:get-tokens", () => collectTokenUsage());
  ipcMain.handle("dsh:get-balance", () => fetchBalance());
  ipcMain.handle("dsh:reapply-theme", () => {
    applyThemeToWeb(theme);
    return true;
  });

  ipcMain.handle("settings:get-prefs", () => ({ ...theme }));

  ipcMain.handle("settings:set-prefs", (_e, prefs) => {
    if (!prefs || typeof prefs !== "object") return { ok: false, error: "参数错误" };
    // 只接受已知字段,防止注入
    const clean = {};
    for (const k of ["primary", "dark", "backgroundImage", "injectedCss"]) {
      if (typeof prefs[k] === "string") clean[k] = prefs[k];
    }
    theme = { ...theme, ...clean };
    try {
      savePrefs(theme);
      applyThemeToWeb(theme);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("settings:pick-image", async () => {
    const r = await dialog.showOpenDialog(settingsWindow || mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });
}

// ---------------------------------------------------------------- 托盘
let tray = null;
function createTray() {
  try {
    const iconPath = path.join(__dirname, "assets", "icon.png");
    tray = new Tray(iconPath);
    tray.setToolTip(APP_TITLE);
    const menu = Menu.buildFromTemplate([
      { label: "打开主界面", click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { label: "设置", click: () => openSettings() },
      { label: "检查更新", click: () => checkForUpdates(true) },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
    tray.on("click", () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch {
    tray = null; // 托盘失败不影响主功能
  }
}

// ---------------------------------------------------------------- 窗口
/**
 * 生成启动画面 HTML。渐变用多段色标消除 8-bit 色带（banding）：
 * 从主题主色经中间过渡色平滑滑向深色，而非两色硬切。
 * @param {string} primary - 主题主色（如 #4D6BFE）
 * @param {string} dark    - 渐变深色端（如 #1D2A6E）
 */
function splashHtml(primary = "#4D6BFE", dark = "#1D2A6E") {
  // 主色 → 主色加深 → 深色端，四段平滑插值，配合径向高光降低色带感
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;color:#fff;font-family:"Segoe UI","Microsoft YaHei",sans-serif;
background:${primary};
background:linear-gradient(160deg,${primary} 0%,${primary} 32%,${dark} 100%);
background-size:100% 100%;}
html::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 50% 8%,rgba(255,255,255,.10) 0%,rgba(255,255,255,0) 55%);}
.logo{font-size:56px;font-weight:800;letter-spacing:2px;text-shadow:0 2px 12px rgba(0,0,0,.25)}
.msg{margin-top:18px;font-size:15px;opacity:.88}
.spinner{margin-top:26px;width:26px;height:26px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:spin 0.9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><div class="logo">DSH</div><div class="msg">正在启动 DeepSeek Harness 服务…</div><div class="spinner"></div></body></html>`;
}

// 当前主题(启动时加载一次,设置变更时更新)
let theme = { ...DEFAULT_THEME };

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: APP_TITLE,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "settings", "inject-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(splashHtml(theme.primary, theme.dark)));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  return mainWindow;
}

// ---------------------------------------------------------------- 生命周期
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    registerIpc();
    theme = loadPrefs();
    if (!SMOKE_TEST) createTray();

    const node = resolveNode();
    const dshBin = resolveDshBin(node);
    if (!dshBin) {
      dialog.showErrorBox(
        APP_TITLE,
        "未找到 DeepSeek Harness CLI (@deepseek-ai/dsh)。\n请先安装:\n  npm install -g @deepseek-ai/dsh"
      );
      app.quit();
      return;
    }
    if (!SMOKE_TEST) createWindow(null);
    try {
      const port = await startDshWeb(node, dshBin);
      if (SMOKE_TEST) {
        console.log(`SMOKE_OK http://127.0.0.1:${port}`);
        killServerTree();
        app.exit(0);
        return;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(`http://127.0.0.1:${port}`);
        // 页面完全加载后注入主题 + 挂饰。SPA 的 React 在 HTML 之后挂载,
        // 因此 did-finish-load 后延迟多次重试,等渲染稳定;背景被覆盖由挂饰内监测兜底。
        const injectAll = () => {
          applyThemeToWeb(theme);
          try {
            const widget = fs.readFileSync(path.join(__dirname, "settings", "inject-widget.js"), "utf8");
            mainWindow.webContents.executeJavaScript(widget).catch(() => {});
          } catch {}
        };
        mainWindow.webContents.on("did-finish-load", () => {
          const url = mainWindow.webContents.getURL();
          if (!url.startsWith(`http://127.0.0.1:${port}`)) return;
          // 立即 + 延迟重试(等 SPA 首屏渲染完),确保主题生效
          injectAll();
          [1500, 4000, 9000].forEach((ms) => setTimeout(injectAll, ms));
        });
      }
      // 服务就绪后:首次使用引导(无 Key) + 静默检查更新
      if (!readStoredKey()) {
        dialog
          .showMessageBox(mainWindow, {
            type: "info",
            title: APP_TITLE,
            message: "首次使用：请配置 API Key",
            detail:
              "使用 DeepSeek Harness 需要 API Key。\n\n点击「去配置」后，在设置窗口粘贴你的 API Key；还没有的话，浏览器会打开 DeepSeek 开放平台引导你创建。",
            buttons: ["去配置", "稍后再说"],
            defaultId: 0,
            cancelId: 1,
          })
          .then(({ response }) => {
            if (response === 0) {
              openSettings();
              shell.openExternal("https://platform.deepseek.com");
            }
          });
      }
      // 静默检查更新(不打断首次引导,延迟几秒)
      setTimeout(() => {
        checkForUpdates().catch(() => {});
      }, 5000);
    } catch (err) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
          `<!doctype html><meta charset="utf-8"><title>${APP_TITLE}</title><body style="font-family:Segoe UI,'Microsoft YaHei';display:flex;align-items:center;justify-content:center;height:100vh"><div><h3>启动失败</h3><pre style="white-space:pre-wrap">${String((err && err.message) || err)}</pre></div></body>`
        ));
      }
    }
  });

  app.on("activate", () => {
    if (mainWindow === null && serverPort) createWindow(`http://127.0.0.1:${serverPort}`);
  });

  app.on("before-quit", () => {
    quitting = true;
    killServerTree();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
