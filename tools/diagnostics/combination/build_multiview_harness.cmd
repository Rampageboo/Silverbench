@echo off
setlocal

call "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64
if errorlevel 1 exit /b %errorlevel%

set "DIAGNOSTIC_DIR=%~dp0."
set "CMAKE_EXE=C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
set "NINJA_EXE=C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
set "ROOT_OVERRIDE=%~1"

if defined ROOT_OVERRIDE (
    "%CMAKE_EXE%" -S "%DIAGNOSTIC_DIR%" -B "%DIAGNOSTIC_DIR%\build-vsenv" -G Ninja -DCMAKE_BUILD_TYPE=Debug "-DCMAKE_MAKE_PROGRAM:FILEPATH=%NINJA_EXE%" "-DANIMOCAP_ROOT:PATH=%ROOT_OVERRIDE%"
) else (
    "%CMAKE_EXE%" -S "%DIAGNOSTIC_DIR%" -B "%DIAGNOSTIC_DIR%\build-vsenv" -G Ninja -DCMAKE_BUILD_TYPE=Debug "-DCMAKE_MAKE_PROGRAM:FILEPATH=%NINJA_EXE%"
)
if errorlevel 1 exit /b %errorlevel%

"%CMAKE_EXE%" --build "%DIAGNOSTIC_DIR%\build-vsenv"
exit /b %errorlevel%
