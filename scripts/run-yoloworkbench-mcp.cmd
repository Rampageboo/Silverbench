@echo off
setlocal EnableExtensions

cd /d "%~dp0.."

if not defined YWB_MCP_ALLOWED_ROOTS set "YWB_MCP_ALLOWED_ROOTS=%CD%"
if not defined YWB_BACKEND_URL set "YWB_BACKEND_URL=http://127.0.0.1:8765"

if not exist ".venv\Scripts\python.exe" (
    1>&2 echo RampageWorkbench MCP requires .venv. Run run.bat once, then restart Codex.
    exit /b 1
)

".venv\Scripts\python.exe" -c "import mcp" >nul 2>nul
if errorlevel 1 (
    1>&2 echo RampageWorkbench MCP dependency is missing. Run run.bat once, then restart Codex.
    exit /b 1
)

".venv\Scripts\python.exe" -m yoloworkbench_mcp.server
