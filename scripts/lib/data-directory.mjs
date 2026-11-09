import path from 'node:path';
import os from 'node:os';

/** Paths belong to the user, not to a replaceable program checkout. */
export function resolveDataDirectories(env = process.env) {
    const absolute = (value, fallback) => {
        if (!value) return path.resolve(fallback);
        if (!path.isAbsolute(value)) throw Error('TestPilot data paths must be absolute.');
        return path.resolve(value);
    };
    const userRoot = process.platform === 'win32' ? (env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')) : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : (env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
    const home = absolute(env.TESTPILOT_DATA_HOME, path.join(userRoot, 'TestPilot'));
    const workspacesRoot = absolute(env.TESTPILOT_RUNTIME_DIR, path.join(home, 'workspaces'));
    const owner = env.TESTPILOT_WORKSPACE || 'dify';
    if (!['dify', 'web-regression'].includes(owner)) throw Error('Unknown TestPilot workspace.');
    const dataDir = absolute(env.TESTPILOT_DATA_DIR, path.join(workspacesRoot, owner));
    return { home, workspacesRoot, owner, dataDir };
}
