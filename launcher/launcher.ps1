#requires -version 5.1
<#
  DeepSeek Harness 桌面版 · 零基础启动器
  ======================================
  面向第一次使用 DeepSeek Harness 的用户，自动完成：
    1. 检测/安装 Node.js（>= 20）
    2. 检测/安装 @deepseek-ai/dsh 命令行工具
    3. 引导创建 DeepSeek 平台账号并配置 API Key
    4. 验证本地环境可以启动 dsh web 服务
    5. 在桌面创建快捷方式（指向桌面版）
    6. 启动 DeepSeek Harness 桌面版

  用法（双击 启动.bat 即可，无需任何命令）：
    powershell -ExecutionPolicy Bypass -File launcher.ps1
    可选参数：
      -CheckOnly    只检查环境并打印结果，不做任何修改
      -ShortcutOnly 只在桌面创建快捷方式
      -NoLaunch     配置完成后不自动启动桌面版
#>
[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$ShortcutOnly,
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------------------------------------------------------------- 常量
$APP_NAME   = "DeepSeek Harness 桌面版"
$DASH_LINE  = ("-" * 62)
$NODE_MIN   = 20
$DSH_HOME   = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE ".dsh" }
$CRED_FILE  = Join-Path $DSH_HOME ".credentials.yaml"
$SETTINGS_FILE = Join-Path $DSH_HOME "settings.yaml"

# 桌面版 exe：优先找脚本同目录的便携版 exe，其次 win-unpacked
$SCRIPT_DIR = $PSScriptRoot
$PORTABLE_EXE = Get-ChildItem -Path $SCRIPT_DIR -Filter "*-portable.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$WIN_UNPACKED_EXE = Join-Path $SCRIPT_DIR "win-unpacked\DeepSeek Harness Desktop.exe"
if ($PORTABLE_EXE) {
  $DESKTOP_EXE = $PORTABLE_EXE.FullName
} elseif (Test-Path $WIN_UNPACKED_EXE) {
  $DESKTOP_EXE = $WIN_UNPACKED_EXE
} else {
  $DESKTOP_EXE = $null
}

# ---------------------------------------------------------------- 输出工具
function Write-Step  { Write-Host ""; Write-Host $DASH_LINE -ForegroundColor DarkGray; Write-Host "[步骤] $args" -ForegroundColor Cyan }
function Write-Ok    { Write-Host "  [OK] $args" -ForegroundColor Green }
function Write-Warn  { Write-Host "  [注意] $args" -ForegroundColor Yellow }
function Write-Err   { Write-Host "  [错误] $args" -ForegroundColor Red }
function Write-Info  { Write-Host "  $args" -ForegroundColor Gray }
function Pause-Go    { Write-Host ""; try { Read-Host "按回车键继续..." | Out-Null } catch {} }

function Show-Banner {
  Clear-Host
  Write-Host ""
  Write-Host "  ============================================" -ForegroundColor Cyan
  Write-Host "      DeepSeek Harness 桌面版 · 安装引导" -ForegroundColor White
  Write-Host "  ============================================" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  本向导将帮你完成：账号创建 → 环境构建 → 开始使用" -ForegroundColor Gray
  Write-Host "  全程无需命令行操作，跟着提示走即可。" -ForegroundColor Gray
  Write-Host ""
}

# ---------------------------------------------------------------- 检测 Node.js
function Get-NodeVersion {
  try {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { return $null }
    $ver = & $node.Source --version 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    if ($ver -match "v(\d+)\.(\d+)\.(\d+)") {
      return [PSCustomObject]@{ Major = [int]$Matches[1]; Minor = [int]$Matches[2]; Patch = [int]$Matches[3]; Path = $node.Source; Raw = $ver }
    }
    return $null
  } catch { return $null }
}

