# 用例结构化与步骤编写规则（供外部 Agent 使用）

目标：把新导入的用例文本转成可执行的 case JSON；模块只能来自 `modules.json`，步骤必须能通过 `scripts/verify/validate-case-json.mjs`。

## 1. 输入

- 新用例来源：CSV / Markdown / XMind 导出的文本；
- 每条必须包含：编号、标题、原始预期；可选：来源路径、优先级、前置条件。

## 2. 归类规则（按顺序判断）

1. 来源路径里出现模块名 → 归该模块；
2. 标题/预期关键词命中 `modules.json` 里模块的 `keywords` → 归该模块；
3. 都不命中 → `executionRoute: "blocked"`，`reason` 写明“无法确定模块”，不要猜。

禁止编造模块 ID；只能使用 `modules.json` 中的 `moduleId`。

## 3. 执行方式

| 情况 | executionRoute |
| --- | --- |
| 只读页面断言、可浏览器执行 | `browser` |
| 接口字段/契约校验 | `api` |
| 需要提交、审批、人工准备账号 | `blocked` |

## 4. 步骤编写

- 只允许 `step-schema.json` 里的动作；
- **禁止写死记录标题或单号**（如“开心25春…等2本样书”“202611130130”）；
- 列表/详情类统一用：

```json
{ "action": "openLatestRecord", "list": "apply", "status": "待审批" }
```

- 每条用例至少 1 条断言（`assertVisible` / `assertText` / `assertExactVisible` / `assertValue` 等）；
- 预期原文照抄，不得改写或降级。

## 5. 输出格式

```json
{
  "caseId": "1-099",
  "title": "审批详情显示审批人姓名",
  "expected": "页面展示审批人姓名与状态",
  "moduleId": "d293ef3e-…",
  "executionRoute": "browser",
  "steps": [ ... ],
  "confidence": 0.86,
  "reason": "标题与预期指向审批详情页"
}
```

## 6. 交付前必须自检

```bash
npm run cases:context      # 重新生成 modules.json（如模块有变更）
npm run cases:validate -- docs/agent/examples/good
```

校验不通过就按错误提示修正，不要跳过。

## 7. 反例（会被校验器拦下）

- `clickExactText` 写死申请标题；
- 模块 ID 不在 `modules.json`；
- 没有断言；
- 预期被改写。
