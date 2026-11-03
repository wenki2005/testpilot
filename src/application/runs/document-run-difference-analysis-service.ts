import type { CaseComparison, DocumentProject, LaneResult } from "../../domain/document-test-model.js";
import type { ChatModelPort } from "../ports/chat-model.js";

export function createDocumentRunDifferenceAnalysisService(chat: Pick<ChatModelPort, "complete">) {
  return {
    async analyze(project: DocumentProject, comparisons: CaseComparison[], deterministic: LaneResult, computerUse: LaneResult): Promise<string> {
      const pending = comparisons.filter(item => !item.aligned);
      if (!pending.length) return "兩個通道逐用例结果一致，本轮无需重测。";
      try {
        const response = await chat.complete([
          { role: "system", content: "你是 QA 差异分析助手。只根据输入的确定性脚本结果和视觉 Computer Use 结果判断差异原因；两者在本轮共享浏览器页面和登录态，不能把它们称为隔离会话中的独立复现。给出下一步：需要重测、需要修订定位/脚本、需要澄清预期、或疑似产品缺陷。不得自行修改或批准测试用例，不得声称证据未提供的事实。blocked 表示未能判定，不是产品失败。逐项引用用例 ID，优先建议最小核查动作。中文输出，最多 10 条建议。" },
          { role: "user", content: JSON.stringify({ targetUrl: project.targetUrl, cases: project.cases.filter(testCase => pending.some(item => item.id === testCase.id)).map(testCase => ({
            id: testCase.id, title: testCase.title, source: testCase.source, expected: testCase.expected,
            comparison: pending.find(item => item.id === testCase.id),
            deterministicEvidence: deterministic.results.find(result => result.id === testCase.id)?.detail.slice(0, 1800),
            computerUseEvidence: computerUse.results.find(result => result.id === testCase.id)?.detail.slice(0, 1800),
          })) }) },
        ], { maxTokens: 900, timeoutMs: 40_000 });
        const content = response && typeof response === "object" && "content" in response ? response.content : undefined;
        const text = typeof content === "string" ? content.trim() : "";
        if (text) return text;
      } catch { /* Static advice remains available when the model is offline. */ }
      return pending.map(item => `- ${item.id} ${item.title}：脚本 ${item.deterministic} / Computer Use ${item.computerUse}。先核对页面现状与预期，再决定修订步骤或重测；不要把 blocked 当成产品失败。`).join("\n");
    },
  };
}
