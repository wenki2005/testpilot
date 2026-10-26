# 156 条全量运行与阻塞修复记录（2026-10-18）

目标：`https://cdn.yibentushu.com/test-sample-apply/#/home`

## 全量基准运行

- Run ID：`21c1bb30-4942-47ef-a1c6-457d6e757e98`
- 范围：156 条用例；确定性脚本 156 条，Computer Use 156 条，共 312 个通道结果
- 确定性：9 passed、30 failed、112 blocked、5 N/A
- Computer Use：2 passed、10 failed、139 blocked、5 N/A
- 总体：`unresolved`。报告与 ZIP 已生成；这表示全量清单已执行并逐条留痕，不代表所有需求都已验证通过。

产物：

- `artifacts/demo/document-tests/runs/21c1bb30-4942-47ef-a1c6-457d6e757e98/report.md`
- `artifacts/demo/document-tests/runs/21c1bb30-4942-47ef-a1c6-457d6e757e98/testpilot-package.zip`
- `artifacts/demo/document-tests/runs/21c1bb30-4942-47ef-a1c6-457d6e757e98/testpilot-package-repaired.zip`（包含复测后修正的 case-34 脚本和 follow-up 证据；原始全量包保留作基准）
- `artifacts/demo/document-tests/runs/21c1bb30-4942-47ef-a1c6-457d6e757e98/run.json`

## 为什么出现“没有可执行步骤”

全量运行有 88 条未能生成浏览器脚本。它们不是一种问题：有待产品确认的预期、明确范围外项，以及依赖 API/数据库/审批/库存/订单/物流、特定账号角色或测试记录的场景。对这部分从空白 H5 页面猜 selector 或编造记录，不能证明原需求。

实际发现 TestPilot 自身还有两个缺陷：

1. 旧流程先跑确定性通道，之后才根据已登录页面生成步骤，造成空步骤先被记为 blocked。
2. 部分步骤只有断言、没有先建立申请/订单/角色状态；脚本把空白页面上找不到预期文字误判成产品失败。

## 已完成的修复

- 将安全步骤生成移到确定性通道之前，并用同一已登录页面取证；后续运行会直接执行新增步骤。
- 对依赖 API/fixture/角色、且没有能建立该状态的交互步骤的断言，明确记录为 blocked，并给出所需接口契约或夹具说明。
- Computer Use 写明“无法观察/缺少账号或 fixture”时不再仅因断言文字缺失而记失败；只有明确反向证据才保留失败判定。
- 修正 `Fixture code` 这类字段名被误识别成缺失业务 fixture 的规则。
- 新增 API suite 关联和文档 case 到 API case 的显式映射界面；不会猜映射，网络访问默认关闭。当前项目没有已审核 API suite，所以后端 API lane 尚无可执行套件。
- 修复 API 配置保存时 `allowNetwork: false` 被后端丢弃的问题。
- 复核全量报告时发现视觉裁决器还有两处误分流：把“暂无订单物流记录”这种预期空态当作 fixture 缺失；把明确观察到的移动端内容裁切/横向溢出仍压成 blocked。现已改为保留预期空态的通过证据，并将有截图佐证的可见反例判为 failed；新增回归用例覆盖两种情形。
- 删除 case-115 错误的静态页面文案断言。该项验收的是审批成功后向对应上级发送的企微消息，已改为 API/集成契约路径；没有真实接口、隔离接收人和消息读回时明确 blocked，不再因当前 H5 页面没有该文案而误报失败。

## case-34 单例复测

复测 Run ID：`38d6b4b7-92fa-45cc-b5e3-c8fb7f34acab`。

将无障碍 role 定位改为页面上确有文字证据的精确文本定位后，脚本成功点击「继续添加样书」、在第二行填写 `9999999999` 并失焦。自编码输入框仍为灰色，没有显示预期红框；相邻数量框红色。确定性通道因此失败；Computer Use 标为 blocked，因为当前没有易诚通书目/API 夹具来确定该编码的服务端结果。该差异需要在隔离环境用已知不存在的书目编码复核，不能把它报成已确认的后端缺陷。

复测后已恢复项目为原来的 156 条全选、审核通过状态，并把验证过的 `clickExactText` 定位和第二行字段断言保留在 case-34 脚本中。新版 ZIP 的 cases.json 已校验 156 条全选并包含这四步。该项仍是 API 路由的部分 UI 覆盖；提示文案和书目有效性没有被冒充为已验证。

## 验证

- `npm run build:server`：通过
- `npm run typecheck:web`：通过
- `npm run build:web`：通过
- 定向回归：24/24 通过（步骤计划、证据分类、无模型页面 fallback、登录后生成以及 API 映射 UI）
- 服务已重启到最新代码。Edge 状态显示 1 个可复用标签；保留原窗口与登录态，没有要求重新扫码。

## 修复后的第二轮全量运行与差异复核

- Run ID：`df613ad7-e1d6-466a-ae12-0f40d7b2d0a1`
- 范围：全部 156 条，312/312 个 lane 结果完成；耗时约 36 分钟；同一 Edge 登录会话复用。
- 确定性：9 passed、25 failed、117 blocked、5 N/A。
- Computer Use（更改分类器前的该轮记录）：2 passed、7 failed、142 blocked、5 N/A。
- 报告与全量包：`artifacts/demo/document-tests/runs/df613ad7-e1d6-466a-ae12-0f40d7b2d0a1/report.md`、`.../testpilot-package.zip`。

