import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { executeCommand } from '../commands/command-adapter.js';
import { redactSensitiveExportData } from '../documents/evidence/sensitive-data.js';
export type PlaywrightCase = {
    id: string;
    title: string;
    status: 'passed' | 'failed' | 'blocked';
    detail: string;
};
/** Normalize upstream JSON, retaining skips, expected failures, retries and
 * setup errors instead of treating a zero process exit code as a QA pass. */
export function normalizePlaywrightReport(raw: unknown): {
    status: 'passed' | 'failed' | 'blocked';
    cases: PlaywrightCase[];
    errors: string[];
} {
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).suites))
        throw Error('Invalid Playwright JSON reporter output');
    const report = raw as any, cases: PlaywrightCase[] = [];
    const visit = (suite: any, parents: string[]) => {
        for (const spec of suite.specs ?? []) {
            for (const item of spec.tests ?? []) {
                const title = [...parents, spec.title, item.projectName].filter(Boolean).join(' › ');
                const results = Array.isArray(item.results) ? item.results : [];
                const actual = results.at(-1)?.status;
                const expected = item.expectedStatus ?? 'passed';
                let status: PlaywrightCase['status'] = 'blocked';
                if (item.status === 'unexpected' || ['failed', 'timedOut'].includes(actual))
                    status = expected === 'passed' ? 'failed' : 'blocked';
                if (item.status === 'expected' && expected === 'passed' && actual === 'passed' && results.length === 1)
                    status = 'passed';
                const detail = status === 'passed' ? 'Upstream Playwright assertion passed.' : `upstream=${item.status}; expected=${expected}; actual=${actual ?? 'not-run'}; attempts=${results.length}. Skips, expected failures and retry-only passes remain unresolved.`;
                cases.push({ id: String(spec.id ?? `${cases.length + 1}`) + ':' + String(item.projectName ?? '') + ':' + String(item.repeatEachIndex ?? 0), title, status, detail });
            }
        }
        for (const child of suite.suites ?? [])
            visit(child, [...parents, child.title].filter(Boolean));
    };
    for (const suite of report.suites)
        visit(suite, [suite.title].filter(Boolean));
    const errors: string[] = (report.errors ?? []).map((e: any) => typeof e?.message === 'string' ? e.message : 'Playwright setup/teardown error');
    const status = errors.length || cases.some(c => c.status === 'failed') ? 'failed' : !cases.length || cases.some(c => c.status === 'blocked') ? 'blocked' : 'passed';
    return { status, cases, errors };
}
export async function runPlaywrightTest(options: {
    projectRoot: string;
    config: string;
    outputRoot: string;
    signal?: AbortSignal;
}) {
    const root = await realpath(options.projectRoot);
    const config = await realpath(path.resolve(root, options.config));
    const rel = path.relative(root, config);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))
        throw Error('Playwright configuration must be inside the approved project');
    const folder = path.resolve(options.outputRoot, randomUUID());
    await mkdir(folder, { recursive: true });
    const jsonPath = path.join(folder, 'playwright.json');
    const require = createRequire(import.meta.url);
    const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
    const command = await executeCommand({ id: 'playwright-test', title: 'Upstream Playwright Test', command: { bin: process.execPath, args: [cli, 'test', '--config', config, '--reporter=json', '--output', path.join(folder, 'attachments')], timeoutMs: 900000, cleanEnvironment: true, env: { PLAYWRIGHT_JSON_OUTPUT_FILE: jsonPath } } }, root, options.signal);
    let normalized: ReturnType<typeof normalizePlaywrightReport>;
    try {
        normalized = normalizePlaywrightReport(JSON.parse(await readFile(jsonPath, 'utf8')));
    }
    catch {
        normalized = { status: 'blocked', cases: [], errors: ['No valid upstream JSON evidence; inspect command logs, dependencies and configuration.'] };
    }
    if (command.status === 'blocked')
        normalized.status = 'blocked';
    else if (command.actualExitCode !== 0 && normalized.status === 'passed') {
        normalized.status = 'blocked';
        normalized.errors.push('Process exit contradicts reported passing tests; review setup/teardown.');
    }
    const result = redactSensitiveExportData({ ...normalized, command, reportPath: path.join(folder, 'report.md'), rawReportPath: jsonPath });
    await writeFile(path.join(folder, 'run.json'), JSON.stringify(result, null, 2));
    await writeFile(path.join(folder, 'report.md'), `# Playwright Test 回归结果\n\n状态：${normalized.status}\n\n${normalized.cases.map(c => `- ${c.status} · ${c.title}: ${c.detail}`).join('\n')}\n\n${normalized.errors.join('\n')}\n`);
    return { ...normalized, reportPath: path.join(folder, 'report.md') };
}
