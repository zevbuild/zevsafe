@echo off
title ZevSafe 25GB+ Vault Encryptor
setlocal EnableDelayedExpansion

echo ===================================================
echo   ZevSafe - 25GB+ Zero-RAM Folder Encryptor (PC)
echo ===================================================
echo.

set "TARGET_FOLDER=%~1"

if "%TARGET_FOLDER%"=="" (
    echo Drag and drop a folder here or enter its path:
    set /p "TARGET_FOLDER=Path: "
)

:: Remove surrounding quotes
set "TARGET_FOLDER=%TARGET_FOLDER:"=%"

if "%TARGET_FOLDER%"=="" (
    echo [ERROR] No folder specified. Exiting.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0encrypt.ps1" "%TARGET_FOLDER%"

echo.
echo ===================================================
echo   Process finished. Press any key to exit.
echo ===================================================
pause >nul
