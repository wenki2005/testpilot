#!/usr/bin/env node
// Stop only owned integrated server processes after checking their port, code,
// start time and active work. Never stops the original 4321 or target browsers.
import { readFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { argument, entryPort, runtimeRoot, legacyRuntimeRoot, workspaceNames, workspacePaths } from './lib/integrated-workspaces.mjs';
const owner = argument('workspace'), selected = process.argv.includes('--entry-only') ? [] : owner ? [workspacePaths(owner)] : workspaceNames.map(workspacePaths);
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
for (const candidate of selected) {
    let workspace = candidate;
    let meta;
    try {
        meta = JSON.parse(await readFile(workspace.processFile, 'utf8'));
    }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const legacy = { ...candidate, root: path.join(legacyRuntimeRoot, candidate.owner), processFile: path.join(legacyRuntimeRoot, candidate.owner + '-process.json') };
        try { meta = JSON.parse(await readFile(legacy.processFile, 'utf8')); workspace = legacy; }
        catch (legacyError) { if (legacyError.code !== 'ENOENT') throw legacyError; continue; }
    }
    if (!Number.isSafeInteger(meta.pid) || meta.pid < 1 || meta.workspace !== workspace.owner || meta.port !== workspace.port || meta.dataDir !== workspace.root)
        throw Error('Instance metadata mismatch; nothing stopped.');
    const url = `http://127.0.0.1:${workspace.port}`;
    const config = await (await fetch(url + '/api/config', { signal: AbortSignal.timeout(5000) })).json();
    if (config.workspaces?.current !== workspace.owner)
        throw Error('Workspace identity mismatch; nothing stopped.');
    const state = workspace.owner === 'dify' ? await (await fetch(url + '/api/system-module-regression')).json() : {};
    const jobs = workspace.owner === 'dify' ? await (await fetch(url + '/api/dify-web-modules')).json() : {};
    const projects = await (await fetch(url + '/api/document-projects')).json();
    if (state.batches?.some(batch => ['running', 'queued'].includes(batch.phase)) || jobs.jobs?.some(job => ['queued', 'preflight', 'awaiting-login', 'preparing', 'dispatching', 'executing', 'reporting'].includes(job.phase)))
        throw Error(workspace.owner + ' has an active regression; finish or stop it in the UI first.');
    if (state.batches?.some(batch => batch.notification?.status === 'sending'))
        throw Error('A notification is in progress; finish delivery before stopping this workspace.');
    for (const system of state.systems ?? []) {
        const core = await (await fetch(url + '/api/system-module-regression/core-chains?systemId=' + encodeURIComponent(system.id))).json();
        if (core.runs?.some(run => ['queued', 'running', 'awaiting-login'].includes(run.phase)))
            throw Error('A core chain is active; finish or stop it in the UI before stopping the workspace.');
    }
    for (const project of projects) {
        const response = await fetch(url + '/api/document-projects/' + encodeURIComponent(project.id) + '/recovery');
        if (response.ok) {
            const value = await response.json();
            if (value?.isRunning || value?.recovery?.isRunning)
                throw Error(workspace.owner + ' has an active document run.');
        }
    }
    const script = `$p=Get-CimInstance Win32_Process -Filter ${quote('ProcessId=' + meta.pid)};if(-not $p -or $p.Name -ne 'node.exe' -or $p.CommandLine.IndexOf(${quote(meta.code)},[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'Server code identity mismatch'};$gap=[Math]::Abs(($p.CreationDate.ToUniversalTime()-([DateTimeOffset]${quote(meta.startedAt)}).UtcDateTime).TotalSeconds);if($gap -gt 10){throw 'Server start time mismatch'};$ports=@(Get-NetTCPConnection -LocalPort ${workspace.port} -State Listen -ErrorAction Stop);if(-not $ports.Count -or @($ports|Where-Object {$_.OwningProcess -ne ${meta.pid}}).Count){throw 'Port owner mismatch'};Stop-Process -Id ${meta.pid} -ErrorAction Stop`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, stdio: 'pipe' });
    await unlink(workspace.processFile);
    console.log('Stopped owned ' + workspace.owner + ' server on ' + workspace.port);
}

if (!owner) {
    let entry;
    let entryFile = path.join(runtimeRoot, 'entry-process.json');
    try { entry = JSON.parse(await readFile(entryFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; entryFile = path.join(legacyRuntimeRoot, 'entry-process.json'); try { entry = JSON.parse(await readFile(entryFile, 'utf8')); } catch (legacyError) { if (legacyError.code !== 'ENOENT') throw legacyError; } }
    if (entry) {
        if (!Number.isSafeInteger(entry.pid) || entry.pid < 1 || entry.port !== entryPort || entry.service !== 'testpilot-unified-entry') throw Error('Entry metadata mismatch; entry was not stopped.');
        const health = await (await fetch(`http://127.0.0.1:${entryPort}/__entry/health`, { signal: AbortSignal.timeout(5000) })).json();
        if (health.service !== entry.service) throw Error('Entry identity mismatch; entry was not stopped.');
        const script = `$p=Get-CimInstance Win32_Process -Filter ${quote('ProcessId=' + entry.pid)};if(-not $p -or $p.Name -ne 'node.exe' -or $p.CommandLine.IndexOf(${quote(entry.code)},[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'Entry code identity mismatch'};$gap=[Math]::Abs(($p.CreationDate.ToUniversalTime()-([DateTimeOffset]${quote(entry.startedAt)}).UtcDateTime).TotalSeconds);if($gap -gt 10){throw 'Entry start time mismatch'};$ports=@(Get-NetTCPConnection -LocalPort ${entryPort} -State Listen -ErrorAction Stop);if(-not $ports.Count -or @($ports|Where-Object {$_.OwningProcess -ne ${entry.pid}}).Count){throw 'Entry port owner mismatch'};Stop-Process -Id ${entry.pid} -ErrorAction Stop`;
        execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, stdio: 'pipe' });
        await unlink(entryFile);
        console.log('Stopped unified entry on ' + entryPort);
    }
}
