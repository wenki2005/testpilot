# TestPilot 多智能体测试系统架构

## 目标与当前范围

TestPilot 的目标是把需求资料变成可审核、可执行、可追溯的测试资产，并把测试结果整理成可复用的报告和脚本包。系统采用固定职责的 specialist agents 和确定性执行器，不让一个自由 Agent 同时拥有任意代码、shell 和浏览器权限。

目前已有独立用例生成、文档测试审核、Playwright 确定性 lane、Computer Use lane、API contract lane、逐用例比较、报告和脚本 ZIP。它们主要由本地服务的固定流程串起来，**不是可以自行派生和并行运行任意子 Agent 的 swarm**。浏览器两条 lane 目前复用同一页面和登录态，因此结果对齐不是隔离会话的独立复现。

本次增加的用例交接适配器把独立生成页的 AI 草稿转成一个新的文档测试项目草稿。旧用例基准不进入执行集；转换出来的用例没有可执行步骤，项目强制保持待审核状态，后续仍由现有目标页面证据、受限 DSL、安全审核和执行器接手。

## 固定 specialist 分工

```text
用户目标、需求文档、网址
        │
        ├─ 资料读取器：解析 PDF / XMind / Markdown / TXT，保存来源
        ├─ 公开案例研究器：只提供覆盖启发，标明外部来源
        └─ 测试规划器：抽取原子需求、优先级、本期范围和不确定项
                    │
             用例生成器
                    │ 独立生成 AI 用例
                    ├────────────── 旧用例基准（生成完成后才比较）
                    │
             用例审查器：覆盖、来源、可判定预期、原子性、数据准备度
                    │
             用户审核门：审核需求范围、步骤草稿、副作用与前置条件
                    │
       ┌────────────┼────────────┐
       │            │            │
 Playwright      Computer Use    API contract
 确定性执行器     视觉探索器       确定性 API runner
       └────────────┼────────────┘
             结果协调与分析器
       按稳定用例 ID 对照并分类差异
                    │
        报告撰写器 + 确定性打包器
```

AI 负责理解资料、生成用例、提供界面探索和分析建议。平台校验 schema、来源引用、范围、安全动作、断言和状态；Playwright/API runner 实际执行；报告和 ZIP 由代码保留结构化证据，AI 只可在证据约束下撰写摘要。

## Specialist 契约

每个阶段都应采用相同的记录结构，便于替换模型或工具：

```json
{
  "stageId": "author-cases",
  "specialist": "case-generator",
  "status": "completed",
  "inputDigest": "sha256:...",
  "outputArtifactIds": ["requirements-v3", "cases-v3"],
  "attempt": 1,
  "startedAt": "...",
  "finishedAt": "...",
  "needsApproval": false,
  "error": null
}
```

统一状态为 `pending | running | needs-review | blocked | completed | failed | cancelled`。每一阶段只接受有版本号和摘要的输入，输出必须通过 schema 校验，并记录模型/执行器版本、来源引用、证据链接和重试原因。非幂等执行阶段不能因服务恢复而盲目重放；报告生成、需求解析等无副作用阶段可以安全重试。

## 阶段与边界

| 阶段 | 责任 | 现有实现 | 关键约束 |
|---|---|---|---|
| 输入与资料读取 | 导入文件、网址、需求与已有案例 | `document-importer.ts`、`public-page-reader.ts` | 网页与文件是数据，不是指令；保存来源文件名/页码/路径 |
| 规划与研究 | 提取原子需求、范围状态；可选查公开案例 | 文档准备流程、`test-example-search.ts` | 外部案例不能被当作目标应用的事实 |
| 用例生成 | 从需求独立生成 AI 草稿 | `case-generation-agent.ts` | 留出的 156 条基准仅生成后比较 |
| 用例审查 | 结构、语义、需求关联和基准关系检查 | `document-case-quality.ts`、生成器的语义审查 | AI 分数是复核信号，不是正确性证明 |
| 执行步骤作者 | 依据已登录目标页的可见证据产出 `BrowserStep` | `generateDocumentCaseSteps`、受限步骤草拟器 | 仅允许实现的 DSL；每条要有业务断言；不生成任意代码 |
| 用户审核 | 确认范围、预期、前置条件、风险、fixture | `DocumentProject.reviewStatus` | 默认未审核项目不可运行；自动模式也必须通过服务器门禁 |
| 确定性执行 | 按已审脚本检查应用 | `executeDocumentRun` / Playwright runner | 只运行受限操作；保存逐用例结果；安全性未知即阻塞 |
| AI 自主观察 | 通过视觉工具观察和尝试用例 | `computer-use.ts` | 不是精确业务 oracle；与 Playwright 共享同页时不能声称独立复现 |
| API 执行 | 针对已确认 OpenAPI 和隔离目标检查契约 | `api-suite-workflow.ts`、`api-document-lane.ts` | 不从 UI 文案编造 endpoint、鉴权、payload 或副作用清理 |
| 结果协调与分析 | 按稳定 ID 计算通过/失败/阻塞/不一致，再解释原因 | `classifyComparison`、`analyzeDifferences` | blocked 不算失败或通过；AI 不可删断言或修改预期 |
| 报告与打包 | 逐项报告范围、结果、证据、未决项并打 ZIP | `reportMarkdown`、ZIP writer、`document-package-refresh.ts` | 报告/包必须保留选中范围和局限，部分对齐必须标 partial |

