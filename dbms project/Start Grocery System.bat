@echo off
setlocal
pushd "%~dp0"
title Grocery Store System

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed. Install Node.js LTS, then run this shortcut again.
    goto failed
)

if not exist ".env" (
    echo The .env configuration file is missing from this folder.
    echo Ask your setup contact to configure the database connection.
    goto failed
)

if not exist "node_modules\express\package.json" (
    where npm >nul 2>&1
    if errorlevel 1 (
        echo npm is missing. Reinstall Node.js LTS with npm included.
        goto failed
    )
    echo Setting up Grocery Store System. This first-time step needs internet access.
    call npm install
    if errorlevel 1 (
        echo Dependency installation failed. Check the internet connection and try again.
        goto failed
    )
)

powershell -NoProfile -Command "$client = New-Object Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1', 3306); exit 0 } catch { exit 1 } finally { $client.Dispose() }" >nul 2>&1
if errorlevel 1 (
    echo MySQL is not responding on port 3306.
    echo Start MySQL in XAMPP, then double-click this file again.
    goto failed
)

powershell -NoProfile -Command "try { $response = Invoke-WebRequest -Uri 'http://127.0.0.1:4000/' -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
if not errorlevel 1 (
    start "" "http://127.0.0.1:4000/"
    popd
    exit /b 0
)

echo Starting Grocery Store System...
start "Grocery Store Server" /D "%~dp0" "%ComSpec%" /k "node index_admin.js"

for /L %%i in (1,1,30) do (
    powershell -NoProfile -Command "try { $response = Invoke-WebRequest -Uri 'http://127.0.0.1:4000/' -UseBasicParsing -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>&1
    if not errorlevel 1 (
        start "" "http://127.0.0.1:4000/"
        popd
        exit /b 0
    )
    timeout /t 1 /nobreak >nul
)

echo The app did not start. Check the Grocery Store Server window for the error.
echo Confirm XAMPP MySQL is running and the local database settings are correct.

:failed
popd
pause
exit /b 1