function Install-NodeGuide {
  Write-Step "安装 Node.js（第 1 步 / 共 6 步）"
  Write-Warn "未检测到 Node.js（或版本低于 $NODE_MIN），DeepSeek Harness 需要它才能运行。"
  Write-Host ""
  Write-Info "请选择安装方式："
  Write-Info "  [1] 自动安装（推荐）—— 将自动下载并安装 LTS 版（约 2-3 分钟）"
  Write-Info "  [2] 手动安装 —— 打开官网下载页，下载安装后回到本向导继续"
  Write-Host ""
  $choice = Read-Host "请输入 1 或 2"
  if ($choice -eq "2") {
    Write-Info "正在打开 Node.js 官网下载页（请选择 LTS 版 Windows 安装包）..."
    Start-Process "https://nodejs.org/zh-cn/download"
    Pause-Go
    Write-Info "请确认已安装完成（可在命令行执行 node --version 验证）..."
    Pause-Go
    return
  }
  # 方式 1：优先 winget（Win10/11 自带），失败则下载官方安装包
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    Write-Info "检测到 winget，正在安装 Node.js LTS（可能需要几分钟，请耐心等待）..."
    try {
      & $winget.Source install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements --disable-interactivity 2>&1 | ForEach-Object { Write-Info $_ }
      if ($LASTEXITCODE -eq 0) { Write-Ok "Node.js 安装完成"; return }
      Write-Warn "winget 安装未成功，改用官方安装包方式"
    } catch { Write-Warn "winget 安装失败，改用官方安装包方式" }
  }
  Write-Info "正在打开 Node.js 官网下载页（请选择 LTS 版 Windows 安装包并完成安装）..."
  Start-Process "https://nodejs.org/zh-cn/download"
  Pause-Go
}

# ---------------------------------------------------------------- 检测 dsh CLI
function Get-DshBin {
  # 1) 显式路径：npm 全局目录下
  $npmRoot = $null
  try {
    $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
    if ($nodeExe) {
      $npmCli = Join-Path (Split-Path $nodeExe -Parent) "node_modules\npm\bin\npm-cli.js"
      if (Test-Path $npmCli) {
        $out = & $nodeExe $npmCli "root" "-g" 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) { $npmRoot = ($out | Select-Object -Last 1).Trim() }
      }
    }
  } catch {}
  $candidates = @()
  if ($npmRoot) { $candidates += (Join-Path $npmRoot "@deepseek-ai\dsh\lib\bin.js") }
  $candidates += (Join-Path $env:APPDATA "npm\node_modules\@deepseek-ai\dsh\lib\bin.js")
  $candidates += (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node_modules\npm\node_modules\@deepseek-ai\dsh\lib\bin.js")
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  # 2) PATH 里的 dsh
  $dshCmd = Get-Command dsh -ErrorAction SilentlyContinue
  if ($dshCmd) {
    try {
      $out = & (Get-Command node -ErrorAction SilentlyContinue).Source (Join-Path $env:APPDATA "npm\node_modules\@deepseek-ai\dsh\lib\bin.js") "--version" 2>$null
      # 上面的 bin.js --version 可能不适用；直接尝试解析 cmd 目标
      $target = $dshCmd.Source
      if ($target -and (Test-Path $target)) {
        $resolved = (Get-Content $target -ErrorAction SilentlyContinue | Select-String "bin.js" | Select-Object -First 1).Line
        if ($resolved -match "'([^']*bin\.js)'") { return $Matches[1] }
      }
    } catch {}
  }
  return $null
}

function Install-DshGuide {
  Write-Step "安装 DeepSeek Harness 命令行工具（第 2 步 / 共 6 步）"
  Write-Warn "未检测到 @deepseek-ai/dsh 命令行工具，正在为你安装（需要网络，约 1-2 分钟）..."
  $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $nodeExe) { Write-Err "缺少 node.exe，无法安装"; Pause-Go; return }
  $npmCli = Join-Path (Split-Path $nodeExe -Parent) "node_modules\npm\bin\npm-cli.js"
  if (-not (Test-Path $npmCli)) {
    Write-Err "未找到 npm（$npmCli），请手动执行安装：npm install -g @deepseek-ai/dsh"
    Pause-Go; return
  }
  try {
    & $nodeExe $npmCli "install" "-g" "@deepseek-ai/dsh" "--no-fund" "--no-audit" 2>&1 | ForEach-Object { Write-Info $_ }
    if ($LASTEXITCODE -eq 0) { Write-Ok "@deepseek-ai/dsh 安装完成" }
    else { Write-Warn "安装命令已执行但可能未成功，请检查上方输出" }
  } catch {
    Write-Err "自动安装失败：$($_.Exception.Message)"
    Write-Info "请手动打开 PowerShell 执行： npm install -g @deepseek-ai/dsh"
  }
  Pause-Go
}

# ---------------------------------------------------------------- API Key
function Get-StoredKey {
  try {
    if (-not (Test-Path $CRED_FILE)) { return $null }
    $line = Get-Content $CRED_FILE -Encoding UTF8 | Where-Object { $_ -match "^\s*DEEPSEEK_API_KEY\s*:" } | Select-Object -First 1
    if (-not $line) { return $null }
    $val = ($line -split ":", 2)[1].Trim().Trim('"').Trim("'")
    return $val
  } catch { return $null }
}

