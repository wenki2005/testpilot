#!/usr/bin/env node
// Read-only verification of copied local TestPilot data and SQLite table
// contents. Does not execute business cases or access the target test database.
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { argument, workspacePaths } from '../lib/integrated-workspaces.mjs';
const workspace = workspacePaths(argument('workspace', 'dify'));
const manifest = JSON.parse(await readFile(workspace.manifest, 'utf8'));
if (manifest.workspace !== workspace.owner)
    throw Error('Migration owner mismatch.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const differences = [], tables = [];
let checkedFiles = 0;
const databaseFiles = new Set(manifest.databases.map(item => item.path));
for (const file of manifest.files) {
    if (databaseFiles.has(file.path))
        continue;
    const saved = await readFile(path.join(workspace.root, file.path));
    if (hash(saved) !== file.sha256)
        differences.push({ path: file.path, reason: 'destination changed after migration' });
    checkedFiles++;
}
for (const database of manifest.databases) {
    const source = new DatabaseSync(path.join(manifest.source, database.path), { readOnly: true });
    const destination = new DatabaseSync(path.join(workspace.root, database.path), { readOnly: true });
    const digest = (db, name) => {
        const statement = db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid');
        statement.setReadBigInts(true);
        const value = createHash('sha256');
        let rows = 0;
        for (const row of statement.iterate()) {
            value.update(JSON.stringify(row, (_key, item) => typeof item === 'bigint' ? item.toString() : item) + '\n');
            rows++;
        }
        return { rows, sha256: value.digest('hex') };
    };
    try {
        for (const table of database.tables) {
            const before = digest(source, table.name), after = digest(destination, table.name);
            tables.push({ database: database.path, table: table.name, sourceRows: before.rows, destinationRows: after.rows, matching: before.sha256 === after.sha256 });
            if (before.sha256 !== after.sha256)
                differences.push({ path: database.path, table: table.name, reason: 'source and destination table contents differ' });
        }
    }
    finally {
        source.close();
        destination.close();
    }
}
const result = { workspace: workspace.owner, verifiedAt: new Date().toISOString(), checkedFiles, databases: manifest.databases.length, tables, differences, passed: differences.length === 0 };
await writeFile(path.join(workspace.root, 'migration-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ workspace: workspace.owner, checkedFiles, databases: result.databases, tables: tables.length, differences: differences.length, passed: result.passed }, null, 2));
if (!result.passed)
    process.exitCode = 1;
