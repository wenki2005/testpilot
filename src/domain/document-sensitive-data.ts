const credentialValuePatterns = [
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}={0,2}/giu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  /((?:"?(?:password|passwd|passcode|pwd|access[_-]?token|refresh[_-]?token|session[_-]?token|id[_-]?token|token|secret|cookie|set-cookie|authorization|api[_-]?key|client[_-]?secret|credential)"?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/giu,
  /([?&](?:access[_-]?token|refresh[_-]?token|id[_-]?token|password|passwd|secret|api[_-]?key|session(?:id|_token))=)[^&#\s]*/giu,
  /(?:^|\r?\n)(set-cookie|cookie)\s*:\s*[^\r\n]*/giu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/giu,
];

/** Pure text redaction shared by domain workflows and outer adapters. */
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
