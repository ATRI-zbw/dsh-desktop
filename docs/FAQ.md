# FAQ · 常见问题

## 安装与启动

### Q: 双击 exe 提示「Windows 已保护你的电脑 / 未知发布者」？
项目未购买代码签名证书（签名证书费用较高）。点击 **更多信息 → 仍要运行** 即可。
每个 Release 都附带 **SHA256 校验和**，可在下载页核对文件完整性，确认无误后放心运行。

### Q: 提示「未找到 DeepSeek Harness CLI」？
本机缺少 `@deepseek-ai/dsh`。打开 PowerShell 执行：

```powershell
npm install -g @deepseek-ai/dsh
```

然后重新打开应用。使用分发包时，直接运行包内的 `启动.bat` 可自动完成安装。

### Q: 双击后长时间白屏/无反应？
首次启动需要等待 `dsh web` 服务就绪（一般 10–30 秒，首次可能更久）。
若超过 2 分钟仍无反应，查看日志：

```
%APPDATA%\dsh-desktop\logs\dsh-web-<时间戳>.log
```

把日志内容提交到 Issue 帮助排查。

### Q: 关闭窗口后服务会残留吗？
不会。关闭窗口时应用会用 `taskkill /T` 结束整个进程树，
包括拉起的 `dsh web` 子进程，无后台残留。

## 账户与 API Key

### Q: API Key 存在哪里？
`C:\Users\<你的用户名>\.dsh\.credentials.yaml`，内容形如：

```yaml
DEEPSEEK_API_KEY: sk-xxxxx
```

这是 dsh 的标准凭证位置（DSH_HOME），与浏览器版共用，请勿外泄。

### Q: 怎么注册账号并创建 API Key？
打开 DeepSeek 开放平台：https://platform.deepseek.com
注册/登录后，进入 **API Keys** 页面 → **创建 API Key** → 复制（只显示一次）。

使用 `启动.bat` 或桌面版内置引导页可一键完成配置。

### Q: 想换一个 API Key？
重新运行 `启动.bat`，或直接编辑上面的 `.credentials.yaml` 文件替换即可。

## 构建与开发

### Q: 打包时 Electron 下载超时/失败？
国内网络访问 GitHub 可能超时，使用 npmmirror 镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

### Q: 我的电脑没装 Node.js，能直接用吗？
使用分发包时，运行 `启动.bat` 会自动引导安装 Node.js（>= 20）。
未来发布的完整安装程序将**内置 Node 与 dsh**，装完即用，无需任何手动安装。

## 其他

### Q: 桌面版和浏览器版有什么区别？
同一个 dsh 服务（同源），桌面版只是把界面装进独立窗口，
自动管理服务的启动/退出，并复用你本机已有的配置、会话与凭据。

### Q: 想贡献代码？
见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
