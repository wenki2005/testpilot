# 本轮验证记录

## 中断运行恢复增量（2026-10-16）

- `npm run typecheck`、`npm run typecheck:web`、`npm run build`：通过。
- 最新 `npm run test:demo`：45/45 通过（12 个顶层分组）。`tests/document-run-crash-recovery.integration.test.mjs` 覆盖 TestPilot 服务在登录接力等待用户确认时被强制终止；测试在原 Edge 标签页模拟完成登录但不点 TestPilot 确认，重启后确认 journal 与恢复提示标为 `awaiting-login`，再用相同 run ID 恢复并完成两条通道。恢复后的确定性断言验证同一标签页的 sessionStorage 登录态被保留。
- 文档工作流 fixture 完成三轮双通道执行后，把最新运行 journal 置为中断状态并移除最终 run 记录，验证恢复 API 保留原 run ID、增加恢复计数并完成新报告/脚本包；再修改目标网址确认旧运行恢复被 API 以 409 拒绝，且不访问变更后地址。
- 运行记录使用原子写入的 `execution.json` 保存项目摘要、所选用例、目标 URL、阶段和恢复次数；恢复前重新比较项目 digest 和审核状态。若用例、网址或审核状态有变化，接口会拒绝恢复；UI 要用户点击后才启动，且明确说明从所选用例开头重跑，不是步骤级断点续跑。
- 恢复完成后的运行 JSON、Markdown 报告及 ZIP 内 `run.json` 都记录恢复次数和“从头重跑”标记，便于报告使用者区分中断前的尝试与恢复后的完整一轮。
- `/api/browser/status` 在 CDP 与隔离模式分别有集成断言。CDP 模式重启后必须报告连接可达并命中原项目已保存的 DevTools target；设置页每 10 秒刷新状态，不显示调试端点之外的会话秘密。
- 强杀/重启路径使用隔离的 headless Edge，通过本机 CDP 连接；它证明浏览器独立于 TestPilot 服务进程保留，不代表已验证用户日常 Edge 配置或企业 SSO 的认证时效。认证中途的登录提示状态仍未持久化，真实用户 Edge 的恢复也待专门验证。

## D 盘代表性项目初轮（2026-10-16）

- 接入四个 profile 后重新验证：`npm run typecheck`、`npm run typecheck:web`、`npm run build` 通过；最新 `npm run test:demo` 为 45/45 通过（12 个顶层分组）。`tests/demo-integration.test.mjs` 的四项目 profile 子测试通过，包含临时服务与浏览器验收。
- `D:\work\grammar-lab-demo`：只运行 `node tests/model.cjs`，通过；验证 16 个合法状态、20 项内容约束及拒绝 9 类非法状态。没有运行会启动浏览器并在项目 `artifacts/` 写截图的浏览器测试。
- `D:\work\plural-runner-demo`：`node tests/engine.cjs` 通过，覆盖 10,000 个随机种子及 500 局 × 729 条路线的穷举检查。
- `D:\work\word-runner-demo`：`node tests/engine.cjs` 通过，覆盖 10,000 个随机种子及 400 局 × 1,024 条路线的穷举检查。
- `D:\work\book-companion-service-demo`：`npm test` 通过，6/6 domain 测试。
- 以上初轮直接运行的本地测试未连接公网，也未修改这些项目源文件；它们建立了样例项目自身的基线。随后四个项目都已加入 TestPilot profile 集成，具体范围见下条。
- 补充的 TestPilot profile 集成：`grammar-lab` 的现存 model + Playwright 浏览器测试及截图报告通过；`plural-runner` 临时副本运行固定 `npm test`，10,000 个随机种子与 500×729 路线穷举检查通过；`book-companion` 先启动临时服务，再运行 6 个 domain 用例及其多视口/交互 Playwright 验收；`word-runner` 先启动本地服务，再运行 10,000 个随机种子的 engine checks 与 canvas/touch/键盘浏览器套件。两个带浏览器的 profile 均将报告和截图作为运行产物保存。`tests/demo-integration.test.mjs` 验证四个 profile ID allowlist、拒绝路径/命令注入、运行串行门禁、规范化结果及服务重启后的历史保留。四项目 profile 子测试 13/13 通过；最新全套 `npm run test:demo` 45/45 通过。所有目标仅指向 D 盘本地样例副本与 loopback 服务；没有访问公网目标或真实登录账号。

## HTTP API 适配器增量（2026-10-16）

- `npm run typecheck`、`npm run typecheck:web` 与 `npm run build` 通过。
- `node --test tests/api-test-adapter.test.mjs`：10/10 通过，覆盖 CLI 实际启动、JSON 子结构和 header 断言、环境变量凭证脱敏、guest/member/admin 权限矩阵 401/403/200、拒绝 suite 明文凭证、变更请求默认阻断及显式放行、并发门禁、唯一 run-scoped fixture setup/cleanup、断言失败后仍清理、cleanup 失败可见、目标路径前缀限制、跨源重定向不跟随、响应状态不匹配、请求超时、API 套件校验和默认外网阻断。
- Fixture 只运行在本机临时 HTTP 服务，变更请求只写入内存计数；未请求公网 API，也未连接用户目标站点。
- 并发 case fixture 声明 8 个同时请求：未传 `--allow-concurrency` 时目标收到 0 次请求；显式允许后，本地服务观测到请求重叠且 8 条响应断言通过。并发值 51 被套件校验拒绝。
- 完整 `npm run test:demo`：37/37 通过（6 个顶层分组），包含文档工作流摘要 fallback、缺失 ZIP 恢复路径，以及 API 并发/权限矩阵/fixture 生命周期。
- 用最终构建的 CLI 对当前 4331 TestPilot 服务执行实际只读 `GET /api/health`：1/1 通过，HTTP 200；JSON 运行记录只保留 HTTP 断言字段，不冒充进程退出码。报告为 [API 自检报告](./artifacts/api-self-check/2dc18999-a583-44cd-84e0-f7f182117022/report.md)。没有重启服务或发送写请求。
- 该增量尚不包含 OpenAPI 导入、交互式登录/session 获取、自动推断和验证数据清理覆盖范围、持续压力测试与 P95/P99 指标、数据库迁移、工作台/MCP 接入或真实用户目标系统角色授权验证。

