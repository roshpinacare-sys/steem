@echo off
cd /d "%~dp0"
node installer\repair.mjs
set RC=%ERRORLEVEL%
pause
exit /b %RC%
