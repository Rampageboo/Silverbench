@echo off
rem Pull the latest RampageWorkbench from GitHub (this computer only receives updates).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update.ps1"
pause