## 文档测试工作流增量（2026-10-16）

- `npm run build`：通过，包含服务端 TypeScript、前端 Vite 构建。
- `npm run test:demo`：27/27 检查通过（5 个顶层分组）。覆盖原有 API/脚本生命周期、隔离的模型协议桩、文档测试端到端 fixture、Computer Use 预检故障矩阵和结构化用例/旧项目兼容性。
- 文档测试 fixture 使用本机临时 HTML 目标、临时数据目录、本机 Chat Completions 模型桩和无头浏览器，不连接真实目标站点或配置的外部模型。第一轮确认 `case-selected` 执行、`case-excluded` 不执行且不进入 ZIP；确定性 lane 通过、Computer Use 能力预检因 fixture 明确拒绝而 blocked，运行被正确标记为 `partial`。
- 同一 fixture 连续运行两轮：第一轮向 `sessionStorage` 写入标记，第二轮反选另一用例并检查该标记仍存在；第二轮确定性与 Computer Use 通道均通过，模型桩收到包含当前页面截图的受限工具请求并返回用例结果，最终两侧对齐。它证明 TestPilot 服务进程内确实复用相同页面/会话，而不只是复用磁盘用户目录；模型桩结果不代表真实模型的视觉判断质量。
- 第三轮将本地模型桩的报告摘要请求设为 HTTP 503，同时让两条测试通道通过；运行仍为 `finalReady=true`，Markdown 明确记录摘要 fallback 原因，报告与可复用 ZIP 均可下载且 ZIP 保留 `finalReady`、报告和脚本。fixture 还暂时移除 ZIP 文件验证下载接口返回 404 和重新生成提示，再恢复文件后继续检查归档。完整 `npm run test:demo` 回归通过 27/27。
- fixture 通过真实 HTTP 下载部分运行 Markdown 和 ZIP，检查报告范围、excluded IDs、ZIP 仅含所选用例；并启动 MCP stdio 服务调用 `testpilot_export_web_run`，确认 MCP 返回部分报告及同一脚本 ZIP 资源。
- 测试环境为该工作流提供 `TESTPILOT_BROWSER_HEADLESS=1`；浏览器启动器将空通道变量按“未设置”处理，因此 Windows 默认可使用已安装 Edge。该开关仅供本地测试，不改变默认可见浏览器行为。
- Computer Use 预检独立协议测试通过 6 个场景：有效图片+no-op 工具调用、模型拒绝工具、坏工具参数、工具名不匹配、不支持图片、请求超时。超时场景采用短时本地 mock，不访问外部服务。
- XMind/结构化元数据测试通过：按来源路径推断权限/身份分类；对“待澄清”预期标为低置信度；校验拒绝非法类别、置信度与覆盖领域。旧项目读取时补齐分类、置信度和覆盖领域，保持旧用例 ID，且只在内存中归一化、不静默改写旧项目文件。
- Markdown 报告汇总已识别领域、本轮覆盖领域和本轮未覆盖的已识别领域；这只是整理后用例标签统计，不宣称需求完整覆盖。旧版运行记录的执行范围会标为未知，并仅按留存的逐用例对照计数。
- 人工新增和 AI 候选共用同一验证器；低置信度入选用例在界面提示复核并阻止自动批准。分类、置信度、覆盖领域会进入双通道提示、Markdown 报告和 MCP 用例 schema。
- 修复协议 fixture 隔离：测试在导入 model-settings 模块前设置全新空 `TESTPILOT_DATA_DIR`，防止读取开发机保存的真实模型 API 配置。该 fixture 在最终验证中确认所有模型交互到达本地 mock。
- 未覆盖真实中转站的图片/工具兼容性和真实目标站点认证；这些仍是后续验证项。

2026-10-15，本地 Windows / Node.js 22.23.2。

## 已执行

- `npm run build`：TypeScript 后端与 Vite React 前端构建通过。
- `npm run typecheck:web`：前端类型检查通过。
- `npm run dev -- run --suite examples/sample-suite.json`：原 CLI 命令用例通过。
- `npm run test:demo`：两组集成检查通过，覆盖 10 个具体场景（Node test 汇总计入两个分组，共 12 项）。
- 浏览器实际操作：自主探索离线演示得到 9 条断言，5 通过 / 4 失败，覆盖数量、折扣与权限三类预置问题；保存 3 条代表性回归，同一预期在故障样本中全部失败，在预置修复后全部通过。

## 集成检查的内容