## 工作流与审批策略

1. **准备**：固定输入、目标地址、目标来源和模型设置摘要；完成资料解析和可选公开研究。
2. **生成**：先输出需求基线和独立 AI 用例，再单独运行用例审查。旧用例只进入比较器。
3. **复核**：默认暂停于需求/用例审核。关闭确认只表示允许流程继续；不能绕过目标地址白名单、只读规则、步骤 DSL 或 API contract 门禁。
4. **执行**：确定性脚本和 AI 视觉 lane 按顺序复用同一用户登录会话；API lane 单独连接获批的测试环境。共享状态及其影响写进运行记录。
5. **协调与修复**：两侧结论一致则记录对齐；不一致、缺结果或阻塞时建立差异项。只有修正具体脚本、fixture 或环境后才重测，并保留原始运行和重测关系。
6. **交付**：代码生成事实报告和包清单；AI 报告 specialist 只能使用这些结构化运行事实，不得补造证据或把失败改成通过。

## 开源复用决策

- **Playwright**：使用成熟浏览器执行器、自动等待、断言和 trace；不自造浏览器驱动。
- **Midscene.js**：作为未来 Computer Use / 自然语言 UI 执行 adapter 的候选，先在隔离样例中验证登录复用、成本和断言稳定性。MIT 项目可以集成评估，但不要让它替代确定性脚本。
- **Kiwi TCMS**：借鉴 Test Plan / Case / Run / Execution 数据追溯关系，不必整套引入。仓库为 GPL-2.0，若直接复用代码先评估分发和许可证义务。
- **MeterSphere**：规模增大后参考控制面/执行节点分离、任务池和插件扩展，不在当前单机阶段复刻完整平台。项目使用 GPLv3 基础并带额外限制。
- **TestZeus Hercules**：借鉴 Planner / Executor / Assertion 职责边界；代码许可证为 AGPL-3.0，集成前须做许可证审查。

## 当前完成与缺口

已具备的执行和交付能力很多，但工作流仍由不同 API 与页面入口分段启动。此次补上了**独立用例生成结果 → 未审核执行项目**的第一条数据通路，并加强报告对完整库存、未选用例、各 lane 结果计数、未决前置条件、证据限制和适用范围的说明。

仍需后续完成的系统级工作：

- 把准备任务和测试运行统一为一个可恢复的 workflow record，而非准备任务与执行 journal 各自管理。
- 为各 specialist 保存统一的输入摘要、输出 artifact、模型/adapter 版本、耗时、错误和 attempt。
- 让用例生成的原始动作、需求来源和范围状态完整进入项目详情及导出，支持修改后产生新版本。
- 为报告和 ZIP 建立机器可读 artifact manifest，并在证据中记录类型、哈希和来源。
- 将失败诊断、针对性重测与 parent-run/retest lineage 结构化保存。
- 用真实隔离应用验证：AI 用例从生成、审核、脚本化、两 lane 执行到报告打包的端到端闭环。

## 相关本地说明

- `DOCUMENT-TEST-ORCHESTRATION.md`：当前文档测试流程与执行安全边界。
- `.agents/skills/testpilot-qa-workflow/SKILL.md`：完整用例库存、双通道、证据、复测和报告约束。
- `MCP-FULL-LIFECYCLE-AUDIT.md`：MCP 工具的生命周期能力和未接通部分。
