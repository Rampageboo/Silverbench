@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "VENV_DIR=.venv"
set "DESKTOP_DIR=apps\desktop"
set "LOG_DIR=logs"
set "LOG_FILE=%LOG_DIR%\desktop.log"
set "SPLASH_PID_FILE=%TEMP%\ywb-launch-splash.pid"
set "SPLASH_READY_FILE=%TEMP%\ywb-launch-ready"

if exist "%SPLASH_READY_FILE%" del /f /q "%SPLASH_READY_FILE%" >nul 2>&1

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist "%DESKTOP_DIR%\package.json" (
    echo Cannot find Tauri desktop app: %DESKTOP_DIR%\package.json>>"%LOG_FILE%"
    call :notify_failure "找不到桌面应用目录，请查看 logs\desktop.log"
    exit /b 1
)

if not exist "%VENV_DIR%\Scripts\python.exe" (
    py -3 -m venv "%VENV_DIR%" >>"%LOG_FILE%" 2>&1
    if errorlevel 1 python -m venv "%VENV_DIR%" >>"%LOG_FILE%" 2>&1
)

call "%VENV_DIR%\Scripts\activate.bat" >>"%LOG_FILE%" 2>&1
if errorlevel 1 (
    call :notify_failure "无法激活 Python 虚拟环境，请查看 logs\desktop.log"
    exit /b 1
)

python -c "import fastapi, uvicorn, ultralytics, mcp" >nul 2>nul
if errorlevel 1 (
    python -m pip install -r "requirements.txt" >>"%LOG_FILE%" 2>&1
    rem requirements.txt owns heavy runtime deps; keep this from replacing torch/cv2.
    python -m pip install ultralytics --no-deps >>"%LOG_FILE%" 2>&1
)

if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
    call :notify_failure "未找到 Node.js，请先安装 Node.js"
    exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
    call :notify_failure "未找到 npm，请先安装 Node.js"
    exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
    call :notify_failure "未找到 Rust/Cargo，开发模式需要先安装 Rust"
    exit /b 1
)

pushd "%DESKTOP_DIR%"
if not exist "node_modules" npm install >>"..\..\%LOG_FILE%" 2>&1

echo [%DATE% %TIME%] Starting YoloWorkBench desktop shell>>"..\..\%LOG_FILE%"
npm run tauri:dev >>"..\..\%LOG_FILE%" 2>&1
set "APP_EXIT_CODE=%ERRORLEVEL%"
echo [%DATE% %TIME%] Exit code %APP_EXIT_CODE%>>"..\..\%LOG_FILE%"
popd

if not "%APP_EXIT_CODE%"=="0" call :notify_failure "YoloWorkBench 启动失败，请查看 logs\desktop.log"
call :stop_launch_splash
exit /b %APP_EXIT_CODE%

:notify_failure
call :stop_launch_splash
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('%~1','YoloWorkBench',[System.Windows.Forms.MessageBoxButtons]::OK,[System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null"
exit /b 0

:stop_launch_splash
if exist "%SPLASH_PID_FILE%" (
    for /f "usebackq delims=" %%P in ("%SPLASH_PID_FILE%") do taskkill /PID %%P /F >nul 2>&1
    del /f /q "%SPLASH_PID_FILE%" >nul 2>&1
)
if exist "%SPLASH_READY_FILE%" del /f /q "%SPLASH_READY_FILE%" >nul 2>&1
exit /b 0