1. 固定用例的正常对照与真实失败响应。
2. Pi 离线工具循环的合同读取、额外场景和证据关联。
3. 样本默认需求的执行计划与断言。
4. 不支持的离线需求和 HTTP 预算耗尽禁止通过。
5. 失败保存回归、原预期复现、预置修复后同预期通过。
6. 报告导出、输入验证、缺少模型配置和来源限制。
7. 历史与回归持久化，重启后可读。
8. 本地 OpenAI Chat Completions **协议模拟端点**实际经过 Pi 适配器，动态登记一个候选检查并执行断言。
9. 计划中的候选检查未执行时，不允许整次运行通过。
10. 模型请求正在等待时取消，以及预先取消的请求不产生 HTTP 操作。

## 结果边界

样本故障与修复都是事先配置的对照。离线探索使用脚本决策，不代表模型自主发现。协议模拟端点用于验证模型调用代码与工具闭环，不能衡量真实模型的理解、规划、误报或缺陷发现能力。本地没有配置真实模型密钥，所以没有运行付费模型效果评估。

本轮实现 API 与 CLI 适配面；没有进行真实浏览器操作型测试 Agent、移动/桌面适配、多应用跨栈覆盖或生产隔离验收。页面上的路由访问范围不能解释成业务状态已穷尽。

## 项目 profile 增量（2026-10-15）

- `npm run typecheck`、`npm run typecheck:web`、`npm run build`：通过。
- `npm run test:demo`：2 个分组、12 项集成检查通过。
- `npm run dev -- run --profile grammar-lab`：通过，TestPilot 记录 1/1 profile case、退出码 0；报告与标准化运行记录保存在 `artifacts/runs/6e7a2273-88e8-4204-843f-d632011d1b83/`。
- 目标 `D:/work/grammar-lab-demo` 的既有 `npm test` 在临时副本中运行：模型测试通过；Playwright + Edge/Chromium 浏览器测试通过，12 条检查、28 个布局组合、0 页面异常/HTTP 错误。浏览器报告和截图已保存在该 TestPilot run 的 `target-artifacts/artifacts/`。
- 用单次 `git -c safe.directory=D:/work -C D:/work status --short` 复查，目标工作区仍干净；未更改 `D:/work` 下项目文件。
- 本轮没有连接真实模型；profile 只执行已有测试，不是需求生成或自主修复验证。

## 工作台本地项目测试增量（2026-10-15）

- `npm run typecheck`、`npm run typecheck:web`、`npm run build`：通过。
- `npm run test:demo`：13/13 集成检查通过。新增检查覆盖：只列出 `grammar-lab` 注册配置；拒绝未知 profile、额外路径/命令字段；防止并发本地运行；等待完整 suite 完成；下载标准化 Markdown/JSON 报告和浏览器报告；拒绝 artifact 路径穿越；服务重启后仍能读取记录。
- 该集成检查实际从临时副本执行 Grammar Lab 文档中的模型 + Playwright/Edge 浏览器测试。profile case 通过、退出码 0；浏览器报告 errors 为 0，28 个布局组合；截图与浏览器报告保存在集成数据目录下的 profile run artifacts 中。
- 浏览器页面中的项目入口仅提交服务端注册 ID；没有接受自由命令、用户路径或客户端 profile 配置。API 仍使用现有回环 host 与 same-origin 守卫。
- 真实模型规划、自动生成/修复测试、多项目覆盖和非浏览器应用类型仍未完成。

## 已批准脚本生命周期增量（2026-10-15）

- `npm run typecheck`、`npm run typecheck:web`、`npm run build`：通过。
- `npm run test:demo`：13/13 检查通过（2 个顶层分组）；项目 profile 生命周期集成场景约 26 秒。
- 集成场景验证 profile ID allowlist、拒绝客户端自由路径/命令、捕获 `package.json` 与两份测试源文件、候选不得执行、人工批准后执行确定性回归、规范化报告记录脚本 ID/版本/SHA-256，以及重启后保留批准状态和运行历史。
- 脚本候选是从配置导入的人工维护快照，不是模型生成。已批准运行使用捕获的 suite 与文件覆盖临时副本，测试目标目录未被修改；当前差异展示命令/用例变化和测试源文件路径变化，尚无逐行源代码 diff。
- 不配置模型也通过已批准脚本路径；该路径不调用 AI。测试集里的本地协议模拟模型检查属于现有 API Agent 的独立集成，不是脚本生成效果验证。

## Grammar Lab 需求到候选脚本（2026-10-15）

- `npm run build`：通过；完整端到端验证由下方 `npm run test:demo` 覆盖。
- `npm run test:demo`：13/13 检查通过。新增 profile 集成在本地 OpenAI-compatible SSE mock 上调用实际 Pi AI/Agent 工具协议，请求一条“数量到达 5 时禁用增加并显示复数”需求，得到受限 DSL 候选；验证 package hook、manifest、TestPilot 固定 runner 和候选快照只持久化在 TestPilot。拒绝候选直接执行，人工批准后停止 mock 模型并重启服务，在无模型配置下执行已保存快照，实际 Grammar Lab Playwright suite 与生成的浏览器断言均通过，报告带有准确版本 ID 和 digest。
- mock fixture 验证 Pi 协议与 TestPilot 限制/执行通路，不代表真实模型能正确理解需求。未调用或评估真实模型。
- 该作者仅适用于登记的 Grammar Lab 和 4 种受限动作；模型不能写任意代码、文件、命令或自动执行。维护/修复脚本、广泛 DOM 检索与其他项目类型仍未实现。

## API 测试 MCP 闭环（2026-10-16）

