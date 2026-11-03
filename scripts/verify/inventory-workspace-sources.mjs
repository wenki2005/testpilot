#!/usr/bin/env node
// Read-only inventory of explicit candidate data roots; never reads credentials.
// Example: node scripts/verify/inventory-workspace-sources.mjs D:/demo/artifacts/demo
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const results = [];
for (const input of process.argv.slice(2)) {
    const root = path.resolve(input), projects = [];
    try {
        for (const file of await readdir(path.join(root, 'document-tests', 'projects'))) {
            if (!file.endsWith('.json'))
                continue;
            try {
                const item = JSON.parse(await readFile(path.join(root, 'document-tests', 'projects', file), 'utf8'));
                projects.push({ id: item.id, name: item.name, fileName: item.fileName, cases: item.cases?.length ?? 0, updatedAt: item.updatedAt });
            }
            catch { }
        }
    }
    catch { }
    results.push({ root, projectCount: projects.length, projects });
}
console.log(JSON.stringify(results, null, 2));
