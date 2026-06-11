@echo off
title Taksi Veri Koprusunu Durdur
cd /d "%~dp0"

echo ===================================================
echo     TAKSI VERI KOPRUSU KAPATILIYOR
echo ===================================================
echo.

wmic process where "CommandLine like '%%local_bridge.js%%'" call terminate >ok 2>&1
del ok >nul 2>&1

echo [INFO] Kopru yazilimi basariyla kapatildi.
echo.
pause
