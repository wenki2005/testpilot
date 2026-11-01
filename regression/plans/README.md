# 回归计划（第一版）

这里的 JSON 是**固定的批次清单**：系统、模块、模块版本、用例编号。它不复制用例内容，只记录“这一版跑哪些”。

- `first-version-2026-11-01.json`：第一版 15 条，覆盖 5 个模块；原 131 条和 17 条最小范围不动。
- 计划里的 `versionId` 是固定版本；模块升级后，计划会拒绝执行，避免偷偷换用例。
- 运行结果写在计划的 `runs` 里，报告和截图仍以 TestPilot 批次为准。

## 运行

```powershell
# 只校验计划、不创建批次
npm run plan:run -- --plan regression/plans/first-version-2026-11-01.json --dry-run

# 实际创建批次（fixed 固定回归）
npm run plan:run -- --plan regression/plans/first-version-2026-11-01.json
```

其他服务地址：

```powershell
node scripts/run-regression-plan.mjs --plan regression/plans/first-version-2026-11-01.json --base-url http://127.0.0.1:4319
```

## 规则

1. 计划是快照：改了用例就新建计划文件（带日期），不要改旧计划的结果。
2. 不在计划里写账号、密钥、Cookie；账号由 TestPilot 的测试窗口负责。
3. `excluded` 写清为什么暂时不跑（BUG、逆向、缺数据），避免“看起来全绿”。
4. 单条重测记录在 `runs` 里，不把重测结果拼回原批次冒充一次跑完。
5. 第一版目标是跑通流程，不要求已知问题变绿；29/92 这类单独跟踪。
