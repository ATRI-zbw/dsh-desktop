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
const { app, BrowserWindow, dialog } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const { createServer } = require("node:net");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const APP_TITLE = "DeepSeek Harness 桌面版";
const READY_TIMEOUT_MS = 120_000; // dsh web 首次启动可能较慢

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

/** 解析 @deepseek-ai/dsh 的 lib/bin.js(优先内置,退回系统全局;环境变量可覆盖)。 */
function resolveDshBin(node) {
  const over = process.env.DSH_DESKTOP_DSH;
  if (over && exists(over)) return over;
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
    const tick = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => {
        if (Date.now() > deadline) return reject(new Error("dsh web 服务启动超时"));
        setTimeout(tick, 500);
      });
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

// ---------------------------------------------------------------- 窗口
const SPLASH_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#4D6BFE,#1D2A6E);color:#fff;font-family:"Segoe UI","Microsoft YaHei",sans-serif}
.logo{font-size:56px;font-weight:800;letter-spacing:2px}
.msg{margin-top:18px;font-size:15px;opacity:.85}
.spinner{margin-top:26px;width:26px;height:26px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:spin 0.9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><div class="logo">DSH</div><div class="msg">正在启动 DeepSeek Harness 服务…</div><div class="spinner"></div></body></html>`;

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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(SPLASH_HTML));
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
      }
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
