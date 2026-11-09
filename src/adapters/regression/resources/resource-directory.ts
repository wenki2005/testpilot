import fs from 'node:fs';
import path from 'node:path';
import { validateProjectResources, resourceDigest, type ProjectResources } from './project-resource-contract.js';
import { createHash } from 'node:crypto';

/** Read individual definition files; never accepts a file outside the selected directory. */
export function readResourceDirectory(directory: string, allowEdits = false): { resources: ProjectResources; modifiedFiles: string[] } {
    const root = fs.realpathSync(directory);
    const read = (relative: string) => {
        if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => !p || p === '.' || p === '..')) throw Error('资源路径无效。');
        const file = path.join(root, relative), resolved = fs.realpathSync(file);
        if (!resolved.startsWith(root + path.sep) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) throw Error('资源包含越界路径或目录联接。');
        const bytes = fs.readFileSync(resolved);
        if (bytes.length > 8 * 1024 * 1024) throw Error('单个资源文件不能超过8MB。');
        return bytes;
    };
    const parse = (relative: string) => JSON.parse(read(relative).toString('utf8'));
    const manifest = parse('manifest.json') as { files: Array<{ file: string; sha256: string }> };
    if (!Array.isArray(manifest.files) || manifest.files.length > 6000) throw Error('资源清单无效。');
    const modifiedFiles: string[] = [];
    for (const file of manifest.files) if (createHash('sha256').update(read(file.file)).digest('hex') !== file.sha256) modifiedFiles.push(file.file);
    if (modifiedFiles.length && !allowEdits) throw Error('资源摘要与清单不一致；若为有意修改，请使用--allow-edits并预览差异。');
    const project = parse('project.json') as { id: string; name: string };
    const modules = parse('modules.json') as Array<{ id: string; name: string; directory: string; caseKeys: string[]; coreCaseIds?: string[]; starterCaseIds?: string[] }>;
    if (!Array.isArray(modules) || modules.length > 100) throw Error('模块清单无效。');
    const cases: ProjectResources['cases'] = [];
    for (const m of modules) {
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(m.directory) || !Array.isArray(m.caseKeys)) throw Error('模块目录或用例索引无效。');
        for (const key of m.caseKeys) {
            const id = key.slice(m.id.length + 1);
            if (!key.startsWith(m.id + ':') || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw Error('用例路径无效。');
            const c = parse('cases/' + m.directory + '/' + id + '.json');
            const script = parse('scripts/' + m.directory + '/' + id + '.json');
            if (c.moduleId !== m.id || script.moduleId !== m.id || c.id !== id || script.caseId !== id || c.versionId !== script.versionId) throw Error('用例、脚本与版本索引不一致。');
            cases.push({ ...(c.priority ? { priority: c.priority } : {}), ...(c.sourceId ? { sourceId: c.sourceId } : {}), ...(c.scriptReview ? { scriptReview: c.scriptReview } : {}), id: c.id, moduleId: c.moduleId, title: c.title, expected: c.expected, manualSteps: c.manualSteps, prerequisites: c.prerequisites, ...(c.prerequisiteReview ? { prerequisiteReview: c.prerequisiteReview } : {}), sourcePath: c.sourcePath, sourceExpected: c.sourceExpected, script: { caseId: script.caseId, dependsOn: script.dependsOn, steps: script.steps } });
        }
    }
    const chains = manifest.files.filter(f => /^chains\/[A-Za-z0-9_-]+\.json$/.test(f.file)).map(f => parse(f.file));
    const resources = validateProjectResources({ schema: 1, project: { id: project.id, name: project.name }, modules: modules.map(m => ({ id: m.id, name: m.name, ...(m.coreCaseIds ? { coreCaseIds: m.coreCaseIds } : {}), ...(m.starterCaseIds ? { starterCaseIds: m.starterCaseIds } : {}) })), cases, chains });
    // Materialize a digest here as a final serialization sanity check.
    resourceDigest(resources);
    return { resources, modifiedFiles };
}