- `npm run typecheck`、`npm run typecheck:web`、`npm run build`：通过。
- `npm run test:demo`：38/38 检查通过（7 个顶层分组，包含单独 API/MCP 端到端场景）。
- API/MCP 场景使用本机 HTTP fixture：生成 API suite 草稿后，未审核执行返回拒绝；显式审核通过后，MCP 只对本机只读 health 路由执行；随后查询运行状态和报告，并验证 ZIP 含规范 suite 快照、说明、Markdown 报告与 JSON 证据。
- 同一轮 API adapter 检查仍验证环境密钥注入/脱敏、角色矩阵、变更与并发 opt-in、清理 fixture、目标路径和 redirect 隔离、超时与断言失败区分。
- 本轮未连接真实模型或真实目标服务，也未操作 Edge/浏览器会话。当前已构建的 MCP/API 服务端接口需要下次启动服务时加载；为保留当前浏览器/登录会话，本轮没有重启正在运行的工作台进程。

## 主工作台 API 用例编写与审核（2026-10-16 continuation）

- `npm run typecheck`、`npm run typecheck:web`、`npm run build`：通过。
- `npm run test:demo`：40/40 检查通过（9 个顶层分组）。新增套件作者本地协议 fixture 检查目标 Base URL、需求和 OpenAPI 资料上下文、JSON 响应格式、来源/优先级保留，以及外域 API path 被 parser 拒绝。MCP 集成又覆盖了 draft 修订产生新版本/digest、approved 候选拒绝原地修改，以及非工作台草稿不能进入自动运行通道。
- 主工作台现在出现 API 服务目标类型，可提交 PDF/XMind/Markdown/TXT 资料、自然语言需求、粘贴的 OpenAPI JSON/YAML，查看 suite 草稿和各 case 的来源、优先级、请求/预期、身份信息与 fixture，并通过 JSON 编辑器保存新版本。
- 主工作台自动模式只会在服务端确认套件均为 GET/HEAD/OPTIONS、无身份矩阵、无并发和无 fixture 后自动批准运行。外网 Base URL 还需单独选择授权；含变更请求等场景保留审核并在执行时要求显式选项。
- 新增主工作台 UI 集成测试，使用隔离 headless Edge、OpenAI-compatible 本地 mock 和本机只读 API target，实际完成“选 API → 输入需求/OpenAPI → 生成候选 → 自动安全审核与运行 → 查看结果/报告包”。目标只收到一次 GET；公开搜索在这个 fixture 中明确关闭，用于保持本地用例稳定。
- API 测试套件新增持久化列表入口；同一 UI 集成场景会从列表重新打开已批准套件，并确认只读取结果、不自动重跑（目标请求仍只有一次）。
- 当前未连接真实模型或真实外部 API，不能证明模型对未知 OpenAPI 文档的测试质量，也没有跑在线搜索分支的端到端验收。现运行中的浏览器/工作台进程没有重启，新 UI 代码要在后续服务启动后显示。

## OpenAPI 结构化索引与用例追溯（2026-10-16 continuation）

- 使用开源 `yaml` 包解析 JSON/YAML OpenAPI 3.0/3.1 文档；建立受限结构索引，不使用文档 `servers` 改写用户目标。
- 使用开源 `@platformatic/openapi-schema-validator` 3.0.0 按 OpenAPI 3.0/3.1 schema 校验完整文档；调用方不添加外部 sub-spec，库默认不解析外部引用。TestPilot 另外预扫描所有 `$ref` 并拒绝非本地 JSON Pointer 引用，再执行本地追溯解析。
- 模型请求收到解析后的操作、method/path、参数、部分 schema constraints/examples、响应状态/schema、安全方案，不再直接依赖原始文本自己发现结构。
- 保存候选前，服务端检查每条 case 有 source 和 requirementRefs；OpenAPI source 必须对应真实操作，request method/path 与其一致，响应状态必须存在于该 operation 的 responses/default。路径参数必须有文档 example/default/enum，否则候选拒绝。
- 仅展开文档内部 JSON Pointer `$ref`，不会向网络请求引用地址；无法解析的本地引用被拒绝。递归 schema 会在最大深度内展开，并在递归边缘保留 `$ref` 标记。
- 工作台生成的候选保存契约 operation key 列表及已引用/未引用项；编辑草稿时服务端保留原契约基线并重新计算覆盖，报告 scope 和 UI 会显示引用数。直接 API/MCP/CLI 输入携带的同名字段会被丢弃，防止调用方伪造覆盖率。该指标只证明来源关联，不证明所有预期和组合都正确。
- 生成器 fixture 覆盖 OpenAPI 3.0.3 与 3.1 通过、schema-invalid 文档拒绝、参数/schema/security 提取、递归 schema、局部 `$ref`、来源追溯与覆盖计数，并验证非法 YAML、Swagger 2.0、远程/缺失引用、外域路径、请求路径不匹配、未知操作引用与未声明响应状态均被拒绝。UI 集成场景验证 2 个契约操作只引用 1 个时界面显示 1/2，改写来源后服务端将两项都标为未覆盖。MCP 集成验证手工伪造的覆盖元数据不会变成受信元数据。
- 最新验证：`npm run typecheck`、`npm run typecheck:web`、`npm run build` 通过；`npm run test:demo` 40/40 通过；API 作者与 MCP 两项定向 fixture 通过。模型调用使用本地兼容 API 桩，不衡量真实模型用例质量。
- 限制：正式 schema 校验不代表业务行为验证；schema 摘要仍有深度/字段上限，尚未解析所有 media type/encoding 细节、统计必填/枚举/负向用例充分度或按真实服务验证授权行为。