随后修复视觉证据裁决器，并针对差异项做了 3 条同会话复测（Run ID：`37b42335-1cc9-4781-aa24-19a34d6dedd3`）：

| 用例 | 确定性 | Computer Use | 复核结论 |
|---|---|---|---|
| case-81 无订单空状态 | passed | passed | 截图和精确文案“暂无订单物流记录”均确认；已修复空状态被误当作缺失 fixture 的问题。 |
| case-94 移动端响应式布局 | failed | failed | 390×844 下导航占据约 245px，表单内容被右缘裁切；两个通道一致确认目标页面移动端横向溢出。 |
| case-115 上级企微推送 | blocked | blocked | 去掉错误的静态 UI 断言，转 API/集成契约路径；需隔离接收人/mock 与消息读回。 |

三条复测的报告与包：`artifacts/demo/document-tests/runs/37b42335-1cc9-4781-aa24-19a34d6dedd3/report.md`、`.../testpilot-package.zip`。复测结束后项目已恢复 156 条全选、审核通过；case-115 保留为无浏览器步骤的 API 契约用例。

最终分类器回归 `node --test tests/computer-use-evidence.test.mjs`：5/5 通过；`npm run build:server`：通过。原始 156 条全量报告保留作全量基准，三条针对性复测单独归档，避免把部分复测冒充全量重跑。

## 差异用例复核收敛

针对全量报告的差异，另外选择 27 条进行定向复核（Run ID：`c7fa0bf2-1de5-4c1d-b023-1c8f1e4f43be`）。第一轮定向执行找出 3 条裁决器误判：case-41、case-44 的有效输入被当成失败；case-48 的明确截图值被 DOM 中文标签定位失败挡成 blocked。随后分别使用更新后的视觉裁决器重跑，并逐条核验：

- case-41：截图明确显示完整收件人值；确定性与 Computer Use 均通过（Run `f7590b01-694d-46ca-94c2-ba5fb6bed310`）。
- case-48：截图明确显示完整地址值；确定性与 Computer Use 均通过（Run `ddf2e9d7-e64a-474f-a982-18b328d268d6`）。
- case-44：截图明确显示完整 11 位手机号；确定性与 Computer Use 均通过（Run `5fd88a34-990c-4098-b6b6-bcf19c0160e7`）。

因此，27 条差异复核的最终两通道分布均为 5 passed、1 failed、21 blocked；逐条 case ID 已对齐。case-81、case-94、case-115 则由 Run `37b42335-1cc9-4781-aa24-19a34d6dedd3` 确认分别为通过、失败、阻塞。项目已恢复 156 条全选、审核通过；case-34、case-53/54、case-61、case-80/82/83/84、case-87/88/89/91/92/93、case-132/133 的无脚本状态现在都有对应 fixture/角色/契约缺口说明，不再保留会制造假失败的空列表或空字段断言。case-39 标注未执行真实提交；仅填入备注不能再被解释成“正常提交”已通过。

定向复核 ZIP 均保存在相应 run 目录；全量 run 与定向 run 分开归档。最后一次验证：Computer Use 裁决器回归 7/7 通过，`npm run build:server` 通过。当前项目的 156 条已全选、审核通过；Edge 仍是同一可复用登录会话。

## 当前无浏览器步骤清单审计

最终项目仍有 110 条没有浏览器步骤，按缺口分为：93 条需要 API/后端证据、业务记录/fixture、角色账号或第三方集成；15 条预期/范围待澄清；2 条其他缺少可判定操作条件。110 条均已带 `coverageGap`，其中执行路由为 API contract 50、fixture/role 15、clarification 12、manual analysis 9、browser UI 18、source review 1、out-of-scope 5。18 条 browser-UI 路由中，仍有申请列表、订单详情、筛选、客户/书目选择等页面可见断言，但其验收点要求相应记录或角色；空页面点击导航只能验证页面标题，不能证明原用例。没有有效 OpenAPI/接口契约或受控业务 fixture，因此不编造步骤去制造假通过。

## 完成 API/角色用例还需要的输入

- 权威 OpenAPI 文档和版本
- 获准的隔离测试 base URL
- 通过环境变量引用的测试身份
- 可重复的合成订单、书目、库存、审批状态夹具及清理方法
- 对待澄清 XMind 项确认明确的页面入口、操作、预期和范围

测试工作台的 API 映射入口已经准备好；收到这些资料后，可以把原先的后端项映射到已审核 API suite 并运行，而无需重写 runner。

## 2026-10-18 最新全量复跑与改进

用户指出空步骤和阻塞必须先查因并尽量补齐。重新核验项目后，156 条全选、审核通过。对上轮 12 条缺步骤的 UI 候选重新调用当前版本步骤生成器：只有 case-99 生成了可验证的部分检查 `assertNotVisible("内部订单管理")`。该检查只证明当前可见菜单文本，不证明非管理员角色的权限或管理 URL 的服务器拒绝；原 `coverageGap` 保留。其余 11 条的生成器没有返回 grounded assertion；项目数据同时证明缺隔离申请/订单/库存夹具、确认无效书目编码、真实角色账号、旧路由与易诚通 API 契约。不能安全补出能验证这些业务结果的脚本。

