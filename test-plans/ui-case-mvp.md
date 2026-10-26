# 部门申样书 UI 浏览器用例补充审计

审计时间：2026-10-18  
范围：浏览器 UI 用例；只读本地项目 JSON、完整矩阵、XMind 副本与已有运行报告。未访问目标站点、未触发执行、未修改权威 JSON，也未重启服务。

## 结论

当前项目 `624a5e81-e79e-493f-a746-8accc5c44b90` 中，已选中且 `sideEffectRisk=none`、有可用 BrowserStep 的可见 UI 用例正好 18 条：case-10、30、31、33、35、37、39–45、47–49、52、94。审计未发现可确认在这18条之外、同时满足需求清晰、无副作用、前置条件已满足的新增用例。将 `unknown` 风险直接改成 `none` 缺乏证据，不建议这样做。

找到两处报告级误分类：case-35、case-37 的当前项目 JSON 均明确为 `sideEffectRisk=none`、无前置条件、已有只读/临时步骤；但 `department-sample-apply-v1.0-blocker-audit.md` 同时把它们归为 `browser-ready`，又以“风险 irreversible”解释 blocked。这两案属于现有18条，不是额外新增。可通过下列审计草案纠正其执行步骤/阻塞描述，不需改权威 JSON。

## 证据来源

- 当前项目：`artifacts/demo/document-tests/projects/624a5e81-e79e-493f-a746-8accc5c44b90.json`，156 cases；18项 selected 且 `sideEffectRisk=none`、有步骤。case-35、case-37 原字段 `preconditions=[]`、`preconditionsConfirmed=true`。
- 完整矩阵：`test-plans/department-sample-apply-v1.0-full-suite.json`（156条）；对应说明 `test-plans/department-sample-apply-v1.0-full-suite.md`。
- XMind 本地副本：`artifacts/demo/document-tests/projects/eaf7b01a-51a2-4e66-bb5e-37d662c4306c-部门申样书_V1.0_测试用例.xmind`。case-35 需求路径明确为“点击继续添加样书→向下复制空白图书明细行→每行提供删除按钮，可删除误加的样书行”；case-37 明确“查看发货方式选项→仅支持快递，H5不展示快递公司选择”。
- 最新现成日志：运行 `f56c0757-9128-4008-b457-d9dac9720f74`（`artifacts/demo/document-tests/runs/f56c0757-9128-4008-b457-d9dac9720f74/`）；阻塞审计 `test-plans/department-sample-apply-v1.0-blocker-audit.md` 的 case-35 与 case-37 条目存在风险字段/阻塞说明矛盾。历史运行报告只用于核对，不作为本次现场复测结果。

## 可用 BrowserStep 草案

以下使用项目现有步骤字段/动作名。只点击添加空白明细行、读取页面文案；不点删除、不保存、不提交。选择配送方式只检查已展示内容，不作变更。

### case-35｜空白新增行显示删除控件

- 风险：只改变当前未提交表单的临时行集合；不删除既有业务记录。步骤草案不点击“删除”。若该表单存在自动保存行为则停止执行，先在隔离测试环境确认。
- 所需 fixture/身份：无特殊 fixture；需能打开空白样书申请表单的已授权员工会话。当前本地证据不能确认目标站点登录要求或自动保存行为。
- 预期：新增空行后展示删除控件。
- BrowserStep JSON：

```json
[
  { "action": "clickExactText", "text": "继续添加样书" },
  { "action": "assertExactVisible", "text": "删除" }
]
```

### case-37｜发货方式为快递且未展示快递公司选择

- 风险：只读可见状态。
- 所需 fixture/身份：打开申请表单的员工会话；不需已有申请记录。
- 预期：显示“发货方式”与“快递”，没有可选快递公司的表单控件。当前 BrowserStep DSL 的可见断言不适合断言“控件不存在”，因此这里只给可直接执行的正向断言；需先确认控件定位器/负向断言 DSL 后再补“无快递公司选择”。
- BrowserStep JSON：

```json
[
  { "action": "assertVisible", "text": "发货方式" },
  { "action": "assertExactVisible", "text": "快递" }
]
```

## 其他 UI 候选的处理

- case-1/2/4 需身份夹具（企微员工/非架构员工）；本地无测试账号/会话声明，不能据用例文本安全地验证登录或授权结果。
- case-21/22 需要确定的客户搜索数据与登录会话。任意关键词可能命中真实客户；没有沙箱 fixture 前不提供可执行输入步骤。
- case-30/31/39–45/47–49/52 已属18条：是输入暂态或读取空表单控件；无需重复加入。
- case-33 也属18条；新增行是临时表单状态，但步骤可增强字段检查（物流编码、数量、图书名称、出版社、定价）。此处缺少字段可重复 locator/DOM 证据，避免扩展成猜测断言。
- case-46 需选择地区；项目标记为 `unknown` 且没有固定沙箱数据，不补临时输入步骤。
- 提交、审批、取消/删除既有数据、重试推送、库存/物流/WMS、订单及跨系统同步类案例均不提供可执行步骤。

## 明确限制

本审计不代表目标页面当前真实运行状态；未登录或操作目标网站。没有现场确认目标环境、账号角色、自动保存策略、浏览器运行时和目标控件定位信息。case-35 的草案仅在空白表单且确认不会自动保存时适用；case-37 的负向断言要等到支持可靠控件存在性断言后再加入。无需据此改动权威项目 JSON。
