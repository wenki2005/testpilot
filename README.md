# TestPilot Demo

TestPilot 的核心方向是持久化、可复用的自动化测试脚本生命周期：脚本可被审核、批准并版本化，再由人工或 CI 确定性重跑。当前 Grammar Lab 支持人工导入现有套件，也支持 AI 从一条需求生成受限 Playwright DSL 候选；两种候选都必须经人工批准，再以无模型确定性 runner 执行。现有 API Agent 工作台仍是独立的探索演示，不等同于已批准的可执行脚本。

## 启动

需要 Node.js **22.19 或更新版本**与 npm。

```powershell
npm install
npm run build
npm run demo
```

打开 http://127.0.0.1:4317 。`PORT` 可覆盖端口。前端修改后运行 `npm run build:web`，或通过 `npm run dev:web` 使用 Vite 开发服务。

## 如何演示

1. 保持样本为「预置缺陷」，运行「已有用例」。查看正常对照与负数数量检查的实际结果。
2. 选择「自主探索」并运行离线演示，查看依据 API 合同补充的折扣边界与未认证导出检查。展开失败断言，核对预期、响应与重现请求。
3. 将失败断言保存为回归用例，在回归页复跑，确认问题仍能重现。
4. 将样本切换为「预置修复」，复跑同一回归用例。预期不变，实际响应应符合断言。
5. 查看历史、执行轨迹、访问范围和未覆盖内容，下载 JSON/Markdown 报告。

样本中的缺陷与修复均为预置演示开关，用于展示发现、证据、回归流程。OpenAPI 合同描述业务规则，不向 Agent 提供缺陷答案表。

## 两种决策模式

**离线演示**不需要密钥。脚本决策驱动真实 Pi Agent 工具循环，执行真实 HTTP 请求，由代码比较状态码与 JSON 预期。离线模式支持预置样本场景，自定义需求会被阻塞；它不代表模型自主推理或未知应用的缺陷发现能力。

**真实模型**通过 Pi AI 对接配置的模型，使用受限工具形成计划、执行检查并观察结果。也可在工作台「设置」中配置 OpenAI 兼容 API 根地址、模型名称和密钥，并验证 endpoint 是否支持 tool calling；设置由本地服务保存，页面不会回读密钥。配置后的 UI 设置优先于环境变量。密钥保存在本机 `artifacts/demo/model-settings.json`，该文件不会被加入版本控制。复制 `.env.example` 为 `.env` 并填写密钥仍然可用；也可以预先配置环境变量：

```powershell
$env:TESTPILOT_API_KEY="your-key"
$env:TESTPILOT_MODEL="your-model-id"
# 可选：兼容端点，按服务要求包含 /v1
$env:TESTPILOT_BASE_URL="https://your-endpoint.example/v1"
npm run demo
```

模型不可用时明确阻塞。模型生成的是候选测试与候选缺陷，业务预期仍需复核。密钥只在本地服务端使用，不返回浏览器或写入报告。网页 Computer Use lane 使用配置的兼容 Chat Completions 接口和自定义工具调用；中转站/模型须实际支持所需工具调用，配置可保存或普通文本对话成功都不代表视觉动作可用。

## Agent 框架与范围

使用维护中的 `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai` 1.2.0，复用 Agent 状态、工具调用与事件循环。产品自行管理测试用例、适配器、固定预期、动作预算、取消、证据和报告。

```text
React 工作台 / 原有 CLI
        ↓
本地 Node 编排与运行记录
        ├─ 固定用例 → HTTP 断言 / 原有 command runner
        └─ Pi Agent → 计划 → 受限 HTTP 工具 → 响应证据 → 代码断言
        ↓
报告 / 历史 / 人工保存候选回归 / 相同预期复跑
```

API Agent 的访问范围固定为内置 `/sample/*` 服务，不开放任意 shell。达到动作或时间预算后停止，未执行的部分不会标记通过。覆盖统计表示被访问的 API 路由，不能解释为已穷尽所有业务状态。

该 API Agent 演示本身尚未实现浏览器自动操作。TestPilot 的文档驱动工作流另有网页测试入口；整个产品仍未提供移动/桌面应用适配、任意目标环境注册、生产 worker 隔离、团队权限与 CI。可沿用测试用例、工具、证据与报告模型，逐个加入目标适配器。

## 原有 CLI

