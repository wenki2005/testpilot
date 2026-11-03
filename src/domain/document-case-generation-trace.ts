import type { CaseGenerationTrace } from "./document-test-model.js";

const scenarioTypes = new Set(["positive", "negative", "boundary", "state-transition", "authorization", "accessibility", "compatibility", "exploratory", "other", "existing"]);
const priorities = new Set(["P0", "P1", "P2", "P3"]);
const confidences = new Set(["high", "medium", "low"]);
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value: JsonObject, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function isTextList(value: unknown, maxItems: number, maxLength = 100_000): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every(item => typeof item === "string" && item.length <= maxLength);
}

function isGeneratedCase(value: unknown): value is JsonObject {
  if (!isObject(value) || !hasOnlyKeys(value, ["id", "origin", "title", "requirementIds", "sourceRefs", "scenarioType", "priority", "preconditions", "testData", "actions", "expectedResult", "confidence", "clarificationNeeded"])) return false;
  return typeof value.id === "string" && identifier.test(value.id)
    && (value.origin === "existing" || value.origin === "ai-draft")
    && typeof value.title === "string" && value.title.length >= 1 && value.title.length <= 200
    && isTextList(value.requirementIds, 100, 128) && new Set(value.requirementIds).size === value.requirementIds.length
    && isTextList(value.sourceRefs, 100)
    && typeof value.scenarioType === "string" && scenarioTypes.has(value.scenarioType)
    && typeof value.priority === "string" && priorities.has(value.priority)
    && isTextList(value.preconditions, 100)
    && isTextList(value.testData, 100)
    && isTextList(value.actions, 100)
    && typeof value.expectedResult === "string" && value.expectedResult.length >= 1 && value.expectedResult.length <= 100_000
    && typeof value.confidence === "string" && confidences.has(value.confidence)
    && isTextList(value.clarificationNeeded, 100);
}

/** Validate the provenance copied from generated case design into a project case. */
export function validateCaseGenerationTrace(value: unknown): CaseGenerationTrace {
  const valid = isObject(value)
    && hasOnlyKeys(value, ["sourceCaseId", "sourceRefs", "actions", "scenarioType", "clarificationNeeded", "original"])
    && typeof value.sourceCaseId === "string" && identifier.test(value.sourceCaseId)
    && isTextList(value.sourceRefs, 100)
    && isTextList(value.actions, 100)
    && typeof value.scenarioType === "string" && scenarioTypes.has(value.scenarioType)
    && isTextList(value.clarificationNeeded, 100)
    && isGeneratedCase(value.original);
  if (!valid) throw new Error("用例生成追溯记录无效：trace 字段不符合 schema。");
  const trace = value as unknown as CaseGenerationTrace;
  if (trace.sourceCaseId !== trace.original.id || trace.scenarioType !== trace.original.scenarioType || JSON.stringify(trace.sourceRefs) !== JSON.stringify(trace.original.sourceRefs) || JSON.stringify(trace.actions) !== JSON.stringify(trace.original.actions) || JSON.stringify(trace.clarificationNeeded) !== JSON.stringify(trace.original.clarificationNeeded)) {
    throw new Error("用例生成追溯字段与原始生成用例不一致。未保存不一致来源。");
  }
  return trace;
}
