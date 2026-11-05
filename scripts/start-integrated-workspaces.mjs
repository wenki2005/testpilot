#!/usr/bin/env node
// Start the same integrated code with separate data, credentials, browser
// profiles and processes. Does not restart existing instances or the old 4321.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, existsSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { argument, repoRoot, runtimeRoot, legacyRuntimeRoot, workspaceNames, workspacePaths } from './lib/integrated-workspaces.mjs';
const owner = argument('workspace');
const selected = owner ? [workspacePaths(owner)] : workspaceNames.map(workspacePaths);
const code = path.join(repoRoot, 'dist', 'demo', 'server.js');
if (!existsSync(code))
    throw Error('Build the integrated server first.');
for (const workspace of selected) {
    const legacy = path.join(legacyRuntimeRoot, workspace.owner);
    if (legacyRuntimeRoot !== runtimeRoot && existsSync(path.join(legacy, 'system-module-regression', 'catalog.sqlite')) && !existsSync(path.join(workspace.root, 'system-module-regression', 'catalog.sqlite'))) {
        throw Error('Existing local data remains in ' + legacy + '. Relocate it with npm run data:relocate before starting the external workspace; no empty replacement was created.');
    }
    const url = `http://127.0.0.1:${workspace.port}`;
    let existing;
    try {
        existing = await (await fetch(url + '/api/config', { signal: AbortSignal.timeout(1500) })).json();
    }
    catch { }
    if (existing) {
        if (existing.workspaces?.current === workspace.owner && existsSync(workspace.processFile)) {
            console.log(workspace.owner + ' already running: ' + url);
            continue;
        }
        throw Error('Port ' + workspace.port + ' belongs to another process. Nothing was stopped.');
    }
    const reservation = createServer();
    reservation.listen(workspace.port, '127.0.0.1');
    await once(reservation, 'listening');
    await new Promise(resolve => reservation.close(resolve));
    mkdirSync(workspace.root, { recursive: true });
    const config = path.join(workspace.privateDir, 'instance.env');
    const settings = existsSync(config) ? Object.fromEntries(Object.entries(parseEnv(readFileSync(config, 'utf8'))).filter(([key]) => /^(?:TESTPILOT_|OPENAI_)/.test(key))) : {};
    const env = { ...process.env, TESTPILOT_API_KEY: '', OPENAI_API_KEY: '', TESTPILOT_DIFY_API_KEY: '', TESTPILOT_DIFY_EXECUTION_API_KEY: '', TESTPILOT_DIFY_WECOM_WEBHOOK: '', ...settings,
        PORT: String(workspace.port), TESTPILOT_DATA_DIR: workspace.root, TESTPILOT_ARTIFACTS_DIR: path.join(workspace.root, 'document-tests'), TESTPILOT_BROWSER_CDP_ENDPOINT: '',
        TESTPILOT_WORKSPACE: workspace.owner, TESTPILOT_WORKSPACE_DATA_STATUS: existsSync(workspace.manifest) ? 'migrated' : 'awaiting-source', TESTPILOT_DIFY_WORKSPACE_URL: 'http://127.0.0.1:4323', TESTPILOT_WEB_WORKSPACE_URL: 'http://127.0.0.1:4324' };
    const log = openSync(path.join(workspace.root, 'server.log'), 'a');
    const child = spawn(process.execPath, [code], { cwd: repoRoot, env, windowsHide: true, detached: true, stdio: ['ignore', log, log] });
    child.unref();
    closeSync(log);
    writeFileSync(workspace.processFile, JSON.stringify({ pid: child.pid, workspace: workspace.owner, port: workspace.port, url, code, dataDir: workspace.root, startedAt: new Date().toISOString() }, null, 2));
    let ready = false;
    for (let n = 0; n < 60; n++) {
        try {
            ready = (await fetch(url + '/api/health', { signal: AbortSignal.timeout(1000) })).ok;
        }
        catch { }
        if (ready)
            break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready)
        throw Error(workspace.owner + ' did not become ready. See its server.log.');
    if (existsSync(path.join(workspace.privateDir, 'mysql-connection.xml'))) {
        const connection = spawnSync(process.execPath, [path.join(repoRoot, "scripts/data/connect-workspace-database.mjs"), '--workspace', workspace.owner], { cwd: repoRoot, windowsHide: true, encoding: 'utf8', timeout: 35000 });
        console.log(connection.status === 0 ? workspace.owner + ': database connection restored.' : workspace.owner + ': reconnect the database in its panel.');
    }
    console.log(workspace.owner + ': ' + url + ' | data: ' + workspace.root);
}

// The public entry owns no business data. Both backends remain independent.
const entryUrl = 'http://127.0.0.1:4325';
let entry;
try { entry = await (await fetch(entryUrl + '/__entry/health', { signal: AbortSignal.timeout(1500) })).json(); } catch {}
if (entry?.service === 'testpilot-unified-entry') {
    console.log('Unified entry already running: ' + entryUrl);
} else {
    const reservation = createServer();
    reservation.listen(4325, '127.0.0.1');
    await once(reservation, 'listening');
    await new Promise(resolve => reservation.close(resolve));
    mkdirSync(runtimeRoot, { recursive: true });
    const log = openSync(path.join(runtimeRoot, 'entry.log'), 'a');
    const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'serve-integrated-entry.mjs')], { cwd: repoRoot, windowsHide: true, detached: true, stdio: ['ignore', log, log] });
    child.unref(); closeSync(log);
    let ready = false;
    for (let n = 0; n < 40; n++) {
        try { ready = (await (await fetch(entryUrl + '/__entry/health', { signal: AbortSignal.timeout(1000) })).json()).service === 'testpilot-unified-entry'; } catch {}
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw Error('Unified entry did not become ready. See runtime-data/entry.log.');
    console.log('Unified entry: ' + entryUrl);
}
