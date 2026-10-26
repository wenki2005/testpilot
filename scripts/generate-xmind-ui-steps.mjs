const projectId = '624a5e81-e79e-493f-a746-8accc5c44b90';
const suite = JSON.parse(await (await import('node:fs/promises')).readFile('test-plans/department-sample-apply-v1.0-full-suite.json', 'utf8'));
const response = await fetch('http://127.0.0.1:4317/api/document-projects');
if (!response.ok) throw new Error(`Unable to read projects: ${response.status}`);
const projects = await response.json();
const project = projects.find(item => item.id === projectId);
if (!project) throw new Error(`Project ${projectId} was not found.`);
const candidates = suite.cases.filter(item => item.automationDisposition === 'UI 脚本待补');
const caseIds = candidates
  .map(item => `case-${Number(item.id.slice('xmind-'.length))}`)
  .filter(id => project.cases.some(item => item.id === id && !item.steps?.length));
if (!caseIds.length) {
  console.log(JSON.stringify({ projectId, requested: 0, reason: 'All UI candidates already have steps.' }));
  process.exit(0);
}
const generated = await fetch(`http://127.0.0.1:4317/api/document-projects/${projectId}/generate-steps`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caseIds }),
});
const result = await generated.json();
if (!generated.ok) throw new Error(`Step generation failed (${generated.status}): ${JSON.stringify(result)}`);
console.log(JSON.stringify(result));
