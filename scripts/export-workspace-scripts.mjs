#!/usr/bin/env node
// Generate owner-specific script indexes from migrated local data. Does not
// execute a case. Generated files remain in ignored runtime-data/<owner>/script-index.
import { spawnSync } from 'node:child_process';
import { readdir, readFile, mkdir, writeFile, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { argument, repoRoot, workspaceNames, workspacePaths } from './lib/integrated-workspaces.mjs';
import { slugify, safeCaseFile } from './lib/regression-scripts-layout.mjs';
const requested = argument('workspace'), selected = requested ? [workspacePaths(requested)] : workspaceNames.map(workspacePaths);
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const markdownPath = value => value.split('/').map(encodeURIComponent).join('/');
for (const workspace of selected) {
    await mkdir(workspace.scripts, { recursive: true });
    if (workspace.owner === 'dify') {
        const output = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'export-regression-scripts.mjs'), '--base-url', `http://127.0.0.1:${workspace.port}`, '--data-dir', workspace.root, '--out', workspace.scripts], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
        if (output.status !== 0)
            throw Error(output.stderr || 'Dify script index export failed.');
        console.log(output.stdout.trim());
        const index = JSON.parse(await readFile(path.join(workspace.scripts, '_index.json'), 'utf8'));
        const lines = ['# Dify 脚本索引', '', '只读生成镜像。原始来源是此数据区中的模块版本与有效缓存，不手改镜像。', `系统 ${index.totals.systems}，模块 ${index.totals.modules}，用例 ${index.totals.cases}。`, ''];
        for (const system of index.systems ?? []) {
            lines.push('## ' + system.name, '');
            const detail = JSON.parse(await readFile(path.join(workspace.scripts, system.dir, '_index.json'), 'utf8'));
            for (const module of detail.modules) {
                const data = JSON.parse(await readFile(path.join(workspace.scripts, module.dir, '_module.json'), 'utf8'));
                lines.push(`### ${module.name}${module.archived ? '（已归档）' : ''}`, `版本 ${module.version.version}，编号 ${module.version.id}`, '');
                for (const item of data.cases)
                    lines.push(`- [${item.id}：${item.title}](${markdownPath(module.dir + '/' + item.file)})（${item.stepCount} 步；${item.status}）`);
                lines.push('');
            }
        }
        lines.push('完整清单见 [_index.json](_index.json)。没有步骤的用例也保留，不能当作通过。', '');
        await writeFile(path.join(workspace.scripts, 'README.md'), lines.join('\n'));
    }
    else {
        const projectsDirectory = path.join(workspace.root, 'document-tests', 'projects');
        let files = [];
        try {
            files = (await readdir(projectsDirectory)).filter(file => file.endsWith('.json'));
        }
        catch { }
        const projects = [], currentFiles = new Set();
        for (const file of files) {
            const project = JSON.parse(await readFile(path.join(projectsDirectory, file), 'utf8'));
            const projectKey = slugify(project.name, project.id) + '-' + hash(String(project.id)).slice(0, 8), directory = path.join(workspace.scripts, projectKey);
            await mkdir(directory, { recursive: true });
            const cases = [], usedNames = new Set();
            for (const item of project.cases ?? []) {
                let name = safeCaseFile(String(item.id));
                if (usedNames.has(name))
                    name = name.replace(/\.json$/, '-' + hash(String(item.id)) + '.json');
                usedNames.add(name);
                currentFiles.add(path.join(directory, name));
                await writeFile(path.join(directory, name), JSON.stringify({ schema: 1, generated: true, workspace: 'web-regression', project: { id: project.id, name: project.name }, case: item, sourceFile: path.relative(workspace.root, path.join(projectsDirectory, file)).replaceAll('\\', '/'), note: 'Source project owns the case; no execution result is inferred from these saved steps.' }, null, 2) + '\n');
                cases.push({ id: item.id, title: item.title, steps: item.steps?.length ?? 0, path: projectKey + '/' + name });
            }
            projects.push({ id: project.id, name: project.name, cases });
        }
        const prune = async (directory) => {
            for (const entry of await readdir(directory, { withFileTypes: true })) {
                const file = path.resolve(directory, entry.name), relative = path.relative(workspace.scripts, file);
                if (relative.startsWith('..') || path.isAbsolute(relative))
                    throw Error('Index path escaped the workspace.');
                if (entry.isSymbolicLink())
                    throw Error('Linked script indexes are not supported.');
                if (entry.isDirectory())
                    await prune(file);
                else if (entry.isFile() && entry.name.endsWith('.json') && entry.name !== '_index.json' && !currentFiles.has(file)) {
                    const value = JSON.parse(await readFile(file, 'utf8'));
                    if (value.generated === true && value.workspace === 'web-regression')
                        await unlink(file);
                }
            }
        };
        await prune(workspace.scripts);
        const migrated = await access(workspace.manifest).then(() => true, () => false);
        const index = { schema: 1, workspace: 'web-regression', generatedAt: new Date().toISOString(), migrationStatus: migrated ? 'imported' : 'source-data-not-provided', projects };
        await writeFile(path.join(workspace.scripts, '_index.json'), JSON.stringify(index, null, 2) + '\n');
        await writeFile(path.join(workspace.scripts, 'README.md'), ['# 网页回归脚本索引', '', migrated ? '以下内容来自独立迁入的网页回归项目。' : '网页回归原数据暂缓迁入，待原任务运行结束后再处理；当前为独立空白数据区。', '', ...projects.flatMap(project => [`## ${project.name}`, '', ...project.cases.map(item => `- [${item.id}：${item.title}](${markdownPath(item.path)})（固定步骤 ${item.steps}）`), '']), '项目中的 cases 是准源；修改项目后重新导出。', ''].join('\n'));
        console.log(JSON.stringify({ workspace: workspace.owner, projects: projects.length, cases: projects.reduce((n, p) => n + p.cases.length, 0), migrationStatus: index.migrationStatus }));
    }
}
