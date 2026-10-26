# TestPilot 开源复用调研（2026-10-18）

## 结论

TestPilot 已有正确的主干，不建议换 agent 框架：当前依赖 Pi Agent Core 1.2.0、Playwright 1.64.1、官方 MCP TypeScript SDK，并已有受限的 BrowserStep DSL、computer-use lane、OpenAPI 感知的 API suite / OpenAPI schema validator、受控 HTTP runner 与 MCP 控制面。下一步应复用成熟引擎和报告格式，把 TestPilot 的审批、源用例 ID、风险门控、夹具状态、双通道比较保留为产品编排层。

建议优先级：

1. 继续用 Playwright 做可复现 UI 回归，提取官方 Playwright CLI/Playwright MCP 的 session、trace、locator 和 agent skill 经验，不要把不受控 CLI 直接交给生成模型。
2. 有正式 OpenAPI 且存在隔离 QA 环境后，先把 Schemathesis 做成独立、可选的 API property-testing provider；当前内置 API runner 负责需求明确的具体用例，Schemathesis 用来补边界和 schema 探索。
3. 用 Prism 在本地从契约生成隔离 mock/sandbox，验证 TestPilot API lane 和失败场景，不把 mock 结果误写为业务真实环境验证。
4. 评估 Allure Playwright 作为可选的标准报告导出器；TestPilot 自己的 JSON/Markdown/ZIP 仍应保留为权威 run 记录与可脱离模型的脚本包。
5. Stagehand 或 Browser Use 只做隔离的探索型 agent provider MVP，输出候选步骤/证据，不能替代确定性脚本，也不能直接执行写操作。

## 当前工程基线

本次静态核查 `package.json`、QA workflow skill、API lane 设计说明：

- `@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`：Agent runtime / 模型接口。
- `playwright`：浏览器运行时，测试和 Computer Use 使用同一套 Playwright page/session。
- `@modelcontextprotocol/server`：TestPilot 自己的 MCP server；MCP 当前是本地编排控制面，不等于目标应用的 MCP 接口。
- `@platformatic/openapi-schema-validator`、TypeBox/Zod：OpenAPI/schema 与输入验证已有基础。
- `src/adapters/api-test-adapter.ts` 和 suite workflow 已支持受限 HTTP、状态/响应断言、角色 principal、RUN_ID 隔离及 setup/cleanup；写操作需批准。
- `.agents/skills/testpilot-qa-workflow/` 已有本地流程 skill 和上游来源清单。官方 Playwright CLI skill 可取 locator、trace、session 管理与生成/调试方法，但其允许 shell/CLI 操作的规则需要转译到 TestPilot 的有限 DSL，不宜原样开放。

本次只调研，没有增加依赖、复制代码或执行目标系统流量。

## 最适合复用的 6 个项目

