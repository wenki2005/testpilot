# 核心链路改造交接（2026-11-20）

## 仓库与运行

- 仓库：`D:\TestPilot-Integrations\20261103-a01\repo`
- 分支：`codex/delivery-20261105`（公司库 `codeup` 的 `master` 最新为 `54e6142`，今天改动均未提交）
- 启动：`node scripts/start-integrated-workspaces.mjs`（端口 4323/4325，统一入口 http://127.0.0.1:4325/dify/）
- 停止：杀掉 4323/4324/4325 监听进程后重启
- 构建：`node node_modules/typescript/bin/tsc -p tsconfig.json`；前端 `node node_modules/vite/bin/vite.js build web`

## 今天已完成（未提交代码）

1. 核心链路改走模块执行器，不再依赖 MySQL：
   - `src/adapters/regression/chains/core-chain-browser.ts`：新增 `chainModuleEngine` 分支，按用例编号调用 `deps.execute`；
   - 用 `core-chain-store.ts` 的 `catalog` 注入用例对象，`lifecycleStatus` 置为 ready，`project.reviewStatus='approved'`；
   - 链路 runId 用 `${run.id}-${chain.id}` 避免冲突。
2. 链路恢复「提交申请」步骤：`src/domain/regression/core-chain-definitions.ts`（`xmind-1-050`）。
3. 提交成功后发企微（接在链路执行完成处）：
   - `core-chain-browser.ts` 调 `sendApprovalNotice`；
   - 内容：`【已提交】用书申请 <编号>` + 系统名 + 用例编号与步骤名。
4. `assertMatch` 动作已全链路打通：类型、校验、执行、质量规则（算数值证据）、`package-builder` runner 分支、`readText` runner 分支。
5. 用例脚本更新（全局生效）：
   - `2-089`：打开最新「已通过」记录，断言「审批人」+ 正则 `已同意|待审批`；
   - `1-075`：打开最新「已通过」记录，断言「小计/总计/预估总重」+ `¥\d+\.\d{2}` + `共\d+本`。仍被质量规则判“证据不足”。
6. 前端：
   - 核心用例「查看用例」去掉 `disabled={blocked}`，可正常展开；
   - 运行提示改为模块同款 `sm-progress sm-live-progress`，移到表格上方，显示「正在运行：链路 · 第 X/Y 步 步骤名」+ 进度条 + 停止运行。

## 实测结果（真实提交过，注意）

- 11-20 用真实提交跑通：申请 `202611200069`、`202611200070`，审批人吴国庆；
- 链路 6 步：提交/待审核/审批人文案/字段回显/全部状态入口通过，样书明细被质量规则拦截；
- 群消息：已加发送代码并跑过一次，未确认是否收到。

## 未完成（下一轮优先）

1. **提交后 5 分钟只读轮询**（用户已选方案 1）：已完成，见下方「2026-11-20 第二轮」。
2. `1-075` 质量规则仍拒绝，需要按 `src/domain/documents/cases/case-assertion-quality.ts` 的判定补“逐行数值”断言：已补到 5 条数值断言，质量门通过；但还需要一条“已通过”的记录真正跑一次才能确认脚本本身落地。
3. 确认企微群消息是否真的收到；账号字段目前用 `run.systemName`，需换成真实账号名。
4. 前端提示条「停止运行」需验证能真正中断链路。

## 约束

- 不要为了通过而删断言或降标准；
- 真实提交会产生企微审批提醒，跑之前必须征得用户同意；
- 截图/验证禁止误点审批。

## 2026-11-20 第二轮（已改代码，未提交 git）

### 改了什么

- 新增 `src/adapters/regression/chains/core-chain-approval.ts`：提交后的审批等待。
  每 30 秒在既有登录页面里发一次只读 GET `dept/book/apply/progress/<applicationNo>`，
  按 `examineStatus` 判定（0 待审批 / 1 已通过 / 2 已驳回 / 3 已取消），最多 10 次。
  不导航、不点击、不装路由；等待期间用户仍可在同一个测试窗口里操作。
- `core-chain-browser.ts` 模块执行器分支：
  - 拆成两批：`submit`+`pending` 先跑 → 轮询 → 其余四步；
  - `onResult` 里逐条回传，页面上的「第 X/Y 步」跟着真实进度走，停止运行时也保留已完成步骤；
  - `abort` 时按文档 runId 调 `deps.cancel(profileId, documentRunId)`，链路才真正被中断（原来只 abort 了链路 controller）；
  - 企微提醒改用真实账号名（`accountLabel`），并把发送结果写进 `submit` 步骤的 detail。
- `core-chain-store.ts` 注入 `accountLabel`；`module-regression-service.ts` 新增
  `accountLabel(systemId)`（activeAccountId → accountNames / accountProfiles）。
- 用例 `1-075` 脚本升到 v67：删掉页面里根本不存在的 `共\d+本`，补 5 条实测能匹配的数值断言
  （金额、总计、预估总重、数量列、定价/重量列），质量门由 BLOCK 降为 PASS；原有断言一条未减。

### 实测

- 超时分支：申请 `202611200093`，`submit`/`pending` 通过，后四步失败
  「审批等待超时（5 分钟）：申请 202611200093 未在等待窗口内通过审批。」
- 取消分支：申请 `202611200096`，用户撤回后轮询识别到 `examineStatus=3`，后四步失败
  「申请已取消（申请 202611200096），后续步骤未执行。」
- 停止运行：`order-flow` 跑一半取消，批次 `phase=cancelled`，已完成的步骤保留。

### 弯路（别再踩）

第一版轮询给测试窗口装了「只读」route，把用户手动撤回的 POST 也拦了，页面报「操作失败，请稍后重试」。
现在不装 route，自动化只发 GET；要保证只读就只约束自己的代码，不要去约束人的操作。

### 还没验

- 「审批通过→继续跑后四步」分支（需要 5 分钟内有人审批）；
- `1-075`/`2-089` 在存在「已通过」记录时的真实执行结果；
- 企微群是否真的收到（接口 errcode=0，但还没人确认群消息）；
- 前端进度条与「停止运行」的目视确认；
- 申请 `202611200093` 仍是待审批，需要人工撤回。
