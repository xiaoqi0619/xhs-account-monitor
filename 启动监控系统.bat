@echo off
cd /d "%~dp0"
chcp 65001 >nul

set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 goto :USE_PATH_NODE

if exist "D:\Program Files\nodejs\node.exe" set "NODE_EXE=D:\Program Files\nodejs\node.exe"
if defined NODE_EXE goto :RUN_APP

if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if defined NODE_EXE goto :RUN_APP

echo [ERROR] Node.js v24+ not found. Please install Node.js first.
pause
exit /b 1

:USE_PATH_NODE
set "NODE_EXE=node"

:RUN_APP
"%NODE_EXE%" src/main.ts %*
echo.
pause
