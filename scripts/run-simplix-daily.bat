@echo off
setlocal
title SRD Warehouse - Daily Simplix Sync
cd /d "%~dp0.."

set "NODE_EXE="
if exist "portable-node\node.exe" set "NODE_EXE=%CD%\portable-node\node.exe"
if not defined NODE_EXE (
  for /d %%D in ("portable-node\node-*") do (
    if exist "%%~fD\node.exe" (
      set "NODE_EXE=%%~fD\node.exe"
      goto :foundnode
    )
  )
)
:foundnode
if not defined NODE_EXE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE_EXE=node"
)
if not defined NODE_EXE (
  echo.
  echo Node.js was not found. Put portable Node.js inside the portable-node folder.
  echo.
  pause
  exit /b 1
)
if not exist "node_modules\@supabase\supabase-js" (
  echo.
  echo Project dependencies are missing. Run the original Simplix sync launcher once to install them.
  echo.
  pause
  exit /b 1
)
echo.
echo ==========================================
echo   SRD Warehouse - Daily Simplix ERP Sync
echo ==========================================
echo Running PR details and PR item lines using one login.
echo.
"%NODE_EXE%" scripts\sync-simplix-daily.mjs %*
set "SYNC_EXIT=%ERRORLEVEL%"
echo.
if "%SYNC_EXIT%"=="0" (
  echo Both daily sync stages finished.
) else (
  echo Daily sync reported a problem. Review messages above.
)
echo.
echo Press any key to close this window after reviewing the results.
pause >nul
exit /b %SYNC_EXIT%
