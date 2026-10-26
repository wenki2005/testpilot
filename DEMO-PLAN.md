# TestPilot 可运行 Demo 计划

本轮在现有 TypeScript CLI 上增加本地 React 工作台与 Node API。以有业务规则的订单 API 为第一套样本，保留原 CLI 命令测试路径，验证通用测试平台的执行闭环。

## 用户方向校准（2026-10-15）

初版 Demo 过度展示了订单 API 网站上的一次性 AI 探索，与产品核心不一致。项目主线应是：AI 根据需求或功能变更起草/更新可复用测试脚本；人审批准后保存为不可变版本；手动或 CI 通过确定性 runner 重跑批准版本，不依赖 AI；探索式测试只负责补充发现候选场景。

当前已实现的 Grammar Lab 样本闭环是受限的首个纵切片：从需求生成 1–12 步声明式浏览器测试候选，由 TestPilot 固定 Playwright Runner 执行；人工批准前不运行；批准后可在无模型配置下重跑保存版本。它验证流程和接口，不代表通用多应用能力或真实模型质量。订单 API 的 AI 探索演示保留为独立的补充功能，不等同于可持久化测试脚本。

## Agent 方案

- 使用维护中的 `@earendil-works/pi-agent-core` 1.2.0 的 Agent 工具循环与 `pi-ai` 模型接入。旧 `@mariozechner` 包已弃用，本轮不采用。
- 需求入口先形成测试计划；探索入口按观察、选择工具、执行、检查证据推进。
- 工具只访问配置的样本服务，禁止任意 shell；固定断言以实际 HTTP 响应判定。
- 提供真实模型模式与明确标注的离线演示模式。离线模式用脚本决策驱动同一 Agent 工具循环，不宣称为模型自主发现。
- 动作预算、运行超时、取消、工具轨迹、未覆盖项与持久化报告贯穿执行过程。

## 演示闭环

1. 运行固定用例，获取每条断言与 HTTP 证据。
2. 用需求测试和自主探索入口执行更多边界与权限检查。
3. 从失败断言保存候选回归用例；复跑同一预期并查看结果。
4. 切换样本的预置修复，再运行测试比较。明确说明这些是预置缺陷与预置修复。

## 本轮范围

实现 API 适配器、Pi Agent 框架接入、工作台、运行历史、证据与报告导出、回归用例保存。浏览器/桌面/移动适配、生产隔离与 CI、多项目评估在后续扩展；本轮不代表原规划中 60 条跨栈用例的完整阶段验收。

## 界面设计

白色与浅蓝灰底（#f4f7fb / #ffffff）、深蓝文字（#172a45）、蓝色操作（#245bd6）、红色缺陷（#c33f47）、绿色通过（#168163）。使用 Segoe UI 与中文系统字体；主布局是左侧导航、中央执行配置与真实运行结果、右侧工具事件流。界面以测试操作、原始证据和可复查的断言为重心，避免营销页面结构。

## 接口

- `GET /api/config` → DemoConfig
- `GET /api/runs` → DemoRun[] (newest first)
- `POST /api/runs` DemoRequest → DemoRun (202; async execution)
- `GET /api/runs/:id` → DemoRun
- `POST /api/runs/:id/cancel` → DemoRun
- `GET /api/runs/:id/report?format=json|md` → download
- `POST /api/target` `{ fixed: boolean }` → DemoConfig (reject while run active)
- `GET /api/regressions` → DemoCheck[]
- `POST /api/regressions` `{ runId, assertionId }` → DemoCheck
- `POST /api/regressions/run` → DemoRun (execute saved checks with identical expectations)
- Sample service under `/sample/*`; contract `GET /sample/openapi.json`.

Shared types live in `src/demo/contracts.ts`. Runtime exports `executeDemo(context, request, checks?)` and `modelConfiguration()` from `src/demo/runtime.ts`. Sample service exports `handleSample(req,res,fixed)` and `defaultChecks`, `defaultRequirements`, `availableRoutes` from `src/demo/sample.ts`.
