@echo off
rem FMU Controller launcher (double-click or: run.bat [-Port 8000] [-Parallel auto^|ray^|pool] [-Workers N] [-Build])
rem Wraps run.ps1 so it works regardless of the PowerShell execution policy.
setlocal
cd /d "%~dp0"

rem With no arguments, open the browser once the server answers on the default port.
if "%~1"=="" start "" /b powershell -NoProfile -WindowStyle Hidden -Command ^
  "for ($i = 0; $i -lt 120; $i++) { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:8000/api/health | Out-Null; Start-Process http://127.0.0.1:8000; break } catch { Start-Sleep -Milliseconds 500 } }"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
if errorlevel 1 (
  echo.
  echo FMU Controller exited with an error. See the messages above.
  pause
)
endlocal