## 场景充分度证据增量（2026-10-16 continuation）

- 新增服务端按操作计算的设计证据：成功场景由引用用例的预期 2xx 状态确认；错误场景仅对声明 4xx/default 的操作要求，并要求引用用例预期 4xx；鉴权场景仅对具有 security requirement 的操作要求，并要求用例明确预期 401/403（角色矩阵至少一身份为 401/403 亦可）。仅声明鉴权不计作覆盖。
- 对参数和 JSON 请求体中的 scalar enum、inclusive 数值上下界及 OpenAPI 3.1 exclusive 数值边界，保存具体目标值、输入位置和成功/错误预期状态类；服务端从 query/path/header/cookie 或 JSON body 中取出值，按类型归一化后与目标值严格比对。每个枚举值/数值边界都单独成项，只有对应的预期状态类正确时才算覆盖。
- OpenAPI 操作追溯还会再次核对引用用例的 HTTP method、路径形状及主断言/角色矩阵的每个预期状态；来源字符串单独改写、路径不匹配或未声明状态不会获得操作覆盖。作者在生成阶段会拒绝声明外的角色状态；手工草稿修订只会把不一致项标成未覆盖。
- 字符串 min/max length、JSON body 数组 min/max items（仅简单标量 items）现在生成合法阈值和阈值外输入；数组参数序列化、嵌套/复杂 items 保持人工核对。正则、组合 schema（allOf/oneOf/anyOf/not）和非 JSON media type仍需人工核对；OpenAPI 3.0 boolean exclusiveMinimum/Maximum按阈值本身应为错误输入处理。这个有限匹配器不等价于完整 JSON Schema 验证。
- 即使某操作所有可自动列出的 enum 值均有用例，只要同一输入还含未支持的 pattern/组合约束，操作级边界状态仍保持“待人工核对”；不能用已命中的部分 checks 清除其他约束风险。
- 候选保存契约事实并在草稿编辑时重新计算；手工提交覆盖数仍被忽略。运行报告区分场景设计证据与真实执行结果，并说明统计只基于预期状态/身份矩阵。
- API 作者 fixture 覆盖 query 参数上所有 enum 值及缺项；独立契约 fixture 覆盖带 Base URL 前缀的 path 参数、query 上下界、header/body enum、JSON body 数值边界、字符串长度和数组数量上下界，检查错误状态类、OAS 3.0 exclusive 语义及伪造来源/路径/状态不增加覆盖。作者 fixture 另验证声明外的角色 418 被拒绝、声明内 400/403 错误和拒绝矩阵被统计；工作台 fixture 检查报告边界摘要、编辑后重算与契约基线保留；MCP fixture继续验证元数据伪造不受信。
- 当前实现的 `npm run typecheck`、`npm run typecheck:web`、`npm run build` 通过；API 作者/UI/MCP 定向集成 4/4 通过；完整 `npm run test:demo` 通过 41/41（10 个顶层场景）。最新全量回归包含该人工复核防误报断言，41/41 通过。
- 这些 fixture 使用本地 OpenAI-compatible mock、headless Edge 与本机 API；未连接真实模型或真实外部目标，因此验证的是数据流和规则，不是模型生成质量或外部服务行为。
- 尚未覆盖：完整 OpenAPI schema 必要性矩阵；组合 schema、复杂数组 item/序列化及非 JSON media type；把实际运行 response 单独关联到用例设计证据；真实服务端授权语义；真实 provider 生成质量。
- `2026-10-16` API run traceability increment: `npm run typecheck`, `npm run typecheck:web`, and `npm run build` passed. `node --test tests/api-test-adapter.test.mjs` passed 10/10 checks; full `npm run test:demo` passed 41/41 checks (10 top-level groups). The local API fixture verified that each executed result carries requirement refs/source/priority as structured fields; Markdown shows the refs and source; expected status/body criteria remain separate from observed HTTP status and scrubbed response evidence. A response-only `apiToken` and environment-backed Authorization value remained redacted in persisted `run.json`. No live model or external API was used in this increment.
- `2026-10-16` API traceability UI increment: `npm run typecheck`, `npm run typecheck:web`, and `npm run build` passed; `node --test tests/api-workbench-ui.integration.test.mjs` and full `npm run test:demo` passed (41/41). Isolated Edge drove the main workbench flow against a local OpenAI-compatible mock and local API fixture, then verified requirement refs/source, expected-versus-actual output, and expanded request/response evidence in the result card. The evidence remained scrubbed by the API runner; no public service, real LLM, or user login session was used.
- `2026-10-16` OpenAPI design-vs-observed assessment: backend/web typechecks and build passed; `npm run test:demo` passed 43/43 checks across 10 top-level groups. Local fixtures prove success-class confirmation, HTTP 404 mismatch against designed success, timeout/no-response, uncovered error target marked not-authored, 401 authorization confirmation, and a declared enum boundary whose actual response is 404. The UI fixture verifies per-operation checks in the result panel; Markdown report includes the same comparison; run JSON carries the assessment in the downloadable package. A runner edge case where omitted `timeoutMs` became a zero-delay timer was fixed to use 10 seconds. Checks distinguish category-level status matching from the full JSON/header assertion result. No real provider or external target was used.
- `2026-10-16` Evidence-grounded targeted API reruns: backend/web typechecks and build passed; `npm run test:demo` passed 43/43. Isolated Edge exercised an approved read-only case returning HTTP 503, showed a deterministic diagnosis, reran only that failed case, then observed HTTP 200 and displayed parent/child `failed → passed` results. The rerun record retains its parent run ID and case IDs while the parent remains separately queryable. The server rejects passing-case reruns, IDs outside the approved suite, and parent runs with a different approved digest; API adapter fixtures verify that setup/cleanup still run around selected cases and invalid selection performs no setup mutation. Existing external target, mutation, concurrency and cleanup gates are unchanged.
- `2026-10-16` Persistent API finding history: backend/web typechecks and production build passed; `node --test tests/api-workbench-ui.integration.test.mjs` passed; full `npm run test:demo` passed 43/43 checks (10 top-level groups). The isolated Edge/local-service scenario recorded a failed 503 case as an open finding, then ran only that failed approved case; HTTP 200 resolved the same stable finding IDs and added open/resolved events to their history. The parent run retained its original failed status and open finding update. The rerun ZIP contains `findings.json` and updated run/report evidence. The workbench exposes open/resolved counts and each issue's occurrence and run history. No live model/provider or external target was used.
- `2026-10-16` Evidence-linked diagnosis and explicit retest proposal: backend/web typechecks and production build passed; isolated workbench and MCP fixtures passed; full `npm run test:demo` passed 43/43 checks. The local workbench scenario produced a same-approved-version 503 finding, requested a diagnosis from persisted run evidence, displayed a deterministic assertion-failure explanation, and required a user click before rerunning only that case. An uncovered OpenAPI operation is classified as a suite design gap and is never offered for rerun; after a successful rerun, the issue diagnoses as resolved. The MCP read-only diagnosis tool returned the same recommendation for an independently created failing case and did not send a second target request. The automatic-run path now refreshes its finding panel immediately after completion. This is deterministic rule-based diagnosis, not AI reasoning; it does not edit cases or execute without the user's click. No live model/provider or external service was used.
- `2026-10-16` CDP browser-tab recovery across service restart: `npm run typecheck`, `npm run typecheck:web`, and `npm run build` passed; the new `tests/browser-session-restart.integration.test.mjs` fixture passed; at that increment full `npm run test:demo` passed 44/44 checks (11 top-level groups). A separately launched headless Edge instance exposed loopback CDP; two independent runtime subprocesses attached sequentially. The first persisted its DevTools target ID locally and wrote a sessionStorage sentinel; shutdown disconnected TestPilot but kept the tab open; the second resolved the same target ID, verified sessionStorage, and navigated the tab. No marker was injected into the target page. This fixture uses a synthetic local page, not a real user login or the user's Edge profile. Interrupted-run recovery was added and verified in a subsequent increment above; the remaining real-user Edge limitation still applies.

