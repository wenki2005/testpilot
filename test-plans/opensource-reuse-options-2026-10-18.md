# TestPilot 开源复用调研（2026-10-18）

## 结论

没有找到一个成熟开源项目可以安全接管 TestPilot 的完整链路：156 条需求用例保真导入、脚本可执行性审查、共享登录态双通道、逐条对比、复测决策和可追溯报告。建议保留 TestPilot 的用例库存、只读 DSL、安全门和对比器，复用成熟执行器、MCP 浏览器协议、测试生成思路和报告附件格式。

## 优先复用

| 项目 | 许可证/证据 | 可借鉴模块 | 接入边界 |
| --- | --- | --- | --- |
| [Microsoft Playwright](https://github.com/microsoft/playwright) 与 [Playwright Test Agents](https://github.com/microsoft/playwright/blob/main/docs/src/test-agents-js.md) | Apache-2.0；上游主项目 | 保留为确定性执行与可复用脚本运行时；参考 Planner → Generator → Healer 的任务分工 | Healer 的 locator 修复要生成新草稿并留痕；不能把修复后成功覆盖首次失败，不能捏造业务数据 |
| [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) | Apache-2.0；项目 README/发布记录显示持续维护 | 用于浏览器会话、可访问性快照、已登录 tab/CDP 复用的能力设计 | 它明确不构成安全边界；TestPilot 必须继续通过自己的只读 DSL、域名允许列表、side-effect gate 和单会话锁来管控动作。不要在测试中另开浏览器实例 |
| [mustafaautomation/ai-testgen](https://github.com/mustafaautomation/ai-testgen) | MIT | PRD/OpenAPI/story 多输入、结构化测试工件与 provider adapter 设计 | 仅借鉴输入和产物 schema，不替代 TestPilot 的用例追踪、风险校验或结果对比 |
| [TinasheBA/playwright-ai-testgen](https://github.com/TinasheBA/playwright-ai-testgen) | 采用前需再次核对仓库许可证 | acceptance criteria 与断言覆盖、定位器检查、编译门的设计 | 断言数量/关键词覆盖不能证明语义覆盖；只可用作草稿质量预检 |
| [Jaredxh/AITestPlatform](https://github.com/Jaredxh/AITestPlatform) | MIT | 数据夹具可信度、失败类型、登录态复用、运行证据、Skill 与报告流程设计 | 项目体量较小，作为模块级参考，不建议整体迁移 |
| [ywq2019/ai_test_agent](https://github.com/ywq2019/ai_test_agent) | MIT | LangGraph 多引擎/Skill 状态机分层 | README 描述的能力需逐项验证；不应为引入框架而重写现有执行状态机 |
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | MIT | Computer Use lane 的 Python agent、重试与观察设计 | 会增加 Python/Agent 运行时；当前优先保持 TypeScript + Playwright，并只借鉴隔离的恢复策略 |
| [Allure JS](https://github.com/allure-framework/allure-js/tree/main/packages/allure-playwright) | 仓库内 Allure Playwright 集成 | 附件、步骤与证据的可读展示 | 可作为报告渲染插件；case ID 对齐、差异分类和“是否重测”是 TestPilot 业务逻辑，需保留自有 comparator |

## 中文搜索结果和许可风险

- [XiaoyunDYX/Auto_Test_Engine](https://github.com/XiaoyunDYX/Auto_Test_Engine) 描述 PDF/DOCX 需求到结构化需求、DSL、Playwright/Pytest 的链路；本次检索未确认许可证，未列入可直接复用项。
- [Jaredxh/AITestPlatform](https://github.com/Jaredxh/AITestPlatform) 与 [ywq2019/ai_test_agent](https://github.com/ywq2019/ai_test_agent) 是中文生态中较接近的端到端原型。可参考数据/状态处理和编排，但需跑自己的兼容验证。
- [SleepyWithoutCoffee/CATJudge](https://github.com/SleepyWithoutCoffee/CATJudge) 是学术性代码驱动 Agent 测试参考；提交较少，且未确认许可证，不 vendoring。

## 对 TestPilot 的具体改进次序

1. 保留当前已实现的文档/XMind 导入、全量用例清单、case ID、只读 BrowserStep DSL、共享 Edge 会话和差异比较。
2. 将所有结果分类为：脚本/页面能力缺失、登录身份缺失、夹具或接口契约缺失、需求待澄清、真实产品失败、运行器瞬时故障。模型生成失败与业务前置条件必须分别展示。
3. 参考 Playwright Test Agents 的 planner/generator/healer 职责，把生成的修复脚本作为新草稿；保留原脚本、首次结果、修订原因和复测链接。
4. 参考 Playwright MCP 持久浏览器会话设计，但让 CUA 与确定性 lane 只连接 TestPilot 所有的同一个受限上下文。当前共享会话要串行运行，不能声称两条 lane 是独立验证。
5. 只有取得经确认的隔离账号、业务数据和服务端契约后，才生成角色矩阵、库存/订单、审批回调等测试；不以公开 H5 的静态页面推断这些服务端事实。
6. 增加生成质量 gate：每条脚本必须逐条映射验收点，包含具体断言；无直接页面证据或前置数据时保存清晰的阻塞原因，不能把标题可见算成通过。
7. 后续评估 Allure 附件格式以丰富报告；保持 TestPilot 的全量清单、未覆盖项、双通道比较、复测链路和 scope-aware readiness 为报告来源。

## Skills

当前环境已经有项目级 `testpilot-qa-workflow` 与 `testpilot-api-contract-fixtures` 两个 Skill，分别规范文档驱动双通道流程和 API 契约/夹具测试；没有发现需要另装的必需 Skill。本轮不安装通用浏览器自动化 Skill 来绕过 TestPilot 安全门，也不从许可证不明仓库拷贝 Skill。