```powershell
npm run dev -- run --suite examples/sample-suite.json
```

原命令执行器保留项目根目录约束、超时、退出码、stdout/stderr 与 JSON/Markdown 报告。CLI 的 `plan`、`explore` 仍是旧占位入口；本轮已接入的 Pi Agent 功能从工作台访问。

### 声明式 HTTP API 回归

CLI 另提供无模型的 `run-api` runner，用 JSON 保存 HTTP 用例，可断言状态码、响应头、JSON 子结构和响应时间，也可为单条用例声明并发请求数（上限 50），并生成同样的 JSON/Markdown 运行证据：

```powershell
npm run dev -- run-api --suite examples/api-suite.sample.json --base-url http://127.0.0.1:4317
```

套件中的路径必须留在配置的目标 origin 和 path 前缀内，runner 不跟随重定向；请求/响应证据会遮盖常见凭证字段，单个响应最多保留 1 MB、单轮证据总量最多 5 MB。默认只允许回环地址，外部环境须明确传 `--allow-network`；POST、PUT、PATCH、DELETE 默认标记为 blocked，需明确传 `--allow-mutations` 才会发送。并发请求默认 blocked，需在 suite case 中设置 `"concurrency": 8` 等并传 `--allow-concurrency`；每条用例最多 50 个同时请求。动态凭证可在请求头或 JSON 字符串中写 `${ENV:VARIABLE_NAME}`，从本机环境变量读取且在证据中脱敏。需要写数据时，suite 可定义显式 fixture setup/cleanup；runner 不会自动推断副作用或清理覆盖，生产环境不应作为测试目标。

可用 `principals` 加 `accessControl` 写同一资源的角色权限矩阵。每个角色必须配置自己的预期状态码，不能从一个角色的结果推断另一个角色的权限；凭证请求头只接受环境变量引用：

```json
{
  "principals": {
    "guest": {},
    "member": { "headers": { "authorization": "Bearer ${ENV:MEMBER_TOKEN}" } },
    "admin": { "headers": { "authorization": "Bearer ${ENV:ADMIN_TOKEN}" } }
  },
  "cases": [{
    "id": "export-permission",
    "title": "Export endpoint enforces roles",
    "request": { "method": "GET", "path": "/api/export" },
    "expect": { "status": 401 },
    "accessControl": {
      "principals": ["guest", "member", "admin"],
      "expectByPrincipal": {
        "guest": { "status": 401 },
        "member": { "status": 403 },
        "admin": { "status": 200 }
      }
    }
  }]
}
```

角色矩阵保留一条可追溯用例结果，同时在证据中分别记录各角色的请求和响应；常见凭证字段会脱敏，原始 token 不会写入运行报告。

### SQLite schema migration 验证

CLI 提供 `run-migrations`；本地工作台 API 和 MCP 也提供 suite 草稿、读取、显式审核、执行、证据读取与导出。按 JSON 套件在每条 scenario 独立的 SQLite 内存数据库中执行 baseline、fixtures 和指定迁移，然后用只读 `SELECT` 精确核对数据/schema。迁移语句在 savepoint 内运行；可声明某个末尾迁移预期失败，并检查回滚后的数据库状态。默认示例演示字段新增与数据保留、迁移中途失败回滚，以及 SQL `ATTACH` 拒绝：

```powershell
npm run dev -- run-migrations --suite examples/migrations/demo-hub-sqlite/suite.json --project-root examples/migrations/demo-hub-sqlite
```

runner 只接受项目根目录中的 `.sql` 文件；每文件最多 512 KB、每套件源码最多 5 MB。只允许 CREATE TABLE/INDEX、ALTER/DROP TABLE/INDEX、INSERT/UPDATE/DELETE；拒绝 `ATTACH`、`DETACH`、`VACUUM`、`PRAGMA`、事务控制及扩展加载。每个 scenario 在独立子进程中运行，V8 heap 上限为 128 MB、硬时限为 8 秒；超时会终止子进程并标为 blocked。断言最多读取 500 行。JSON 报告包含 SQLite 版本、suite SHA-256、迁移事件和每项检查的 expected/actual rows；Markdown 显示相同信息。ZIP 保留 suite、SQL 快照和完整运行证据。此适配器只覆盖 SQLite；不连接本机文件型数据库、PostgreSQL/MySQL、外部服务或生产环境。

