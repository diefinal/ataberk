@echo off
title Sunucuyu Durdur
cd /d "%~dp0"

echo ===================================================
echo     SUNUCU KAPATILIYOR (Port: 3000)
echo ===================================================
echo.

set "found=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do (
    echo [INFO] Port 3000 uzerinde calisan sunucu bulundu. PID: %%a
    taskkill /f /pid %%a
    set "found=1"
)

if "%found%"=="0" (
    echo [INFO] Port 3000 uzerinde calisan aktif bir sunucu bulunamadi.
) else (
    echo [INFO] Sunucu basariyla kapatildi.
)

echo.
pause
