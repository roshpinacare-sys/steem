@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.16 or newer with npm is required.
  echo Install Node.js, then run INSTALL.cmd again.
  pause
  exit /b 1
)
node installer\install.mjs
set RC=%ERRORLEVEL%
pause
exit /b %RC%
