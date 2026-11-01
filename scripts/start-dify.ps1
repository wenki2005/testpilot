$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodeExecutable)) { throw 'Node.js 22.19+ is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist/demo/server.js'))) { throw 'Build the project first: npm run build' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) { throw 'Create .env from .env.example and configure TESTPILOT_DIFY_API_KEY first.' }
if (-not $env:PORT) { $env:PORT = '4319' }
$taskDifyUrl = "http://127.0.0.1:$env:PORT"
try {
  $taskDifyState = Invoke-RestMethod -Uri "$taskDifyUrl/api/dify-web-modules" -TimeoutSec 3
  if ($taskDifyState.PSObject.Properties.Name -contains 'modules' -and $taskDifyState.PSObject.Properties.Name -contains 'jobs') {
    Write-Host "TestPilot is already running: $taskDifyUrl/?page=dify-regression"
    Write-Host 'Reuse this instance. Rebuild and restart it after source changes.'
    exit 0
  }
} catch { }
Write-Host "TestPilot Dify: http://127.0.0.1:$env:PORT/?page=dify-regression"
Write-Host 'Press Ctrl+C to stop. Records are stored locally, not in the target MySQL database.'
Push-Location $projectRoot
try { & $nodeExecutable --env-file-if-exists=.env dist/demo/server.js; exit $LASTEXITCODE } finally { Pop-Location }
