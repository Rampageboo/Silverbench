@echo off
setlocal

cd /d "%~dp0"

set "VENV_DIR=.venv"
set "DESKTOP_DIR=apps\desktop"
set "LOG_DIR=logs"
set "LOG_FILE=%LOG_DIR%\desktop.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

if not exist "%DESKTOP_DIR%\package.json" (
    echo Cannot find Tauri desktop app: %DESKTOP_DIR%\package.json>>"%LOG_FILE%"
    exit /b 1
)

if not exist "%VENV_DIR%\Scripts\python.exe" (
    py -3 -m venv "%VENV_DIR%" >>"%LOG_FILE%" 2>&1
    if errorlevel 1 python -m venv "%VENV_DIR%" >>"%LOG_FILE%" 2>&1
)

call "%VENV_DIR%\Scripts\activate.bat" >>"%LOG_FILE%" 2>&1
if errorlevel 1 exit /b 1

python -c "import fastapi, uvicorn" >nul 2>nul
if errorlevel 1 (
    python -m pip install -r "requirements.txt" >>"%LOG_FILE%" 2>&1
)

if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where node >nul 2>nul
if errorlevel 1 exit /b 1
where npm >nul 2>nul
if errorlevel 1 exit /b 1
where cargo >nul 2>nul
if errorlevel 1 exit /b 1

pushd "%DESKTOP_DIR%"
if not exist "node_modules" npm install >>"..\..\%LOG_FILE%" 2>&1

echo [%DATE% %TIME%] Starting YoloWorkBench desktop shell>>"..\..\%LOG_FILE%"
npm run tauri:dev >>"..\..\%LOG_FILE%" 2>&1
set "APP_EXIT_CODE=%ERRORLEVEL%"
echo [%DATE% %TIME%] Exit code %APP_EXIT_CODE%>>"..\..\%LOG_FILE%"
popd

exit /b %APP_EXIT_CODE%
