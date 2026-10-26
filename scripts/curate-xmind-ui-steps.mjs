const projectId = '624a5e81-e79e-493f-a746-8accc5c44b90';
const root = 'http://127.0.0.1:4317';
const projects = await (await fetch(`${root}/api/document-projects`)).json();
const project = projects.find(item => item.id === projectId);
if (!project) throw new Error(`Project ${projectId} was not found.`);
const byNumber = n => project.cases[n - 1];
const localOnly = n => { const item = byNumber(n); item.sideEffectRisk = 'none'; item.preconditions = []; item.preconditionsConfirmed = true; };

// User-only form edits and read-only assertions are safe without submitting the application.
localOnly(30);
byNumber(30).steps = byNumber(30).steps.map(step => step.action === 'fillByLabel' ? { ...step, label: '数量（册）' } : step.action === 'assertRoleDisabled' ? { ...step, name: '提交申请' } : step);
localOnly(31);
byNumber(31).steps = [
  { action: 'fillByLabel', label: '数量（册）', value: '10000' },
  { action: 'assertText', text: '超出范围' },
];
localOnly(40);
byNumber(40).steps = [
  { action: 'fillByLabel', label: '备注', value: '1234567890123456789012345678901' },
  { action: 'assertMaxLengthOrMessage', label: '备注', maxLength: 30, message: '超长' },
];
localOnly(42);
byNumber(42).steps = [
  { action: 'assertVisible', text: '收货信息' },
  { action: 'fillByLabel', label: '收件人', value: '' },
  { action: 'assertText', text: '必填' },
];
localOnly(43);
byNumber(43).steps = [
  { action: 'assertVisible', text: '收货信息' },
  { action: 'assertVisible', text: '收件人' },
  { action: 'fillByLabel', label: '收件人', value: 'ABCDEFGHIJKLMNOPQRSTUVWXY' },
  { action: 'assertValue', label: '收件人', value: 'ABCDEFGHIJKLMNOPQRST' },
];
localOnly(47);
byNumber(47).steps = [
  { action: 'assertVisible', text: '所在地区' },
  { action: 'assertRoleDisabled', role: 'button', name: '提交申请' },
];
localOnly(49);
localOnly(94);
byNumber(94).steps = [
  { action: 'setViewport', width: 390, height: 844 },
  { action: 'assertVisible', text: '样书申请' },
  { action: 'setViewport', width: 1280, height: 800 },
  { action: 'assertVisible', text: '样书申请' },
];

const response = await fetch(`${root}/api/document-projects/${projectId}/update`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cases: project.cases }),
});
const updated = await response.json();
if (!response.ok) throw new Error(`Could not save curated steps (${response.status}): ${JSON.stringify(updated)}`);
console.log(JSON.stringify({ projectId, count: project.cases.length, curated: [30,31,40,42,43,47,49,94].map(n => ({ id: byNumber(n).id, title: byNumber(n).title, risk: byNumber(n).sideEffectRisk, steps: byNumber(n).steps })) }));
