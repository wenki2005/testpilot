import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { BrowserCheck, DocumentProject } from '../../../domain/documents/shared/test-model.js';
import type { DocumentAuthoringContext } from '../../../domain/documents/cases/authoring-context.js';
import { redactSensitiveExportText } from '../../../domain/documents/shared/sensitive-data.js';
type Binding = {
    projectId: string;
    root: string;
    files: Array<{
        path: string;
        label: string;
        caseIds?: string[];
        startLine?: number;
        endLine?: number;
    }>;
};
const inside = (root: string, target: string) => { const relative = path.relative(root, target); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
/** Operator-owned manifest, never a model/request supplied path or recursive repository dump. */
export function createDocumentAuthoringContextReader(options: {
    manifestPath: string;
    databaseStatus(): {
        connected: boolean;
    };
    databaseEvidence?(project: DocumentProject): Promise<import('../../../domain/documents/shared/database-evidence.js').DocumentDatabaseEvidence | undefined>;
}) {
    return async (project: DocumentProject, item: BrowserCheck): Promise<DocumentAuthoringContext> => {
        const result: DocumentAuthoringContext = {
            sources: [], database: { connected: options.databaseStatus().connected, capability: 'read-only-explorer', resultEvidence: false }, warnings: [],
        };
        if (!result.database.connected)
            result.warnings.push('数据库当前未连接；这是连接状态，不证明测试数据不存在。历史查询与源码均不能充当本次数据库断言。');
        if (result.database.connected && options.databaseEvidence) {
            try {
                const evidence = await options.databaseEvidence(project);
                if (evidence)
                    result.databaseEvidence = evidence;
            }
            catch (error) {
                result.warnings.push(error instanceof Error ? error.message : '本次数据库查询未获得证据。');
            }
        }
        let bindings: Binding[];
        try {
            if ((await stat(options.manifestPath)).size > 64000)
                throw new Error('manifest too large');
            const parsed: unknown = JSON.parse(await readFile(options.manifestPath, 'utf8'));
            if (!Array.isArray(parsed) || parsed.length > 50)
                throw new Error('invalid manifest');
            bindings = parsed as Binding[];
        }
        catch (error) {
            result.warnings.push((error as NodeJS.ErrnoException).code === 'ENOENT' ? '尚未绑定项目源码资料；不能据此认定用户未提供资料。' : '源码资料清单不可读取或格式无效；未使用未核验内容。');
            return result;
        }
        let budget = 16000;
        for (const binding of bindings.filter(entry => entry?.projectId === project.id)) {
            if (!Array.isArray(binding.files) || binding.files.length > 50 || typeof binding.root !== 'string' || !path.isAbsolute(binding.root)) {
                result.warnings.push('项目源码绑定格式无效。');
                continue;
            }
            let root: string;
            try {
                root = await realpath(binding.root);
            }
            catch {
                result.warnings.push('已绑定的源码目录不可读取。');
                continue;
            }
            for (const file of binding.files) {
                if (file.caseIds && (!Array.isArray(file.caseIds) || !file.caseIds.includes(item.id)))
                    continue;
                if (result.sources.length >= 6 || budget < 500) {
                    result.warnings.push('源码上下文已达到单条容量上限，其余文件未发送。');
                    break;
                }
                try {
                    if (typeof file.path !== 'string' || path.isAbsolute(file.path) || /(?:^|[\\/])(?:\.env[^\\/]*|node_modules|\.git)(?:[\\/]|$)/iu.test(file.path) || !/\.(?:vue|ts|tsx|js|java|sql|md|json|ya?ml)$/iu.test(file.path))
                        throw new Error();
                    const target = await realpath(path.resolve(root, file.path));
                    if (!inside(root, target) || (await stat(target)).size > 256000)
                        throw new Error();
                    const content = await readFile(target, 'utf8');
                    const lines = content.split(/\r?\n/u);
                    const startLine = file.startLine ?? 1;
                    const endLine = Math.min(file.endLine ?? Math.min(lines.length, startLine + 119), lines.length);
                    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine >= 160)
                        throw new Error();
                    const excerpt = redactSensitiveExportText(lines.slice(startLine - 1, endLine).map((line, i) => `${startLine + i}: ${line}`).join('\n'));
                    if (excerpt.length > budget) {
                        result.warnings.push('一个源码片段超过剩余容量，未截断后当成完整证据。');
                        continue;
                    }
                    budget -= excerpt.length;
                    result.sources.push({ label: String(file.label).slice(0, 160), path: file.path, sha256: createHash('sha256').update(content).digest('hex'), startLine, endLine, excerpt });
                }
                catch {
                    result.warnings.push('一个已绑定源码片段不可读取、越界或格式无效；未作为生成依据。');
                }
            }
        }
        if (!result.sources.length)
            result.warnings.push('本用例没有可用的已绑定源码片段；仍可依据真实页面和需求生成步骤。');
        return result;
    };
}
