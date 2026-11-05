// Shared local paths for independently owned Dify and web-regression workspaces.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDirectories } from './data-directory.mjs';
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const runtimeRoot = resolveDataDirectories().workspacesRoot;
export const legacyRuntimeRoot = path.join(repoRoot, 'runtime-data');
export const workspaceNames = ['dify', 'web-regression'];
export const workspacePorts = { dify: 4323, 'web-regression': 4324 };
export function workspacePaths(owner) {
    if (!workspaceNames.includes(owner))
        throw Error('workspace must be dify or web-regression');
    const root = path.join(runtimeRoot, owner);
    return { owner, root, privateDir: path.join(root, 'private'), scripts: path.join(root, 'script-index'), manifest: path.join(root, 'data-migration.json'), processFile: path.join(runtimeRoot, `${owner}-process.json`), port: workspacePorts[owner] };
}
export function argument(name, fallback) { const at = process.argv.indexOf('--' + name); return at < 0 ? fallback : process.argv[at + 1] ?? fallback; }
