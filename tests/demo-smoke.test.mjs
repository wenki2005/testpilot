import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverEntry = path.join(root, "dist", "demo", "server.js");

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForServer(child, baseUrl, readOutput) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Demo server exited early.\n${readOutput()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Demo server did not become healthy in time.\n${readOutput()}`);
}

async function readJson(response) {
  const text = await response.text();
  assert.ok(response.ok, `HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

async function waitForRun(baseUrl, runId) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(runId)}`);
    const run = await readJson(response);
    if (!["queued", "running"].includes(run.status)) return run;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Run ${runId} did not finish in time.`);
}

test("offline demo runs, saves a regression, passes after the preset fix, and exports a report", { timeout: 60_000 }, async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "testpilot-demo-smoke-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^TESTPILOT_/i.test(key) && !/(API_KEY|TOKEN|SECRET)/i.test(key),
  ));
  const child = spawn(process.execPath, [serverEntry], {
    cwd: root,
    env: {
      ...inheritedEnv,
      TESTPILOT_DISTRIBUTION_DEMO: "1",
      TESTPILOT_DATA_DIR: dataDir,
      TESTPILOT_ARTIFACTS_DIR: dataDir,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { output += chunk; });

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([once(child, "exit"), new Promise(resolve => setTimeout(resolve, 2_000))]);
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  await waitForServer(child, baseUrl, () => output);

  const pageResponse = await fetch(baseUrl);
  assert.equal(pageResponse.status, 200);
  assert.match(await pageResponse.text(), /assets\/index-[^"']+\.js/);

  const config = await readJson(await fetch(`${baseUrl}/api/config`));
  assert.equal(config.fixedTarget, false);
  assert.equal(config.targetLabel, "订单样例 API（预置缺陷）");
  assert.deepEqual(await readJson(await fetch(`${baseUrl}/api/project-profiles`)), [{ id: "quantity-sample", name: "数量校验样例（内置测试缺陷）", suiteName: "随包数量规则回归" }]);

  const health = await readJson(await fetch(`${baseUrl}/sample/health`));
  assert.equal(health.ok, true);
  const products = await readJson(await fetch(`${baseUrl}/sample/products`));
  assert.equal(products.products.length, 2);

  const firstRun = await readJson(await fetch(`${baseUrl}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "deterministic", provider: "offline", requirements: "offline smoke", maxActions: 10, target: "sample" }),
  }));
  const failedRun = await waitForRun(baseUrl, firstRun.id);
  assert.equal(failedRun.status, "failed");
  const failedAssertion = failedRun.assertions.find(assertion => assertion.status === "failed");
  assert.ok(failedAssertion, "expected the preset defect to produce a failed assertion");
  assert.equal(failedAssertion.expected.status, 400);
  assert.equal(failedAssertion.actual.status, 201);

  const savedRegression = await readJson(await fetch(`${baseUrl}/api/regressions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: failedRun.id, assertionId: failedAssertion.id }),
  }));
  assert.equal(savedRegression.expect.status, 400);
  assert.equal(savedRegression.path, "/sample/orders");

  const target = await readJson(await fetch(`${baseUrl}/api/target`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fixed: true }),
  }));
  assert.equal(target.fixedTarget, true);

  const rerunResponse = await fetch(`${baseUrl}/api/regressions/run`, { method: "POST" });
  assert.equal(rerunResponse.status, 202);
  const rerun = await readJson(rerunResponse);
  const passedRun = await waitForRun(baseUrl, rerun.id);
  assert.equal(passedRun.status, "passed");
  assert.ok(passedRun.assertions.length > 0);
  assert.ok(passedRun.assertions.every(assertion => assertion.status === "passed"));

  const report = await readJson(await fetch(`${baseUrl}/api/runs/${encodeURIComponent(passedRun.id)}/report?format=json`));
  assert.equal(report.id, passedRun.id);
  assert.equal(report.status, "passed");
});
