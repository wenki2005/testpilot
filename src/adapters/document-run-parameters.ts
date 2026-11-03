import type { BrowserCheck, BrowserStep, DocumentProject } from "../domain/document-test-model.js";
import { containsCredentialLikeValue } from "./document-sensitive-data.js";

const parameterToken = /\{\{param:([A-Za-z][A-Za-z0-9_.-]{0,39})\}\}/gu;
const forbiddenParameterName = /(?:pass(?:word|code)?|pwd|token|secret|cookie|auth|credential|api.?key)/iu;
const parameterizedStepFields = new Set(["value", "text", "name"]);

export function collectDocumentParameterNames(cases: Array<Pick<BrowserCheck, "steps" | "testDataRequirements">>): string[] {
  const names = new Set<string>();
  for (const item of cases) {
    for (const requirement of item.testDataRequirements ?? []) names.add(requirement.key);
    for (const step of item.steps ?? []) for (const [field, value] of Object.entries(step)) {
      if (!parameterizedStepFields.has(field) || typeof value !== "string") continue;
      parameterToken.lastIndex = 0;
      for (const match of value.matchAll(parameterToken)) names.add(match[1]!);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "en"));
}

export function resolveDocumentRunParameters(project: DocumentProject, selectedCaseIds: string[], dataSetId?: string, overrides: Record<string, string> = {}): Record<string, string> {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides) || Object.getPrototypeOf(overrides) !== Object.prototype) throw new Error("本轮参数必须是普通对象。");
  const knownNames = new Set(collectDocumentParameterNames(project.cases));
  const selectedCases = project.cases.filter(item => selectedCaseIds.includes(item.id));
  const requiredNamesSet = new Set<string>();
  for (const item of selectedCases) {
    for (const requirement of item.testDataRequirements ?? []) if (requirement.required) requiredNamesSet.add(requirement.key);
    for (const step of item.steps ?? []) for (const [field, value] of Object.entries(step)) {
      if (!parameterizedStepFields.has(field) || typeof value !== "string") continue;
      parameterToken.lastIndex = 0;
      for (const match of value.matchAll(parameterToken)) requiredNamesSet.add(match[1]!);
    }
  }
  const requiredNames = [...requiredNamesSet].sort((a, b) => a.localeCompare(b, "en"));
  const dataSet = dataSetId ? project.testDataSets?.find(item => item.id === dataSetId) : undefined;
  if (dataSetId && !dataSet) throw new Error("选择的测试数据组不存在或已删除；请重新选择。");
  const values: Record<string, string> = { ...(dataSet?.values ?? {}) };
  for (const [name, value] of Object.entries(overrides)) {
    if (!knownNames.has(name)) throw new Error(`未知的测试参数：${name}。请检查步骤中的 {{param:名称}} 引用。`);
    if (forbiddenParameterName.test(name)) throw new Error(`测试参数「${name}」可能是密码或凭据；认证信息请使用已登录的 Edge 会话。`);
    if (typeof value !== "string" || value.length > 500) throw new Error(`测试参数「${name}」必须是 500 字以内的字符串。`);
    values[name] = value;
  }
  for (const [name, value] of Object.entries(values)) {
    if (!knownNames.has(name)) throw new Error(`数据组中包含当前用例未定义的参数「${name}」；请整理数据组后再运行。`);
    if (forbiddenParameterName.test(name)) throw new Error(`测试参数「${name}」可能是密码或凭据；认证信息请使用已登录的 Edge 会话。`);
    if (typeof value !== "string" || value.length > 500) throw new Error(`测试数据组中的「${name}」必须是 500 字以内的字符串。`);
  }
  for (const name of requiredNames) {
    if (Object.hasOwn(values, name) && containsCredentialLikeValue(values[name]!)) {
      throw new Error("测试参数「" + name + "」疑似含有令牌、Cookie 或认证凭据；请改用合成测试数据。");
    }
  }
  const missing = requiredNames.filter(name => !Object.hasOwn(values, name));
  if (missing.length) throw new Error(`本轮缺少参数值：${missing.map(name => `{{param:${name}}}`).join("、")}。请填写参数或选择包含这些值的数据组。`);
  return Object.fromEntries(requiredNames.map(name => [name, values[name]!]));
}

export function resolveBrowserStepParameters(step: BrowserStep, values: Record<string, string>): BrowserStep {
  const resolved = { ...step } as Record<string, unknown>;
  for (const [field, value] of Object.entries(resolved)) {
    if (!parameterizedStepFields.has(field) || typeof value !== "string") continue;
    parameterToken.lastIndex = 0;
    const next = value.replace(parameterToken, (_token, name: string) => {
      if (!Object.hasOwn(values, name)) throw new Error(`本轮没有提供参数值「${name}」。`);
      return values[name]!;
    });
    if (next.includes("{{param:")) throw new Error(`步骤中的参数引用格式无效：${value}`);
    resolved[field] = next;
  }
  return resolved as BrowserStep;
}