在 `/api/document-projects/:id/generate-steps` 的阻塞原因中修复了反馈缺陷：以前只报告“AI 没生成可执行步骤”，没有给调用者看 `coverageGap` 中已知的具体夹具/身份/API/route 前置条件。现在两个事实会一起显示（生成失败 + 实际缺口）。新增回归测试覆盖 case-56 状态 fixture 缺失；`npm run build:server` 与 `node --test tests/document-step-grounding.test.mjs` 均通过（2/2）。之后完整本地 `npm run test:demo` 通过（43 个顶层测试、78 个子/主测试，0 失败）。

随后启动全量双通道 Run `30aded97-6d6f-4437-8382-71d10a04193c`，覆盖 156 个用例、312 个通道结果；复用同一 Edge 管理会话。最终分布：

| 通道/比较 | passed | failed | blocked | N/A | unresolved |
|---|---:|---:|---:|---:|---:|
| 确定性 | 7 | 9 | 135 | 5 | — |
| Computer Use | 4 | 5 | 142 | 5 | — |
| 比较 | — | — | — | 5 | 143 |

比较另有 8 条状态一致（4 条两侧通过、4 条两侧失败）；143 条 unresolved 包含 135 条两侧均 blocked、4 条 `failed/blocked`、3 条 `passed/blocked`，以及 case-27 的 `failed/failed`（两侧状态虽一致，完整用例要求的 API suite 尚未创建/审核，故不能记 aligned）。Computer Use 从 case-96 到 case-156 共 61 条均有结果记录，其中 60 条 blocked、1 条 N/A；空白页预检导致整批跳过的错误诊断数为 0。后段用例继续暴露当前认证页是员工 H5，而大量需求需要 PC 管理后台、账号角色或订单 fixture。最终 Run `overall=unresolved`、`finalReady=false`，不会包装成测试成功。

Run 报告与可复用脚本包：

- `artifacts/demo/document-tests/runs/30aded97-6d6f-4437-8382-71d10a04193c/report.md`
- `artifacts/demo/document-tests/runs/30aded97-6d6f-4437-8382-71d10a04193c/testpilot-package.zip`

两侧确认为产品缺陷的 UI 证据：case-10 文案多了“联系运营”；case-27 对非数字自编码未见可见拦截，且确定性网络监听发现一次 fetch/XHR；case-31 数量输入 `10000` 被限制显示为 `999`，预期的“超出范围”未出现；case-45 输入 `123` 后红框出现但缺少预期“手机号格式错误”；case-94 在 390×844 下桌面侧栏约占 238–245px，表单被裁切。确定性还单独报出 case-26、42、49、51 的失败，Computer Use 未能确认这些项，需逐条复核，不与双通道确认缺陷混为一谈。

复跑完成后重启 TestPilot 服务以加载新反馈文案；浏览器 API 复核 `reachable=true`、`managedTabs=1`。测试过程中未要求再次扫码。

开源复用调研记录在 `test-plans/opensource-reuse-options-2026-10-18.md`。建议保留自有编排、安全门和 case-ID comparator，复用 Playwright 执行能力、官方 Playwright MCP 的持久会话设计、Allure 附件格式以及单项生成器的输入/门禁思路。项目级 `testpilot-qa-workflow` 与 `testpilot-api-contract-fixtures` Skill 已存在；当前没有许可证明确且能替代完整流程的成熟 Skill/项目，因此没有安装通用浏览器自动化 Skill 绕过受控 DSL。

## 2026-10-19: 156 条全量复跑与“空步骤/阻塞”修复

用户要求对全部 156 条用例逐条执行，遇到空步骤和阻塞先查因并尽可能补齐。本轮在同一个持久 Edge 登录会话中完成全量 Run `5aeed8a6-712e-42cc-856c-f82f32fab7a8`（312/312 lane 结果，约 43 分钟）：

| 通道/比较 | passed | failed | blocked | N/A | unresolved |
|---|---:|---:|---:|---:|---:|
| 确定性脚本 | 7 | 11 | 133 | 5 | — |
| Computer Use | 5 | 5 | 141 | 5 | — |
| 比较 | — | — | — | 5 | 141 |

Run `overall=unresolved`、`finalReady=false`。仍 unresolved 的主因包括 PC 管理后台地址/角色身份、审批/订单/库存/书目测试夹具、API 契约和源码审查输入；这些不能从员工 H5 的空表单推造。本次 156 条均有两 lane 结果，没有中途跳过或重新扫码。

### 本轮发现并修复的工具问题

- case-137 原步骤只在输入框聚焦时读回数量，没有失焦；会漏掉页面把 `1000`、`9999` 夹为 `999` 的行为。测试脚本补了失焦步骤，确定性 lane 两个值均断言失败，截图也清楚复现 BUG-003。
- Computer Use 结果判定器只认识中文“失焦后改为 999”，不能识别模型英文描述；DOM 标签定位失败后把明确截图缺陷降为 blocked。现判定器支持中英文夹值证据，DOM 复核缺失不会遮住可见矛盾。
- 比较报告在 API suite 缺失时只显示 API 阻塞，隐藏了浏览器子检查的产品线索。现在保留整案 unresolved，同时把“部分 UI 检查发现疑似产品缺陷”和证据摘录写入 issue。
- 空步骤只读观察之前也会逐条截图 API contract/source review 等不匹配的 lane；现在无步骤被动观察只允许 `browser-ui` 路由，并在只读结果明确标注仅收集观察证据及拒绝非只读动作。
- case-138 曾被错误加上需求没有要求的“红框无效态”断言，导致脚本假失败。已撤掉过度断言；逐项输入 `0/-1/1.5/abc`、失焦并检查按钮未启用。记录仍保留因其他必填项为空、无法证明禁用原因的 coverage gap。

