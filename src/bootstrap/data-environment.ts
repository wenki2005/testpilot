import path from 'node:path';
import { resolveDataDirectories } from '../../scripts/lib/data-directory.mjs';

/** Call before dynamically importing adapters that read environment at module load. */
export function configureDataEnvironment() {
    const paths = resolveDataDirectories();
    process.env.TESTPILOT_DATA_DIR = paths.dataDir;
    process.env.TESTPILOT_ARTIFACTS_DIR ??= path.join(paths.dataDir, 'document-tests');
    return paths;
}
