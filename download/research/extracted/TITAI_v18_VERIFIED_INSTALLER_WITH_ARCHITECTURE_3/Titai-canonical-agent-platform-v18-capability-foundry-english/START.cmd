@echo off
cd /d "%~dp0"
node installer\start.mjs
if errorlevel 1 pause
