@echo off
setlocal

cd /d "%~dp0"

set "VENV_DIR=.venv"
set "ENTRY_FILE=legacy\qt\yolo_label_viewer_web_app.py"

if not exist "%ENTRY_FILE%" (
    echo Cannot find legacy Qt entry file: %ENTRY_FILE%
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

rem Direct interpreter survives project folder renames.
set "RWB_PYTHON=%CD%\%VENV_DIR%\Scripts\python.exe"

"%RWB_PYTHON%" -m pip install --upgrade pip
if errorlevel 1 (
    echo Failed to update pip.
    pause
    exit /b 1
)

if exist "requirements.txt" (
    "%RWB_PYTHON%" -m pip install --upgrade -r "requirements.txt"
    if errorlevel 1 (
        echo Failed to install requirements.txt.
        pause
        exit /b 1
    )
    "%RWB_PYTHON%" -m pip install ultralytics --no-deps
    if errorlevel 1 (
        echo Failed to install ultralytics.
        pause
        exit /b 1
    )
)

"%RWB_PYTHON%" "%ENTRY_FILE%"
set "APP_EXIT_CODE=%ERRORLEVEL%"

echo.
echo Legacy Qt application exited with code %APP_EXIT_CODE%.
pause
exit /b %APP_EXIT_CODE%
