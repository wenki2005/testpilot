import type { CaseComparison, DocumentProject, DocumentRun, DocumentRunMode, LaneResult } from '../../domain/document-test-model.js';

export interface DocumentRunResultSummaryPorts {
  analyzeDifferences(project: DocumentProject, comparisons: CaseComparison[], deterministic: LaneResult, computerUse: LaneResult): Promise<string>;
  summarizeAligned(project: DocumentProject, run: DocumentRun): Promise<string>;
}

export function createDocumentRunResultSummaryService(ports: DocumentRunResultSummaryPorts) {
  return {
    async summarize(input: {
      project: DocumentProject;
      run: DocumentRun;
      comparisons: CaseComparison[];
      deterministic: LaneResult;
      computerUse: LaneResult;
      runMode: DocumentRunMode;
      finalReady: boolean;
      aborted: boolean;
      onReportStage?: (() => Promise<void>) | undefined;
    }): Promise<{ analysis: string; reportSummary: string }> {
      const { project, run, comparisons, deterministic, computerUse, runMode, finalReady, aborted, onReportStage } = input;
      const analysis = aborted
        ? '本轮运行已手动取消。已保留停止前完成的逐用例结果；当前用例标记取消，未执行的用例标记未运行，可从本轮结果定向重跑。'
        : runMode === 'regression'
          ? '常规回归模式不调用模型。请依据逐用例结果和保存的执行证据区分产品缺陷、测试数据问题、环境问题或过期用例。'
          : await ports.analyzeDifferences(project, comparisons, deterministic, computerUse);

      const reportSummary = aborted
        ? `本轮运行已取消：已完成 ${comparisons.filter(item => item.deterministic === 'passed' || item.deterministic === 'failed').length} 条确定性结果；取消/未运行 ${comparisons.filter(item => item.deterministic === 'cancelled' || item.deterministic === 'not-run' || item.computerUse === 'cancelled' || item.computerUse === 'not-run' || item.apiContract === 'cancelled' || item.apiContract === 'not-run').length} 条。未运行项不会被计为通过。`
        : runMode === 'regression'
          ? `常规回归完成：通过 ${comparisons.filter(item => item.resolution === 'aligned' && (item.deterministic === 'passed' || item.deterministic === 'not-applicable' && item.apiContract === 'passed') && (!item.apiContract || item.apiContract === 'passed')).length} 条；失败 ${comparisons.filter(item => item.deterministic === 'failed' || item.apiContract === 'failed').length} 条；未验证 ${comparisons.filter(item => item.resolution === 'unresolved').length} 条；N/A ${comparisons.filter(item => item.resolution === 'not-applicable').length} 条。失败和阻塞均保留逐用例结果，不会被算作通过。`
          : finalReady
            ? '本轮所需执行路径均按用例 ID 得到确定结论。API contract 路由由已审核 API runner 验证；浏览器 UI 路由由对应浏览器 lane 验证。以下报告不代表已覆盖应用的所有缺陷。'
            : `本轮为${run.overall === 'partial' ? '部分运行' : '未完成运行'}：已验证且结论一致 ${comparisons.filter(item => item.resolution === 'aligned').length} 条；真实结果不一致 ${comparisons.filter(item => item.resolution === 'mismatch').length} 条；尚未验证 ${comparisons.filter(item => item.resolution === 'unresolved').length} 条；范围外 N/A ${comparisons.filter(item => item.resolution === 'not-applicable').length} 条。blocked 表示未能判定，不算通过或产品失败；请根据逐用例证据复核后决定是否重测。`;

      if (!aborted) await onReportStage?.();
      if (!aborted && runMode === 'compare' && finalReady) {
        try { return { analysis, reportSummary: await ports.summarizeAligned(project, run) }; }
        catch (error) { return { analysis, reportSummary: reportSummary + `\n\nAI 摘要未能生成，以下逐用例报告由 TestPilot 根据执行记录生成。原因：${error instanceof Error ? error.message : String(error)}` }; }
      }
      return { analysis, reportSummary };
    },
  };
}