| 项目 | 已有能力/对 TestPilot 的价值 | License 与维护信号 | 接入建议与边界 |
|---|---|---|---|
| [Microsoft Playwright](https://github.com/microsoft/playwright) / [Playwright Test](https://playwright.dev/docs/intro) | 浏览器驱动、自动等待、locator、断言、fixtures、trace、重试/并行、浏览器矩阵。TestPilot 已依赖 Playwright，因此主要是采用 Test runner、trace 与最佳实践，而非再造浏览器层。 | Apache-2.0；微软维护；GitHub Releases 和 Playwright 1.64 线仍有近期发布活动。 | 将 BrowserStep DSL 编译到现有 Playwright page；增加 per-case trace/screenshot/network 摘要与 artifact 引用。可先为导出的脚本包采用 `@playwright/test` runner/report，但需验证当前运行时升级兼容，避免同时维护两套 locator/timeout 语义。保留 TestPilot 风险策略，不让 Playwright 的普通测试脚本越过审批。 |
| [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) + [官方 Playwright CLI Skill](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md) | 官方 MCP browser tool；支持持久用户 profile、隔离 context、storage state 与连接已有浏览器 extension/CDP；CLI skill 覆盖 snapshot/ref、browser sessions、storage state、trace 和 test generation。直接对应 TestPilot 需要“同一登录窗口持续跑”和 Computer Use 通道。 | MCP 包 Apache-2.0；Playwright CLI 在微软 GitHub 维护，CLI skill 是上游官方工作流资料。项目文档/发布在 2026 年仍活跃。 | 先复用其会话生命周期和调试思路，继续让 TestPilot 的 `BrowserSessionManager` 独占原浏览器实例；可单独搭一个只读/隔离 PoC 比较 Computer Use 稳定性。不要另起 MCP browser server 接管同一 profile，否则会争抢实例；不直接复制允许 Bash/npx/cookie/localStorage 的 skill 权限。将上游 skill 改写为 TestPilot 专用：禁止读密钥/任意 shell、限制 origin、写操作走审核、trace 脱敏。 |
| [Schemathesis](https://github.com/schemathesis/schemathesis) | OpenAPI/GraphQL 驱动的 property-based 与 fuzz 风格 API 检查，可对字段边界、组合输入、schema/response 不一致生成并缩减复现案例；适合补齐“接口契约已有，但人手用例没枚举到”的 API 探索。 | MIT；约 3.7k stars；GitHub releases 至少到 4.31.1（2026-10-14），近期迭代活跃。 | 最初实现为独立 Python provider/子进程，在 TestPilot 中把每个 Hypothesis case 保存成输入、seed、operation、请求摘要、响应断言与原始需求关联；将结果映射为候选用例，不覆盖手写的预期。仅允许用户给出的 OpenAPI、明确 staging allowlist、速率/用例数上限、专用凭证和 run-scoped fixture。没有 OpenAPI、沙箱或 cleanup 证明时绝不对外部应用 fuzz；生产申请系统不运行变更型探索。 |
| [Stoplight Prism](https://github.com/stoplightio/prism) | 从 OpenAPI/Postman Collection 建 mock server；也能代理并验证 request/response 与契约。用于在本地建立可预测 API 夹具，验证 TestPilot runner 对错误码、缺字段、超时、角色等契约用例的表现。 | Apache-2.0；主线 v5.16.0 于 2026-07 发布，近期活跃。 | 当前仓库要求 Node >=22.19，而 Prism v5.16.0 的 `@stoplight/prism-http` 要求 Node >=24.18；不要直接塞入主进程。PoC 应采用独立子进程/容器并固定兼容版本，再确认依赖约束。作为本地开发/集成测试依赖运行在 loopback/ephemeral container；以契约 examples/fixtures 初始化，不把 mock 通过计入目标产品 E2E。注意 Prism mock 默认响应不能替代真实应用审批/库存/异步事务模型。 |
| [Stagehand](https://github.com/browserbase/stagehand) | TypeScript/Playwright 之上的 `observe/act/extract` 自然语言浏览器抽象，AI locator 与缓存/可复现代码结合，适合作为“agent 自主探索并产出可审阅候选脚本”的最小对照方案。与 TestPilot TS runtime 技术栈一致。 | MIT；超过 24k GitHub stars；仓库持续发布，2026 年仍有 3.x 活动。 | 建议做隔离 MVP provider：读取 TestPilot 已打开页面/测试账户，运行低风险只读探索，将动作转换为 DSL 候选，要求 deterministic replay 与 reviewer approval 后才能保存。默认禁止 agent 直发 POST、提交表单和跨 origin 导航。Stagehand 某些使用模式面向 Browserbase 云服务；本地模式/API 与模型计费/数据传输边界需先确认，不要把 Browserbase 云会话作为默认登录方案或强依赖。 |
| [Allure Playwright](https://github.com/allure-framework/allure-js/tree/main/packages/allure-playwright) | Playwright Test 的生态报告适配器；支持 steps、截图、trace、labels、links、参数和历史报告。能增强 QA 人员可读性与失败证据归档。 | Apache-2.0；Allure JS 于 2026-10 仍有近期更新，README 支持 Allure Report 2/3 与 Windows。 | 作为导出格式而非唯一数据源。建立 `TestPilot CaseResult -> Playwright Test result/Allure labels` 映射，把 `sourceCaseId`、lane、coverage gap、风险/人工前置、run ID 做 label/parameter。先验证 Allure 插件可否挂接现有 DSL runner；如果不迁移到 Playwright Test，可实现极薄 reporter bridge/JSON 转换器，禁止为生成漂亮报告重写执行核心。报告和 trace 需要凭据、个人信息脱敏。 |

## 其他值得参考但不应直接当产品 runner 的项目

- [BrowserGym](https://github.com/ServiceNow/BrowserGym)：Apache-2.0，由 ServiceNow 维护的网页 agent benchmark/environment 生态；适合评测不同 Computer Use agent 在任务完成率、回合数、定位稳定性上的差异。GitHub 近期发布 v0.14.3 且 2026-09 仍有 PR 活动。它不是面向任意生产网站、需求用例和测试报告的通用回归执行器；应在自建 fixture/demo app 上做 agent 回归 benchmark。
- [browser-use](https://github.com/browser-use/browser-use)：MIT、Python 生态活跃、社区规模大。它提供完整自主浏览器 agent，适合做探索型 provider 对照。与当前 TypeScript/Pi/Playwright/MCP 重叠大，并增加 Python 运行时、agent tool surface 与潜在 provider/cloud 依赖；优先用 Stagehand 做 TS PoC，只有它在既定 benchmark 显著胜出才增加 browser-use。
- 中文检索发现大量“AI + Playwright 自动化”文章、教程及个人仓库，但其中不少仅是 prompt→Playwright codegen demo，缺少可复现执行、写操作隔离、双通道差异分析和长期维护证据。本报告不建议引入无活跃 release、无清晰 license 或仅有短视频/营销材料的项目作为执行底座。建议以英文官方仓库的 upstream source 为准，中文流程文档和本地 skill 则面向中文用户编写。

## Skills：安装、裁剪或自建

### 可直接参考上游并安装到 agent 开发环境

- [microsoft/playwright-cli 的 `playwright-cli` skill](https://github.com/microsoft/playwright-cli/tree/main/skills/playwright-cli)（Apache-2.0 仓库）：提供 CLI 快速操作、snapshot、session、trace、storage state 和 test generation 的官方操作指引。仓库说明支持安装到 `.agents/skills`，但需要先在隔离 repo/fixture 做一次安装与回归，确认具体版本、文件变化和依赖。
- [Microsoft Playwright 内置 `playwright-cli` skill](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/skills/playwright-cli/SKILL.md)：官方工具文档直接可读。当前 TestPilot 可选“借鉴/裁剪”而非启用上游命令权限，因为其中命令可读 cookie/localStorage 并能提交表单。
- [Browserbase `browser-use-to-stagehand` skill](https://github.com/browserbase/skills/tree/main/skills/browser-use-to-stagehand)：MIT，适用于把已有 browser-use Python 脚本迁移到 Stagehand v3；需要 Browserbase 凭证和模型 provider，因此只适合迁移实验，不适合当前用户侧默认工作流。

### TestPilot 应继续维护自有规范 skill

本项目已有 `.agents/skills/testpilot-qa-workflow/`，而且它绑定了产品真正需要的 workflow：完整用例 inventory、lane 选择、审核、login handoff、用例证据、差异复核、retest 与 report/package。上游浏览器 skill 不能表达这些 TestPilot 特有状态。推荐保留本地 skill，并纳入如下通用规则：

1. 在开始执行前统计选中用例、可执行步骤、部分覆盖与前置条件缺失；不得把“没有步骤”混成普通 blocked 而不解释或提出可审阅候选。
2. 区分确定性断言、AI 视觉观察、API 契约/状态夹具，逐个源 case 保留 requirement refs 和 coverage gaps；部分断言通过仍不得记完整通过。
3. 同一个登录 session 跨用例复用，登录 gate 仅在检测到真实过期/登录页时触发；可由用户接管浏览器一次然后续跑。
4. LLM 可以提出 BrowserStep/API candidate 和差异解释，但测试通过状态必须来自脚本断言/可复核视觉 evidence，而非模型口头判断。
5. 写请求、删除/提交、跨 origin、fuzz、并发、生成/清理业务数据按环境 allowlist 与明确批准控制。测试套件导出后不得暗中获得额外权限。
6. 失败自动分类为产品缺陷、用例定义错误、测试脚本缺陷、环境/fixture 缺失、AI 观察分歧；每类记录可复现证据并维护修复回归。

因此建议下一步“裁剪 Playwright 官方 skill 的有用知识 + 强化当前 TestPilot skill”，而非安装泛化的 autonomy skill 或再造 LangChain/CrewAI/新 agent framework。

## 建议路线（小步验证后整合）

| 阶段 | MVP | 验收证据 |
|---|---|---|
| A. Browser agent 持续会话 | 官方 Playwright MCP/CLI 的 session 行为作参照，在 TestPilot 同一 `BrowserSession` 连续执行 10 条只读用例与 Computer Use；造登录页 mock 测过期后一次 handoff，不新开/关浏览器。 | 每条 case 的 page/session ID 相同；登录态在 run 中保持；trace 重放步骤可复核；无重新扫码循环。 |
| B. AI 浏览器探索转脚本 | Stagehand 在本地 demo fixture 上探索 3 个任务，只能产出 `BrowserStep[]` 草稿；由确定性 runner replay；比较探索时完成率和 replay 稳定性。 | 每个候选带源 requirement、locator、assertion、风险标签和截图；模型不直接标 PASS；导入前 reviewer gate 与风险单测通过。 |
| C. Contract/API fuzz | Prism 起 loopback mock，导入 Petstore 等公开 OpenAPI；用内置 runner 跑显式需求 suite，再用 Schemathesis 生成受限只读/本地故障输入。 | 记录 schema operation coverage、seed/reproducer、request budget；POST/DELETE 默认拒绝；contract mock 结果单列，不与线上目标 E2E 混算。 |
| D. 报告/包标准化 | 先把一组已有 run 导出到 Allure 结果中；对照 TestPilot 原 Markdown/JSON/ZIP。 | Case ID/lane/status/blocked reason/attachments 一一对应；ZIP 脱网可运行且仍保留副作用限制；secret/trace sanitization 检查通过。 |
| E. 156 条样例整合 | 只有样例系统负责人给出真实 contract、测试账号角色、沙箱/fixture/setup/cleanup 与明确审批后，扩增 API lane。页面用例仍由 Playwright 与 Computer Use 双通道；不满足条件的 case 生成明确缺项，而非自动伪造 endpoint/assertion。 | 156 条每条被归档为可执行、部分覆盖、缺环境/契约、需求澄清或 N/A；对于可执行项双通道结果和差异闭环，最终脚本包与报告能复现。 |

## 对 TestPilot 的最小整合决策

1. **现在不换框架、不添加 Browser Use/Stagehand 运行时。** 先用自有 fixture 证明 Computer Use 与单 session 生命周期，当前已有依赖足够。
2. **优先增强 Playwright execution evidence 和导出脚本。** 官方 Playwright Test runner/trace 应作为第一个候选整合；逐步减少独立实现的超时、重试、trace 和 reporter 能力。
3. **API contract 的真实覆盖不能靠 agent 猜。** 继续使用现有 API suite；在有 OpenAPI 后接 Schemathesis。Prism 帮本地 mock/fault injection，不假装是业务 QA 环境。
4. **统一 provider interface。** `BrowserExecutor`、`ApiExecutor` 与 future `ExplorerProvider` 输出同一 `CaseEvidence`/`CaseResult` envelope；保留 `sourceCaseId`、lane、environment、fixture/run ID、coverage gaps、approval record。上游工具只能作为 provider/engine，不定义 TestPilot 判定策略。
5. **公开项目“可用”需 PoC 而非 star 数佐证。** 每个 adapter 必须通过本地 fixture 的正确性、安全边界、session reuse、故障恢复和导出复现测试后，才进入默认安装依赖。

## 主要来源

- Playwright: [仓库](https://github.com/microsoft/playwright), [官方 docs](https://playwright.dev/docs/intro), [license](https://github.com/microsoft/playwright/blob/main/LICENSE)
- Playwright MCP: [仓库/README](https://github.com/microsoft/playwright-mcp), [官方持久 profile 文档](https://playwright.dev/docs/mcp)
- Playwright CLI skill: [仓库 skills](https://github.com/microsoft/playwright-cli/tree/main/skills/playwright-cli), [微软上游 skill](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/skills/playwright-cli/SKILL.md)
- Schemathesis: [仓库](https://github.com/schemathesis/schemathesis), [releases](https://github.com/schemathesis/schemathesis/releases)
- Prism: [仓库](https://github.com/stoplightio/prism), [mocking guide](https://github.com/stoplightio/prism/blob/main/docs/guides/01-mocking.md), [package license/engine](https://github.com/stoplightio/prism/blob/main/packages/http/package.json), [releases](https://github.com/stoplightio/prism/releases)
- Stagehand: [仓库](https://github.com/browserbase/stagehand), [license](https://github.com/browserbase/stagehand/blob/main/LICENSE), [official skills](https://github.com/browserbase/skills)
- browser-use: [仓库](https://github.com/browser-use/browser-use), [license/usage](https://github.com/browser-use/browser-use#license)
- BrowserGym: [仓库](https://github.com/ServiceNow/BrowserGym), [license](https://github.com/ServiceNow/BrowserGym/blob/main/LICENSE)
- Allure JS: [仓库/License/activity](https://github.com/allure-framework/allure-js), [Playwright adapter docs](https://github.com/allure-framework/allure-js/tree/main/packages/allure-playwright)
- 中文背景资料仅作背景、不作为仓库维护/License 依据：[Thoughtworks Radar 第 32 期中文 PDF](https://www.thoughtworks.com/content/dam/thoughtworks/documents/radar/2025/04/tr_technology_radar_vol_32_cn.pdf)。

> 维护活跃度是调研日基于 upstream releases、近期提交/PR 页面得到的快照，不构成未来支持承诺。集成前应针对固定 tag 再查 license、Node/Python 兼容矩阵、依赖许可证和安全公告。