function Set-StoredKey([string]$key) {
  if (-not (Test-Path $DSH_HOME)) { New-Item -ItemType Directory -Path $DSH_HOME -Force | Out-Null }
  $existing = @()
  if (Test-Path $CRED_FILE) { $existing = Get-Content $CRED_FILE -Encoding UTF8 }
  $newLines = $existing | Where-Object { $_ -notmatch "^\s*DEEPSEEK_API_KEY\s*:" }
  $newLines += "DEEPSEEK_API_KEY: $key"
  # 写临时文件再替换，避免写坏
  $tmp = "$CRED_FILE.tmp"
  $newLines | Set-Content -Path $tmp -Encoding UTF8
  Move-Item -Path $tmp -Destination $CRED_FILE -Force
}

function Ensure-Credential {
  Write-Step "配置 DeepSeek API Key（第 3 步 / 共 6 步）"
  $stored = Get-StoredKey
  if ($stored) {
    Write-Ok "已检测到已保存的 API Key（${stored}...）"
    return
  }
  Write-Warn "还没有配置 API Key。DeepSeek 平台账号的 API Key 是使用 AI 能力的凭证。"
  Write-Host ""
  Write-Info "首次使用请按下面步骤操作："
  Write-Info "  1. 打开 DeepSeek 开放平台并注册/登录账号："
  Write-Info "     https://platform.deepseek.com"
  Write-Info "  2. 在「API Keys」页面点击「创建 API Key」，复制生成的 key"
  Write-Info "     （形如 sk-xxxxxxxxxxxxxxxx，请妥善保管，只显示一次）"
  Write-Host ""
  Start-Process "https://platform.deepseek.com"
  Write-Info "浏览器已打开，请完成注册并创建 API Key 后回到本窗口。"
  Pause-Go
  $key = ""
  while (-not $key) {
    $key = Read-Host "请粘贴你的 API Key（粘贴后按回车）"
    $key = $key.Trim()
    if ($key -match "sk-[A-Za-z0-9]{20,}") {
      Set-StoredKey $key
      Write-Ok "API Key 已保存到 $CRED_FILE"
      # 确保 settings.yaml 默认使用 deepseek
      if (-not (Test-Path $SETTINGS_FILE)) {
        @(
          "agent-default-model:",
          "  provider: deepseek-official",
          "  model: deepseek-v4-flash"
        ) | Set-Content -Path $SETTINGS_FILE -Encoding UTF8
        Write-Ok "已生成默认 settings.yaml（deepseek-v4-flash）"
      }
      return
    } else {
      Write-Err "格式看起来不对（应以 sk- 开头且足够长），请重新粘贴完整 key"
    }
  }
}

# ---------------------------------------------------------------- 验证 dsh web
function Find-FreePort {
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  $listener.Stop()
  return $port
}

function Test-DshWeb {
  Write-Step "验证本地环境（第 4 步 / 共 6 步）"
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  $dshBin = Get-DshBin
  if (-not $node) { Write-Err "缺少 node.exe"; return $false }
  if (-not $dshBin) { Write-Err "缺少 dsh CLI（$dshBin）"; return $false }
  Write-Info "正在启动 dsh web 做一次快速自检（约 10-30 秒）..."
  $port = Find-FreePort
  $p = $null
  try {
    $p = Start-Process -FilePath $node -ArgumentList @($dshBin, "web", "--port", "$port", "--no-open") -PassThru -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\dsh-selfcheck-out.log" -RedirectStandardError "$env:TEMP\dsh-selfcheck-err.log"
    $deadline = (Get-Date).AddSeconds(60)
    $ok = $false
    while ((Get-Date) -lt $deadline) {
      if ($p.HasExited) { break }
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ok = $true; break }
      } catch {}
      Start-Sleep -Milliseconds 800
    }
    if ($ok) {
      Write-Ok "dsh web 服务启动正常（端口 $port，HTTP 200）"
    } else {
      Write-Err "dsh web 自检未通过"
      $errLog = Get-Content "$env:TEMP\dsh-selfcheck-err.log" -Tail 5 -ErrorAction SilentlyContinue
      if ($errLog) { $errLog | ForEach-Object { Write-Info "  $_" } }
    }
    return $ok
  } finally {
    if ($p -and -not $p.HasExited) {
      try { & taskkill /PID $p.Id /T /F 2>$null | Out-Null } catch {}
    }
  }
}

