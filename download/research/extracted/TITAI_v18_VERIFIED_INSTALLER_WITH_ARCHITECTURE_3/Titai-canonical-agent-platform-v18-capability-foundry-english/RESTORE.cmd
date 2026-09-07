@echo off
cd /d "%~dp0"
node installer\restore.mjs
set RC=%ERRORLEVEL%
pause
exit /b %RC%
