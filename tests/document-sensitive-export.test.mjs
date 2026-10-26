import test from "node:test";
import assert from "node:assert/strict";
import { containsCredentialLikeValue, isSensitiveExportField, redactSensitiveExportData, redactSensitiveExportText } from "../dist/adapters/document-sensitive-data.js";

test("redacts credential fields, token formats, cookie headers and credential query parameters", () => {
  const source = {
    targetUrl: "https://example.test/?access_token=query-secret&mode=smoke",
    headers: { Authorization: "Bearer header-secret-value", Cookie: "session-id=cookie-secret" },
    note: "JWT eyJabcdefghij.klmnopqrst.uvwxyz1234",
  };
  const redacted = redactSensitiveExportData(source);
  const serialized = JSON.stringify(redacted);
  for (const secret of ["query-secret", "header-secret-value", "cookie-secret", "eyJabcdefghij.klmnopqrst.uvwxyz1234"]) {
    assert.equal(serialized.includes(secret), false, secret + " must not be present in exported evidence");
  }
  assert.match(serialized, /smoke/u, "non-sensitive URL parameters stay visible");
  assert.equal(redactSensitiveExportText("https://example.test/?session=primary"), "https://example.test/?session=primary");
  assert.equal(redacted.headers.Authorization, "[REDACTED]");
  assert.equal(redacted.headers.Cookie, "[REDACTED]");
});

test("redacts password values in authored browser input steps and leaves synthetic parameters intact", () => {
  const source = {
    cases: [{
      steps: [
        { action: "fillByLabel", label: "Password", value: "LocalPass-7!" },
        { action: "fillByLabel", label: "Scenario marker", value: "synthetic-case-42" },
      ],
    }],
  };
  const redacted = redactSensitiveExportData(source);
  assert.equal(redacted.cases[0].steps[0].value, "[REDACTED]");
  assert.equal(redacted.cases[0].steps[1].value, "synthetic-case-42");
});

test("recognizes credential field names and blocks credential-like parameter contents", () => {
  assert.equal(isSensitiveExportField("accessToken"), true);
  assert.equal(isSensitiveExportField("apiKey"), true);
  assert.equal(isSensitiveExportField("scenarioMarker"), false);
  assert.equal(containsCredentialLikeValue("Bearer abcdefghijklmnop"), true);
  assert.equal(containsCredentialLikeValue("https://example.test/?token=query-secret"), true);
  assert.equal(containsCredentialLikeValue("synthetic-case-42"), false);
  assert.equal(redactSensitiveExportText("Cookie: session-id=cookie-secret").includes("cookie-secret"), false);
});
