@echo off
setlocal
title SRD Warehouse - Simplix PR Item Line Sync
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
  echo Portable node.exe not found in portable-node folder.
  echo This test uses the same portable Node.js as run-simplix-sync.bat.
  pause
  exit /b 1
)
if not exist "node_modules\@supabase\supabase-js" (
  echo Project dependencies were not found.
  echo Run your normal Simplix sync launcher once to install them, then retry.
  pause
  exit /b 1
)
echo.
echo SRD Warehouse - PR Item Lines
echo This uses production Simplix and writes to a separate Supabase table.
echo It does not change the regular sync or reports.
echo.
if "%~1"=="" (
  echo Pilot mode: testing PR104021 only.
  "%NODE_EXE%" scripts\sync-simplix-pr-lines.mjs --pr=PR104021
) else (
  echo Arguments: %*
  "%NODE_EXE%" scripts\sync-simplix-pr-lines.mjs %*
)
echo.
echo Finished. Keep this window open to check the results.
pause
