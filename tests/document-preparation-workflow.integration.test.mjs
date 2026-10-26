import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');

test('document preparation persists observable stages and returns a reviewable project', { timeout: 30_000 }, async t => {
  const port = await reservePort();
  const dataDir = resolve(root, 'artifacts', 'document-preparation-integration', String(Date.now()));
  const demo = spawn(process.execPath, ['dist/demo/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), TESTPILOT_DATA_DIR: dataDir, TESTPILOT_API_KEY: '', OPENAI_API_KEY: '', HTTPS_PROXY: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', TESTPILOT_BROWSER_HEADLESS: '1', TESTPILOT_BROWSER_CDP_ENDPOINT: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = '';
  demo.stdout.on('data', chunk => { logs += chunk.toString(); }); demo.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(async () => { if (demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited; } });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { if (demo.exitCode !== null) throw new Error(`server exited: ${logs}`); try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {} if (i === 99) throw new Error(`server did not start: ${logs}`); await delay(100); }
  const content = '# Login screen\n\n- 登录页面应显示为安全入口。\n';
  const startedResponse = await fetch(`${base}/api/document-projects/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetUrl: 'http://127.0.0.1:43210/', fileName: 'requirements.md', bytesBase64: Buffer.from(content).toString('base64'), caseMode: 'existing', requireConfirmation: true }) });
  assert.equal(startedResponse.status, 202);
  const started = await startedResponse.json();
  assert.ok(started.preparationId);
  const observed = [];
  let task;
  for (let i = 0; i < 200; i++) { task = await (await fetch(`${base}/api/document-preparation/${started.preparationId}`)).json(); observed.push(task.stage); if (task.status !== 'running') break; await delay(50); }
  assert.equal(task.status, 'needs-review');
  assert.ok(task.projectId);
  assert.deepEqual([...new Set(task.events.map(event => event.stage))], ['planning', 'reading-materials', 'web-research', 'generating-cases', 'reviewing-cases', 'generating-steps', 'needs-review']);
  const storedTask = await (await fetch(`${base}/api/document-preparation/${started.preparationId}`)).json();
  assert.ok(storedTask.events.some(event => event.stage === 'reading-materials' && event.status === 'completed'));
  const projects = await (await fetch(`${base}/api/document-projects`)).json();
  const project = projects.find(item => item.id === task.projectId);
  assert.ok(project);
  assert.equal(project.reviewStatus, 'draft');
  assert.ok(project.workflowId);
  assert.deepEqual(project.sourceRoles, [{ fileName: 'requirements.md', role: 'requirements' }]);
  assert.equal(project.cases.length, 1, 'a Markdown heading is a section title, not an executable test case');
  assert.equal(project.cases[0].title, '登录页面应显示为安全入口。');
  assert.ok(project.generationWarning);
  const workflowResponse = await fetch(`${base}/api/document-workflows/${project.workflowId}`);
  assert.equal(workflowResponse.status, 200);
  const workflow = await workflowResponse.json();
  assert.equal(workflow.projectId, project.id);
  assert.equal(workflow.status, 'waiting');
  assert.equal(workflow.approvalPolicy, 'confirm-before-execution');
  assert.deepEqual(workflow.stages.map(stage => stage.stageId), ['generate-cases', 'review-cases', 'author-steps', 'human-approval']);
  assert.equal(workflow.stages.at(-1).status, 'waiting');
  assert.equal(workflow.stages.at(-1).approval.status, 'pending');
});

async function reservePort() {
  const { createServer } = await import('node:net');
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('unable to reserve port');
  const port = address.port; await new Promise(resolveClose => server.close(resolveClose)); return port;
}
