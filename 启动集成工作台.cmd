@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts\start-integrated-workspaces.mjs
) else (
  node scripts\start-integrated-workspaces.mjs
)
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4325/dify/?page=dify-regression"
