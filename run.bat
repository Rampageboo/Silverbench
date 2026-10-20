@echo off
setlocal

cd /d "%~dp0"

set "VENV_DIR=.venv"
set "DESKTOP_DIR=apps\desktop"
set "LOG_DIR=logs"
set "LOG_FILE=%LOG_DIR%\desktop.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist "%DESKTOP_DIR%\package.json" (
    echo Cannot find Tauri desktop app: %DESKTOP_DIR%\package.json
    pause
    exit /b 1
)

if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo Creating local virtual environment...
    py -3 -m venv "%VENV_DIR%"
    if errorlevel 1 (
        python -m venv "%VENV_DIR%"
    )
    if errorlevel 1 (
        echo Failed to create virtual environment.
        pause
        exit /b 1
    )
) else (
    "%VENV_DIR%\Scripts\python.exe" --version >nul 2>nul
    if errorlevel 1 (
        echo Recreating broken virtual environment...
        rmdir /s /q "%VENV_DIR%"
        py -3 -m venv "%VENV_DIR%"
        if errorlevel 1 (
            echo Failed to recreate virtual environment.
            pause
            exit /b 1
        )
    )
)

rem Use the local interpreter directly: venv activation embeds its old folder.
set "RWB_PYTHON=%CD%\%VENV_DIR%\Scripts\python.exe"

"%RWB_PYTHON%" -c "import fastapi, uvicorn, ultralytics, mcp" >nul 2>nul
if errorlevel 1 (
    echo Installing Python dependencies ^(first run or missing packages^)...
    "%RWB_PYTHON%" -m pip install -r "requirements.txt"
    if errorlevel 1 (
        echo Failed to install requirements.txt.
        pause
        exit /b 1
    )
    rem requirements.txt owns heavy runtime deps; keep this from replacing torch/cv2.
    "%RWB_PYTHON%" -m pip install ultralytics --no-deps
    if errorlevel 1 (
        echo Failed to install ultralytics.
        pause
        exit /b 1
    )
)

if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=C:\Program Files\nodejs;%PATH%"
)

if exist "%USERPROFILE%\.cargo\bin\cargo.exe" (
    set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required for the Tauri desktop app.
    echo Install Node.js, then run this file again.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo npm is required for the Tauri desktop app.
    pause
    exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
    echo Rust/Cargo is required for the Tauri desktop app in dev mode.
    echo Install Rust, then run this file again.
    pause
    exit /b 1
)

pushd "%DESKTOP_DIR%"

if not exist "node_modules" (
    echo Installing desktop frontend dependencies...
    npm install
    if errorlevel 1 (
        popd
        echo Failed to install desktop frontend dependencies.
        pause
        exit /b 1
    )
)

echo Starting RampageWorkbench desktop shell...
echo React shell on http://127.0.0.1:5173
echo All tools are native React — no iframe embeds
echo.
echo Tip: double-click RampageWorkbench.vbs to launch without a terminal window.
echo      Run create-shortcut.vbs once to put a desktop shortcut on your desktop.
echo Logs: logs\desktop.log, logs\backend.log
echo Fallback full web shell: cd apps\desktop ^&^& npm run tauri:dev:legacy
echo Qt is not used. For the old Qt shell specifically, use run_legacy_qt.bat.
echo [%DATE% %TIME%] Starting RampageWorkbench desktop shell>>"..\..\%LOG_FILE%"
powershell -NoProfile -Command "npm run tauri:dev 2>&1 | Tee-Object -FilePath '..\..\%LOG_FILE%' -Append"
set "APP_EXIT_CODE=%ERRORLEVEL%"

popd

echo.
echo Tauri desktop application exited with code %APP_EXIT_CODE%.
pause
exit /b %APP_EXIT_CODE%
