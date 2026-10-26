# TestPilot 阻塞用例修复记录（2026-10-18）

## 用户指出的问题

用户指出“blocked / 没有可执行步骤”不应只当作结论。处理原则：能从目标页面真实证据构造安全只读步骤的，补脚本并运行；缺少业务记录、角色或服务端合同的，保留具体阻塞原因，不通过通用标题断言伪造完整覆盖。

## 目标站静态页面证据

只读取 `https://cdn.yibentushu.com/test-sample-apply/` 的公开前端 JS 资源，未调用业务 API。前端代码证实：

- 左侧入口“订单物流”对应 `/logistics`。
- 订单页搜索框 placeholder 是“搜索订单号/书籍”。
- 列表为空时页面显示“暂无订单物流记录”。
- 搜索参数是只读列表查询的 keyword；未触发提交、审批、库存或订单写入。

## 补齐的两条用例

- `case-81` 无订单空状态：进入订单物流，精确断言“暂无订单物流记录”。脚本通过 deterministic 和 Computer Use 两通道验证。
- `case-83` 无匹配搜索：在搜索框填入唯一查询串 `TP_NO_MATCH_20261018_46638D88B83F`，精确断言“暂无订单物流记录”。两通道通过。
- 旧记录 `dfe0360c-18d6-4236-9692-1337a5f9ae0a`：该运行后来审计发现 case-83 搜索前列表已空，因此其 2/2 状态不能作为搜索过滤通过证据；已撤销该通过结论。只有 case-81 空状态得到页面证据支持。

以上只证明本轮已登录账号当前订单列表的空态与无匹配查询，不推断订单字段/筛选对真实记录的正确性。

## 执行器修复

- 增加 `fillByPlaceholder`，用于应用只暴露 placeholder、没有关联 label 的输入框。此动作进入步骤校验、实际浏览器执行、AI 草稿 schema 和可下载 `run.mjs`。
- Computer Use 结果工具的 `case_id` 字段因同时服务动作与结果而可选；此前服务端在结果阶段却强制要求它，导致模型省略字段时被错误阻塞。现在仅当省略时绑定当前执行用例 ID；若明确提交另一 ID 仍拒绝。
- 视觉模型有时会为长用例返回超过 700 字的证据；旧限制会因长度把可读证据挡成 blocked。现在模型输入上限为 2000 字，服务端保留前 687 字加截断标记，输出仍限 700 字，并由回归验证。
- 批量生成端点之前把所有未生成项都命名为 `failedCaseIds`，把“需要夹具/澄清”混同成模型失败。现在分别返回 `blockedCaseIds`、逐条 `blockedReasons` 和 `generatedCaseIds`。
- Computer Use 的格式错误现在报告缺失的是 case ID、status 还是 evidence，不把全部问题压成“结果不匹配”。
- Skill 增加了先取目标 DOM/可见页面证据、再写最小只读步骤的要求；也说明只有未覆盖的验收点仍留 `coverageGap`。
- 修复一项内置 select 边界测试的错误预期字符串。单项和文档工作流集成测试验证通过。

## 首轮完整 156 条结果

运行 `46638d88-b83f-474d-9b76-a004953489e0`：

- deterministic：6 passed / 10 failed / 140 blocked。
- Computer Use：1 passed / 7 failed / 148 blocked。
- 6/156 对齐，`overall=unresolved`、`finalReady=false`；报告和 ZIP 存在。
- 真实差异包含文案不匹配（目标页面多“联系运营”）、数量超 9999 未给出预期提示、390px 视口有控件溢出等。
- 对齐之外的用例仍需逐项核对 locator、API 证据和业务数据，不能按 blocked 等同产品通过或失败。

## 修复后全量复跑

运行 `dd07cc4f-7c8c-4bad-bf73-99e56f747fca`：

- deterministic：8 passed / 10 failed / 138 blocked。
- Computer Use：3 passed / 7 failed / 146 blocked。
- 9/156 对齐，`overall=unresolved`、`finalReady=false`；报告和 ZIP 均生成。
- case-81 与 case-83 在两侧都通过并对齐；新步骤确实可重放。
- 两轮全量的对齐数从 6 提升到 9。增加部分来自新增的两个对齐用例和 Computer Use 正确归档结果。

