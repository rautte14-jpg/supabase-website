@echo off
title SRD Warehouse - Simplix PR Sync
cd /d "%~dp0\.."

set "PORTABLE_NODE=%CD%\portable-node"
set "NODE_EXE="
set "NPM_CMD="

if exist "%PORTABLE_NODE%\node.exe" (
  set "NODE_EXE=%PORTABLE_NODE%\node.exe"
)

if exist "%PORTABLE_NODE%\npm.cmd" (
  set "NPM_CMD=%PORTABLE_NODE%\npm.cmd"
)

if not defined NODE_EXE (
  for /d %%D in ("%PORTABLE_NODE%\node-*") do (
    if exist "%%~fD\node.exe" (
      set "NODE_EXE=%%~fD\node.exe"
      if exist "%%~fD\npm.cmd" set "NPM_CMD=%%~fD\npm.cmd"
      goto :foundportable
    )
  )
)

:foundportable
if defined NODE_EXE (
  echo Using portable Node.js:
  echo %NODE_EXE%
  set "PATH=%~dp0..\portable-node;%PATH%"
  for %%P in ("%NODE_EXE%") do set "PATH=%%~dpP;%PATH%"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo.
    echo Node.js was not found.
    echo.
    echo No admin rights are required.
    echo Download the Node.js "Standalone Binary (.zip)" and extract it into:
    echo.
    echo   %CD%\portable-node
    echo.
    echo Then double-click this file again.
    echo.
    pause
    exit /b 1
  )
)

if not defined NPM_CMD (
  where npm >nul 2>nul
  if not errorlevel 1 set "NPM_CMD=npm"
)

if not defined NPM_CMD (
  for %%P in ("%NODE_EXE%") do (
    if exist "%%~dpPnpm.cmd" set "NPM_CMD=%%~dpPnpm.cmd"
  )
)

if not defined NPM_CMD (
  echo.
  echo npm.cmd was not found beside node.exe.
  echo Make sure you extracted the full Node.js ZIP.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo Installing project packages locally...
  call "%NPM_CMD%" install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo.
echo ==========================================
echo   SRD Warehouse - Simplix PR Sync
echo   Semi-automatic mode: every 30 minutes
echo ==========================================
echo.
echo Keep this window open during the workday.
echo You will only be asked for a fresh Simplix token when the current token expires.
echo.
call "%NPM_CMD%" run sync:simplix-prs -- --watch=30

echo.
pause