# ---------------------------------------------------------------- 桌面快捷方式
function New-DesktopShortcut {
  Write-Step "创建桌面快捷方式（第 5 步 / 共 6 步）"
  if (-not $DESKTOP_EXE) {
    Write-Warn "未找到桌面版程序（*-portable.exe 或 win-unpacked），跳过快捷方式"
    return $false
  }
  $desktop = [Environment]::GetFolderPath("Desktop")
  $lnkPath = Join-Path $desktop "DeepSeek Harness 桌面版.lnk"
  try {
    $ws = New-Object -ComObject WScript.Shell
    $sc = $ws.CreateShortcut($lnkPath)
    $sc.TargetPath = $DESKTOP_EXE
    $sc.WorkingDirectory = Split-Path $DESKTOP_EXE -Parent
    $sc.Description = "DeepSeek Harness 桌面版"
    # 图标默认取 exe 自带（IconLocation 留空即用 TargetPath,0）
    $sc.Save()
    Write-Ok "已创建桌面快捷方式：$lnkPath"
    return $true
  } catch {
    Write-Err "创建快捷方式失败：$($_.Exception.Message)"
    return $false
  }
}

# ---------------------------------------------------------------- 启动桌面版
function Start-DesktopApp {
  Write-Step "启动 DeepSeek Harness 桌面版（第 6 步 / 共 6 步）"
  if (-not $DESKTOP_EXE) {
    Write-Err "未找到桌面版程序，无法启动"
    Write-Info "请确认本脚本与桌面版程序（*-portable.exe）放在同一目录"
    return
  }
  Write-Info "正在启动：$DESKTOP_EXE"
  try {
    Start-Process -FilePath $DESKTOP_EXE
    Write-Ok "已启动！窗口打开后即可开始使用。"
    Write-Info "首次启动需要等待服务就绪（约 10-30 秒），请稍候。"
  } catch {
    Write-Err "启动失败：$($_.Exception.Message)"
  }
}

# ---------------------------------------------------------------- 主流程
Show-Banner

if ($ShortcutOnly) {
  New-DesktopShortcut
  Pause-Go
  exit 0
}

# 1. Node.js
$nodeInfo = Get-NodeVersion
if ($nodeInfo -and $nodeInfo.Major -ge $NODE_MIN) {
  Write-Step "检查 Node.js（第 1 步 / 共 6 步）"
  Write-Ok "Node.js $($nodeInfo.Raw)（$($nodeInfo.Path)）"
} else {
  if ($CheckOnly) {
    Write-Step "检查 Node.js"
    Write-Err "未检测到 Node.js（>= $NODE_MIN）"
  } else {
    Install-NodeGuide
  }
}

# 2. dsh CLI
$dshBin = Get-DshBin
if ($dshBin) {
  Write-Step "检查 DeepSeek Harness 命令行工具（第 2 步 / 共 6 步）"
  Write-Ok "已找到 @deepseek-ai/dsh：$dshBin"
} else {
  if ($CheckOnly) {
    Write-Step "检查 @deepseek-ai/dsh"
    Write-Err "未检测到 @deepseek-ai/dsh"
  } else {
    Install-DshGuide
  }
}

# 3. API Key
if ($CheckOnly) {
  Write-Step "检查 API Key"
  $stored = Get-StoredKey
  if ($stored) { Write-Ok "已配置 API Key（${stored}...）" } else { Write-Err "未配置 API Key（$CRED_FILE 中无 DEEPSEEK_API_KEY）" }
} else {
  Ensure-Credential
}

# 4. 验证
$webOk = Test-DshWeb

if ($CheckOnly) {
  Write-Host ""
  Write-Host $DASH_LINE -ForegroundColor DarkGray
  if ($nodeInfo -and $nodeInfo.Major -ge $NODE_MIN -and $dshBin) {
    $stored = Get-StoredKey
    if ($stored -and $webOk) {
      Write-Host "  环境检查全部通过！可以直接使用。" -ForegroundColor Green
    } elseif (-not $stored) {
      Write-Host "  环境基本就绪，但还缺 API Key。运行启动器（不带 -CheckOnly）配置即可。" -ForegroundColor Yellow
    } else {
      Write-Host "  环境部分就绪（dsh web 自检未通过），请查看上方错误。" -ForegroundColor Yellow
    }
  } else {
    Write-Host "  环境未就绪，请运行启动器（不带 -CheckOnly）自动安装缺失组件。" -ForegroundColor Yellow
  }
  Write-Host ""
  exit 0
}

# 5. 快捷方式
New-DesktopShortcut

# 6. 启动
if (-not $NoLaunch) {
  Start-DesktopApp
} else {
  Write-Step "完成"
  Write-Ok "环境配置完成。桌面已放置快捷方式，双击即可启动。"
}

Write-Host ""
Write-Host "  感谢使用！如遇问题，请把本窗口的内容截图反馈。" -ForegroundColor Gray
Pause-Go
