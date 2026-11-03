param([switch]$Restart,[switch]$Open)
$ErrorActionPreference='Stop'
# 用途：启动原4321固定回归；前提：已构建、原.env与本地数据存在。
# 示例：powershell -File scripts/start-fixed-regression.ps1 -Restart
# 仅管理本机TestPilot服务与启动元数据；不提交目标业务、不写目标数据库。
$repo=Split-Path -Parent $PSScriptRoot
$demoRoot=[IO.Path]::GetFullPath((Join-Path $repo '..\..'))
$data=Join-Path $demoRoot 'artifacts\demo-toolrun'
$config=Join-Path $demoRoot '.env'
$base='http://127.0.0.1:4321'
$private=Join-Path $demoRoot '.local\fixed-regression'
New-Item -ItemType Directory -Path $private -Force | Out-Null
if(-not(Test-Path -LiteralPath (Join-Path $repo 'dist\demo\server.js'))){throw '请先构建 TestPilot。'}
if(-not(Test-Path -LiteralPath $config)){throw '未找到原演示目录的本机配置，未新建或替换配置。'}
$health=$null
try{$health=Invoke-RestMethod ($base+'/api/health') -TimeoutSec 3}catch{}
if($health -and ($Restart -or $health.regressionMode -ne 'fixed')){
  $state=Invoke-RestMethod ($base+'/api/system-module-regression') -TimeoutSec 5
  $jobs=Invoke-RestMethod ($base+'/api/dify-web-modules') -TimeoutSec 5
  if(@($state.batches|Where-Object {$_.phase -in @('queued','running')}).Count -or @($jobs.jobs|Where-Object {$_.phase -in @('queued','preflight','awaiting-login','preparing','dispatching','executing','reporting')}).Count){throw '当前仍有测试运行，请待本轮结束后启动；没有中断测试。'}
  $known=@((Join-Path $demoRoot '.local\fixed-regression-process.json'),(Join-Path $demoRoot '.local\dify-tools\codex-4321-process.json'))
  $meta=$null
  foreach($file in $known){if(Test-Path -LiteralPath $file){$candidate=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json;try{$process=Get-Process -Id $candidate.pid -ErrorAction Stop}catch{continue};if($process.ProcessName -eq 'node' -and [IO.Path]::GetFullPath($candidate.source) -eq [IO.Path]::GetFullPath($repo) -and [IO.Path]::GetFullPath($candidate.data) -eq [IO.Path]::GetFullPath($data) -and [Math]::Abs(($process.StartTime.ToUniversalTime()-([DateTimeOffset]$candidate.createdAt).UtcDateTime).TotalSeconds) -lt 10){$meta=$candidate;break}}}
  if(-not $meta){throw '无法核对当前服务身份，没有停止任何进程。'}
  $listener=@(Get-NetTCPConnection -LocalPort 4321 -State Listen -ErrorAction Stop)
  if(-not $listener.Count -or @($listener|Where-Object {$_.OwningProcess -ne $meta.pid}).Count){throw '端口进程与原服务记录不一致，没有停止任何进程。'}
  Stop-Process -Id $meta.pid -ErrorAction Stop
  $health=$null
}
if(-not $health){
  $node=Get-Command node -ErrorAction SilentlyContinue
  $executable=if($node){$node.Source}else{Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
  if(-not(Test-Path -LiteralPath $executable)){throw '未找到 Node.js 22.19 或更新版本。'}
  $env:PORT='4321';$env:TESTPILOT_DATA_DIR=$data
  $configArgument='--env-file="'+$config+'"'
  $nodeArguments=@($configArgument,'dist/demo/server.js')
  $process=Start-Process -FilePath $executable -ArgumentList $nodeArguments -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $private 'server.out.log') -RedirectStandardError (Join-Path $private 'server.err.log') -PassThru
  [pscustomobject]@{pid=$process.Id;port=4321;source=$repo;data=$data;createdAt=(Get-Date).ToUniversalTime().ToString('o');kind='restored-fixed-regression'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $demoRoot '.local\fixed-regression-process.json') -Encoding utf8
  for($n=0;$n -lt 60;$n++){try{$health=Invoke-RestMethod ($base+'/api/health') -TimeoutSec 2;if($health.regressionMode -eq 'fixed'){break}}catch{};Start-Sleep -Milliseconds 250}
}
if($health.regressionMode -ne 'fixed' -or $health.experimentalToolController -ne $false){throw '未核实固定回归版本已加载，请查看本机启动日志。'}
$credentialFile=Join-Path $demoRoot '.local\database\connection.credentials.xml'
$credential=$null;$requestBody=$null
try{
  $database=Invoke-RestMethod ($base+'/api/mysql/status') -TimeoutSec 5
  if(-not $database.connected -and (Test-Path -LiteralPath $credentialFile)){
    # Reuse the user's existing Windows-protected credential, never export it.
    $credential=Import-Clixml -LiteralPath $credentialFile
    $requestBody=@{user=$credential.UserName;password=$credential.GetNetworkCredential().Password}|ConvertTo-Json -Compress
    $database=Invoke-RestMethod -Method Post -Uri ($base+'/api/mysql/connect') -ContentType 'application/json' -Body $requestBody -TimeoutSec 20
    if($database.connected){Write-Host '原测试库只读连接已恢复。'}
  }
}catch{Write-Warning '固定回归服务已启动；测试库连接未恢复，请在数据库工具查看连接状态。'}
finally{$credential=$null;$requestBody=$null}
Write-Host '固定回归已就绪。使用原账号、原用例与原运行历史。'
if($Open){Start-Process ($base+'/?page=dify-regression&system=436847ad-f144-425f-b303-1ca9b22e0b52&scope=starter')}
