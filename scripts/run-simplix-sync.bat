@echo off
title SRD Warehouse - Simplix PR Sync
cd /d "%~dp0\.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 18 or newer, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing project packages...
  call npm install
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
echo ==========================================
echo.
call npm run sync:simplix-prs

echo.
pause
