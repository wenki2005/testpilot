@echo off
setlocal
rem ---------------------------------------------------------------
rem This file is intentionally ASCII-only with CRLF line endings.
rem cmd.exe reads batch files using the OEM code page, so non-ASCII
rem bytes here (even a UTF-8 BOM) break parsing on Chinese Windows.
rem All localized messages live in start-demo.ps1 (UTF-8 with BOM).
rem ---------------------------------------------------------------
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-demo.ps1"
if errorlevel 1 goto :failed
goto :eof

:failed
echo.
echo Launcher failed. See the messages above for the reason.
echo.
pause
