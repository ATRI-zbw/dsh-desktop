@echo off
rem DeepSeek Harness 桌面版 - 在桌面创建快捷方式（双击本文件即可）
title DeepSeek Harness 桌面版 快捷方式
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 PowerShell，无法继续。
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1" -ShortcutOnly
if errorlevel 1 (
  echo.
  echo [错误] 创建快捷方式失败，请截图反馈。
  pause
  exit /b 1
)
