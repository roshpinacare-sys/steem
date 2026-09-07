@echo off
cd /d "%~dp0"
node installer\verify.mjs --deep
set RC=%ERRORLEVEL%
pause
exit /b %RC%