通过工作台或 MCP/API 提交的套件必须附带所有声明的 SQL 文件；服务端会验证路径、SQL 大小与套件结构，计算 SHA-256。审核后版本不可变，运行时从锁定内容重建隔离目录，防止候选存储文件被改写后执行未审核源码。工作台的“更多 → 数据库迁移测试”提供 TestPilot ZIP 脚本包导入、JSON/SQL 编辑、草稿保存、审核、运行和报告/脚本包下载。导入会创建新草稿，拒绝路径穿越、超过 200 个文件或解压内容超过 5 MB 的归档。

ZIP 中的 `README.md` 提供重新运行命令。把 ZIP 解压到 TestPilot 仓库下的 `artifacts/imported-migrations`，然后执行 `npm run dev -- run-migrations --suite artifacts/imported-migrations/suite-sources/suite.json --project-root artifacts/imported-migrations/suite-sources --out artifacts/runs/sqlite-replay`。该 runner 是确定性的，不需要 AI 模型或网络连接；运行会创建全新的内存数据库，并在失败、受限或错误时返回非零退出码。

需要真实建立并清理测试数据时，可在 suite 添加 `fixtures: { setup: [...], cleanup: [...] }`，使用 `${RUN_ID}` 在请求路径、JSON 字符串或请求头中生成每轮唯一的合成记录标识。任何 POST/PUT/PATCH/DELETE 用例都必须提供 cleanup，并在变更请求中引用 `${RUN_ID}`；cleanup 也必须指向该标识。setup 未通过会阻止业务用例执行，cleanup 仍会在结尾运行（反序），断言失败或异常时也会尝试清理。若 cleanup 自身失败，运行会如实失败。发送任何写请求仍需 `--allow-mutations`。TestPilot 不会推断 cleanup 是否真的覆盖全部副作用，因此应只在隔离测试环境使用，并在 suite 内验证删除结果。

CLI、MCP 和主工作台均可调用同一确定性 API runner。主工作台的“API 服务”模式接受需求说明/资料和粘贴的 OpenAPI 3.0/3.1 JSON/YAML；TestPilot 使用 `@platformatic/openapi-schema-validator` 校验 OpenAPI 结构，再解析操作路径、方法、参数、有限深度的 schema、响应状态、安全方案和文档内部 JSON Pointer `$ref`，之后才调用兼容模型生成受限 suite 草稿。远程 `$ref` 会被拒绝，用户输入的 Base URL 始终覆盖文档 `servers`。服务端会将生成的 method/path/响应状态回查到 OpenAPI 操作，检查来源引用，记录被引用与未引用的操作，并验证后再允许保存。该计数是操作追溯证据，不代表语义完整覆盖。随后可检查、审核、运行和导出；关闭运行前确认时，只有工作台生成、只读、无身份矩阵、无并发/fixture 的套件才能自动审核并运行。其他套件可在 JSON 编辑器中修订，每次保存都会递增版本、重新计算 digest 和操作追溯覆盖。MCP 也提供草拟、检查、修订、显式审核、确定性运行、查询证据和导出报告/ZIP；服务端拒绝未审核或摘要不匹配的版本。SQLite migration CLI、HTTP API、MCP 与工作台现已贯通草稿、审核、执行、报告和 ZIP 生命周期。PostgreSQL/MySQL 适配、应用特定的身份权限探索、持续压力测试和 P95/P99 指标仍是后续工作。Suite 可以显式声明自己维护的 setup/cleanup HTTP 步骤，但 TestPilot 不会推断或证明其覆盖全部副作用。

### 保存并重跑已批准脚本

项目测试页可从登记 profile 建立人工导入快照，或输入一条需求来生成 AI 脚本候选。当前 AI 作者只支持 Grammar Lab：模型只能提交 1–12 步的受限 DSL（点击、文本断言、可见/禁用断言），不能输出任意 JavaScript、shell 或文件操作。TestPilot 用固定 runner 将它转成现有项目 Playwright 可执行的候选测试；套件命令与 allowlist 源文件一起形成版本快照。人工审核后批准，再点击“无模型重跑此批准版本”。

CLI 同样可运行 TestPilot 内登记的项目测试配置，例如：

```powershell
npm run dev -- run --profile grammar-lab
```