### 定向复测

使用当前工具代码对 case-137/138 重跑 Run `66d16e10-8162-44c1-952a-ff7701124939`：case-137 两 lane 均为 failed，证据一致确认前端夹到 999；比较仍为 unresolved，因为服务端 `buildAndCheckGoods` 和保存结果没有 API contract/环境验证。case-138 两 lane 均 blocked，明确记录了非法值被变为 `1`/清空且提交按钮仍 disabled，但其它必填字段为空，无法验证 disabled 是由数量校验造成。该处理避免误报全案通过或假设因果。

定向 Run 与可复用包：

- 全量报告：`artifacts/demo/document-tests/runs/5aeed8a6-712e-42cc-856c-f82f32fab7a8/report.md`
- 全量包：`artifacts/demo/document-tests/runs/5aeed8a6-712e-42cc-856c-f82f32fab7a8/testpilot-package.zip`
- 定向复核报告：`artifacts/demo/document-tests/runs/66d16e10-8162-44c1-952a-ff7701124939/report.md`
- 定向复核包：`artifacts/demo/document-tests/runs/66d16e10-8162-44c1-952a-ff7701124939/testpilot-package.zip`

验证：`npm run build:server` 通过；Computer Use 前置条件/只读门禁 9/9、证据判定及报告回归 11/11 通过。项目选择已恢复至 156/156，全量审核状态为 approved。浏览器持续复用当前 Edge 会话。

## 2026-10-19 追加复核：空步骤根因与客户下拉脚本

用户追问阻塞与空步骤是否只是被报告、没有实际修复。本次在同一项目浏览器会话完成修复后全量 Run `f49b8328-85d5-4a30-a0d2-7c9b87a8cd99`（156 条、312/312 lane 结果）：确定性 7 passed / 11 failed / 133 blocked / 5 N/A；Computer Use 7 passed / 7 failed / 137 blocked / 5 N/A；比较 13 aligned / 138 unresolved / 5 N/A。报告仍为 unresolved、`finalReady=false`。

根因分两类：

1. 真实依赖：审批/订单/库存/书目夹具、后台角色/接口契约或未定稿的业务规则缺失。没有这些资料，写出步骤也无法判定原验收点；此类用例继续保留具体缺口与待办。
2. 工具误拦截：导入器把“需要环境和/或账号/API mock”这句通用备注复制到所有用例，令已在登录页面可见且可选择的 case-18 也被判为缺角色/夹具。模型步骤生成器也只返回空草稿；而客户选择器实际是无 HTML label/placeholder 的自定义 `combobox`，旧 runner 只能按 label/placeholder 定位，无法复用 Computer Use 的页面发现结果。

对 case-18 固化了六步只读脚本：进入“本人申领”、确认“费用划归客户”字段、通过页面实测的第二个 combobox 输入“内部客户”、确认目标选项出现、选择该选项、确认选中值可见。新运行 `77946f5d-8705-4025-b27c-17404d518f59` 中确定性与 Computer Use 均通过，比较 aligned。全程未提交或保存。

Runner 新增受限 `fillByRoleIndex` 动作，支持以页面已观察到的 accessible role 和索引操作缺少 label/placeholder 的自定义控件；添加 `assertValueByPlaceholder`，在前端选择后移除 placeholder 时要求目标值在可见输入框中唯一匹配。Computer Use 复核同步支持该定位方式。case-137 的中英文数字截断失败判定器也已修复，定向 Run `751fa332-b552-408b-84b1-658e3714f7c0` 中两条浏览器通道均判 failed，完整报告继续保留缺少已审核 API suite 的 unresolved 限制。

验证：`npm run build:server` 通过；`node --test tests/document-field-unlabeled.test.mjs tests/computer-use-evidence.test.mjs` 10/10 通过。全量项目已恢复为 156/156 选中、0 排除、审核通过。全量报告/包为 `artifacts/demo/document-tests/runs/f49b8328-85d5-4a30-a0d2-7c9b87a8cd99/`；case-18 最新定向报告/单用例包为 `artifacts/demo/document-tests/runs/77946f5d-8705-4025-b27c-17404d518f59/`。后续完整新包需要在所有脚本修改后再生成；本轮没有把单用例包冒充全量包。

## 2026-10-19 继续修复：根因、可执行子检查和独立包一致性

用户指出“blocked/无步骤不能只报告，要继续查因和补脚本”。本轮在同一个持久 Edge 会话中完成：

1. **补两条已由当前页面证据支持的只读子检查**。case-17 查询 1004.00 外部客户；case-24 查询内部客户。新增步骤使用实测可访问性角色 `combobox` 的 index 1，不猜 CSS selector。Run `eb827b0b-23a3-47ad-84a2-9f87e7922c5f` 两侧都确认：1004.00 返回“无数据”；内部客户返回 3 个建议项。结果仍 blocked，原因是环境无 1004.00 合成数据，且没有权威客户清单/更新时间/缓存基线；脚本只验证可见子项，没有把它伪装成完整通过。
2. **修复降低确认模式下的生成门控**。`generate-steps` 以前无条件把项目退回 draft，即使用户选择自动执行且生成结果为安全只读。现在只有需要确认或 API suite 要人工审查时回到 draft；其余新增只读步骤通过安全门后保持 approved。测试需要的缺口仍保留在用例和报告中。
3. **修复 Computer Use 对数量截断的英文证据误判**。新加回归样例覆盖“typing 1000 … after clicking away the field visibly changed to 999”。之前 DOM 二次定位失败令视觉结论 blocked；现在新全量运行中 case-137 两侧均为 failed，截图证据明确显示 1000/9999 失焦后变成 999。服务端/保存行为仍未验证。
4. **修复全量包 runner 漏掉 `setViewport`**。审计发现旧 runner 虽有 `fillByRoleIndex` 和 `selectByRoleIndex`，却漏了 `setViewport`，造成可复用脚本无法复现响应式断言。本轮在源码生成链中修正 dispatch 顺序，并在打包前检查所选用例的每种 BrowserStep 都有执行分支；缺动作会阻止生成包，不再静默跳过。本次全量 ZIP 已按此修复并重验。

