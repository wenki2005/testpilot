import { documentProjectPlatformTemplates, type DocumentProject, type DocumentProjectExecutionConfig, type DocumentProjectPlatform, type DocumentTestDataSet } from '../../domain/document-test-model.js';
import type { DocumentProjectRepository } from '../ports/document-project-repository.js';
import { validateDocumentCaseOrder } from '../../domain/document-case-order.js';

export function createDocumentProjectUpdateService(deps: {
  projects: Pick<DocumentProjectRepository, 'saveProject'>;
  validateTarget(targetUrl: unknown): string;
  validateCases(value: unknown, existing: DocumentProject['cases']): DocumentProject['cases'];
  containsCredentialLikeValue(value: string): boolean;
  requiresManualReview(project: DocumentProject): boolean;
  hasAutoRunnableSelectedCase(cases: DocumentProject['cases']): boolean;
  now(): string;
}) {
  return {
    async update(project: DocumentProject, input: unknown): Promise<DocumentProject> {
      const data = input as Record<string, any> | null;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('更新内容必须是对象。');
      // Saving metadata is not a review of a previously drafted case set or
      // platform. Only the established case-update/review paths may advance it.
      const preserveDraftReview = project.reviewStatus === 'draft' && data.cases === undefined;
      let platformChanged = false;
      if (data.platform !== undefined) {
        if (data.platform !== 'pc-web' && data.platform !== 'mobile-web' && data.platform !== 'wecom-workbench') throw new Error('项目端类型必须是 PC 网页、移动网页或企微工作台中的明确选择。');
        const platform = data.platform as Exclude<DocumentProjectPlatform, 'unknown'>;
        if (project.platform?.type !== platform || project.platform.status !== 'confirmed' || (platform === 'mobile-web' && project.executionConfig?.isMobile !== true)) {
          platformChanged = true;
          project.platform = { type: platform, status: 'confirmed', confirmedAt: deps.now() };
          project.executionConfig = { ...structuredClone(documentProjectPlatformTemplates[platform]), entryUrl: project.targetUrl } satisfies DocumentProjectExecutionConfig;
          project.reviewStatus = 'draft';
          project.reviewNotes = '项目端类型已由用户确认；请按对应入口与视口复核用例后重新审核。';
          delete project.stepAuthoring;
        }
      }
      if (data.targetUrl !== undefined) {
        const updatedTargetUrl = deps.validateTarget(data.targetUrl);
        if ((project.siteVersions?.length ?? 0) > 0 && updatedTargetUrl !== project.targetUrl) {
          throw new Error('该项目已启用网站版本记录；请登记一个新版本来变更网址，不能直接改写项目目标网址。');
        }
        if (updatedTargetUrl !== project.targetUrl) {
          project.targetUrl = updatedTargetUrl;
          delete project.stepAuthoring;
        }
      }
      if (data.cases !== undefined) {
        const validatedCases = deps.validateCases(data.cases, project.cases);
        validateDocumentCaseOrder(validatedCases);
        project.cases = validatedCases;
        // Keep the authoring evidence as a historical review record. The UI
        // compares its case/step digests with the edited version and marks it
        // stale when needed; dropping it here would hide the source trace.
      }
      if (data.testDataSets !== undefined) {
        if (!Array.isArray(data.testDataSets) || data.testDataSets.length > 50) throw new Error('测试数据组必须是最多 50 组的数组。');
        const previous = new Map((project.testDataSets ?? []).map(item => [item.id, item]));
        const ids = new Set<string>();
        const names = new Set<string>();
        project.testDataSets = data.testDataSets.map((item: unknown, index: number): DocumentTestDataSet => {
          const candidate = item as Record<string, any> | null;
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
              Object.keys(candidate).some(key => !['id', 'name', 'values', 'createdAt', 'updatedAt'].includes(key)) ||
              typeof candidate.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidate.id) ||
              typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.trim().length > 80 ||
              !candidate.values || typeof candidate.values !== 'object' || Array.isArray(candidate.values) || Object.keys(candidate.values).length > 100) {
            throw new Error('第 ' + (index + 1) + ' 组测试数据无效。');
          }
          const name = candidate.name.trim();
          if (ids.has(candidate.id) || names.has(name.toLocaleLowerCase())) throw new Error('测试数据组 ID 和名称必须唯一。');
          ids.add(candidate.id); names.add(name.toLocaleLowerCase());
          const values: Record<string, string> = {};
          for (const [key, value] of Object.entries(candidate.values)) {
            if (!/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/u.test(key) || /(?:pass(?:word|code)?|pwd|token|secret|cookie|auth|credential|api.?key)/iu.test(key) || typeof value !== 'string' || value.length > 500) {
              throw new Error('第 ' + (index + 1) + ' 组测试数据包含无效或敏感参数「' + key + '」；不要保存密码、令牌或认证信息。');
            }
            if (deps.containsCredentialLikeValue(value)) throw new Error('第 ' + (index + 1) + ' 组测试数据中的「' + key + '」疑似含有令牌、Cookie 或认证凭据；请改用合成测试数据。');
            values[key] = value;
          }
          const saved = previous.get(candidate.id);
          const now = deps.now();
          return { id: candidate.id, name, values, createdAt: saved?.createdAt ?? now, updatedAt: now };
        });
      }
      if (data.apiContract !== undefined) {
        const config = data.apiContract;
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('apiContract 必须是对象。');
        if (config.suiteId !== undefined && (typeof config.suiteId !== 'string' || !/^[0-9a-f-]{36}$/i.test(config.suiteId))) throw new Error('apiContract.suiteId 必须是有效的候选 UUID。');
        if (['allowNetwork', 'allowMutations', 'allowConcurrency'].some(key => config[key] !== undefined && typeof config[key] !== 'boolean')) throw new Error('API 网络、写请求和并发授权必须分别使用布尔值。');
        if (config.mappings !== undefined && (!Array.isArray(config.mappings) || config.mappings.some((entry: any) => !entry || typeof entry.documentCaseId !== 'string' || !Array.isArray(entry.apiCaseIds) || entry.apiCaseIds.some((id: unknown) => typeof id !== 'string')))) {
          throw new Error('apiContract.mappings 必须包含 documentCaseId 和 apiCaseIds 字符串数组。');
        }
        project.apiContract = {
          ...(config.suiteId ? { suiteId: config.suiteId } : {}),
          allowNetwork: config.allowNetwork === true, allowMutations: config.allowMutations === true,
          allowConcurrency: config.allowConcurrency === true, mappings: config.mappings ?? [],
        };
      }
      if (platformChanged || preserveDraftReview) {
        project.reviewStatus = 'draft';
      } else if (project.confirmationRequired !== true && !deps.requiresManualReview(project) && deps.hasAutoRunnableSelectedCase(project.cases)) {
        project.reviewStatus = 'approved';
        project.reviewNotes = '用户选择自动运行：仅已就绪的只读用例通过服务端安全门后自动执行；缺步骤、预期不足、风险未定或依赖缺失的用例保留为阻塞。';
      } else {
        project.reviewStatus = 'draft';
        project.reviewNotes = '';
      }
      project.updatedAt = deps.now();
      await deps.projects.saveProject(project);
      return project;
    },
  };
}
