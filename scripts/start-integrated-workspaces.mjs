#!/usr/bin/env node
// Start the same integrated code with separate data, credentials, browser
// profiles and processes. Does not restart existing instances or the old 4321.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, existsSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { argument, repoRoot, runtimeRoot, legacyRuntimeRoot, entryPort, workspacePorts, workspaceNames, workspacePaths } from './lib/integrated-workspaces.mjs';
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
            const metadata = JSON.parse(readFileSync(workspace.processFile, 'utf8'));
            if (path.resolve(metadata.code) !== path.resolve(code)) throw Error('An instance from another program directory is running. Stop it before upgrading; no process was replaced.');
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
    // 迁移回执（data-migration.json）只有 migrate 脚本会写；用 relocate 搬过来的数据
    // 没有它，但库文件已经在位，不能因此判成“尚未迁入”。
    const dataStatus = existsSync(workspace.manifest) || existsSync(path.join(workspace.root, 'system-module-regression', 'catalog.sqlite')) ? 'migrated' : 'awaiting-source';
    const env = { ...process.env, TESTPILOT_API_KEY: '', OPENAI_API_KEY: '', TESTPILOT_DIFY_API_KEY: '', TESTPILOT_DIFY_EXECUTION_API_KEY: '', TESTPILOT_DIFY_WECOM_WEBHOOK: '', ...settings,
        PORT: String(workspace.port), TESTPILOT_DATA_DIR: workspace.root, TESTPILOT_ARTIFACTS_DIR: path.join(workspace.root, 'document-tests'), TESTPILOT_BROWSER_CDP_ENDPOINT: '',
        TESTPILOT_WORKSPACE: workspace.owner, TESTPILOT_WORKSPACE_DATA_STATUS: dataStatus, TESTPILOT_DIFY_WORKSPACE_URL: `http://127.0.0.1:${workspacePorts.dify}`, TESTPILOT_WEB_WORKSPACE_URL: `http://127.0.0.1:${workspacePorts['web-regression']}` };
    const log = openSync(path.join(workspace.root, 'server.log'), 'a');
    const child = spawn(process.execPath, [code], { cwd: repoRoot, env, windowsHide: true, detached: true, stdio: ['ignore', log, log] });
    child.unref();
    closeSync(log);
    writeFileSync(workspace.processFile, JSON.stringify({ pid: child.pid, workspace: workspace.owner, port: workspace.port, url, code, dataDir: workspace.root, startedAt: new Date().toISOString() }, null, 2));
    let ready = false;
    // 首次启动要从 project-resources 导入全部用例并建版本，冷盘时可能超过 15 秒；
    // 健康即返回，所以放宽窗口不会拖慢正常启动。
    for (let n = 0; n < 240; n++) {
        try {
            ready = (await fetch(url + '/api/health', { signal: AbortSignal.timeout(1000) })).ok;
        }
        catch { }
        if (ready)
            break;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready)
        throw Error(workspace.owner + ' did not become ready after 60s. See its server.log.');
    if (existsSync(path.join(workspace.privateDir, 'mysql-connection.xml'))) {
        const connection = spawnSync(process.execPath, [path.join(repoRoot, "scripts/data/connect-workspace-database.mjs"), '--workspace', workspace.owner], { cwd: repoRoot, windowsHide: true, encoding: 'utf8', timeout: 35000 });
        console.log(connection.status === 0 ? workspace.owner + ': database connection restored.' : workspace.owner + ': reconnect the database in its panel.');
    }
    console.log(workspace.owner + ': ' + url + ' | data: ' + workspace.root);
}

// The public entry owns no business data. Both backends remain independent.
const entryUrl = `http://127.0.0.1:${entryPort}`;
let entry;
try { entry = await (await fetch(entryUrl + '/__entry/health', { signal: AbortSignal.timeout(1500) })).json(); } catch {}
if (entry?.service === 'testpilot-unified-entry') {
    console.log('Unified entry already running: ' + entryUrl);
} else {
    const reservation = createServer();
    reservation.listen(entryPort, '127.0.0.1');
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
