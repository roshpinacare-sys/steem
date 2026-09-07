@echo off
cd /d "%~dp0"
echo WARNING: This removes the database, backups and local secrets.
set /p CONFIRM=Type DELETE-ALL to continue: 
if /I not "%CONFIRM%"=="DELETE-ALL" exit /b 1
node installer\uninstall.mjs --remove-data
pause
