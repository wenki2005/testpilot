@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-fixed-regression.ps1" -Restart -Open
if errorlevel 1 pause
