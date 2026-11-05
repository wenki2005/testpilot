import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { readDocumentPackage } from '../../documents/execution/workflow-facade.js';
import type { WebModuleJob } from '../execution/module-execution-service.js';
import { formatDifyMarkdown } from '../authoring/markdown-case-pack.js';
import { assertDifyExportSafe } from './export-policy.js';
import { needsDifyReadback } from '../scenarios/scenario-planner.js';
import { difyScriptName } from '../../../domain/regression/script-package-layout.js';
type ScriptPackageContext = {
    batchId?: string;
    systemId: string;
    systemName: string;
    createdAt: string;
    selectionScope?: 'starter' | 'all' | 'custom';
    modules: Array<{
        jobId?: string;
        moduleId: string;
        moduleName: string;
        versionId: string;
        version: number;
    }>;
};
export type DifyScriptModuleInput = Pick<WebModuleJob, 'moduleId' | 'moduleName' | 'moduleDigest' | 'selectedCaseIds' | 'snapshot' | 'results'> & Partial<Pick<WebModuleJob, 'id' | 'executionProject' | 'planDigest'>> & {
    resultSources?: Array<{
        caseId: string;
        batchId: string;
        jobId: string;
        createdAt: string;
    }>;
};
/** Narrow Dify export compatibility fix; the shared runner source is unchanged. */
export function difyPortableRunner(source: string): string {
    const allowed = ['assertControlEnabled', 'assertSelectedByRoleIndex', 'assertText', 'assertVisible', 'assertNotVisible', 'assertExactVisible', 'assertRoleVisible', 'assertValue', 'assertValueByPlaceholder', 'assertDisabled', 'assertRoleDisabled', 'assertFieldInvalid', 'assertMaxLengthOrMessage', 'assertNoHorizontalOverflow', 'assertNoFetchOrXhr', 'assertCurrentUrlUnchanged'];
    const match = source.match(/c\.steps\.some\(s=>(\[[^\]\n]+\])\.includes\(s\.action\)\)/);
    let existing: unknown;
    try {
        existing = JSON.parse(match?.[1]?.replaceAll("'", '"') ?? 'null');
    }
    catch { }
    if (!match || !Array.isArray(existing) || !existing.length || existing.some(value => !allowed.includes(value)))
        throw Error('固定脚本的断言协议发生变化，导出前需要重新核验。');
    return source.replace(match[0], `c.steps.some(s=>${JSON.stringify(allowed)}.includes(s.action))`);
}
/** Reuse the existing portable runner; export only this Dify batch's frozen scope. */
export async function difyScriptPackage(jobs: WebModuleJob[], context?: ScriptPackageContext): Promise<Buffer> {
    const completed = jobs.find(j => j.documentRunId && j.executionFinished);
    if (!completed?.documentRunId)
        throw Error('本轮尚未形成网页执行脚本包；可先导出 Markdown 用例。');
    const runnerFiles = unzipSync(await readDocumentPackage(completed.documentRunId));
    return buildScriptPackage(jobs, runnerFiles, context);
}
/** Export a current selection without creating a job or a business run. */
export async function difySelectionScriptPackage(modules: DifyScriptModuleInput[], runnerRunIds: string[], context: ScriptPackageContext): Promise<Buffer> {
    for (const runId of new Set(runnerRunIds)) {
        let files: Record<string, Uint8Array>;
        try {
            files = unzipSync(await readDocumentPackage(runId));
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
                continue;
            throw error;
        }
        return buildScriptPackage(modules, files, context);
    }
    throw Error('当前系统的执行器文件缺失，请恢复独立执行包；用例与历史结果未修改。');
}
function buildScriptPackage(jobs: DifyScriptModuleInput[], runnerFiles: Record<string, Uint8Array>, context?: ScriptPackageContext): Buffer {
    if (!runnerFiles['run.mjs'] || !runnerFiles['package.json'])
        throw Error('本轮执行包缺少固定脚本，请恢复打包阶段后重试。');
    const base = 'Dify_固定脚本/';
    const files: Record<string, Uint8Array> = {};
    const modules: Array<{
        moduleId: string;
        moduleName: string;
        versionId: string;
        version: number | null;
        jobId?: string | undefined;
        directory: string;
        script: string;
        caseCount: number;
    }> = [];
    const used = new Set<string>();
    for (const job of jobs) {
        const source = job.executionProject ?? job.snapshot;
        const cases = structuredClone(source.cases.filter(c => job.selectedCaseIds.includes(c.id)));
        for (const c of cases) {
            const result = job.results.find(r => r.caseId === c.id);
            if (!result || !['passed', 'failed'].includes(result.status) || c.expected === '必填未完成时提交按钮置灰不可点击' || needsDifyReadback(c))
                c.steps = [];
        }
        assertDifyExportSafe({ targetUrl: job.snapshot.targetUrl, cases });
        const entry = context?.modules.find(item => job.id ? item.jobId === job.id : item.versionId === job.moduleId);
        const moduleName = entry?.moduleName ?? job.moduleName;
        const moduleId = entry?.moduleId ?? job.moduleId;
        const stem = `Dify_${difyScriptName(moduleName)}_v${entry?.version ?? '未知'}_${difyScriptName(moduleId, 8)}`;
        let directory = stem;
        let suffix = 2;
        while (used.has(directory.toLowerCase()))
            directory = stem + '_' + suffix++;
        used.add(directory.toLowerCase());
        const prefix = base + 'modules/' + directory + '/';
        const script = `Dify_${difyScriptName(moduleName)}_固定脚本.mjs`;
        const packageJson = JSON.parse(strFromU8(runnerFiles['package.json']));
        packageJson.description = `Dify · ${moduleName} · v${entry?.version ?? '未知'}`;
        packageJson.scripts = { ...packageJson.scripts, test: `node "./${script}"` };
        files[prefix + script] = strToU8(difyPortableRunner(strFromU8(runnerFiles['run.mjs'])));
        files[prefix + 'package.json'] = strToU8(JSON.stringify(packageJson, null, 2));
        files[prefix + 'cases.json'] = strToU8(JSON.stringify({ targetUrl: job.snapshot.targetUrl, cases, selectedCaseIds: job.results.filter(r => !r.outOfScope).map(r => r.caseId) }, null, 2));
        files[prefix + 'cases.md'] = strToU8(formatDifyMarkdown(job.moduleName, cases));
        files[prefix + 'manifest.json'] = strToU8(JSON.stringify({ schema: 2, owner: 'dify', kind: context?.selectionScope ? 'selection-script-package' : 'fixed-script-package', systemId: context?.systemId, systemName: context?.systemName, batchId: context?.batchId, moduleName, moduleId, versionId: entry?.versionId ?? job.moduleId, version: entry?.version ?? null, jobId: job.id, moduleDigest: job.moduleDigest, planDigest: job.planDigest, selectedCaseIds: job.selectedCaseIds, originalResults: job.results.map(r => ({ caseId: r.caseId, status: r.status, outOfScope: r.outOfScope })), resultSources: job.resultSources, readOnly: true, difyCalledByExportedRunner: false }, null, 2));
        files[prefix + 'README.md'] = strToU8(`# Dify · ${moduleName}\n\n- 模块版本：v${entry?.version ?? '未记录'}\n- 所选范围：${cases.length} 条\n- 执行脚本：\`${script}\`\n- 来源：${job.id ?? '当前勾选范围（逐条来源见 manifest）'}\n\n在本目录执行：\n\n\`\`\`sh\nnpm install\nnpx playwright install chromium\nnpm test\n\`\`\`\n\n\`cases.json\` 是执行器读取的固定文件名；\`cases.md\` 保存原始预期；\`manifest.json\` 标注 Dify 归属、模块、版本及来源。不要移动单个文件，整个模块目录一起保存。独立脚本不会调用 Dify；缺少完整步骤或本机补充核验的用例继续报告 blocked。\n`);
        modules.push({ moduleId, moduleName, versionId: entry?.versionId ?? job.moduleId, version: entry?.version ?? null, jobId: job.id, directory: 'modules/' + directory, script, caseCount: cases.length });
        if (cases.some(c => c.expected === '必填未完成时提交按钮置灰不可点击'))
            files[prefix + 'DIFY-CHECKS.md'] = strToU8('必填未完成时提交按钮置灰不可点击：本机 Dify 额外验证渲染后的灰色背景。当前独立脚本不包含此样式检查，因此该条保留原预期并以无完整步骤/blocked 导出，不仅凭禁用状态宣称通过。请在 Dify 工作台运行此条。\n');
        if (cases.some(needsDifyReadback))
            files[prefix + 'DIFY-READBACK.md'] = strToU8('本目录包含需要 TestPilot 本机查询回读、提示颜色或完整表单有效性转换核验的用例。独立脚本不包含这些补充检查，相应条目保留原始预期并留空步骤，独立执行须报告 blocked。请在 TestPilot 固定回归工作台执行完整核验。\n');
    }
    const scopeNote = context?.selectionScope ? '本包对应当前勾选模块和所选用例范围；每条用例的最新执行来源写在模块 manifest 中。导出不创建回归批次，不表示重新执行；未执行及阻塞用例保留原预期，缺完整步骤仍报告 blocked。' : '包中只包含本批冻结范围，不等于当前勾选范围的所有历史结果，也不是最新全部用例镜像。原批次没有启动的模块在总 manifest 中标为未执行，不伪造可运行脚本。';
    const missingModules = context?.modules.filter(entry => !modules.some(module => module.moduleId === entry.moduleId && module.versionId === entry.versionId)).map(({ moduleId, moduleName, versionId, version }) => ({ moduleId, moduleName, versionId, version, status: 'not_executed' })) ?? [];
    files[base + 'README.md'] = strToU8('# Dify 模块固定脚本包\n\n先看 `Dify_模块索引.md`，再进入 `modules/Dify_<模块名>_v<版本>_<短ID>/` 运行 `npm test`。每个模块独立存放，不再用任务 UUID 作为目录名称。UUID 只在 manifest 中用于追溯。\n\n' + scopeNote + '\n\n独立执行不调用 Dify，不会产生新的 Dify 工作流记录。包中不含登录态或凭据；需要登录时使用自己的本机浏览器会话。阻塞项保留原预期并清空不能证明完整预期的步骤；范围外条目不进入执行选择。数据库回读、样式及其他本机补充核验仍需在 TestPilot 工作台完成，不能凭导出包宣称通过。\n\n文件约定：模块脚本标注 Dify 和模块名；cases.json、cases.md、package.json、manifest.json 是模块内固定协议名，保持原名并随整个目录保存。不要和 WEB 模块的脚本、截图、数据库备份或私有配置混放。\n');
    files[base + 'Dify_模块索引.md'] = strToU8(['# Dify 模块索引', '', `系统：${context?.systemName ?? '历史模块包'}`, `范围：${context?.selectionScope ?? '历史批次'}`, `批次：${context?.batchId ?? '当前范围导出，未新建执行批次'}`, '', ...modules.map(module => `- [Dify · ${module.moduleName} · v${module.version ?? '未知'} · ${module.caseCount} 条](${module.directory.split('/').map(encodeURIComponent).join('/')}/README.md)`), ...missingModules.map(module => `- Dify · ${module.moduleName} · v${module.version}：未执行，未生成脚本目录。`), ''].join('\n'));
    files[base + 'manifest.json'] = strToU8(JSON.stringify({ schema: 2, owner: 'dify', kind: context?.selectionScope ? 'selection-script-package' : 'fixed-script-package', scope: context?.selectionScope, exportedAt: context?.selectionScope ? context.createdAt : undefined, systemId: context?.systemId, systemName: context?.systemName, batchId: context?.batchId, batchCreatedAt: context?.batchId ? context.createdAt : undefined, modules, missingModules, difyCalledByExportedRunner: false }, null, 2));
    return Buffer.from(zipSync(files));
}