仍未完成的范围不是被隐藏：其余用例需要订单/申请夹具、角色账号、后端 API 证据、PC 后台或需求澄清。逐条见原审计和本轮报告。

## 回归命令

```powershell
npm run build:server
npm run typecheck
node --test tests/document-workflow.integration.test.mjs tests/document-placeholder-validation.test.mjs tests/document-select-unlabeled.test.mjs
```

最近一次 targeted 回归：3 个测试全部通过。

## 2026-10-18 阻塞审计更正与网络断言增补

- 更正此前“case-83 已双通道通过”的结论：运行前订单列表的各状态计数均为 0，查询前已空；所以旧脚本只重复验证了空态，没有验证关键词过滤。该历史运行记为**覆盖无效/需要重测**，不能作为搜索功能的通过证据。case-81 才是被实际页面记录支持的空状态用例。逐案证据见 `case-inventory-mvp-audit-2026-10-18.md`。
- case-27「输入非数字：校验拦截，不调用接口」已经有 UI 步骤；真正缺的是网络断言。新增 `startFetchOrXhrCapture` / `assertNoFetchOrXhr` DSL，确定性 runner 在用户动作前开始监听，在动作后等待 250–5000 ms（默认 1 秒），只保存请求方法和 `fetch`/`xhr` 类型，不保存 URL 或参数。断言无效字段状态与无 fetch/XHR 可共同执行。自动补齐会删除旧的“DSL 无法证明不调用接口”过时说明，保留其他 gap 并写入准确覆盖边界。
- 双通道边界：Computer Use 的截图无法证明“没有发请求”，现在会将该项记为不可验证/blocked；因此不得将它写成双通道对齐。这个 BrowserStep 只覆盖观察窗口内的 fetch/XHR，不覆盖 sendBeacon、WebSocket、表单导航、service worker 或服务端日志；完整契约仍需保留对应 `coverageGap`。
- 导出 ZIP 的无 AI runner 已更新并通过独立执行验证：无请求 fixture 为 pass；输入值触发 fetch 时为 fail，且失败报告不包含请求 URL 或 `secret` 参数。
- 更新了 MCP/browser-step schema、文档步骤生成器、服务端断言门禁、coverage 检查与项目 `testpilot-qa-workflow` Skill。
- 本轮验证：`npm run typecheck`、`npm run build:server` 通过；`npm run test:demo` **59/59 passed**（最终回归 124.2 秒）。新增批量生成 API 测试验证已有 case-27 风格的步骤会自动补 network listener，随后回到 `draft` 等待审核；ZIP runner 同时验证无请求 pass、实际 fetch fail 且证据经过脱敏。
- 当前正在运行的目标站服务是在本补丁之前启动的旧进程，不会加载这些代码。为了保住现有 Edge 登录会话且不让用户再次扫码，本轮没有重启目标站进程；因而以上是本地 fixture 与独立打包 runner 的验证，不是目标站 156 条的修复后重跑。

### 当前 no-step 分类快照

权威清单仍是 156 条、其中 121 条空步骤。本轮代码把其中“无效输入不得调用接口”从一律视为后端阻塞，改为可编写 fetch/XHR 确定性断言；新生成脚本仍要依赖目标页现场的字段/菜单证据。其余主要分为角色/身份 7 条、预期待澄清 11 条、API/服务端 25 条、业务数据/夹具 54 条、N/A 3 条、缺少明确 UI 断言 5 条、其它记录/历史数据 2 条。14 条候选只表示文本规则允许向 AI 请求一个有界的 UI 草案，不代表已有现场定位证据或可以直接运行。详见 case inventory 报告和 OSS/Skill 调研备忘录。

