$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

try {
    $nodeVersionText = (& node --version 2>$null).Trim()
} catch {
    throw '没有找到 Node.js。请安装 Node.js 22.19 或更新版本，然后重新启动此文件。'
}

if ($LASTEXITCODE -ne 0 -or $nodeVersionText -notmatch '^v(?<version>\d+\.\d+\.\d+)') {
    throw '无法读取 Node.js 版本。请安装 Node.js 22.19 或更新版本。'
}

$nodeVersion = [version]$Matches.version
if ($nodeVersion -lt [version]'22.19.0') {
    throw "当前 Node.js 是 $nodeVersionText；需要 22.19.0 或更新版本。"
}

if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    Write-Host '首次启动：正在安装运行依赖，需要网络连接……' -ForegroundColor Cyan
    Push-Location $root
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。检查网络后重新运行“启动演示.cmd”。' }
    } finally {
        Pop-Location
    }
}

$runtimeData = Join-Path $root 'runtime-data'
New-Item -ItemType Directory -Path $runtimeData -Force | Out-Null
$env:TESTPILOT_DISTRIBUTION_DEMO = '1'
$env:TESTPILOT_DATA_DIR = $runtimeData
$env:TESTPILOT_ARTIFACTS_DIR = Join-Path $runtimeData 'document-tests'
if ([string]::IsNullOrWhiteSpace($env:PORT)) { $env:PORT = '4317' }

Write-Host ''
Write-Host 'TestPilot 演示服务正在启动。' -ForegroundColor Green
Write-Host "浏览器地址：http://127.0.0.1:$env:PORT"
Write-Host '演示数据保存在 runtime-data；按 Ctrl+C 停止服务。'
Write-Host ''

Push-Location $root
try {
    & npm.cmd run demo:start
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
