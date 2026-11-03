import type { BrowserCheck, BrowserStep, CasePriority, CaseLifecycleStatus, SideEffectRisk, CaseGenerationTrace } from "./document-test-model.js";
import { caseCategories, confidenceFromExpectation, inferCaseCategory, type CaseCategory, type CaseConfidence } from "./document-test-types.js";
import { normalizeDocumentCaseEntryPath } from "./document-case-entry.js";
import { planCaseExecution } from "./document-case-routing.js";
import { validateCaseGenerationTrace } from "./document-case-generation-trace.js";

const maxCases = 200;
export function validateCases(value: unknown): BrowserCheck[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxCases) throw new Error(`测试用例需为 1–${maxCases} 条。`);
  const seenCaseIds = new Set<string>();
  return value.map((item: any, i) => {
    if (!item || typeof item !== "object" || !["text", "visible", "field"].includes(item.kind) || typeof item.title !== "string" || !item.title.trim() || item.title.length > 500 || typeof item.expected !== "string" || item.expected.length > 12000 || typeof item.source !== "string" || item.source.length > 12000) throw new Error(`第 ${i + 1} 条用例无效。`);
    if (!Array.isArray(item.steps) || item.steps.length > 30) throw new Error(`第 ${i + 1} 条用例 steps 必须是最多 30 步的数组。`);
    const steps: BrowserStep[] = item.steps.map((step: any, j: number) => {
      if (!step || typeof step !== "object" || typeof step.action !== "string") throw new Error(`第 ${i + 1} 条第 ${j + 1} 步无效。`);
      const text = (key: string, max = 160) => { if (typeof step[key] !== "string" || !step[key].trim() || step[key].length > max) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 ${key} 无效。`); };
      if (step.action === "fillByLabel" || step.action === "selectByLabel") { text("label"); if (typeof step.value !== "string" || step.value.length > 500 || step.action === "selectByLabel" && !step.value.trim()) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 value 无效。`); if (step.rowIndex !== undefined && (!Number.isInteger(step.rowIndex) || step.rowIndex < 0 || step.rowIndex > 9)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 rowIndex 无效。`); return { action: step.action, label: step.label, value: step.value, ...(step.rowIndex === undefined ? {} : { rowIndex: step.rowIndex }) }; }
      if (step.action === "fillByPlaceholder") { text("placeholder"); if (typeof step.value !== "string" || step.value.length > 500) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 value 无效。`); return { action: step.action, placeholder: step.placeholder, value: step.value }; }
      if (step.action === "fillByRoleIndex") { if (step.role !== "combobox" || !Number.isInteger(step.index) || step.index < 0 || step.index > 20 || typeof step.value !== "string" || step.value.length > 500) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 role/index/value 无效。`); return { action: step.action, role: step.role, index: step.index, value: step.value }; }
      if (step.action === "blurByPlaceholder") { text("placeholder"); return { action: step.action, placeholder: step.placeholder }; }
      if (step.action === "selectByPlaceholder") { text("placeholder"); text("value"); return { action: step.action, placeholder: step.placeholder, value: step.value }; }
      if (step.action === "selectByRoleIndex" || step.action === "assertSelectedByRoleIndex") { if (step.role !== "combobox" || !Number.isInteger(step.index) || step.index < 0 || step.index > 9) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 role/index 无效。`); text("value"); return { action: step.action, role: step.role, index: step.index, value: step.value }; }
      if (step.action === "blurByLabel") { text("label"); if (step.rowIndex !== undefined && (!Number.isInteger(step.rowIndex) || step.rowIndex < 0 || step.rowIndex > 9)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 rowIndex 无效。`); return { action: step.action, label: step.label, ...(step.rowIndex === undefined ? {} : { rowIndex: step.rowIndex }) }; }
      if (step.action === "clickByRole") {
        text("name");
        if (!["button", "radio", "checkbox", "tab", "link"].includes(step.role) || /提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|submit|save|delete|pay|checkout|confirm|place\s*order|send|reset|log\s*out/i.test(step.name)) throw new Error("点击步骤只能使用安全控件名称，禁止提交、保存、删除、支付、确认等动作。");
        return { action: step.action, role: step.role, name: step.name };
      }
      if (step.action === "triggerClientValidation") { text("name"); return { action: step.action, name: step.name }; }
      if (step.action === "clickExactText") {
        text("text");
        if (/提交|保存|删除|支付|付款|确认|下单|发送|重置|退出|注销|submit|save|delete|pay|checkout|confirm|place\s*order|send|reset|log\s*out/i.test(step.text)) throw new Error("点击步骤只能使用安全文本，禁止提交、保存、删除、支付、确认等动作。");
        return { action: step.action, text: step.text };
      }
      if (step.action === "deleteSampleRow") {
        if (step.rowIndex !== undefined && (!Number.isInteger(step.rowIndex) || step.rowIndex < 0 || step.rowIndex > 9)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 rowIndex 无效。`);
        return { action: step.action, ...(step.rowIndex === undefined ? {} : { rowIndex: step.rowIndex }) };
      }
      if (step.action === "assertText" || step.action === "assertVisible") { text("text"); return { action: step.action, text: step.text }; }
      if (step.action === "assertNotVisible") { text("text"); return { action: step.action, text: step.text }; }
      if (step.action === "assertExactVisible") { text("text"); return { action: step.action, text: step.text }; }
      if (step.action === 'goBack') return {action:'goBack'};
      if (step.action === 'assertControlEnabled') {text('text');return {action:'assertControlEnabled',text:step.text};}
      if (step.action === "assertRoleVisible") { text("name"); if (!["button", "radio", "checkbox", "tab", "link"].includes(step.role)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 role 无效。`); return { action: step.action, role: step.role, name: step.name }; }
      if (step.action === "assertValue") { text("label"); if (typeof step.value !== "string" || step.value.length > 500) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 value 无效。`); if (step.rowIndex !== undefined && (!Number.isInteger(step.rowIndex) || step.rowIndex < 0 || step.rowIndex > 9)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 rowIndex 无效。`); return { action: step.action, label: step.label, value: step.value, ...(step.rowIndex === undefined ? {} : { rowIndex: step.rowIndex }) }; }
      if (step.action === "assertValueByPlaceholder") { text("placeholder"); if (typeof step.value !== "string" || step.value.length > 500) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 value 无效。`); return { action: step.action, placeholder: step.placeholder, value: step.value }; }
      if (step.action === "assertDisabled") { text("label"); return { action: step.action, label: step.label }; }
      if (step.action === "assertFieldInvalid") { text("label"); if (step.rowIndex !== undefined && (!Number.isInteger(step.rowIndex) || step.rowIndex < 0 || step.rowIndex > 9)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 rowIndex 无效。`); return { action: step.action, label: step.label, ...(step.rowIndex === undefined ? {} : { rowIndex: step.rowIndex }) }; }
      if (step.action === "captureCurrentUrl" || step.action === "assertCurrentUrlUnchanged") return { action: step.action };
      if (step.action === "assertRoleDisabled") { text("name"); if (!(["button", "radio", "checkbox", "tab", "link"].includes(step.role))) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 role 无效。`); return { action: step.action, role: step.role, name: step.name }; }
      if (step.action === "assertMaxLengthOrMessage") { text("label"); text("message", 120); if (!Number.isInteger(step.maxLength) || step.maxLength < 1 || step.maxLength > 500) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 maxLength 无效。`); return { action: step.action, label: step.label, maxLength: step.maxLength, message: step.message }; }
      if (step.action === "startFetchOrXhrCapture") return { action: step.action };
      if (step.action === "assertNoFetchOrXhr") { if (step.quietMs !== undefined && (!Number.isInteger(step.quietMs) || step.quietMs < 250 || step.quietMs > 5000)) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 quietMs 必须在 250–5000 毫秒之间。`); return { action: step.action, ...(step.quietMs === undefined ? {} : { quietMs: step.quietMs }) }; }
      if (step.action === "assertNoHorizontalOverflow") return { action: step.action };
      if (step.action === "setViewport") { if (!Number.isInteger(step.width) || !Number.isInteger(step.height) || step.width < 320 || step.width > 1920 || step.height < 480 || step.height > 1600) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 viewport 超出允许范围。`); return { action: step.action, width: step.width, height: step.height }; }
      if (step.action === "scrollToRatio") { if (typeof step.ratio !== "number" || !Number.isFinite(step.ratio) || step.ratio < 0 || step.ratio > 1) throw new Error(`第 ${i + 1} 条第 ${j + 1} 步滚动比例必须在 0–1 之间。`); return { action: step.action, ratio: step.ratio }; }
      if (step.action === "setReducedMotion") { if (typeof step.value !== "boolean") throw new Error(`第 ${i + 1} 条第 ${j + 1} 步 reducedMotion 必须是布尔值。`); return { action: step.action, value: step.value }; }
      throw new Error(`不支持的浏览器动作：${step.action}`);
    });
    const networkAssertionIndex = steps.findIndex(step => step.action === "assertNoFetchOrXhr");
    if (networkAssertionIndex >= 0) {
      const captureIndex = steps.findIndex(step => step.action === "startFetchOrXhrCapture");
      const firstInteractionIndex = steps.findIndex(step => ["fillByLabel", "fillByPlaceholder", "fillByRoleIndex", "blurByLabel", "blurByPlaceholder", "selectByLabel", "selectByPlaceholder", "selectByRoleIndex", "clickByRole", "clickExactText", "triggerClientValidation"].includes(step.action));
      const hasLaterInteraction = steps.slice(networkAssertionIndex + 1).some(step => ["fillByLabel", "fillByPlaceholder", "fillByRoleIndex", "blurByLabel", "blurByPlaceholder", "selectByLabel", "selectByPlaceholder", "selectByRoleIndex", "clickByRole", "clickExactText", "triggerClientValidation"].includes(step.action));
      if (captureIndex < 0 || firstInteractionIndex >= 0 && captureIndex > firstInteractionIndex) throw new Error(`第 ${i + 1} 条用例必须在首个用户操作前启动 fetch/XHR 捕获。`);
      if (hasLaterInteraction) throw new Error(`第 ${i + 1} 条用例的 fetch/XHR 断言必须放在最后一个用户操作之后。`);
    }
    const stringList = (key: string, fallback: string[], maxItems = 10): string[] => {
      const raw = item[key] === undefined ? fallback : item[key];
      if (!Array.isArray(raw) || raw.length > maxItems || raw.some(value => typeof value !== "string" || value.length > 500)) throw new Error(`第 ${i + 1} 条用例 ${key} 必须是最多 ${maxItems} 条、每条不超过 500 字的字符串数组。`);
      return raw.map(value => value.trim()).filter(Boolean);
    };
    const priority = item.priority === undefined ? "P2" : item.priority;
    if (!["P0", "P1", "P2", "P3"].includes(priority)) throw new Error(`第 ${i + 1} 条用例 priority 必须是 P0–P3。`);
    const category = item.category === undefined ? inferCaseCategory(`${item.title} ${item.source}`) : item.category;
    if (!caseCategories.includes(category)) throw new Error(`第 ${i + 1} 条用例 category 无效。`);
    const confidence = item.confidence === undefined ? confidenceFromExpectation(item.expected) : item.confidence;
    if (confidence !== "high" && confidence !== "medium" && confidence !== "low") throw new Error(`第 ${i + 1} 条用例 confidence 必须是 high、medium 或 low。`);
    const suppliedCoverageAreas = stringList("coverageAreas", [category], caseCategories.length);
    if (suppliedCoverageAreas.some((area): area is string => !caseCategories.includes(area as CaseCategory))) throw new Error(`第 ${i + 1} 条用例 coverageAreas 包含未知分类。`);
    const coverageAreas = [...new Set<CaseCategory>([category, ...suppliedCoverageAreas as CaseCategory[]])];
    const rawModulePath = item.modulePath === undefined ? [] : item.modulePath;
    if (!Array.isArray(rawModulePath) || rawModulePath.length > 8 || rawModulePath.some(value => typeof value !== "string" || !value.trim() || value.trim().length > 120)) throw new Error(`第 ${i + 1} 条用例 modulePath 必须是最多 8 层、每层 1–120 字的业务模块路径。`);
    const modulePath = rawModulePath.map((value: string) => value.trim());
    const rawDependencies = item.dependsOnCaseIds === undefined ? [] : item.dependsOnCaseIds;
    if (!Array.isArray(rawDependencies) || rawDependencies.length > 50 || rawDependencies.some((id: unknown) => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(id)) || new Set(rawDependencies).size !== rawDependencies.length) throw new Error(`第 ${i + 1} 条用例 dependsOnCaseIds 必须是最多 50 个唯一、有效用例 ID。`);
    const dependsOnCaseIds = [...rawDependencies] as string[];
    const rawTags = item.tags === undefined ? [] : item.tags;
    if (!Array.isArray(rawTags) || rawTags.length > 20 || rawTags.some(value => typeof value !== "string" || value.trim().length > 40)) throw new Error(`第 ${i + 1} 条用例 tags 必须是最多 20 项、每项 1–40 字的字符串数组。`);
    const tags = [...new Set<string>(rawTags.map((value: string) => value.trim()).filter(Boolean))];
    const entryPath = normalizeDocumentCaseEntryPath(item.entryPath);
    if (item.selectedForRegression !== undefined && typeof item.selectedForRegression !== "boolean") throw new Error(`第 ${i + 1} 条用例 selectedForRegression 必须为布尔值。`);
    const lifecycleStatus = item.lifecycleStatus;
    if (lifecycleStatus !== undefined && !["draft", "runnable", "disabled"].includes(lifecycleStatus)) throw new Error(`第 ${i + 1} 条用例 lifecycleStatus 必须是 draft、runnable 或 disabled。`);
    if (lifecycleStatus !== undefined && lifecycleStatus !== "runnable" && item.selectedForRegression === true) throw new Error(`第 ${i + 1} 条用例处于草稿或停用状态，不能同时纳入本轮回归。`);
    const sideEffectRisk = item.sideEffectRisk === undefined ? "unknown" : item.sideEffectRisk;
    if (!["none", "reversible", "irreversible", "unknown"].includes(sideEffectRisk)) throw new Error(`第 ${i + 1} 条用例 sideEffectRisk 无效。`);
    if (item.preconditionsConfirmed !== undefined && typeof item.preconditionsConfirmed !== "boolean") throw new Error(`第 ${i + 1} 条用例 preconditionsConfirmed 必须为布尔值。`);
    const cleanup = item.cleanup === undefined ? "" : item.cleanup;
    if (typeof cleanup !== "string" || cleanup.length > 1000) throw new Error(`第 ${i + 1} 条用例 cleanup 必须是不超过 1000 字的字符串。`);
    const caseOrigin = item.caseOrigin;
    if (caseOrigin !== undefined && !["held-out-benchmark", "ai-generated", "document-derived", "manual", "iteration-impact-draft"].includes(caseOrigin)) throw new Error(`第 ${i + 1} 条用例 caseOrigin 无效。`);
    const caseGenerationTrace = item.caseGenerationTrace === undefined ? undefined : validateCaseGenerationTrace(item.caseGenerationTrace);
    // explorationEvidence is intentionally not trusted from model, import, or API input.
    const rawDataRequirements = item.testDataRequirements === undefined ? [] : item.testDataRequirements;
    if (!Array.isArray(rawDataRequirements) || rawDataRequirements.length > 30) throw new Error(`第 ${i + 1} 条用例 testDataRequirements 必须是最多 30 项的数组。`);
    const requirementKeys = new Set<string>();
    const testDataRequirements = rawDataRequirements.map((requirement: any, index: number) => {
      if (!requirement || typeof requirement !== "object" || typeof requirement.key !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/u.test(requirement.key.trim()) || typeof requirement.description !== "string" || !requirement.description.trim() || requirement.description.length > 240 || (requirement.source !== undefined && (typeof requirement.source !== "string" || requirement.source.length > 500)) || typeof requirement.required !== "boolean") throw new Error(`第 ${i + 1} 条用例测试数据要求 ${index + 1} 无效。`);
      const key = requirement.key.trim();
      if (/(?:pass(?:word|code)?|pwd|token|secret|cookie|auth|credential|api.?key)/iu.test(key)) throw new Error(`第 ${i + 1} 条用例测试数据字段「${key}」可能是认证凭据，禁止保存。`);
      if (requirementKeys.has(key)) throw new Error(`第 ${i + 1} 条用例测试数据字段「${key}」重复。`);
      requirementKeys.add(key);
      return { key, description: requirement.description.trim(), ...(requirement.source?.trim() ? { source: requirement.source.trim() } : {}), required: requirement.required };
    });
    if (item.coverageGap !== undefined && (typeof item.coverageGap !== "string" || item.coverageGap.length > 1000)) throw new Error(`第 ${i + 1} 条用例 coverageGap 必须是不超过 1000 字的字符串。`);
    const caseId = item.id === undefined ? `case-${i + 1}` : item.id;
    if (typeof caseId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/u.test(caseId)) throw new Error(`第 ${i + 1} 条用例 ID 无效；须为 1–80 位字母、数字、下划线、点、冒号或连字符。`);
    if (seenCaseIds.has(caseId)) throw new Error(`第 ${i + 1} 条用例 ID「${caseId}」重复；每个项目内的用例 ID 必须唯一。`);
    seenCaseIds.add(caseId);
    if(item.requiredAssertions !== undefined && (!Array.isArray(item.requiredAssertions) || item.requiredAssertions.length>15 || item.requiredAssertions.some((value:unknown)=>typeof value!=='string' || !value.trim() || value.length>160 || !item.expected.includes(value))))throw new Error('明确验收值必须是预期原文中最多15个非空文字片段。');
    for(const key of ['authorizedWriteOperationId','writeResultOperationId'])if(item[key]!==undefined && (typeof item[key]!=='string' || !/^[A-Za-z0-9_-]{1,80}$/.test(item[key])))throw new Error('单次写入绑定标识无效。');
    if(item.authorizedWriteOperationId && item.writeResultOperationId)throw new Error('提交操作和结果核验必须分为不同用例。');
    if(item.writeResultSourceRunId!==undefined && (!item.writeResultOperationId || item.authorizedWriteOperationId || typeof item.writeResultSourceRunId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.writeResultSourceRunId)))throw new Error('提交来源run只能显式绑定到只读结果核验用例。');
    const validated: BrowserCheck = {
      ...(item.writeResultSourceRunId?{writeResultSourceRunId:item.writeResultSourceRunId}:{}),
      ...(item.authorizedWriteOperationId?{authorizedWriteOperationId:item.authorizedWriteOperationId}:{}),
      ...(item.writeResultOperationId?{writeResultOperationId:item.writeResultOperationId}:{}),
      ...(item.requiredAssertions ? {requiredAssertions:[...item.requiredAssertions]} : {}),
      id: caseId, title: item.title.trim(), source: item.source,
      ...(entryPath ? { entryPath } : {}),
      ...(modulePath.length ? { modulePath } : {}),
      ...(dependsOnCaseIds.length ? { dependsOnCaseIds } : {}),
      ...(tags.length ? { tags } : {}),
      requirementRefs: stringList("requirementRefs", [item.source]), priority: priority as CasePriority, category: category as CaseCategory, confidence: confidence as CaseConfidence, coverageAreas: coverageAreas as CaseCategory[], ...(lifecycleStatus === undefined ? {} : { lifecycleStatus: lifecycleStatus as CaseLifecycleStatus }), selectedForRegression: lifecycleStatus !== undefined && lifecycleStatus !== "runnable" ? false : item.selectedForRegression !== false,
      preconditions: stringList("preconditions", []), preconditionsConfirmed: item.preconditionsConfirmed === undefined ? !(Array.isArray(item.preconditions) && item.preconditions.length > 0) : item.preconditionsConfirmed === true,
      testData: stringList("testData", []),
      ...(testDataRequirements.length ? { testDataRequirements } : {}),
      sideEffectRisk: sideEffectRisk as SideEffectRisk, cleanup: cleanup.trim(),
      ...(caseOrigin === undefined ? {} : { caseOrigin: caseOrigin as NonNullable<BrowserCheck["caseOrigin"]> }),
      ...(caseGenerationTrace === undefined ? {} : { caseGenerationTrace: structuredClone(caseGenerationTrace) as CaseGenerationTrace }),
      kind: item.kind, expected: item.expected, steps, ...(typeof item.coverageGap === "string" ? { coverageGap: item.coverageGap } : {}),
    };
    const plan = planCaseExecution(validated);
    validated.executionRoute = plan.route;
    validated.executionReason = plan.reason;
    validated.nextAction = plan.nextAction;
    return validated;
  });
}

/** Preserve trusted generation provenance by case ID while rejecting traces supplied by updates. */
export function validateCasesPreservingGenerationTrace(value: unknown, existing: BrowserCheck[], trustedFreshExplorationEvidence: ReadonlyMap<string, NonNullable<BrowserCheck["explorationEvidence"]>> = new Map()): BrowserCheck[] {
  if (!Array.isArray(value)) return validateCases(value);
  const trustedTraces = new Map(existing.flatMap(item => item.caseGenerationTrace ? [[item.id, item.caseGenerationTrace] as const] : []));
  const trustedEvidence = new Map(existing.flatMap(item => item.explorationEvidence ? [[item.id, item.explorationEvidence] as const] : []));
  const trustedCandidates = value.map((candidate: any) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    const normalized = { ...candidate };
    delete normalized.caseGenerationTrace;
    const storedEvidence = typeof normalized.id === "string" ? trustedEvidence.get(normalized.id) : undefined;
    const freshEvidence = typeof normalized.id === "string" ? trustedFreshExplorationEvidence.get(normalized.id) : undefined;
    if (normalized.explorationEvidence !== undefined && storedEvidence && !freshEvidence && JSON.stringify(normalized.explorationEvidence) !== JSON.stringify(storedEvidence)) {
      throw new Error(`用例 ${normalized.id} 的页面探索证据不能由更新请求替换。`);
    }
    delete normalized.explorationEvidence;
    if (typeof normalized.id === "string") {
      const trace = trustedTraces.get(normalized.id);
      if (trace) normalized.caseGenerationTrace = structuredClone(trace);
    }
    return normalized;
  });
  return validateCases(trustedCandidates).map(item => {
    const trace = trustedTraces.get(item.id);
    const freshEvidence = trustedFreshExplorationEvidence.get(item.id);
    const eligibleExplorationDraft = item.caseOrigin === "ai-generated" && item.lifecycleStatus === "draft" && item.selectedForRegression === false;
    // Fresh evidence may only be introduced as a generated draft. Once stored,
    // keep that trusted provenance through human lifecycle/selection changes.
    const evidence = eligibleExplorationDraft ? freshEvidence ?? trustedEvidence.get(item.id) : trustedEvidence.get(item.id);
    return { ...item, ...(trace ? { caseGenerationTrace: structuredClone(trace) } : {}), ...(evidence ? { explorationEvidence: structuredClone(evidence) } : {}) };
  });
}
