@echo off
cd /d "%~dp0"
node installer\backup.mjs
set RC=%ERRORLEVEL%
pause
exit /b %RC%
