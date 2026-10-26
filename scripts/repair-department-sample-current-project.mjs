import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectId = "624a5e81-e79e-493f-a746-8accc5c44b90";
const projectsRoot = path.resolve("artifacts/demo/document-tests/projects");
const backupRoot = path.resolve("artifacts/demo/document-tests/backups");
const projectPath = path.join(projectsRoot, `${projectId}.json`);
const backupPath = path.join(backupRoot, `${projectId}.before-blocker-repair.json`);
const project = JSON.parse(await readFile(projectPath, "utf8"));
if (project.cases.length !== 156) throw new Error(`Expected 156 XMind cases, got ${project.cases.length}`);
await (await import("node:fs/promises")).mkdir(backupRoot, { recursive: true });
await copyFile(projectPath, backupPath);

const byNumber = n => project.cases[n - 1];
const excludedAsOutOfScope = [16, 71, 72, 95, 102];
for (const n of excludedAsOutOfScope) {
  const item = byNumber(n);
  item.selectedForRegression = false;
  item.preconditions = [];
  item.preconditionsConfirmed = true;
  item.sideEffectRisk = "none";
}

// Case 52 is a negative UI assertion on the untouched form. It must never click
// the submit control; the disabled state can be checked safely on the live page.
const submitGuard = byNumber(52);
submitGuard.steps = [
  { action: "assertVisible", text: "样书申请" },
  { action: "assertRoleDisabled", role: "button", name: "提交申请" },
];
submitGuard.sideEffectRisk = "none";
submitGuard.preconditions = [];
submitGuard.preconditionsConfirmed = true;
submitGuard.selectedForRegression = true;
submitGuard.cleanup = "只读检查空白表单提交按钮状态；不点击提交、不保存、不创建申请。";

// Replace keywords inherited from business descriptions with actual read-only
// browser assertions. These steps inspect visible controls only; they do not
// click delete, submit, or save.
const deleteControl = byNumber(35);
deleteControl.steps = [
  { action: "clickExactText", text: "继续添加样书" },
  { action: "assertExactVisible", text: "删除" },
];
deleteControl.sideEffectRisk = "none";
deleteControl.preconditions = [];
deleteControl.preconditionsConfirmed = true;
deleteControl.selectedForRegression = true;
deleteControl.cleanup = "只新增未提交的临时明细行并确认删除按钮可见；不点击删除、不提交或保存。";

const fixedShipping = byNumber(37);
fixedShipping.steps = [
  { action: "assertVisible", text: "发货方式" },
  { action: "assertExactVisible", text: "快递" },
];
fixedShipping.sideEffectRisk = "none";
fixedShipping.preconditions = [];
fixedShipping.preconditionsConfirmed = true;
fixedShipping.selectedForRegression = true;

const noCarrierPicker = byNumber(38);
noCarrierPicker.steps = [
  { action: "assertNotVisible", text: "快递公司" },
  { action: "assertNotVisible", text: "选择快递公司" },
];
noCarrierPicker.sideEffectRisk = "none";
noCarrierPicker.preconditions = [];
noCarrierPicker.preconditionsConfirmed = true;
noCarrierPicker.selectedForRegression = true;
noCarrierPicker.cleanup = "只检查页面未提供快递公司选择，不修改配送信息、不提交或保存。";

// Test responsive layout at a common mobile viewport and desktop viewport.
// The dedicated assertion checks document overflow and visible interactive
// controls extending beyond the viewport instead of only checking page copy.
const responsive = byNumber(94);
responsive.steps = [
  { action: "setViewport", width: 390, height: 844 },
  { action: "assertNoHorizontalOverflow" },
  { action: "setViewport", width: 1280, height: 800 },
  { action: "assertNoHorizontalOverflow" },
];
responsive.sideEffectRisk = "none";
responsive.preconditions = [];
responsive.preconditionsConfirmed = true;
responsive.selectedForRegression = true;
responsive.cleanup = "只在移动和桌面视口检查布局，不触发业务操作。";

project.updatedAt = new Date().toISOString();
project.reviewNotes = `${project.reviewNotes ?? ""}\n修复阻塞误分类：case-35/37/38/52 使用只读断言；case-94 使用响应式视口溢出断言；case-${excludedAsOutOfScope.join(", case-")} 按原 XMind 期次范围标记为不纳入本轮。`;
await writeFile(projectPath, JSON.stringify(project, null, 2), "utf8");
console.log(JSON.stringify({
  projectId,
  backupPath,
  total: project.cases.length,
  newlyExecutable: [35, 37, 38, 52, 94],
  outOfScope: excludedAsOutOfScope,
  selected: project.cases.filter(item => item.selectedForRegression).length,
}, null, 2));
