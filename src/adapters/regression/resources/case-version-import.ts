import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { extractDocument } from '../../documents/resources/importer.js';
import { parseCaseVersionMarkdown, type CaseVersionRow } from './case-markdown-import.js';
import { inferImportModule, matchImportedCase } from './case-import-matching.js';
import { compareProjectResources, resourceKey, validateProjectResources, type ProjectResources } from './project-resource-contract.js';
type Row = CaseVersionRow;
const clean = (s: string) => s.trim().replace(/^[✅❌⚠️🔄\s]+/u, '').replace(/\s+P[0-3]\s*$/i, '').trim();
/** Lossless leaf extraction for whole-file maintenance. Topic IDs survive insertion/reordering. */
async function rows(fileName: string, bytes: Uint8Array): Promise<Row[]> {
    if (/\.(?:md|markdown)$/i.test(fileName)) return parseCaseVersionMarkdown(fileName, bytes);
    if (/\.csv$/i.test(fileName)) {
        const doc = await extractDocument(fileName, bytes);
        return (doc.testCases ?? []).map(c => ({ key: 'csv:' + c.id, id: c.id!, title: c.title, expected: c.expected, sourcePath: c.modulePath ?? [] }));
    }
    if (!/\.xmind$/i.test(fileName)) throw Error('请上传完整Markdown、XMind或CSV；资源备份JSON使用导入。');
    let entries: Record<string, Uint8Array>;
    try { entries = unzipSync(bytes, { filter: f => { if (f.originalSize > 16 * 1024 * 1024) throw Error('XMind解压内容过大。'); return f.name === 'content.json'; } }); }
    catch { throw Error('XMind文件无效或过大。'); }
    if (!entries['content.json']) throw Error('只支持含content.json的新版XMind。');
    const sheets = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entries['content.json']));
    if (!Array.isArray(sheets)) throw Error('XMind工作表无效。');
    const result: Row[] = []; let count = 0;
    const visit = (n: any, parents: string[]) => {
        if (!n || typeof n.title !== 'string' || parents.length > 40 || ++count > 20000) throw Error('XMind节点或层级无效。');
        const children = [...(n.children?.attached ?? []), ...(n.children?.detached ?? [])];
        if (!children.length && parents.length) {
            const title = clean(n.title); if (!title) throw Error('存在空用例。');
            const sourceId = typeof n.id === 'string' && n.id.length <= 200 ? 'xmind:' + n.id : undefined;
            result.push({ key: sourceId ?? 'path:' + [...parents, n.title].join(' > '), ...(sourceId ? { sourceId } : {}), title, expected: title, sourcePath: parents });
        }
        for (const child of children) visit(child, [...parents, n.title.trim()]);
    };
    for (const sheet of sheets) visit(sheet.rootTopic, []);
    return result;
}
export const caseVersionInput = z.object({ systemId: z.uuid(), fileName: z.string().min(1).max(250), bytesBase64: z.string().min(1).max(12_000_000), mapping: z.record(z.string(), z.object({ moduleId: z.uuid(), caseId: z.string().min(1).max(80).optional() }).strict()).default({}) }).strict();
/** Produces a preview only. Application uses the normal resource transaction and revision guard. */
export async function prepareCaseVersion(current: ProjectResources, input: unknown) {
    const data = caseVersionInput.parse(input);
    if (current.project.id !== data.systemId) throw Error('项目不匹配。');
    const bytes = Buffer.from(data.bytesBase64, 'base64'); if (bytes.length > 8 * 1024 * 1024) throw Error('文件超过8MB。');
    const imported = await rows(data.fileName, bytes);
    if (!imported.length || imported.length > 2000 || new Set(imported.map(r => r.key)).size !== imported.length) throw Error('用例为空、过多或源编号重复。');
    const resources = structuredClone(current); resources.cases = [];
    const unresolved: Array<{ key: string; title: string; sourcePath: string[]; reason: string }> = [], identities = new Set<string>(), scriptsToReview: string[] = [], mappingUpdates: string[] = [], autoMappings: Array<{ key: string; caseId?: string; moduleId: string; reason: string; confidence: 'high' | 'medium' }> = [];
    for (const row of imported) {
        const chosen = data.mapping[row.key];
        let matches = current.cases.filter(c => chosen ? c.moduleId === chosen.moduleId && c.id === chosen.caseId : row.id ? c.id === row.id : row.sourceId && c.sourceId === row.sourceId);
        if (!chosen && !matches.length && row.sourceId) matches = current.cases.filter(c => c.sourceId === row.sourceId);
        if (!chosen && !matches.length && (!row.id || row.structured)) {
            matches = current.cases.filter(c => (!row.structured && clean(c.sourceExpected) === row.expected) || clean(c.title) === row.title);
            if (matches.length > 1) {
                const modules = current.modules.filter(m => row.sourcePath.includes(m.name));
                if (modules.length === 1) matches = matches.filter(c => c.moduleId === modules[0]!.id);
                else if (row.sourcePath.length) { const path = row.sourcePath.slice(1).join(' > '); matches = matches.filter(c => c.sourcePath.slice(1).join(' > ') === path); }
            }
        }
        if (!chosen && !matches.length) {
            const automatic = matchImportedCase(row, current.cases);
            if (automatic)
                matches = [automatic.value];
        }
        if (matches.length > 1) { unresolved.push({ ...row, reason: '存在多个候选，请选择原用例。' }); continue; }
        const old = matches[0];
        if (chosen?.caseId && !old) throw Error('映射的原用例不存在。');
        const candidates = resources.modules.filter(m => row.sourcePath.includes(m.name));
        let moduleId = old?.moduleId ?? chosen?.moduleId ?? (candidates.length === 1 ? candidates[0]!.id : undefined);
        if (!moduleId) {
            const inferred = inferImportModule(resources, row);
            moduleId = inferred.module.id;
            if (inferred.created && !resources.modules.some(m => m.id === moduleId))
                resources.modules.push(inferred.module);
            autoMappings.push({ key: row.key, ...(old ? { caseId: old.id } : {}), moduleId, reason: inferred.reason, confidence: inferred.created ? 'medium' : 'high' });
        }
        if (!moduleId || !resources.modules.some(m => m.id === moduleId)) { unresolved.push({ ...row, reason: '自动识别失败，请选择所属模块或原用例。' }); continue; }
        const id = old?.id ?? row.id ?? 'case-' + createHash('sha256').update(row.key).digest('hex').slice(0, 20);
        const identity = resourceKey({ moduleId, id }); if (identities.has(identity)) throw Error('多条新用例映射到同一编号，请调整。'); identities.add(identity);
        const unchanged = old && (row.id || row.structured ? row.title === old.title && row.expected === old.expected : row.expected === clean(old.sourceExpected))
            && (row.manualSteps === undefined || JSON.stringify(row.manualSteps) === JSON.stringify(old.manualSteps))
            && (row.priority === undefined || row.priority === old.priority);
        const sourceId = row.structured ? old?.sourceId ?? row.sourceId : row.sourceId ?? old?.sourceId;
        if (unchanged && sourceId && old.sourceId !== sourceId) mappingUpdates.push(identity);
        const review = unchanged ? old.scriptReview : { status: 'pending' as const, note: old ? '原脚本保留；用例内容变化，执行前需核对。' : '新增用例，需补充脚本和前置。' };
        if (review?.status === 'pending') scriptsToReview.push(identity);
        if (unchanged) {
            resources.cases.push({ ...old, ...(sourceId ? { sourceId } : {}) });
            continue;
        }
        resources.cases.push({ ...(row.priority || old?.priority ? { priority: row.priority ?? old!.priority! } : {}), id, moduleId, title: unchanged ? old.title : row.title, expected: unchanged ? old.expected : row.expected, manualSteps: row.manualSteps ?? old?.manualSteps ?? [], prerequisites: old?.prerequisites ?? [], ...(old?.prerequisiteReview ? { prerequisiteReview: old.prerequisiteReview } : {}), ...(review ? { scriptReview: review } : {}), ...(sourceId ? { sourceId } : {}), sourcePath: unchanged ? old.sourcePath : row.sourcePath, sourceExpected: unchanged ? old.sourceExpected : row.expected, script: old?.script ?? { caseId: id, dependsOn: [], steps: [] } });
    }
    const issues: string[] = [];
    if (unresolved.length) {
        issues.push('还有未确认的编号或模块映射；确认完成前不判定旧用例移除。');
        // Unresolved source rows may still refer to any old case. Do not advertise
        // their absence as deletion or invent broken dependencies in a partial preview.
        resources.cases.push(...current.cases.filter(c => !identities.has(resourceKey(c))).map(c => structuredClone(c)));
    }
    const kept = new Set(resources.cases.map(resourceKey));
    for (const c of resources.cases) for (const dep of c.prerequisites) if (!kept.has(resourceKey(dep))) issues.push(c.id + '的前置' + dep.caseId + '已移除，请先调整引用。');
    for (const chain of resources.chains) for (const step of chain.steps) for (const id of step.caseIds) if (!resources.cases.some(c => c.id === id)) issues.push('核心链路' + chain.title + '仍引用' + id + '，需先调整链路定义。');
    resources.modules = resources.modules.filter(m => resources.cases.some(c => c.moduleId === m.id)).map(m => ({ ...m, ...(m.coreCaseIds ? { coreCaseIds: m.coreCaseIds.filter(id => kept.has(resourceKey({ moduleId: m.id, id }))) } : {}), ...(m.starterCaseIds ? { starterCaseIds: m.starterCaseIds.filter(id => kept.has(resourceKey({ moduleId: m.id, id }))) } : {}) }));
    if (!issues.length) validateProjectResources(resources);
    const comparison = compareProjectResources(current, resources);
    const metadataOnly = comparison.changed.filter(k => mappingUpdates.includes(k));
    const recognized = imported.map(({ key, id, title, expected, sourcePath, manualSteps, priority }) => ({ key, id, title, expected, sourcePath, manualSteps, priority }));
    return { resources, recognized, autoMappings, unresolved, issues: [...new Set(issues)], scriptsToReview, mappingUpdates, total: imported.length, ...comparison, changed: comparison.changed.filter(k => !metadataOnly.includes(k)), unchanged: [...comparison.unchanged, ...metadataOnly] };
}