修复后的全量 Run `db58ddfd-811b-45d3-a77d-d6c68393fc92` 覆盖 156/156 条用例、312/312 lane 记录：

| 结果 | passed | failed | blocked | N/A | aligned | unresolved |
|---|---:|---:|---:|---:|---:|---:|
| 确定性脚本 | 8 | 11 | 132 | 5 | — | — |
| Computer Use | 7 | 6 | 138 | 5 | — | — |
| 对比 | — | — | — | 5 | 11 | 140 |

`overall=unresolved`、`finalReady=false`。这说明双通道已经逐用例留有结果，但大多数业务闭环验收仍缺 API 契约、真实隔离环境、角色身份或订单/审批/库存等 fixtures；“两边都是 blocked”不会被包装成通过。当前项目为 156/156 选中、审核通过。

**双通道均复现的 UI 失败**：case-10 提示文案实际比预期多“联系运营”；case-31 输入 10000 后变为 999 且没有“超出范围”提示；case-45 手机号输入 123 后没有预期“手机号格式错误”；case-94 在 390×844 下侧栏与表单并排造成横向溢出及裁切；case-137 输入 1000 和 9999 失焦后都变为 999。case-137 的后端接受情况没有测试。case-26/27/42/49/50/51 的确定性失败未获视觉通道独立确认，仍列为待复核，不当作双通道确认缺陷。

全量报告和脚本包：

- `artifacts/demo/document-tests/runs/db58ddfd-811b-45d3-a77d-d6c68393fc92/report.md`
- `artifacts/demo/document-tests/runs/db58ddfd-811b-45d3-a77d-d6c68393fc92/testpilot-package.zip`

ZIP 复核：156 条用例；实际使用的 20 种 BrowserStep 在独立 runner 中都存在分支，包括 `setViewport`、`fillByRoleIndex`、`selectByRoleIndex`。包中仍保留 unresolved 结果，不能宣称全套通过。生成器加入动作完整性检查，后续新增 DSL 动作若未同步 runner 将直接阻断打包并报出缺少的动作。

源码验证：`npm run build:server` 通过；Computer Use evidence 回归 9/9 通过。完整 `npm run test:demo` 正在运行，最终总数待结束后补录。开源复用建议及既有 workflow/API fixture Skills 参见 `opensource-reuse-options-2026-10-18.md` 与 `.agents/skills/testpilot-qa-workflow/SKILL.md`。

### 完整项目测试结果补记

`npm run test:demo` 首次运行 79 项中 78 项通过；唯一失败是 `tests/document-workflow.integration.test.mjs` 仍断言缺省确认模式下生成脚本必须变回 draft，与用户此前选择减少确认冲突。已把期望更新为“仅安全修复后的只读步骤可继续 approved，coverage warning 保留”，并单独重跑该完整集成文件，1/1 通过。其余 78 项在同一次全量测试中通过，因此修正后已有证据覆盖 79/79 项。

### `setViewport` 导出脚本运行级回归补记

继续审计后发现，仅检查 ZIP 内动作分支字符串不足以证明动作实际可执行。已扩展 `tests/document-workflow.integration.test.mjs` 的本地页面 fixture：页面在 resize 时显式显示 `window.innerWidth`；用例先执行 `setViewport(390×844)`，再断言可见文本为 `viewport=390`。同一测试既运行 TestPilot 确定性 lane，也启动 ZIP 内 `run.mjs` 对本地页面做独立复跑。测试通过（文档工作流集成 1/1，114 秒），因此独立脚本已被真实运行并证明视口动作生效。

对本轮全量包再做静态契约检查：156 条用例共用到 20 种动作，缺失动作 0；`setViewport`、`fillByRoleIndex`、`selectByRoleIndex` 分支均存在。`npm run build:server` 通过。

### 2026-10-19 继续修复：已审核低置信脚本不再被执行门禁误拦

本轮检查发现 `confidence=low` 同时被用于两个不相干的判断：正确地阻止模型根据含糊来源自动起草步骤；错误地又阻止已有人审核、具有明确断言且只读的脚本执行。这使“材料不够确定”永久覆盖“人已补齐并审核步骤”。现已拆开：AI仍不能为低置信用例臆造新步骤；已审核且通过只读 DSL、安全前置条件和结果断言校验的现有脚本可以执行。项目级审核门仍强制生效。

另已加强响应式断言：除整页宽度与控件视口外溢外，也检查可见标题、段落、列表和标签在 `overflow:hidden/clip` 下是否把文字切掉；新增回归夹具专门覆盖“页面没有横向滚动条但文字被裁掉”的情况。持久浏览器每例重载后会等待应用恢复滚动处理，再将同一标签页滚回页首并验证，登录 storage 保留。