## Demo Hub SQLite migration profile (2026-10-16)

- `npm run typecheck`, `npm run typecheck:web`, and `npm run build`: passed.
- Focused `node --test tests/demo-hub-profile.integration.test.mjs`: passed. The TestPilot workbench launched only the registered `demo-hub` profile; all 11 copied local API tests passed, including legacy SQLite migration preserving existing rows and backup verification/restore/tamper rejection.
- The demo-hub profile excludes `.venv`, `data`, artifacts, CloudBase integration code, deployment tooling, and release snapshots from its temporary project copy. The interpreter comes from the project's existing virtual environment; test-created SQLite databases and backup contents live under per-test temporary directories.
- This is application-owned SQLite migration coverage, not a generic TestPilot database migration adapter. No CloudBase endpoint, credentials, publish scripts, or live application were used.
- Follow-up `node --test tests/demo-integration.test.mjs`: 13/13 checks passed, including the expanded five-profile matrix (Grammar Lab, Plural Runner, Book Companion, Word Runner, Demo Hub). The matrix completed in about 115 seconds; the Demo Hub profile contributed one passed process case with all 11 Python tests, including both migration/backup assertions.
- Final full suite `npm run test:demo`: 46/46 checks passed across 13 top-level test groups, including the five-profile matrix. Follow-up focused Demo Hub profile test also passed after adding explicit assertions that excluded private/deployment paths are absent from the disposable copy.

## Generic SQLite migration runner increment (2026-10-16)

- Added `run-migrations` CLI, strict JSON suite validation, project-root SQL file resolution, an in-memory SQLite database per scenario, migration savepoints, exact SELECT row assertions, normalized JSON/Markdown evidence, and a reusable ZIP of the immutable suite plus SQL sources.
- Safety contracts: SQL input cap 512 KB/file and 5 MB total; suite JSON cap 5 MB; 200 statements/file; 500 assertion rows/check; allowlisted DDL/DML only; no network, shell, file-backed database, `ATTACH`, `DETACH`, `VACUUM`, `PRAGMA`, transaction commands, virtual tables or extension loading.
- Synchronous SQLite execution runs in a separate child process with a 128 MB V8 old-space cap and an 8-second hard timeout. A timed-out process is terminated and the case/run is `blocked`. A regression fixture proves a high-cost aggregate is terminated. Other fixtures prove migration savepoint rollback, refusal of ATTACH, path-traversal rejection, exact result evidence and ZIP contents.
- `npm run typecheck`, `npm run typecheck:web`, `npm run build`: passed. `node --test tests/sqlite-migration-adapter.test.mjs`: 3/3 passed.
- `npm run dev -- run-migrations ...` and `node dist/cli.js run-migrations ...`: both passed 2/2 scenarios. The generated run packages contain the suite and SQL snapshots. Node 22 displays its `node:sqlite` ExperimentalWarning.
- Scope: local SQLite only. No DB server, external target, production database, or real sample app was accessed. The runner is not yet wired into the workbench/MCP approval flow; PostgreSQL/MySQL adapters and a general auth/load lifecycle remain future work.
- Follow-up full regression after adding the child-process timeout boundary: `npm run test:demo` passed 49/49 checks across 16 top-level groups. This includes the five registered project profiles, browser/document recovery, API/MCP workflows, SQL ATTACH/traversal refusal, savepoint rollback, and hard timeout -> blocked behavior.

