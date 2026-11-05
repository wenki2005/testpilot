#!/usr/bin/env node
// Restore only this workspace's separate database connection with its copied
// Windows-protected credential. No plaintext credential is logged or persisted.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { argument, workspacePaths } from '../lib/integrated-workspaces.mjs';
const workspace = workspacePaths(argument('workspace', 'dify'));
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const script = `$ErrorActionPreference='Stop';$base='http://127.0.0.1:${workspace.port}';$config=Invoke-RestMethod ($base+'/api/config') -TimeoutSec 10;if($config.workspaces.current -ne ${quote(workspace.owner)}){throw 'Workspace identity mismatch'};$credential=$null;$body=$null;try{$credential=Import-Clixml -LiteralPath ${quote(path.join(workspace.privateDir, 'mysql-connection.xml'))};$body=@{user=$credential.UserName;password=$credential.GetNetworkCredential().Password}|ConvertTo-Json -Compress;$status=Invoke-RestMethod -Method Post -Uri ($base+'/api/mysql/connect') -ContentType 'application/json' -Body $body -TimeoutSec 25;[pscustomobject]@{workspace=${quote(workspace.owner)};connected=[bool]$status.connected}|ConvertTo-Json -Compress}catch{[pscustomobject]@{workspace=${quote(workspace.owner)};connected=$false;message='Use the database panel to reconnect this workspace.'}|ConvertTo-Json -Compress}finally{$credential=$null;$body=$null}`;
const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
console.log(result.trim());
if (JSON.parse(result).connected !== true)
    process.exitCode = 1;
