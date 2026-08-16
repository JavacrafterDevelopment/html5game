@echo off
setlocal
title WHITEOUT - Game Server
cd /d "%~dp0"

echo.
echo   Starting WHITEOUT server...
echo.

if not exist "runtime\node\node.exe" (
  echo   ERROR: runtime\node\node.exe is missing.
  echo   The portable Node runtime should ship inside this folder.
  echo   If you copied the project, make sure the "runtime" folder came with it.
  echo.
  pause
  exit /b 1
)

rem Everything runs from the bundled runtime - nothing needs to be installed.
"runtime\node\node.exe" "server\index.js" %*

echo.
echo   Server stopped.
pause