验证：`npm run build:server` 通过；`npm run test:demo` 通过，82/82；定向 responsive-layout 与 case-baseline 回归 2/2；document-case-metadata 11/11。此次未改动部门申样目标应用。原 156 条用例仍以 `db58ddfd-811b-45d3-a77d-d6c68393fc92` 全量记录为基准；后端/审批/角色/库存/企微类验收仍需真实 API 契约与隔离 fixtures 才能声称通过。

针对原始 156 条项目，使用当前 TestPilot 的页面取证步骤生成接口重新处理了全部 10 条空步骤 `browser-ui` 项（case-53、54、70、75、77、82、84、87、88、92），结果为 0/10 生成；工具保留每条原始预期并返回具体阻塞原因。case-70/75/77 明确需要 API/业务数据；case-53/54/82/84/87/88/92 需要审批/订单等记录或员工身份。目前页面证据没有这些记录，若强行添加点击或断言会变成无目标的假脚本。项目备份为 `test-plans/624a5e81-e79e-493f-a746-8accc5c44b90.before-repair-attempt-2026-10-19.json`。下一步的最小解锁资料是：审批详情入口和待审/已审隔离记录、订单/申请测试记录与可核对字段、可复用员工测试身份；API 类用例需 OpenAPI/接口文档、测试环境和可创建/清理的 fixtures。


### 2026-10-19 追加：可执行子检查与 Canvas/SVG 双通道差异

用户指出部分场景“被阻塞、却没有脚本”。复核确认有两种原因，不能用同一种方式处理：

- **有页面状态证据、缺业务记录**：TestPilot 的步骤生成只接受能验证原预期的步骤；历史申请/订单列表没有数据时，AI 0/10 生成是有意不编造记录，但也漏掉了能做的只读页面检查。现为 case-53/54/82/84/87/88 加入基于本轮 Computer Use 观察的导航+空状态断言；case-75 加入空表单汇总显示子检查。每条仍保留 coverage gap，所以子步骤通过不冒充完整用例通过。
- **画面可见、DOM 不可读**：case-75 的 H5 由 21 个 Canvas/SVG 渲染面展示汇总金额/重量。Computer Use 截图能看到精确值，Playwright 页面/所有 frame 的 innerText 均取不到。此前这被确定性脚本误报成 fail。现在确定性 lane 将这种情形标记为“视觉内容需 Computer Use 核验”的 blocked；Computer Use 的 DOM 对账也将 Canvas/SVG 上的截图证据保留为 unverified，不再覆盖视觉观察制造“精确文字不存在”的假矛盾。可访问 DOM 的普通页面文字仍由脚本断言。

执行证据：

- 全量基准仍为 db58ddfd-811b-45d3-a77d-d6c68393fc92，156 条、312 个通道结果；本次未用 7 条定向复跑替代全量基准。
- 新增/复测的 7 条（Run 722fe5ff-749a-4842-8a08-e1d272a42523）：确定性通道 6 条部分脚本断言通过后保留 blocked，case-75 曾因 DOM 可读性限制报错；Computer Use 均确认记录/夹具缺失，未把整案判通过。
- case-75 脚本和视觉复核 Run 6da8d640-b24b-457f-84e5-18793680cc86：两通道均 blocked/inconclusive；脚本明确识别 21 个 Canvas/SVG 渲染面，视觉通道看到“总计: ¥0.00”和“预估总重: 0.00公斤”，但没有合成图书数据，因而未验证多行小计与汇总公式。这不是产品失败，也不是全案通过。
- 工具代码：src/adapters/document-test-workflow.ts 的脚本文本断言现在跨主 frame/iframe 检查可见文本，并识别 Canvas/SVG 不可 DOM 读取；src/adapters/computer-use.ts 仅在 DOM 缺失且存在图形渲染面时把核验列为 unverified，截图结论仍由 Computer Use 给出。
- 项目当前已恢复为 156/156 选中、审核通过；全量基准结果与本轮定向复核均分别保留。

验证：npm run build:server 通过；case-75 在修复后重跑 2/2 lane 均为预期的 blocked/inconclusive，已无脚本 false-fail。tests/document-workflow.integration.test.mjs 正在验证 ZIP runner 对新的跨 frame 文本等待逻辑的执行。


工作流集成补测已完成：tests/document-workflow.integration.test.mjs 1/1 通过（118 秒），ZIP runner、部分范围报告和 MCP 导出仍正常；npm run build:server 通过。

### 2026-10-19 最终复核：旧服务报告已由当前源码全量取代

用户追问“为什么阻塞、为什么没有可执行步骤”。直接原因是此前把“完整业务验收缺少夹具/接口/角色”误当成“不能生成任何步骤”，而部分用例又在 Canvas/SVG 上绘制文字，确定性 DOM lane 会把看得见但 DOM 不可读的内容报成失败。本轮做了以下修正：

