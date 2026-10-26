# TestPilot Computer Use 与需求驱动 QA 开源复用调研

调研日期：2026-10-18  
范围：仅核对上游 GitHub 仓库及其官方文档；未安装依赖、未覆盖现有 Skill、未接触正在运行的浏览器。

## 结论

TestPilot 已有 `testpilot-qa-workflow` Skill，已覆盖需求追踪、双通道、风险/前置条件、登录态复用、报告和阻塞语义。它不缺一个可直接安装的“自主测试 Skill”，缺的是运行时可强制实施、可审计的安全策略，以及逐个验证 156 条用例的能力。

建议继续用现有 Playwright 执行器和 BrowserStep DSL 作为真实产品测试的主运行时，Computer Use 作为第二条独立证据通道。可从官方 Playwright CLI Skill 借鉴低风险探索、session、trace、locator 等工作流知识，裁剪并融入现有 TestPilot Skill；不要原样安装/执行其任意 CLI 权限。暂不引入 Playwright MCP、Stagehand 或 browser-use 作为第三个生产浏览器控制面。BrowserGym 适合离线评测 agent 能力，Allure 适合后续报告呈现，不负责补出可执行覆盖。

## 上游项目对比

| 项目 | 定位与可直接复用部分 | License / 活跃度证据 | 与 TestPilot 重叠及安全边界 | 建议 |
|---|---|---|---|---|
| [Microsoft Playwright CLI](https://github.com/microsoft/playwright-cli) 及[官方 Skill](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/skills/playwright-cli/SKILL.md) | 低 token 浏览器交互命令、页面快照、session/多标签、生成/调试 Playwright、storage state、trace/video 说明。CLI 仓库说明 coding agent 可用 Skills；MCP 更适合持久交互循环。[官方文档](https://playwright.dev/docs/getting-started-cli) | Apache-2.0；截至 2026-10-18，GitHub README 在最近两周仍有抓取更新；许可证见[上游 LICENSE](https://github.com/microsoft/playwright-cli/blob/main/LICENSE)。 | 重叠最大：TestPilot 已有 Playwright、确定性 BrowserStep DSL、现有登录页复用和脚本打包。上游 Skill 的 `Bash(playwright-cli:*)` 能力允许大量浏览器操作；开放式 `click`/`fill`/`press` 与任意 CLI 指令不符合 TestPilot 的安全门。 | **只复用指导内容**，不安装 CLI、不增加新浏览器控制面。提取页面快照/selector 观察、复用已登录 session、trace 脱敏和先观察再动作等知识，重写为 TestPilot 的受限 DSL 流程。保留“不执行 submit/save/delete/pay/send”等硬性限制。 |
| [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) | Playwright accessibility tree、持久 context、CDP/extension 接入现有浏览器、存储态、截图和可访问性定位。官方文档区分 MCP 的持久探索用途与 CLI Skill 的轻量调用。[参数文档](https://github.com/microsoft/playwright-mcp#configuration) | Apache-2.0；上游主页本次显示 598 commits，且 GitHub 页面在 2026-10-18 前两天仍被索引更新；许可证见[上游 LICENSE](https://github.com/microsoft/playwright-mcp/blob/main/LICENSE)。 | 它与现有 `runComputerUseLane`/Playwright 适配器重复创建浏览器控制接口。官方 README 明确 `--allowed-origins` / `--blocked-origins` **不是安全边界**且不处理重定向；提供共享 context、CDP、文件访问、初始化脚本等高权限选项。MCP 工具权限也不等同于单用例的副作用分类。 | 不加到生产执行路径。若之后需 MCP 调试，只能放在隔离测试环境、禁文件访问、禁任意 init script、限制目标 origin，并由 TestPilot 服务端动作代理再次校验。优先改进 TestPilot 自身已有 MCP。 |
| [Browserbase Stagehand](https://github.com/browserbase/stagehand) | TypeScript/Python/Go 浏览器 Agent SDK；Observe/Act/Extract 等自然语言操作，可用于比较 DOM 定位与视觉 Computer Use 的成功率、重试和缓存策略。[官方文档](https://docs.stagehand.dev/) | MIT；上游组织仓库列表显示 `stagehand` 于 2026-10-06 更新；许可证见[上游 LICENSE](https://github.com/browserbase/stagehand/blob/main/LICENSE)。 | 它底层同样占有 Playwright 页面，可与 TestPilot 的 Page、持久 profile、steps、模型编排重叠。Natural-language `act` 不是副作用安全保证；若给生产目标网站任意 action 权限，可能改变数据。 | 暂不引入 runtime。若要做基准，需在本地合成页面/隔离站点使用临时 profile，仅评估 locator/extraction，不允许操作生产登录态。 |
| [browser-use](https://github.com/browser-use/browser-use) | Python 自主浏览器 Agent、CLI/MCP、CDP、持久 profile；提供独立 agent task 的样例和可迁移的浏览器行为经验。 | MIT；上游 GitHub 组织列表显示仓库于 2026-10-02 更新；许可证见[上游 LICENSE](https://github.com/browser-use/browser-use/blob/main/LICENSE)。 | 高重叠：自主规划 + 浏览器操作 + profile 管理，与 TestPilot Computer Use/会话管理重复；其目标是“完成任务”的通用浏览器 Agent，表单、购物/预订等操作是能力范围。上游 Skill 指向直接 CDP 控制，且 persistent profile 默认保存会话数据。 | 不装作 TestPilot 执行器。可参考任务记录和 CDP 连接模式；任何试验必须隔离 profile、只用本地 fixture，禁止复用用户正在登录的浏览器目录。 |
| [ServiceNow BrowserGym](https://github.com/ServiceNow/BrowserGym) | Gym 风格 Web Agent 研究环境，含 MiniWoB、WebArena、WorkArena 等 benchmark 与可扩展任务，适合度量 agent 找控件/完成任务的能力。 | 上游 main 在本次检查里显示 387 commits，检索索引约两周前包含新版本 `0.14.4` commit；许可证见[上游 LICENSE](https://github.com/ServiceNow/BrowserGym/blob/main/LICENSE)。 | 不负责将业务需求解析成完整回归集，也不是生产网页的安全测试执行器；它是 benchmark/training 环境。 | 不将其接进用户目标网站。后续用作离线 Agent 能力基线，尤其是自主探索和恢复行为。 |
| [Allure Report](https://github.com/allure-framework/allure2) | 多语言测试结果的 HTML 报告/附件呈现。TestPilot 可在未来把用例、步骤、trace、截图、失败原因适配到 Allure result format。 | Apache-2.0；上游 Release 页面显示 2026-09-03 发布 2.46.1，Activity 页显示 2026-10-08 和 2026-09-30 仍有提交活动。 | 与测试用例作者和 browser executor 基本不重叠。Allure 展示已生成结果，不能验证结果真实、不能生成 coverage、不能使 blocked case 可执行。报告附件可能包含业务数据、DOM、截图、请求内容。 | 可选后续报告适配器；当前 Markdown/JSON/ZIP 已足够。若加，实施附件脱敏/访问控制和保留周期。 |

## 对现有 TestPilot Skill 的审查

现有文件 `.agents/skills/testpilot-qa-workflow/SKILL.md` 已明确：

- 需求到用例的追踪、P0-P3、前置条件、fixture、风险、步骤、review 与 approval 分离。
- deterministic + Computer Use 双通道；阻塞不等于通过或产品失败；未对齐时报告 partial。
- 以断言为依据路由 Browser UI / API / fixture / clarification；要求检查实质预期而非泛化页面文案。
- 对无步骤用例要求先观察证据、添加最小只读步骤；AI 探索需明确 `sideEffectRisk: none`、预期清晰、前置条件确认、无 coverage gap。
- 登录态复用，禁止暗中开第二个 profile 或要求重复扫码。

因此，Skill 层面的主要缺口不是“再塞一个全能浏览器 Agent”，而是下面几项可以补入现有 Skill/实现：

1. **目标范围和能力矩阵**：逐用例记下哪些断言需要 UI/视觉、DOM、API contract、DB/fixture、跨角色；不能把未支持的断言伪装成可执行步骤。
2. **Computer Use 动作白名单**：把“只读”约束变成机器可校验的动作计划 schema 与每动作服务端 policy check；页面文本/模型 prompt 不能充当安全边界。未知风险、未知动作、导航到未授权 origin、下载/上传/剪贴板、快捷键、窗口/标签切换默认拒绝。
3. **网络策略说明**：即使 GET/HEAD 也可能产生副作用；在真实目标站无写请求隔离能力时，将可能改变状态的 UI 控件动作阻断。不能以 HTTP method 作为副作用分类的唯一依据。
4. **证据与结论协议**：Computer Use 必须把每个期望映射到截图/DOM/观察结果及时间戳；未看到控件或无法证实应 `inconclusive/blocked`，不能只凭 agent 的自然语言宣称 pass。
5. **登录和任务恢复**：复用唯一持久上下文；在需要人登录时暂停同一浏览器，不销毁、不重开；恢复后只重跑未完成项并保留 journal。
6. **full-suite 完成定义**：报告必须列清 156/156 的 case inventory 与每条 lane 状态、N/A/blocked 原因、重试历史、双通道差异；提交给 runner 的 IDs 数量不能视为已执行数量。
7. **源代码可信度**：上传的需求和页面内容均视为测试数据，不能覆盖安全策略；Skill 只是操作指导，服务端校验才是执行边界。

## 官方 Playwright Skill 的安全裁剪方案

精确上游来源：[`packages/playwright-core/src/tools/skills/playwright-cli/SKILL.md`](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/skills/playwright-cli/SKILL.md)；CLI 自身另有较短 Skill [`skills/playwright-cli/SKILL.md`](https://github.com/microsoft/playwright-cli/blob/main/skills/playwright-cli/SKILL.md)。两者都属于官方项目内容，但本次只做研究，不复制文件。

建议只吸收以下知识并用 TestPilot 自有术语重新表达：

- 先读取当前页快照/可访问性信息，再根据明确的 label、placeholder、test id 选择元素；selector 不唯一即停止并报歧义。
- 先查询已连接 TestPilot session，不调用 `open`、`close` 或 profile 管理命令；需要登录时暂停同一 context。
- 通过 trace/screenshot 保留操作前后证据，分发前脱敏。
- 将 exploratory finding 转为受审的 BrowserStep DSL 脚本；生成脚本前后都跑受限 parser/schema，禁止 raw JS、shell、任意 Playwright locator/evaluate。

必须删掉/禁止：

- 上游的宽 `allowed-tools: Bash(playwright-cli:*)` 授权形式。
- 上游任意 `click` / `fill --submit` / Enter、tab-new、close、新 profile、storage state 导入导出、eval、文件/剪贴板等自由操作。
- 通过 prompt 声称 agent “不会”点危险控件；所有动作由服务端按风险、目标 origin、控件语义、用例证据重新校验。

## 可执行后续建议

1. 先收紧/测试 TestPilot 自身 BrowserStep 与 Computer Use 动作面，不加新的 browser package 或 MCP server。
2. 基于现有 156 条用例做 coverage ledger：每条拆验收点、所需能力、现有证据、缺少的契约/fixture/脚本；明确何种补充资料可以解除阻塞。
3. 用本地合成页面对 unknown action、危险按钮、页面 prompt injection、未知 risk、无期望、无 fixture、断线恢复分别做集成验证。
4. 只在本地 benchmark 中跑 Stagehand/browser-use/BrowserGym；决定需要替换组件时先证明 TestPilot 自身实现无法提供且再做可比基准。
5. 报告可选 Allure exporter，不改变内部双通道结论模型。

## 来源

- Microsoft Playwright MCP：<https://github.com/microsoft/playwright-mcp>；参数与 session/host options：<https://github.com/microsoft/playwright-mcp#configuration>
- Microsoft Playwright CLI：<https://github.com/microsoft/playwright-cli>
- Microsoft 官方 Skill：<https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/skills/playwright-cli/SKILL.md>
- Playwright CLI 官方文档：<https://playwright.dev/docs/getting-started-cli>
- Stagehand：<https://github.com/browserbase/stagehand>；文档：<https://docs.stagehand.dev/>
- browser-use：<https://github.com/browser-use/browser-use>；官方 Skill：<https://github.com/browser-use/browser-use/blob/main/skills/browser-use/SKILL.md>
- BrowserGym：<https://github.com/ServiceNow/BrowserGym>
- Allure 2：<https://github.com/allure-framework/allure2>