配置位于 `examples/profiles/`，逐项声明项目根目录、可选本地服务、既有测试命令、测试源文件 allowlist 和需要保留的产物。命令仍交给同一个无 shell runner，报告包含退出码、stdout/stderr、耗时以及批准脚本身份。配置项目会先复制到临时目录执行，跳过 `.git`、`node_modules` 与 `.env*`；脚本源快照只覆盖到临时副本，文件路径限于登记 allowlist 且拒绝符号链接/路径穿越。当前 Grammar Lab 配置会启动本地服务并分配空闲回环端口，随后运行其文档中的 `npm test`（模型断言 + Playwright/Edge 浏览器流程）。这会沿用目标项目已有 Playwright 用例，不增加第二套浏览器驱动。工作台只显示服务端登记的 profile ID，不接收命令或项目路径。

当前 AI 需求作者仅支持 Grammar Lab 已登记界面和有限 selector/action 集；它不会浏览任意项目、自动探测 DOM、维护既有测试或直接编辑 D:/work 项目。差异展示到用例和文件路径级，尚无逐行源代码审查、CI 集成或跨项目脚本仓库。临时 API Agent 的模型候选检查也不会自动进入批准脚本。

范围、验证结果与后续阶段见 [PROJECT-ROADMAP.md](./PROJECT-ROADMAP.md)。

## 数据与验证

工作台报告默认保存在 `artifacts/demo/runs/<id>/`，回归用例在 `artifacts/demo/regressions.json`。`TESTPILOT_DATA_DIR` 可覆盖存储目录。CLI 报告继续位于 `artifacts/runs/`。

```powershell
npm run build
npm run test:demo
```

集成检查使用独立临时端口和隔离数据目录，实际执行缺陷样本与预置修复、相同预期回归、离线 Pi 工具循环、预算阻断、报告下载与持久化；本地模拟模型端点检查 Chat Completions 协议、动态候选用例、漏测阻断和取消。另有文档测试端到端 fixture 使用本地 HTML 页面、本地模型桩和无头 Edge/Chromium，验证所选子集、跨轮会话、Computer Use 截图调用、部分报告、ZIP 内容和 MCP 导出；预检故障矩阵覆盖模型拒绝、坏参数、不支持图片和超时；XMind/旧项目测试覆盖分类、预期置信度、覆盖领域与旧用例 ID 兼容。测试会在加载模型设置前使用新的空数据目录，不能读取你保存的真实 API 配置；这些测试不代表真实模型质量或真实目标应用结果。具体结果见 [VALIDATION.md](./VALIDATION.md)。

本轮范围与接口约定见 [DEMO-PLAN.md](./DEMO-PLAN.md)。这是用于评审架构和执行闭环的 Demo，尚未达到完整规划中跨技术栈、多应用、大样本质量评估的阶段验收。

## 文档驱动浏览器测试

### 独立测试用例生成 Agent

工作台“更多 → 生成测试用例”是独立的用例设计入口。它接受需求文本、PDF/XMind/Markdown/TXT、网站 URL/页面文字和可选公开案例参考；其中 XMind 旧用例作为留出的比较基准，不进入生成提示。默认上限 80，首轮使用约 70% 名额，留出余量针对未关联的范围内需求补齐；仍未覆盖的需求会保留为明确缺口。随后分批比较旧用例的重合度，并对步骤可执行性、预期可观察性、需求依据、原子性和测试数据就绪度作二次评审。范围外、延期、待确认需求与本期覆盖缺口分别统计。比较和语义评审是 AI 复核信号，不是正确性结论；结构完整度也不代表业务正确。结果可导出 JSON 或 Markdown。此入口只生成测试设计，不生成浏览器 DSL、不写自动化脚本、不执行目标系统测试。

网站 URL 会尝试读取少量公网静态 HTML；不会携带登录态，也不执行网页脚本。需要登录或由 JavaScript 渲染的站点，请粘贴页面可见文字。公开搜索仅提供测试覆盖启发，不作为目标应用事实。配置模型后可在新入口单独使用；原来的“新建测试”端到端流程仍保持独立。用例生成参考与复用边界见[调研记录](./research/test-case-generation-agent-reference-2026-10-19.md)，生成规范见[本地 Skill](./.agents/skills/testpilot-case-generation/SKILL.md)。