补充复跑的历史记录也曾把 case-83 写成确定性通过；后续证据审计已将该结论更正为**覆盖无效**：搜索前列表为空，不能证明过滤功能。case-27 当时尚无 network assertion；新增能力只在后续代码补丁中加入，不能追溯宣称历史目标运行已验证。case-29/32 在空表单下如实 blocked，必须先有已知图书价格/重量夹具。case-26、31、42、45、49 的目标页面校验文案未按用例预期出现，已记录为实际差异。

## 最终基准全量复跑（156 条）

运行 `3d85d43e-7248-4e44-a9a5-eaa6d02cc1d7`，所有 156 条均选中；同一持久浏览器会话，无需再次扫码：

- 确定性脚本：8 passed / 9 failed / 139 blocked。
- Computer Use：3 passed / 7 failed / 146 blocked。
- 两侧 9/156 状态一致；整体 `unresolved`、`finalReady=false`。报告和 `testpilot-package.zip` 均已生成。
- 报告：`artifacts/demo/document-tests/runs/3d85d43e-7248-4e44-a9a5-eaa6d02cc1d7/report.md`。
- 可复用脚本包：`artifacts/demo/document-tests/runs/3d85d43e-7248-4e44-a9a5-eaa6d02cc1d7/testpilot-package.zip`。

脚本明确验证了以下目标站问题：

- case-10：实际提示多出“联系运营”，与用例精确文案不一致；两条通道均失败。
- case-26：不存在编码失焦后错误红框消失，且未显示“未获取图书信息”。
- case-31：数量 10000 被静默改写为 999，没有用例要求的超限提示。
- case-42、45、49：必填/手机号格式校验提示与用例不一致或缺失。
- case-94：390px 视口存在水平溢出。
- case-27：脚本能观察到无效状态，但当前 runner 没有网络请求断言，不能证明“未调用接口”。

全量阻塞的根因不止于用例缺步骤：`runComputerUseLane` 在调用视觉模型前要求每条用例已有非空确定性步骤，因此空步骤用例根本没有进入 Computer Use；结果把“没有脚本”误当成“AI 无法自主探索”。已修正为允许无步骤用例由 AI 在同一截图会话里规划安全的只读动作，仍保留精确预期、前置条件、测试数据、已知 coverage gap 和副作用门禁。待澄清、范围外、未授权账号与后端/业务夹具依赖仍标为 blocked，不会拿当前员工账号或任意生产数据伪造测试。

首次代码改动通过 `npm run typecheck`、`npm run build:server` 与 `npm run test:demo`（58/58 passed）；之后独立安全复核指出未标副作用风险的用例会被过宽准入，故进一步收紧并补了执行器集成测试。最新本地结果见下节。此处 156 条结果是自主探索改动前的目标站基准结果，不能把基准数误写成修复后的结果。

## 自主探索安全复核与本地集成验证

- 准入条件现要求用例 `sideEffectRisk` 明确标成 `none`；缺失或 `unknown` 风险一律阻塞。任何非空 `coverageGap` 也阻塞，避免模型只验证了子项却把整条用例报通过。
- 新增本地无头 Edge 集成场景，真实调用 `runComputerUseLane`：空步骤用例通过视觉动作点击一个只改变本地页面显示状态的按钮；另一个用例尝试点击 `Submit`，被动作门禁拒绝，本地服务没有收到任何 POST。
- 最新定向 Computer Use 测试：9/9 通过；`npm run typecheck` 通过。完整 `npm run test:demo`：59/59 通过（总耗时约 120 秒）。
- 没有更多空步骤目标站用例能在现有证据下安全补脚本：case-81、case-83 已有页面和空态证据、无需业务夹具；其他候选需要订单/申请记录、角色账号、后台或 API 证据。详见 case-gap-audit 与 case-repair-audit。
- 安全准入代码已进入 `dist`，但正在运行的旧服务是启动时加载模块的进程，不会热加载此修复。为避免关闭现有持久 Edge 会话而重新触发扫码，本轮没有重启该服务；因此未声称修复版已在目标站重新跑过 156 条。当前目标站基准仍是上节 `3d85d43e-7248-4e44-a9a5-eaa6d02cc1d7`。
