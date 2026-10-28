@echo off
setlocal
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "threads_installer_exit=%ERRORLEVEL%"
echo.
pause
exit /b %threads_installer_exit%
