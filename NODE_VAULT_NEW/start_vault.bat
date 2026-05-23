@echo off
title NODE_VAULT // vault_server
cd /d "%~dp0"

echo.
echo  ============================================
echo    NODE_VAULT  //  STARTING BACKEND
echo  ============================================
echo.
if not "%NODE_VAULT_PORT%"=="" (
    echo    NODE_VAULT_PORT = %NODE_VAULT_PORT%
)
if not "%1"=="" (
    echo    explicit port arg: %1
    set "PORT_ARG=--port %1"
) else (
    set "PORT_ARG="
)
echo.

REM Remove any stale .port file from a previous crashed session.
if exist ".port" del /q ".port"

REM Spawn a hidden PowerShell that waits for .port to appear, then waits
REM for the server on that port, then opens the browser tab.
start "" /min powershell -NoProfile -WindowStyle Hidden -Command ^
  "$dir = (Get-Location); $pf = Join-Path $dir '.port';" ^
  "for ($i=0; $i -lt 30 -and -not (Test-Path $pf); $i++) { Start-Sleep -Milliseconds 500 };" ^
  "if (-not (Test-Path $pf)) { exit 1 };" ^
  "$port = (Get-Content $pf).Trim();" ^
  "for ($i=0; $i -lt 20; $i++) {" ^
  "  try { Invoke-WebRequest -Uri ('http://127.0.0.1:' + $port + '/api/manifest') -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop | Out-Null;" ^
  "        Start-Process ('http://localhost:' + $port + '/'); exit 0 } catch { Start-Sleep -Seconds 1 } }"

REM Flask runs in THIS console window. You see all server logs and can Ctrl+C.
python vault_server.py %PORT_ARG%

echo.
echo  ============================================
echo    SERVER STOPPED
echo  ============================================
pause
