@echo off
setlocal

cd /d "%~dp0"

set "VENV_DIR=.venv"
set "ENTRY_FILE=yolo_label_viewer_web_app.py"

if not exist "%ENTRY_FILE%" (
    echo Cannot find project entry file: %ENTRY_FILE%
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
)

call "%VENV_DIR%\Scripts\activate.bat"
if errorlevel 1 (
    echo Failed to activate virtual environment.
    pause
    exit /b 1
)

python -m pip install --upgrade pip
if errorlevel 1 (
    echo Failed to update pip.
    pause
    exit /b 1
)

if exist "requirements.txt" (
    python -m pip install --upgrade -r "requirements.txt"
    if errorlevel 1 (
        echo Failed to install requirements.txt.
        pause
        exit /b 1
    )
)

python "%ENTRY_FILE%"
set "APP_EXIT_CODE=%ERRORLEVEL%"

echo.
echo Application exited with code %APP_EXIT_CODE%.
pause
exit /b %APP_EXIT_CODE%
