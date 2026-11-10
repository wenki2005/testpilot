param([switch]$Stop,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
$packageRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$node=Join-Path $packageRoot 'runtime\node.exe'
if(-not(Test-Path -LiteralPath $node)){
    $installed=Get-Command node -ErrorAction SilentlyContinue
    if(-not $installed){throw '未找到Node.js。源码版请安装Node.js 22.19或更高版本，完整运行包应包含runtime/node.exe。'}
    $node=$installed.Source
}
$versionText=(& $node --version).Trim()
if($LASTEXITCODE -ne 0 -or $versionText -notmatch '^v(?<version>\d+\.\d+\.\d+)'){throw '无法启动Node.js，请检查运行包是否完整。'}
if([version]$Matches.version -lt [version]'22.19.0'){throw '需要Node.js 22.19或更高版本。'}
if(-not(Test-Path -LiteralPath (Join-Path $packageRoot 'node_modules'))){throw '运行依赖缺失。源码版请先npm ci并构建，完整包请重新解压。'}
$env:PATH=(Split-Path -Parent $node)+';'+$env:PATH
Push-Location $packageRoot
try{
    if($Stop){
        # 不带 --workspace 会同时停止 dify 与 web-regression 两个工作区
        & $node (Join-Path $packageRoot 'scripts\stop-integrated-workspaces.mjs')
        if($LASTEXITCODE -eq 0){ & $node (Join-Path $packageRoot 'scripts\stop-integrated-workspaces.mjs') --entry-only }
    }else{
        # 不带 --workspace 会同时启动两个工作区，侧栏入口才不会出现 502
        & $node (Join-Path $packageRoot 'scripts\start-integrated-workspaces.mjs')
        if($LASTEXITCODE -eq 0 -and -not $NoBrowser){
            $entryPort=if($env:TESTPILOT_ENTRY_PORT){$env:TESTPILOT_ENTRY_PORT}else{'4325'}
            Start-Process "http://127.0.0.1:$entryPort/dify/?page=dify-regression"
        }
    }
    if($LASTEXITCODE -ne 0){throw '启动或停止未完成，请按上方提示处理。'}
}finally{Pop-Location}
