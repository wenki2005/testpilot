# TestPilot 引擎 MVP 只读审计（2026-10-18）

## 审计范围与结论

按用户目标“URL + 资料 → 规划 → 用例 → 脚本与 Computer Use → 比较 → 报告/ZIP”逐段核对当前代码及既有运行 `71a60764-c2aa-4004-9344-84b3e28aa165`。没有访问目标站、没有运行目标站写操作，没有编辑产品代码或主项目 JSON。本次唯一新建文件是本审计报告。

结论：TestPilot 已是可运行的工作流原型，拥有真实的导入、Playwright DSL 执行、视觉模型执行、逐 ID 比较、持久化报告和 ZIP；但“Agent 自动规划”主要是预置阶段清单，“AI 双通道独立验证”实际共享一个浏览器 page，“全量通过”并未达成。上一轮产物可证明全 156 条进入了两条 lane 的结果清单，却不能证明 156 条都执行了浏览器动作：确定性通道 6 passed / 11 failed / 139 blocked，Computer Use 1 passed / 18 failed / 137 blocked；9/156 aligned，147 unresolved，`finalReady=false`，overall=`unresolved`。报告和 ZIP 已实际生成，但只能是未完成运行产物。

## 各环节的事实

| 环节 | 真实实现 | 当前差距 / 证据 |
|---|---|---|
| URL 与附件输入 | `POST /api/document-projects/import` 接受目标 URL 和 1–5 个文件；抽取 PDF/XMind 等文字与既有用例；并行读文件后进入阶段事件流。 | 真正发生于本地服务端；在本轮 artifact 中来源文件名和目标 URL 有保留。实现不等于已具备任何格式/大文件的可靠性证明。 |
| 规划 | 创建 preparation task 并记录 planning、reading-materials、web-research、generating-cases、generating-steps 等阶段；可执行公开检索及 AI 补充候选用例、草拟浏览器步骤。 | `makeDocumentProject` 中的 `workflowPlan` 是固定描述字符串，不是按项目生成的计划，也没有在这些阶段派生并协调独立 agents。报告称“没有取得公开搜索结果”，所以这轮没有可验证的外部研究输入。 |
| XMind 用例 | importer 把 XMind 主题映射成带来源的用例；运行 artifact 有 156 条 case ID，且 156/156 selected。 | 既有用例已读入/进入执行清单；不代表 156 个完整步骤都已生成或执行。运行中 276 项 lane-case 结果中有 276 项 blocked（139+137），只有 36 项得到 passed/failed 判定。 |
| 可复用脚本 | 文档执行器运行受限 Playwright DSL；报告打包 `cases.json`、`run.json` 和 `run.mjs`。另有独立的 API suite loader/runner，可运行 GET/角色矩阵、断言状态/JSON，并输出 ZIP。 | 156 用例批次的 blocked 项不能称为可复用可运行脚本；很多是缺步骤/前置数据/后端合同。文档脚本 ZIP 是 partial artifact，不会补齐 API 契约、账号、记录或清理机制。 |
| AI Computer Use | `computer-use.ts` 将截图发给 OpenAI-compatible Chat Completions，并通过 TestPilot 自定义 `computer_step` schema 要求有限工具调用；有能力预检、动作限制和逐用例结果。 | 这不是 Responses API 的原生 Computer Use 协议。两 lane 顺序共享同一个 `Page` 与登录态，不是独立/盲测验证。artifact 的 AI 结果 18 failed/1 passed/137 blocked；无法仅凭这批总计判定每个 failed 是产品缺陷，必须看每条证据和已修复的 lane 误报。 |
| 比较 | 通过稳定 case ID 比较，两侧同为 passed/failed 才算 aligned；blocked 不会通过；`finalReady` 按比较全对齐计算。 | 本轮 9 aligned、147 unresolved，故没有对整套样例验收。对齐也只代表同一共享页面状态下状态一致，不等于无缺陷。 |
| 报告/ZIP | `report.md`、`run.json`、`testpilot-package.zip` 实际存在；JSON/报告保存 case 范围与执行记录。 | 当 `finalReady=false` 时并不调用 `generateAlignedReport` 生成 AI 结论，而是拼接静态摘要；“AI 生成报告”没有在本轮发生。ZIP 可供复核/后续重跑，不应描述为 156 条已可完整复用。 |
| Skill / MCP | 本地 `testpilot-qa-workflow` Skill 提供完整清单、lane/prerequisite、复核和报告规范；`src/mcp/server.ts` 提供文档导入、编辑、审核、运行、查询、导出及 API suite MCP 工具。 | Skill 是行为规范文档，不会自行执行流程或增加 runner 能力；MCP 调用本地 TestPilot HTTP API，不是一个能派生子 agent 的 runtime。代码文档明确当前编排不是动态多 Agent 系统。 |

