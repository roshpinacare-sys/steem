@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.16 or newer is required to verify this package.
  pause
  exit /b 1
)
node installer\verify-package.mjs
set RC=%ERRORLEVEL%
pause
exit /b %RC%
