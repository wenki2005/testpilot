// Shared local paths for independently owned Dify and web-regression workspaces.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDirectories } from './data-directory.mjs';
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const runtimeRoot = resolveDataDirectories().workspacesRoot;
export const legacyRuntimeRoot = path.join(repoRoot, 'runtime-data');
export const workspaceNames = ['dify'];
const localPort = (value, fallback) => { const port = value ? Number(value) : fallback; if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid local TestPilot port.'); return port; };
export const workspacePorts = { dify: localPort(process.env.TESTPILOT_DIFY_PORT, 4323), 'web-regression': localPort(process.env.TESTPILOT_WEB_PORT, 4324) };
export const entryPort = localPort(process.env.TESTPILOT_ENTRY_PORT, 4325);
if (new Set([...Object.values(workspacePorts), entryPort]).size !== 3) throw Error('TestPilot ports must be distinct.');
export function workspacePaths(owner) {
    if (!workspaceNames.includes(owner))
        throw Error('workspace must be dify or web-regression');
    const root = path.join(runtimeRoot, owner);
    return { owner, root, privateDir: path.join(root, 'private'), scripts: path.join(root, 'script-index'), manifest: path.join(root, 'data-migration.json'), processFile: path.join(runtimeRoot, `${owner}-process.json`), port: workspacePorts[owner] };
}
export function argument(name, fallback) { const at = process.argv.indexOf('--' + name); return at < 0 ? fallback : process.argv[at + 1] ?? fallback; }
