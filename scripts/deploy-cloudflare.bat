@echo off
setlocal
cd /d "%~dp0.."

echo.
echo SRD Warehouse System - Local Cloudflare Deploy
echo -----------------------------------------------

set "NODE_EXE="
set "NODE_DIR="
set "NPM_CMD="

if exist "portable-node\node.exe" (
  set "NODE_EXE=%CD%\portable-node\node.exe"
  set "NODE_DIR=%CD%\portable-node"
  set "NPM_CMD=%CD%\portable-node\npm.cmd"
) else (
  for /d %%D in ("portable-node\node-v*-win-x64") do (
    if exist "%%~fD\node.exe" (
      set "NODE_EXE=%%~fD\node.exe"
      set "NODE_DIR=%%~fD"
      set "NPM_CMD=%%~fD\npm.cmd"
    )
  )
)

if not defined NODE_EXE (
  where node >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Node.js was not found.
    echo Put the portable Node folder inside this project as portable-node, then run this file again.
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
  set "NPM_CMD=npm"
) else (
  set "PATH=%NODE_DIR%;%PATH%"
)

if not exist "node_modules" (
  echo Installing project dependencies...
  call "%NPM_CMD%" install
  if errorlevel 1 goto :fail
)

echo.
echo Building the website locally...
call "%NPM_CMD%" run build
if errorlevel 1 goto :fail

echo.
echo Deploying to Cloudflare Workers...
call "%NPM_CMD%" exec wrangler deploy
if errorlevel 1 goto :fail

echo.
echo DEPLOYMENT COMPLETED SUCCESSFULLY.
echo You can now refresh the SRD Warehouse System website.
pause
exit /b 0

:fail
echo.
echo DEPLOYMENT FAILED.
echo Read the error shown above. If Cloudflare asks you to sign in, complete the browser login and run this file again.
pause
exit /b 1