## Structured SQLite migration evidence (2026-10-16)

- Added `sqliteMigration` to normalized `run.json`: exact suite/SQL SHA-256, runtime SQLite version, per-scenario applied migrations/events, and per-check query, expected rows, actual rows and status. Expected failures explicitly record savepoint rollback and the error text.
- Markdown now renders a migration evidence section from those structured fields. The reusable ZIP includes that report and the same `run.json`; a package test compares the digest and rows across the API result, persisted JSON and Markdown/ZIP.
- Re-ran `npm run typecheck`, `npm run typecheck:web`, `npm run build`, and focused SQLite tests (3/3): passed. `npm run test:demo`: 49/49 passed across 16 top-level groups.
- A fresh `tsx` CLI run passed 2/2 scenarios; SQLite version 3.51.3 and suite digest `bffbcba88457679e400efe6a5833683f4f573cc172069587a80584929d86e54f` appear in the report and normalized JSON. Evidence and package are under `artifacts/runs/sqlite-migration-structured-evidence/20546267-ee14-4df3-9bd7-a9782f4480ec/`.
- Still CLI-only: no main workbench suite upload/review lifecycle or migration-specific MCP tools yet. Cross-OS process termination, other SQLite versions, PostgreSQL/MySQL and real application migrations remain unverified.

## SQLite migration API/MCP workflow increment (2026-10-16)

- Added API candidate create/list/get, explicit approve/reject, approved-run, run record, Markdown report, and ZIP package endpoints, plus corresponding MCP prepare/get/review/run/export tools.
- The API accepts only suite JSON and a bounded path-to-SQL map. It validates every declared source path, requires all and only referenced SQL files, caps each at 512 KB and total source at 5 MB, and persists a SHA-256 digest.
- Execution requires an approved candidate whose stored content still matches the digest. The service reconstructs those stored sources into a fresh temporary directory before invoking the existing in-memory SQLite runner; no external DB URL or client path is accepted.
- Manual HTTP lifecycle smoke used the checked-in Demo Hub suite: draft execution was rejected (409), approval enabled the run, both scenarios passed, report returned 200, and the ZIP was 5,472 bytes.
- `npm run typecheck`, `npm run typecheck:web` and `npm run build` passed. `npm run test:demo` passed 51/51 checks across 18 top-level groups, including the HTTP lifecycle fixture, browser UI workflow, and five-profile matrix (about 112 seconds).
- The main workbench exposes a migration suite editor, list, review controls, approved run, structured result view, report/package downloads, and TestPilot ZIP package import. The browser UI integration fixture confirms round-trip package import, path traversal and oversized-source rejection, approval cannot apply to unsaved edits, the reviewed suite runs successfully, downloads appear, and the editors stack on mobile widths.
- Cross-OS process limits, PostgreSQL/MySQL isolation, and use against real application migration sets remain open.

## SQLite reusable package offline replay (2026-10-16)

- Added explicit Windows and macOS/Linux extraction/replay steps to the generated package README. The command uses `run-migrations` on `suite-sources` and requires no AI or network calls.
- Extended the package regression to extract the emitted ZIP to a fresh temporary directory and invoke the built CLI against only those exported files. It asserts the replay passes both scenarios and prints `2 passed / 2 total`.
- `npm run build` and `node --test tests/sqlite-migration-adapter.test.mjs`: build passed and 3/3 migration adapter tests passed, including the isolated offline package replay. Node 22 still emits the documented experimental warning for `node:sqlite`.

## SQLite MCP and Skill parity (2026-10-16)

- Added SQLite migration steps and boundaries to the repository QA Skill and its MCP workflow reference, including explicit approval, immutable digest, in-memory-only scope, deterministic export/replay and honest `blocked` handling.
- Added a real MCP stdio integration fixture. It starts the demo HTTP server and MCP process, checks all six published SQLite tool names, prepares/reads/revises a suite, rejects execution before approval, rejects edits after approval, executes the approved suite, and validates the exported ZIP sources/report/run record.
- `node --test tests/sqlite-migration-mcp.integration.test.mjs`: 1/1 passed. The fixture is included in `npm run test:demo`; collect the new full-suite result after this integration.

## Execution lifecycle race correction (2026-10-16)

- Reordered terminal cleanup so the active execution gate is released before the finished run is persisted and becomes observable. This fixed a stale `409` on an immediately following run.
- Added a regression to `tests/demo-integration.test.mjs`: after the first run reaches its terminal state, it immediately starts a second run and confirms the server accepts it.
- `npm run typecheck`, `npm run typecheck:web`, and `npm run build` passed. Full `npm run test:demo` passed 52 checks across 19 top-level groups, including the new MCP stdio lifecycle test.
- Browser work is still intentionally serialized; the fix covers sequential handoff after completion, not concurrent browser use.

## Document preparation task observability (2026-10-17)

