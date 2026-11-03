import type { DocumentProjectRepository } from "../ports/document-project-repository.js";
import type { DocumentProject, DocumentRun, DocumentRunScopePlan, DocumentSiteVersion } from "../../domain/document-test-model.js";
import { validateDocumentRunScopePlan } from "../../domain/document-run-scope.js";

export type DocumentRunExecutionInput = {
  selectedCaseIds?: string[];
  scopePlan?: DocumentRunScopePlan;
  siteVersionSnapshot?: DocumentSiteVersion;
};

export type DocumentRunExecutor<T extends DocumentRunExecutionInput> =
  (project: DocumentProject, options: T) => Promise<DocumentRun>;

/** Application use case that loads, validates, freezes and then executes one project snapshot. */
export function createDocumentRunApplicationService<T extends DocumentRunExecutionInput>(
  dependencies: Pick<DocumentProjectRepository, "getProject"> & { executor: DocumentRunExecutor<T> },
) {
  return {
    async execute(projectId: string, options: T): Promise<DocumentRun> {
      const project = await dependencies.getProject(projectId);
      if (!project) throw new Error("找不到指定的文档测试项目。");
      if (project.reviewStatus !== "approved") throw new Error("项目尚未审核通过，不能启动测试运行。");
      if (options.selectedCaseIds !== undefined) {
        const selected = options.selectedCaseIds;
        if (!Array.isArray(selected) || selected.length === 0 || new Set(selected).size !== selected.length) throw new Error("运行范围必须包含非空且不重复的用例 ID。");
        const available = new Set(project.cases.map(item => item.id));
        if (selected.some(id => !available.has(id))) throw new Error("运行范围包含当前项目中不存在的用例 ID。");
      }
      const selectedCaseIds = options.selectedCaseIds ?? project.cases.filter(item => item.selectedForRegression !== false && item.lifecycleStatus !== "draft" && item.lifecycleStatus !== "disabled").map(item => item.id);
      const scopePlan = validateDocumentRunScopePlan(options.scopePlan, selectedCaseIds);
      const frozenProject = structuredClone(project);
      if (options.siteVersionSnapshot) frozenProject.targetUrl = options.siteVersionSnapshot.targetUrl;
      return dependencies.executor(frozenProject, { ...options, ...(scopePlan ? { scopePlan } : {}) });
    },
  };
}
