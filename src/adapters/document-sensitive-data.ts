function normalizedWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

export function isSensitiveExportField(value: string): boolean {
  const words = normalizedWords(value);
  if (words.some(word => ["password", "passwd", "passcode", "pwd", "token", "secret", "cookie", "authorization", "credential", "credentials"].includes(word))) return true;
  return words.includes("api") && words.includes("key")
    || words.includes("client") && words.includes("secret")
    || words.includes("set") && words.includes("cookie");
}

const credentialValuePatterns = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}={0,2}/giu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  /((?:"?(?:password|passwd|passcode|pwd|access[_-]?token|refresh[_-]?token|session[_-]?token|id[_-]?token|token|secret|cookie|set-cookie|authorization|api[_-]?key|client[_-]?secret|credential)"?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/giu,
  /([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|password|passwd|secret|api[_-]?key|session(?:id|_token))=)[^&#\s]*/giu,
  /(?:^|\r?\n)(set-cookie|cookie)\s*:\s*[^\r\n]*/giu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/giu,
];

export function redactSensitiveExportText(value: string): string {
  let result = value;
  result = result.replace(credentialValuePatterns[0]!, "$1 [REDACTED]");
  result = result.replace(credentialValuePatterns[1]!, "[REDACTED]");
  result = result.replace(credentialValuePatterns[2]!, "$1[REDACTED]");
  result = result.replace(credentialValuePatterns[3]!, "$1[REDACTED]");
  result = result.replace(credentialValuePatterns[4]!, "[REDACTED]");
  result = result.replace(credentialValuePatterns[5]!, "[REDACTED PRIVATE KEY]");
  return result;
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
    const secretInput = /^(?:fillByLabel|fillByPlaceholder|fillByRoleIndex)$/u.test(action)
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