- Website/document intake now returns `202 Accepted` with a preparation task ID. `GET /api/document-preparation/:id` returns its persisted event history and latest stage while background preparation continues.
- The task records planning, reading uploaded materials, public-example search, case authoring, browser-step authoring, and either ready, needs-review, or failed outcomes. Each stage transition is atomically observable through a local JSON record; the workbench polls and displays the current event before opening the prepared project.
- Preparation errors are retained with the task instead of disappearing into a long-running import request. A follow-up integration fixture validates task creation, stage ordering, persisted event history, review handoff, model-less case warnings, and final project retrieval. This fixture also exposed and fixed missing parent-directory creation when storing uploaded source files.
- `npm run build` passed. `npm run test:demo` passed 53 checks across 20 top-level groups, including the new preparation-workflow fixture; both backend and web TypeScript checks passed before the full suite.
- Current boundary: task records survive service restarts and can be queried by ID, but the UI does not yet automatically reconnect to an in-flight preparation after a browser reload, nor can it resume from an interrupted stage. The next orchestration increment should reconcile interrupted preparation records safely and provide UI recovery/discovery without repeating external search or model calls that already completed.

## Real sample-apply case run (2026-10-17)

- Reused the persisted TestPilot project for `https://cdn.yibentushu.com/test-sample-apply/#/home`. The first attempt selected 12/12 cases but all were blocked because the legacy approved project had no reviewed read-only risk metadata; the website was not opened and no login was requested. This confirms unknown risk is held behind the safety gate.
- Reviewed a 4-case read-only subset (home title/entry, navigation to application history, and two notice-copy checks); excluded the other 8 cases due to missing executable steps or unassessed risk. The project now records that subset and the review rationale.
- Live dual-channel run `8cbf870d-6776-4e9e-9c51-d236246ff24a`: script 1/4 passed, Computer Use 3/4 passed, 0/4 aligned; overall `unresolved`, with partial report and ZIP package ready. No login handoff was triggered. Computer Use used the configured DeepSeek-compatible vision/tool endpoint and the same TestPilot browser session; no application form was submitted.
- Live findings: the page's right header says `历史申请` while the requirement case expects `申请记录`; the script's substring assertion falsely passed because other page text contains `申请记录`, while the visual lane noticed the header-label mismatch. A script click expecting button name `申请记录` timed out, while Computer Use clicked the visible `历史申请` control and reached the history screen. The page's notice copy is `如有调样、周边产品等样书申请需求，请联系运营OA申请`; deterministic substring checks failed against the shorter requirement phrase, while the visual lane incorrectly marked semantically similar copy passed. The history screen showed an empty state, so no application number rows were available.
- Corrective code in this increment adds explicit exact text and exact accessible-role assertion steps (`assertExactVisible`, `assertRoleVisible`) for deterministic and exported runners, plus planning prompt guidance and stricter visual instructions for quoted expected wording. The live run above predates these code changes because the active TestPilot process/browser session was kept open; the stricter assertions are covered by local build and regression checks, and need a subsequent live rerun after a controlled service restart.
- Final verification after the assertion DSL and Computer Use prompt changes: `npm run build` passed; focused metadata/preparation fixtures passed 7/7; full `npm run test:demo` passed 53/53 checks across 20 top-level groups. These local fixtures verify the new action schema and all existing integration paths. The 2026-10-17 live sample-apply execution predates the stricter prompt/DSL changes, so live-provider adherence and live corrected-script outcomes are not yet verified.

## Final assertion and Computer Use fixes (2026-10-17)

- Added authoritative server-side checks for every reviewed `assertExactVisible` / `assertRoleVisible` predicate after Computer Use reports. A model-reported pass is downgraded to failed when the shared browser page lacks an exact required text or accessible control. A regression fixture deliberately lies about a missing exact string and proves the server rejects the pass.
- Fixed the Computer Use capability probe: its hard-coded 1×1 PNG was invalid and was rejected by the configured relay. Replaced it with a valid PNG, disabled DeepSeek V4 thinking for the tool-capability probe, raised the response budget, and added finish-reason/tool-call diagnostics. The configured `deepseek-v4.1-flash` settings check now returns `computerUse.available=true`.
- Added `clickExactText` with high-impact action safeguards, added the action to AI step generation and the packaged runner, and bounded visual keypress schemas to exclude Enter. Added a guarded native-select fallback for unlabeled fields; its local fixture verifies nearby-label uniqueness, selection, and ambiguity rejection.
- Final sample-app run `da178109-3fa9-4c89-86bd-f8f812df646c` used the same persisted browser session and needed no login handoff. Three selected read-only cases finished **fully aligned** (3/3): history navigation and empty-state assertions passed in both lanes; the exact header label and notice copy failed in both lanes. `finalReady=true`, a report and reusable ZIP were generated, and no form submission occurred. Product result is `failed` because the live application differs from the supplied requirement text, not because the two test lanes disagree.
- Original case 4 was excluded from this final batch: it duplicates the notice wording while requiring a custom, initially unnamed usage selector. Computer Use selected it visually, but deterministic selection could not locate its unlabeled custom control; a two-click text attempt was unreliable. The agent reports that coverage gap instead of claiming a pass. A dedicated deterministic interaction for that custom selector remains future work.
- Verification: `npm run build` passed; focused document/Computer Use tests passed 8/8, including the new unlabeled-select fixture; the document-workflow false-pass integration test passed. The latest full `npm run test:demo` run had 51/53 checks pass: the two failures are one D-drive `book-companion` profile case and its enclosing test, caused by that project's audio browser acceptance flow timing out while waiting for the next caption after seeking near clip end. Its domain test passed. This is outside TestPilot's changed code; the complete suite had passed 53/53 earlier in this work.