在工作台的“文档驱动测试”中导入需求或既有用例，填写目标应用 URL，并可拖入 PDF、XMind、Markdown 或 TXT 资料。XMind 用例保留主题路径并识别 P0-P3 优先级；每条用例还可记录需求追溯、前置条件及确认、合成测试数据/fixture 引用、副作用风险和清理说明。工作台支持全选、只选 P0/P1 或手动选择本轮回归子集。

当前网页执行由确定性 Playwright runner 和视觉 Computer Use lane 组成。视觉 lane 使用配置的 OpenAI-compatible Chat Completions 服务和自定义 `computer_step` 工具调用，不是 OpenAI Responses API 原生 Computer Use。两条 lane 在同一轮里顺序复用项目的浏览器页面与登录态；TestPilot 服务运行期间，同一项目的 Edge 页面会一直保持打开并供后续轮次复用，因此不是隔离上下文中的独立复现。模型没有返回有效工具动作、超时或无法判断时应标为 blocked。两侧按用例 ID 比较；完整对齐才标记为验证完成。无论是否完全对齐，本轮都能下载逐用例报告和可复用脚本包，未对齐产物会醒目标明是部分结果，不能视为通过。实现边界、已知缺口和演进路线见[文档测试编排说明](./DOCUMENT-TEST-ORCHESTRATION.md)。运行数据保存在 `artifacts/demo/document-tests/`。

模型能否调用工具取决于所配置的中转服务和模型。设置连接测试会检查截图输入与工具调用，正式运行时还会用当前页面截图进行一次无动作预检；失败会将视觉 lane 统一标为 blocked。当前网页 runner 只执行明确标为只读且前置条件已确认的用例；未知或有副作用的用例显示为 blocked，清理说明不会自动执行。部分产物记录本轮入选与排除用例，完整对齐只表示入选子集完成。测试用例和页面截图会发送给配置的模型服务。通用 HTTP API runner 已可通过 CLI 或 MCP 执行；MCP 审核与证据导出使用同一套服务端校验。SQLite migration 在工作台/API/MCP 提供受限 SQL 草稿、审核、内存数据库运行与报告包；PostgreSQL/MySQL、应用适配的身份权限探索、持续压力测试及 P95/P99 指标仍未实现。XMind 解析能力以支持的格式为限。两侧结果相同只表示本次用例在共享会话中结论一致，不证明缺陷已穷尽或覆盖完整。

## MCP 与标准化 QA Skill

仓库内提供 TestPilot stdio MCP server，可由 Codex、Claude Code、Cursor、VS Code 等 MCP host 启动。它连接到本地 TestPilot 服务，暴露项目读取、需求导入、用例编辑、审核、双通道执行、状态查询和运行产物导出等工具；本地项目支持脚本候选、审批、无模型重跑和报告/脚本包导出；API 工作流支持套件草稿、修订版本、显式审核、确定性运行和可复用 ZIP 导出。主工作台也可生成并审核 API suite。部分结果可导出但会明确标记，不能绕过未审核执行，也不能把未对齐结果标成通过。

1. 启动 TestPilot 服务。
2. 在 MCP host 中新增 stdio server，`command` 为 `node`，`args` 分别为仓库的 `node_modules/tsx/dist/cli.mjs` 与 `src/mcp/server.ts` 绝对路径。
3. 设置环境变量 `TESTPILOT_BASE_URL`，例如 `http://127.0.0.1:4330`。默认值为 `http://127.0.0.1:4317`；MCP server 会拒绝非 loopback 地址。

示例（把工作区路径替换为本机实际路径）：

```json
{
  "mcpServers": {
    "testpilot-qa": {
      "command": "node",
      "args": [
        "D:/test agent/testpilot-mvp/node_modules/tsx/dist/cli.mjs",
        "D:/test agent/testpilot-mvp/src/mcp/server.ts"
      ],
      "env": {
        "TESTPILOT_BASE_URL": "http://127.0.0.1:4330"
      }
    }
  }
}
```

项目级 Skill 位于 `.agents/skills/testpilot-qa-workflow/`。连接 MCP 后，按 Skill 分阶段运行“准备 → 检查/修订 → 用户审核 → 双通道执行 → 差异处理 → 对齐后报告与 ZIP”；未连接 MCP 时可回退到工作台。具体工具和安全边界见 [MCP 工作流说明](./.agents/skills/testpilot-qa-workflow/references/mcp-workflow.md)。