- 修正 `.agents/skills/testpilot-qa-workflow/SKILL.md` 的矛盾门槛：有 `coverageGap` 不再自动禁止 grounded、只读的部分 UI 子检查；子检查通过仍不能把整条用例标为通过。
- 新增 `test-plans/department-sample-apply-v1.0-empty-step-readiness.json`，逐条列出项目 94 条空 steps 的既有分流、coverage gap、前置条件、负责人动作及来源。完整清单核验为 11 条待澄清、5 条 N/A、23 条业务页面/角色/夹具、55 条 API/后端/集成/安全证据；156 条总库存精确对齐，94 条空步骤不漏项。
- 加固模型 API 地址读取路径：保存值和环境变量在发送 Bearer Key 前同样经过 URL 校验，远程 HTTP 被拒绝，只允许远程 HTTPS 和本地 loopback HTTP。`tests/model-settings-security.test.mjs` 2/2 通过。
- `npm run build:server` 通过；`npm run test:demo` 84/84 通过。

第一次新跑全量的 Run `b2b0e710-6fd2-4441-98ba-1ee31c430135` 虽已执行 312/312 并生成包，事后确认它由早于 Canvas/SVG 修复的 `dist` 服务运行：case-75 的确定性 lane 再次误报 fail。因此该轮保留作为历史证据，但不作为最新代码基准。

改用当前源码服务并接回同一持久化 Edge 标签页后，Run `7d9dd845-4c8f-47ef-bfa7-57455d7645be` 重新执行 156/156 条、312/312 个 lane 结果；登录 handoff 未触发。最终：

| 通道/比较 | passed | failed | blocked | N/A | aligned | unresolved |
|---|---:|---:|---:|---:|---:|---:|
| 确定性 | 8 | 6 | 137 | 5 | — | — |
| Computer Use | 5 | 2 | 144 | 5 | — | — |
| 对比 | — | — | — | 5 | 6 | 150 |

`overall=unresolved`、`finalReady=false`，因为多数用例缺真实隔离数据/API/角色证据；aligned 中有 5 条双侧通过、case-94 双侧复现移动端内容裁切失败。case-75 在当前源码下确定性 lane 变为正确的 Canvas/SVG DOM 不可读 `blocked`，Computer Use 看到空表单 `总计: ¥0.00` / `预估总重: 0.00公斤`，但没有图书/多行 fixtures，因此核心公式仍 unresolved；这证实是 runner 观测分类误报已修复，不代表多行公式通过。

另有双侧复现的 case-27：自编码输入 `ABC` 出现红框，失焦时仍出现查询加载迹象；确定性监听也观察到 1 次 fetch/XHR，违反“非数字不调用接口”的明确验收点。case-94 在 390×844 下固定桌面侧栏导致主内容裁切。case-10 的实际提示比 XMind 期望多“联系运营”；case-137 确定性复现输入 1000/9999 失焦后钳制为 999，但 Computer Use 没有完成最终双侧对照。报告须将这些按证据边界保留，不自动修改需求文本。

最终报告：`artifacts/demo/document-tests/runs/7d9dd845-4c8f-47ef-bfa7-57455d7645be/report.md`。脚本 ZIP：同目录 `testpilot-package.zip`。ZIP 完整性核验通过，包含 README、workflow plan、156 条 `cases.json`、report、run snapshot、依赖说明与 `run.mjs` 共 8 个文件；导出 runner 包含视口动作分支。旧版 `b2b...` 报告不得作为当前源码结果引用。

### 2026-10-19 追加：浏览器第三方请求策略收紧

用户继续追问 blocked/没有可执行步骤的原因并要求补救。本轮修复了另一类“工具本身会制造阻塞或不安全放行”的问题：浏览器请求守卫过去只看 method/path，跨源 `GET /getInfo` 或 `POST /queryOrders` 会因命名像读取而通过，且 route handler 没有使用 resource type。现在在线确定性与 Computer Use handler 都把目标 origin、Playwright resource type 与导航状态传给同一个 `allowBrowserRequest` 策略；跨源 XHR/fetch、未知导航、非 HTTPS 第三方内容拒绝；HTTPS 第三方仅允许脚本、样式、图片、字体、媒体等被动资源；活动登录接力才可加载受限 SSO 导航/认证路径，接力结束即撤销。导出 ZIP runner 同步检查跨源 resource type，防止离线复跑变宽松。

验证：`npm run build:server` 通过；`node --test tests/login-handoff-request-policy.test.mjs` 1/1；全量 `npm run test:demo` 84/84；针对 ZIP runner 新增资源类型/第三方被动资源断言后，再跑 `node --test tests/document-workflow.integration.test.mjs` 1/1（约 118 秒）。

这次修复的是执行器网络边界，不会凭空为原始用例创造审批、订单、员工身份、合成数据或 OpenAPI 证据。已有报告仍显示 156/156 被纳入、312/312 双通道记录，但大量完整业务检查因上述环境材料缺失而 unresolved。已有能力应该继续生成可验证的只读子检查并保留 coverage gap；完整通过要等对应 fixtures/契约/身份到位。当前需再次用现行源码对目标全量复跑，确认更严格的网络边界没有切断目标应用所需接口。

### 2026-10-19 继续：修正登录跨源写请求边界并扩展页面证据生成

并行代码审计发现上一版策略仍有漏洞：登录接力期间只看路径名，任意域名的 `/oauth/token` POST 或 `/session` OPTIONS 仍可能通过。现改成每次登录接力仅临时信任当时已打开登录/认证页面中观测到的精确 HTTPS origin；跨源认证写入还要求 auth 路径与 fetch/XHR resource type。同源之外的相同路径不再获准。补了 `evil.example/oauth/token`、`evil.example/session` 与错误 resource type 的拒绝回归；目标 origin 的合法测试 SSO origin 在活动接力期间通过，接力结束拒绝。

