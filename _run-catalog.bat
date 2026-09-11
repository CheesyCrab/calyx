@echo off
setlocal
cd /d "%~dp0"

rem Double-clicked cmd.exe sessions do not run the PowerShell profile that
rem normally initializes fnm. Bootstrap it only when Node/npm are absent.
where node.exe >nul 2>&1
if errorlevel 1 call :init_node
where npm.cmd >nul 2>&1
if errorlevel 1 call :init_node

where node.exe >nul 2>&1
if errorlevel 1 goto :missing_node
where npm.cmd >nul 2>&1
if errorlevel 1 goto :missing_node

python --version >nul 2>&1
if not errorlevel 1 (
    python tools\catalog.py %*
) else (
    py -3 --version >nul 2>&1
    if errorlevel 1 goto :missing_python
    py -3 tools\catalog.py %*
)

set "CALYX_EXIT=%ERRORLEVEL%"
if not "%CALYX_EXIT%"=="0" (
    echo.
    echo Calyx launcher failed with exit code %CALYX_EXIT%.
    pause
)
exit /b %CALYX_EXIT%

:init_node
where fnm.exe >nul 2>&1
if errorlevel 1 exit /b 1
for /f "delims=" %%i in ('fnm env --shell cmd 2^>nul') do call %%i
exit /b 0

:missing_node
echo Node.js and npm were not found.
echo Install Node.js, or install/configure fnm, then try again.
pause
exit /b 1

:missing_python
echo Python 3 was not found via either python or py -3.
pause
exit /b 1
