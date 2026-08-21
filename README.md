# DeepSeek Harness 桌面版

把 DeepSeek Harness 的 Web 界面（`dsh web`）包装成 Windows 桌面应用：
Electron 壳在启动时用系统 Node 子进程拉起 `dsh web`，等待服务就绪后加载本地页面；
关闭窗口即随进程树一起退出服务。零基础用户也可用配套启动器一键完成
「账户创建 → 本地环境构建 → 开始使用」全流程。

> 个人开源项目，按需维护。欢迎 Issue、PR 与使用反馈——反馈越多，维护越勤。
> 请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [FAQ.md](docs/FAQ.md)。

## 特性

- 🖥️ **桌面应用**：Electron 窗口承载 dsh web，关闭窗口即整体退出，无后台残留
- 🚀 **零基础启动器**（`launcher/`）：检测/安装 Node.js → 安装 dsh CLI → 引导注册
  DeepSeek 平台账号并配置 API Key → 验证服务 → 创建桌面快捷方式 → 启动
- 📦 **两种分发**：单文件便携版 + NSIS 安装程序（计划内置 Node 与 dsh，装完即用）
- 📱 **手机遥控（规划中）**：`remote/` 模块，蓝牙（后续局域网/远程中继）远程
  查看进度、派发任务、批准沙箱请求（详见 [remote/README.md](remote/README.md)）

## 快速开始

### 方式一：使用分发包（推荐给普通用户）

从 [Releases](../../releases) 下载：

- `DeepSeek-Harness-Desktop-<版本>-portable.exe` —— 单文件便携版，双击即用
- `DeepSeek-Harness-Desktop-Setup-<版本>.exe` —— NSIS 安装程序
- `DeepSeek-Harness-Desktop-<版本>-便携包.zip` —— 便携版 + 零基础启动器 + 使用说明

首次运行若遇 SmartScreen 提示「未知发布者」，点 **更多信息 → 仍要运行** 即可
（项目未购买代码签名证书；每个 Release 均附 SHA256 校验和供核对）。

### 方式二：从源码构建

前置条件：Windows x64、Node.js >= 20、已全局安装 `@deepseek-ai/dsh`：

```powershell
npm install -g @deepseek-ai/dsh
npm install
npm start          # 开发运行
npm run icon       # 生成图标（首次或修改图标后）
npm run dist       # 构建便携版 + NSIS 安装包（输出到 dist/）
```

## 工作原理

桌面版通过系统 Node 运行本机的 `@deepseek-ai/dsh` CLI（与浏览器版同源），
复用 `%USERPROFILE%\.dsh`（DSH_HOME）下的配置、会话与凭据：

```
Electron 主进程
  ├─ 探测系统 node.exe 与 dsh CLI（支持 DSH_DESKTOP_NODE / DSH_DESKTOP_DSH 覆盖）
  ├─ 借空闲端口 → spawn `dsh web --port <port> --no-open`
  ├─ 轮询 HTTP 就绪 → 加载本地页面
  └─ 退出时 taskkill 进程树
```

## 项目结构

```
dsh-desktop/
├── main.js                  # Electron 主进程（含 --smoke-test 冒烟模式）
├── package.json             # electron-builder 构建配置
├── launcher/                # 零基础启动器（.bat 入口 + PowerShell 引导）
├── remote/                  # 手机遥控模块（规划中）
├── scripts/                 # 构建辅助脚本
├── docs/                    # 文档（FAQ 等）
├── assets/  build/          # 图标资源
└── .github/workflows/       # CI：tag 推送 → 自动构建 → 发 Release
```

## 配置 / 排障

| 环境变量 | 作用 |
| --- | --- |
| `DSH_DESKTOP_NODE` | 指定 node.exe 绝对路径（默认自动探测） |
| `DSH_DESKTOP_DSH` | 指定 dsh CLI 的 `lib/bin.js` 绝对路径（默认自动探测） |

- 每次启动会选一个空闲端口（避免与已有实例冲突），日志写到
  `%APPDATA%/dsh-desktop/logs/dsh-web-<时间戳>.log`
- 若提示「未找到 DeepSeek Harness CLI」，执行 `npm install -g @deepseek-ai/dsh` 后重开
- 更多问题见 [FAQ.md](docs/FAQ.md)

## 许可

MIT License，见 [LICENSE](LICENSE)。
