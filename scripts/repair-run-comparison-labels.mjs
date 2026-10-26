import { readFile, writeFile } from "node:fs/promises";
import { unzipSync, zipSync, strToU8 } from "fflate";

const runId = "f56c0757-9128-4008-b457-d9dac9720f74";
const dir = `artifacts/demo/document-tests/runs/${runId}`;
const runPath = `${dir}/run.json`;
const reportPath = `${dir}/report.md`;
const zipPath = `${dir}/testpilot-package.zip`;
const run = JSON.parse(await readFile(runPath, "utf8"));
let bothBlocked = 0;
let oneBlocked = 0;
let alignedPass = 0;
let alignedFail = 0;
for (const item of run.comparisons) {
  const { deterministic: left, computerUse: right } = item;
  item.aligned = (left === "passed" || left === "failed") && left === right;
  if (item.aligned) {
    item.issue = "";
    if (left === "passed") alignedPass++; else alignedFail++;
  } else if (left === "blocked" && right === "blocked") {
    item.issue = "两侧都因风险、前置条件或缺少步骤而未执行；这是未验证项，不是两侧结果不一致。";
    bothBlocked++;
  } else if (left === "blocked" || right === "blocked") {
    item.issue = "只有一侧得到执行结果；当前无法进行双通道比较。";
    oneBlocked++;
  } else {
    item.issue = `结果不一致：确定性脚本 ${left}，Computer Use ${right}。`;
  }
}
let report = await readFile(reportPath, "utf8");
report = report.replace(
  /本轮为未完成运行：[^\r\n]*/u,
  `本轮为未完成运行：${alignedPass + alignedFail}/151 条已执行用例的两侧结果一致（${alignedPass} 条均通过，${alignedFail} 条均失败）；另有 ${bothBlocked} 条两侧都未执行、${oneBlocked} 条仅一侧执行。两侧都 blocked 代表没有证据，不代表“结果不一致”，也不算通过或产品失败。`
);
report = report.replaceAll(
  "Computer Use 未能完成该用例，需要修复配置或检查遗漏后重跑。",
  "该用例尚未完成双通道验证；blocked 是未验证，不是结果不一致。"
);
const explanation = [
  "## 阻塞与比较结果解释（报告修正）",
  "",
  `- 实际双通道一致：${alignedPass + alignedFail} 条（${alignedPass} pass/pass，${alignedFail} fail/fail）。` ,
  `- 两通道均未执行：${bothBlocked} 条，不能称为两侧差异。` ,
  `- 只有一侧执行：${oneBlocked} 条，仍不能形成对比结论。` ,
  "- 因此本轮结论仍为 unresolved；真正已执行并发现产品差异的用例见各通道结果，不把 blocked 计为 bug。",
  "",
].join("\n");
report = report.replace("## 差异分析与后续建议", `${explanation}## 差异分析与后续建议`);
run.report = report;
await writeFile(runPath, JSON.stringify(run, null, 2), "utf8");
await writeFile(reportPath, report, "utf8");
const archive = unzipSync(new Uint8Array(await readFile(zipPath)));
archive["run.json"] = strToU8(JSON.stringify(run, null, 2));
archive["report.md"] = strToU8(report);
await writeFile(zipPath, zipSync(archive));
console.log(JSON.stringify({ runId, alignedPass, alignedFail, bothBlocked, oneBlocked, reportPath, zipPath }, null, 2));
