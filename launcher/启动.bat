@echo off
rem DeepSeek Harness 桌面版 - 零基础启动器（双击本文件即可）
title DeepSeek Harness 桌面版 启动器
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 PowerShell，无法继续。
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1"
if errorlevel 1 (
  echo.
  echo [错误] 启动器执行出错，请截图反馈。
  pause
  exit /b 1
)
