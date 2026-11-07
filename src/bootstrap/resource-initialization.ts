import fs from 'node:fs';
import path from 'node:path';
import type { SystemModuleRegression } from '../adapters/regression/catalog/module-regression-service.js';
import { readResourceDirectory } from '../adapters/regression/resources/resource-directory.js';

export type ResourceInitialization = { status: 'initialized' | 'existing' | 'missing' | 'error' | 'disabled'; systemId?: string; message: string; modules?: number; cases?: number; chains?: number };

/** Never copies a runtime database or login profile into a newly installed instance. */
export async function initializeBundledResources(catalog: SystemModuleRegression, directory: string | undefined): Promise<ResourceInitialization> {
    if (!directory || process.env.TESTPILOT_AUTO_INITIALIZE === '0') return { status: 'disabled', message: '资源自动初始化未启用。' };
    try {
        if (!fs.existsSync(directory)) return { status: 'missing', message: '未找到内置项目资源；请检查安装包或TESTPILOT_RESOURCE_DIR。' };
        const project = JSON.parse(fs.readFileSync(path.join(directory, 'project.json'), 'utf8')) as { id?: string };
        if (project.id && catalog.state().systems.some(s => s.id === project.id)) return { status: 'existing', systemId: project.id, message: '已使用本机项目；未覆盖用例、记录或账号配置。' };
        const { resources } = readResourceDirectory(directory);
        const result = await catalog.initializeResources(resources, { targetUrl: process.env.TESTPILOT_RESOURCE_TARGET_URL ?? 'https://cdn.yibentushu.com/test-sample-apply/index.html#/home', environment: process.env.TESTPILOT_RESOURCE_ENVIRONMENT ?? '测试' });
        if (!result.initialized) return { status: 'existing', systemId: result.systemId, message: '已存在本机项目，未重复初始化。' };
        return { status: 'initialized', systemId: result.systemId, modules: resources.modules.length, cases: resources.cases.length, chains: resources.chains.length, message: '已加载内置用例和脚本；没有导入运行记录、截图或账号。' };
    } catch (error) { return { status: 'error', message: '资源初始化失败：' + (error instanceof Error ? error.message : '请检查资源版本和文件摘要。') }; }
}
