@echo off
title ZevSafe 25GB+ Vault Decryptor
setlocal EnableDelayedExpansion

echo ===================================================
echo   ZevSafe - 25GB+ Zero-RAM Vault Decryptor (PC)
echo ===================================================
echo.

set "TARGET_FILE=%~1"

if "%TARGET_FILE%"=="" (
    echo Drag and drop a .zev vault file here or enter its path:
    set /p "TARGET_FILE=Path: "
)

:: Remove surrounding quotes
set "TARGET_FILE=%TARGET_FILE:"=%"

if "%TARGET_FILE%"=="" (
    echo [ERROR] No .zev file specified. Exiting.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0decrypt.ps1" "%TARGET_FILE%"

echo.
echo ===================================================
echo   Process finished. Press any key to exit.
echo ===================================================
pause >nul
