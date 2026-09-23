@echo off
setlocal

rem Kalio Windows CMD bootstrap. The PowerShell installer owns release selection,
rem integrity checks, installation, autostart, and launch behavior.

set "INSTALLER_URL=https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install-release.ps1"
set "INSTALLER_PATH=%TEMP%\kalio-install-%RANDOM%-%RANDOM%.ps1"

echo.
echo Kalio Installer
echo Downloading the latest release installer...
echo.

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri '%INSTALLER_URL%' -OutFile '%INSTALLER_PATH%'"
if errorlevel 1 goto :download_failed

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER_PATH%" %*
set "INSTALL_EXIT=%ERRORLEVEL%"
del /q "%INSTALLER_PATH%" >nul 2>&1

if not "%INSTALL_EXIT%"=="0" exit /b %INSTALL_EXIT%
exit /b 0

:download_failed
del /q "%INSTALLER_PATH%" >nul 2>&1
echo.
echo [kalio] Failed to download the installer from:
echo %INSTALLER_URL%
exit /b 1
