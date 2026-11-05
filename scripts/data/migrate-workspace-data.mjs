#!/usr/bin/env node
// Copy local TestPilot data into an unused, owner-specific destination. Sources
// remain read-only. Example: --workspace dify --source D:/demo/artifacts/demo-toolrun
// Optional --env-source and --credentials-source stay in ignored private storage.
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, readdir, readFile, writeFile, copyFile, lstat, access, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { argument, workspacePaths } from '../lib/integrated-workspaces.mjs';
const target = workspacePaths(argument('workspace'));
const source = path.resolve(argument('source') ?? (() => { throw Error('--source is required'); })());
const normalize = p => process.platform === 'win32' ? p.toLowerCase() : p;
const fromRoot = normalize(source), toRoot = normalize(target.root);
if (fromRoot === toRoot || toRoot.startsWith(fromRoot + path.sep) || fromRoot.startsWith(toRoot + path.sep))
    throw Error('Source and destination must be separate directories.');
await access(source);
try {
    await access(target.root);
    throw Error('Destination already exists. Migration never overwrites existing workspace data.');
}
catch (error) {
    if (error.code !== 'ENOENT')
        throw error;
}
const staging = path.join(path.dirname(target.root), `.incoming-${target.owner}-${randomUUID()}`);
await mkdir(staging, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [], databases = [], excluded = [];
const ignored = new Set(['browser-profiles', 'browser-sessions', 'node_modules', '.git', '.local', 'private', 'script-index']);
async function walk(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const relative = prefix + entry.name, from = path.join(dir, entry.name), to = path.join(staging, relative);
        if (ignored.has(entry.name) || /^\.env(?:\.|$)/.test(entry.name) || entry.name === 'data-migration.json' || /(?:-wal|-shm|-journal|\.tmp)$/.test(entry.name)) {
            excluded.push(relative);
            continue;
        }
        if (entry.isSymbolicLink())
            throw Error('Refusing a linked data path: ' + relative);
        if (entry.isDirectory()) {
            await mkdir(to, { recursive: true });
            await walk(from, relative + '/');
            continue;
        }
        if (!entry.isFile())
            continue;
        if (!prefix && entry.name === 'model-settings.json') {
            const settings = JSON.parse(await readFile(from, 'utf8'));
            delete settings.browserCdpEndpoint;
            const bytes = Buffer.from(JSON.stringify(settings, null, 2) + '\n');
            await writeFile(to, bytes);
            files.push({ path: relative, sha256: hash(bytes), kind: 'private-model-settings', browserConnectionSeparated: true });
            continue;
        }
        if (/\.(?:sqlite|sqlite3|db)$/i.test(entry.name)) {
            const db = new DatabaseSync(from, { readOnly: true });
            try {
                await backup(db, to);
            }
            finally {
                db.close();
            }
            const saved = new DatabaseSync(to, { readOnly: true });
            try {
                const integrity = saved.prepare('PRAGMA quick_check').get();
                if (Object.values(integrity ?? {})[0] !== 'ok')
                    throw Error('Copied database integrity check failed: ' + relative);
                const tables = saved.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
                databases.push({ path: relative, tables: tables.map(({ name }) => ({ name, rows: saved.prepare('SELECT count(*) AS n FROM "' + String(name).replaceAll('"', '""') + '"').get().n })) });
            }
            finally {
                saved.close();
            }
            files.push({ path: relative, sha256: hash(await readFile(to)), kind: 'sqlite-online-backup' });
            continue;
        }
        let bytes, stable = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            bytes = await readFile(from);
            if (hash(bytes) === hash(await readFile(from))) {
                stable = true;
                break;
            }
        }
        if (!stable)
            throw Error('Source is changing; no completed migration was recorded: ' + relative);
        await writeFile(to, bytes);
        files.push({ path: relative, sha256: hash(bytes), kind: 'file' });
    }
}
await walk(source);
const privateFiles = [];
for (const [flag, name] of [['env-source', 'instance.env'], ['credentials-source', 'mysql-connection.xml']]) {
    const configured = argument(flag);
    if (!configured)
        continue;
    const from = path.resolve(configured);
    if (!(await lstat(from)).isFile())
        throw Error('Expected a private configuration file.');
    const privateDir = path.join(staging, 'private');
    await mkdir(privateDir, { recursive: true });
    await copyFile(from, path.join(privateDir, name));
    privateFiles.push(name);
}
const manifest = { schema: 1, workspace: target.owner, source, destination: target.root, completedAt: new Date().toISOString(), sourceWasModified: false, browserSessionsCopied: false, files, databases, excluded, privateFiles };
await writeFile(path.join(staging, 'data-migration.json'), JSON.stringify(manifest, null, 2) + '\n');
await rename(staging, target.root);
console.log(JSON.stringify({ workspace: target.owner, destination: target.root, files: files.length, databases: databases.length, privateConfigurations: privateFiles.length }, null, 2));
