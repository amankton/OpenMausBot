@echo off
title Restart Chief and Workspace
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-chief-dev.ps1"
if errorlevel 1 (
  echo.
  echo Chief could not finish restarting. The error is shown above.
  pause
)
