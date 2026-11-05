import { redactSensitiveExportText } from "../../../domain/documents/shared/sensitive-data.js";
export { redactSensitiveExportText } from "../../../domain/documents/shared/sensitive-data.js";

function normalizedWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

export function isSensitiveExportField(value: string): boolean {
  if (/密码|口令|验证码|密钥|令牌|会话凭据/u.test(value)) return true;
  const words = normalizedWords(value);
  if (words.some(word => ["password", "passwd", "passcode", "pwd", "token", "secret", "cookie", "authorization", "credential", "credentials"].includes(word))) return true;
  return words.includes("api") && words.includes("key")
    || words.includes("client") && words.includes("secret")
    || words.includes("set") && words.includes("cookie");
}

export function containsCredentialLikeValue(value: string): boolean {
  return redactSensitiveExportText(value) !== value;
}

export function redactSensitiveExportData(value: unknown): unknown {
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") return redactSensitiveExportText(current);
    if (Array.isArray(current)) return current.map(item => visit(item));
    if (!current || typeof current !== "object") return current;
    const record = current as Record<string, unknown>;
    const action = typeof record.action === "string" ? record.action : "";
    const locatorLabel = [record.label, record.placeholder, record.name]
      .filter((item): item is string => typeof item === "string")
      .join(" ");
    const secretInput = /^(?:fillByLabel|fillByPlaceholder|fillByRoleIndex|assertValue|assertValueByPlaceholder)$/u.test(action)
      && isSensitiveExportField(locatorLabel);
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      if (isSensitiveExportField(key) || secretInput && key === "value") output[key] = "[REDACTED]";
      else output[key] = visit(child);
    }
    return output;
  };
  return visit(value);
}