随后核查为何页面明明可操作，生成器仍报告“无页面证据”：旧取证只扫描主 frame 的标题/控件/标题元素/链接，不扫 iframe 和可见正文行；此外无模型 fallback 的规则一开始就 `return`，使其只能处理红框字段，无法继续尝试页面上已直接观察到的精确提示文案。现已跨所有 frame 收集去重后的可见正文行（过滤手机号、邮箱、身份证样式值及密码/令牌/验证码关键词），并允许从需求中明确引用、且在页面证据中确实可见的引号文案生成 `assertVisible`。这类步骤仍保留原 coverage gap，不把部分检查升级成完整验收。

回归证明本地页面仅以可见正文给出的精确提示能生成可复用 `assertVisible` 并由确定性 lane 执行通过；原 invalid-field 页面证据 fallback 也继续通过。`npm run build:server` 通过，`node --test tests/document-no-model-step-fallback.integration.mjs` 1/1 通过，`node --test tests/login-handoff-request-policy.test.mjs` 1/1 通过。

当前新开源源码实例 4323 上已有全量 Run `daf9fc6d-8ed3-4111-83ee-2ab93e30923e`，156 条用例、312 个双通道结果，正在依次执行。它启动于上述最新策略和正文/frame取证改动之前，因此只作当前基线，不冒充新策略验证；完成后将使用新源码及同一已认证 CDP 会话再跑全量，并比较两次的安全阻塞与用例结果。运行当前仍在进行，未要求用户重新扫码。

## 2026-10-19 full run and same-site API repair

- Full run `4edcbfd0-a5ed-4da9-903c-3e75c6847fc1` covered 156/156 cases and 312 browser-lane results, with 58 API-contract cases separately blocked because no approved API suite/contract was linked.
- Root cause for the earlier blank page: the H5 shell is hosted at `cdn.yibentushu.com` while bootstrap/dictionary/region reads use `testapi.yibentushu.com`. The browser policy blocked every cross-origin fetch/XHR, so the SPA rendered an empty shell. The exact same-site read API exception now admits only HTTPS GET/HEAD/POST/OPTIONS fetch/XHR to read-shaped endpoints (plus `/system/dict` and `/system/area/tree`) on the same registrable site. Cross-site APIs and mutation-shaped paths remain blocked. The source policy is injected into packaged `run.mjs` so live and ZIP runner behavior stay aligned.
- A browser smoke using the existing TestPilot Edge profile observed five allowed API responses, zero blocked/failed target API responses, and the full application form. The public page displayed applicant-type controls and visible form sections; no submission or save was performed.
- Computer Use now recovers a blank target in the same owned tab before global preflight. The source-grounded case repair runs before page evidence collection so safe repairs are not suppressed by an evidence-read failure.
- Full-run outcome remains `unresolved`: deterministic 7 passed / 6 failed / 138 blocked / 5 N/A; Computer Use 7 passed / 3 failed / 141 blocked / 5 N/A. Comparisons: 7 pass/pass aligned, 1 fail/fail aligned (case-94), 2 fail/fail with backend proof still missing (case-27, case-137), 3 deterministic-fail / Computer-Use-blocked (case-10, case-42, case-51), 138 blocked/blocked, 5 N/A.
- Case-10 page copy differs from its exact expected quote: actual text includes `请联系运营OA申请`, while the case expects `请OA申请`; preserve this as a requirement/product discrepancy rather than weakening the exact-copy assertion.
- Confirmed defects: case-27 accepts a non-numeric book code without visible validation and emitted a fetch/XHR during the bounded observation window; case-94 overflows/clips at 390px; case-137 clamps entered quantity 1000/9999 to 999. These remain source-target findings, not fixes to the target application.
- Generated artifacts: `artifacts/demo/document-tests/runs/4edcbfd0-a5ed-4da9-903c-3e75c6847fc1/report.md` and `testpilot-package.zip`.

## 2026-10-19 retest with the expanded first-party read policy

- Rerun ID `04f826be-1c22-43ff-aa2c-5558a1a961f0`; all 156 cases completed in deterministic and Computer Use lanes; report and package are ready. Edge profile authentication was verified after service restart without presenting a login page.
- The updated policy permits the target app's first-party `/system/dict` and `/system/area/tree` reads. A profile-backed browser smoke observed 5 allowed API responses, 0 blocked target API requests, the full form and applicant-type choices. Customer search for supplied 1004.* test keys still rendered `无数据`; treat this as missing target test fixture, not request-policy blocking.
- Run remains `unresolved`: deterministic 7 passed / 6 failed / 138 blocked / 5 N/A; Computer Use 5 passed / 2 failed / 144 blocked / 5 N/A. The model lane is nondeterministic across runs; a new visual failure on case-45 confirms the invalid phone input lacks the required red state and exact error copy. Case-94 responsive overflow is again failed in both lanes. API contract lane remains 58 blocked without an approved API suite.
- Case-27, case-42, case-51, and case-137 deterministic failures are unchanged. Case-10 remains a literal copy mismatch. The selected suite produced no new safe scripts from the 11 model candidates because each lacks required fixture, identity, URL, or backend evidence; 84 other empty-script cases remain assigned to explicit clarification, role/data fixture, backend/API, scope, or evidence gaps.
- Latest report and reusable package: `artifacts/demo/document-tests/runs/04f826be-1c22-43ff-aa2c-5558a1a961f0/report.md` and `testpilot-package.zip`.
