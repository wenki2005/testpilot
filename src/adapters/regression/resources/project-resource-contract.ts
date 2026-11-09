import { createHash } from 'node:crypto';
import { z } from 'zod';
import { assertDifyExportSafe } from '../exports/export-policy.js';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/);
const dependency = z.object({ moduleId: z.string().uuid(), caseId: identifier }).strict();
const resourceCase = z.object({
    priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
    sourceId: z.string().min(1).max(200).optional(),
    scriptReview: z.object({ status: z.enum(['pending', 'reviewed']), note: z.string().max(2000) }).strict().optional(),
    id: identifier,
    moduleId: z.string().uuid(),
    title: z.string().trim().min(1).max(500),
    expected: z.string().trim().min(1).max(2000),
    manualSteps: z.array(z.string().max(2000)).max(100),
    prerequisites: z.array(dependency).max(30),
    prerequisiteReview: z.object({ status: z.enum(['reviewed', 'pending']), note: z.string().max(2000) }).strict().optional(),
    sourcePath: z.array(z.string().max(1000)).max(50),
    sourceExpected: z.string().max(10000),
    script: z.object({ caseId: identifier, dependsOn: z.array(dependency.extend({ requiredStatus: z.literal('passed') })).max(30), steps: z.array(z.unknown()).max(100) }).strict(),
}).strict();
const chain = z.object({ id: identifier, title: z.string().min(1).max(200), description: z.string().max(2000), steps: z.array(z.object({ id: identifier, title: z.string().min(1).max(200), expected: z.string().max(10000), caseIds: z.array(identifier).max(200) }).strict()).max(100) }).strict();
export const projectResourceSchema = z.object({
    schema: z.literal(1),
    project: z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(120) }).strict(),
    modules: z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(120), coreCaseIds: z.array(identifier).max(600).optional(), starterCaseIds: z.array(identifier).max(600).optional() }).strict()).min(1).max(100),
    cases: z.array(resourceCase).min(1).max(2000),
    chains: z.array(chain).max(100),
}).strict();
export type ProjectResources = z.infer<typeof projectResourceSchema>;
export type ResourceCase = ProjectResources['cases'][number];
export const resourceKey = (c: { moduleId: string; id?: string; caseId?: string }) => c.moduleId + ':' + (c.id ?? c.caseId);
export const resourceDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Definitions only: runtime results, credentials and arbitrary paths are never accepted. */
export function validateProjectResources(input: unknown): ProjectResources {
    const bundle = projectResourceSchema.parse(input);
    assertDifyExportSafe(bundle);
    const modules = new Map(bundle.modules.map(m => [m.id, m]));
    if (modules.size !== bundle.modules.length || new Set(bundle.modules.map(m => m.name)).size !== bundle.modules.length)
        throw Error('资源包含重复模块编号或名称。');
    if (modules.has(bundle.project.id)) throw Error('项目与模块不能使用相同编号。');
    const cases = new Map(bundle.cases.map(c => [resourceKey(c), c]));
    if (cases.size !== bundle.cases.length) throw Error('资源包含重复用例编号。');
    for (const c of bundle.cases) {
        if (!modules.has(c.moduleId)) throw Error('用例引用了不存在的模块。');
        if (c.script.caseId !== c.id) throw Error('脚本编号与用例不一致。');
        const deps = c.prerequisites.map(resourceKey), scriptDeps = c.script.dependsOn.map(resourceKey);
        if (new Set(deps).size !== deps.length || new Set(scriptDeps).size !== scriptDeps.length || JSON.stringify([...deps].sort()) !== JSON.stringify([...scriptDeps].sort()))
            throw Error('脚本与前置用例不一致或重复。');
        for (const dep of deps) if (!cases.has(dep) || dep === resourceKey(c)) throw Error('前置用例不存在或引用自身。');
    }
    for (const m of bundle.modules) {
        const ids = new Set(bundle.cases.filter(c => c.moduleId === m.id).map(c => c.id));
        if (!ids.size) throw Error('资源模块不能为空。');
        for (const selection of [m.coreCaseIds, m.starterCaseIds]) if (selection && (new Set(selection).size !== selection.length || selection.some(id => !ids.has(id)))) throw Error('执行范围包含未知或重复用例。');
    }
    const visiting = new Set<string>(), done = new Set<string>();
    const visit = (key: string) => {
        if (visiting.has(key)) throw Error('前置用例形成循环。');
        if (done.has(key)) return;
        visiting.add(key);
        for (const dep of cases.get(key)!.prerequisites) visit(resourceKey(dep));
        visiting.delete(key); done.add(key);
    };
    for (const key of cases.keys()) visit(key);
    if (new Set(bundle.chains.map(c => c.id)).size !== bundle.chains.length) throw Error('核心链路编号重复。');
    for (const c of bundle.chains) {
        if (new Set(c.steps.map(s => s.id)).size !== c.steps.length) throw Error('链路步骤编号重复。');
        for (const s of c.steps) for (const id of s.caseIds) if (!bundle.cases.some(c => c.id === id)) throw Error('链路引用了不存在的用例。');
    }
    return bundle;
}

export function compareProjectResources(before: ProjectResources, after: ProjectResources) {
    const old = new Map(before.cases.map(c => [resourceKey(c), c])), next = new Map(after.cases.map(c => [resourceKey(c), c]));
    return {
        added: [...next.keys()].filter(k => !old.has(k)),
        removed: [...old.keys()].filter(k => !next.has(k)),
        changed: [...next.keys()].filter(k => old.has(k) && resourceDigest(old.get(k)) !== resourceDigest(next.get(k))),
        unchanged: [...next.keys()].filter(k => old.has(k) && resourceDigest(old.get(k)) === resourceDigest(next.get(k))),
    };
}