### 关键代码与产物

- `src/demo/server.ts`：导入端点创建 planning task、抽取文件、调用 `searchTestExamples`、可选生成用例并补步骤。
- `src/demo/runtime.ts`：文档补用例及浏览器步骤提示词/结构化输出校验。
- `src/adapters/document-test-workflow.ts`：DSL 验证、确定性执行、双 lane 比较、报告/ZIP、恢复 journal。
- `src/adapters/computer-use.ts`：自定义截图+工具调用视觉 lane。
- `src/adapters/api-test-adapter.ts` / `src/storage/api-suite-loader.ts`：独立 API 套件执行及安全门。
- `src/mcp/server.ts`、`.agents/skills/testpilot-qa-workflow/SKILL.md`、`DOCUMENT-TEST-ORCHESTRATION.md`。
- 全量结果：`artifacts/demo/document-tests/runs/71a60764-c2aa-4004-9344-84b3e28aa165/{run.json,report.md,testpilot-package.zip}`。

## 独立本地 MVP 验证：API lane + 角色矩阵 + 写入保护

选 API lane 作为可验证的关键引擎切片：样书用例中不少预期是权限、订单/库存/审批回调等后端事实，不能从页面截图推断；本地 mock 能证明 TestPilot 至少具备把安全的 API 用例实际执行、验证角色预期、拒绝未授权变更的能力。运行已有 fixture：

```powershell
Set-Location 'D:\test agent\testpilot-mvp'
node --test tests/api-suite-local.integration.test.mjs
```

结果：1 test passed（88.97ms，整体 351.58ms）。fixture 在 `127.0.0.1` 随机端口和系统临时目录建立 mock 与临时 suite；没有访问外网。实证如下：

- `GET /health` 的状态/JSON 断言通过；服务端计数确认为一次请求。
- 同一个 `/private` 按 guest/member/admin 得到 401/403/200，角色矩阵用例通过，服务端恰好收到三次 GET。
- POST 主用例与 DELETE cleanup 都未开启变更许可；结果标为 blocked，mock 的 mutation 计数为 0，证明请求未送达服务端。
- suite loader 也验证变更用例必须有 `${RUN_ID}` 隔离引用和针对 run ID 的清理定义。

这是 runner contract 的本地验证，不证明 UI 工作台的 suite 创建/审核/MCP 路径都已端到端跑通；也不证明真实样书应用有对应 API、fixture 或可安全清理的数据。

## 建议给根任务的最短验证路线

1. **把职责分清**：网页无副作用检查走浏览器 DSL；角色/持久化/库存/审批集成走带 OpenAPI 契约的 API suite；有实际写入的测试只在隔离 mock/sandbox、独立 run ID 和可审计 cleanup 条件下执行。不要把“本轮没有步骤”自动等同于整个用例永远不可测。
2. **补上任务级状态门禁**：报告首页显示总用例、浏览器/API/manual 的分布、各类未决先决条件、实际发出请求数、拒绝的副作用数、对齐比例；当任何 lane case blocked 时强制 `partial/unresolved`，现行单个子集 `finalReady` 之外还需要 `inventoryReady`（所有 156 条有明确 lane/排除/待证据原因）。
3. **验证全链路编排，不增加伪 Agent**：用本地 fixture 端到端走 import→case extraction→safe step drafting→review→browser lane 和 API lane→comparison→report+ZIP→MCP resource/tool fetch；把静态计划文案和动态阶段事件分别显示。仅当任务拆解/交接确实按 agent 运行时，才称为 multi-agent。
4. **持久化与恢复证明**：已有测试有 crash/recovery 覆盖，建议单独保存 fixture 成功证据，并把恢复策略标成“从用例开头重放”，避免让用户误以为步骤级续跑。
5. **视觉 lane 独立性**：如果产品要求“双重验证”，应使用不同 browser context 并明确登录态如何安全复用/注入；否则产品命名为“共享会话下的 AI 复核”。在共享状态时，不将 lane 间一致性当成独立证据。
6. **先拿后端合同再扩充样例 API 覆盖**：需接口地址/Schema、测试租户与脱敏凭证注入、权限角色、合成记录种子、幂等 run ID 与真实清理回执。现有本地 API fixture 能成为 adapter 的基线，但不能替代这些项目特定合同。

