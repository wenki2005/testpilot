# 脚本步骤 DSL 参考

用例的 `script.steps` 是一个数组，每个元素是一个动作对象。**保存时服务端会按类型校验**，动作名或字段写错会直接拒绝，所以照着本页写。

来源：`src/domain/documents/shared/test-model.ts` 的 `BrowserStep` 联合类型。动作名区分大小写。

---

## 一、动作清单

### 断言类（决定用例成败，至少要有 1 个）

| action | 字段 | 说明 |
| --- | --- | --- |
| `assertExactVisible` | `text` | 页面存在**完全等于** `text` 的可见元素 |
| `assertVisible` | `text` | 页面存在**包含** `text` 的可见元素（模糊匹配，优先用它查文案） |
| `assertNotVisible` | `text` | 页面上**看不到**包含 `text` 的元素 |
| `assertText` | `text` | 断言页面文本包含 `text` |
| `assertRoleVisible` | `role`, `name` | 存在指定可访问角色的控件；`role` 只能是 `button`/`radio`/`checkbox`/`tab`/`link` |
| `assertRoleDisabled` | `role`, `name` | 指定角色的控件处于禁用态 |
| `assertControlEnabled` | `text` | 指定文本的控件可点击/可用 |
| `assertDisabled` | `label` | 指定 label 的表单控件为禁用 |
| `assertValue` | `label`, `value`, `rowIndex?` | 表单控件的值等于 `value`（表格行用 `rowIndex`） |
| `assertValueByPlaceholder` | `placeholder`, `value` | 按占位符定位的输入框值等于 `value` |
| `assertSelectedByRoleIndex` | `role=combobox`, `index`, `value` | 第 `index+1` 个下拉框的选中值等于 `value` |
| `assertFieldInvalid` | `label`, `rowIndex?` | 字段处于无效/报错态 |
| `assertCurrentUrlUnchanged` | — | 当前 URL 与记录点一致 |
| `assertNoFetchOrXhr` | `quietMs?` | 观察窗口内没有 fetch/XHR 请求 |
| `assertNoHorizontalOverflow` | — | 无横向溢出 |
| `assertMaxLengthOrMessage` | `label`, `maxLength`, `message` | 长度限制或对应提示 |

### 操作类（改页面状态，不直接判定成败）

| action | 字段 | 说明 |
| --- | --- | --- |
| `clickExactText` | `text` | 点击完全等于 `text` 的元素；受安全策略限制，含提交/删除/支付等字样的目标会被拒绝 |
| `clickByRole` | `role`, `name` | 按角色点击，`role` 同上四种 |
| `fillByPlaceholder` | `placeholder`, `value` | 按占位符填输入框 |
| `fillByLabel` | `label`, `value`, `rowIndex?` | 按 label 填；表格列名可当 label 用 `rowIndex` 定位行 |
| `fillByRoleIndex` | `role=combobox`, `index`, `value` | 在远程搜索型下拉里输入关键字（**只输入，不选中**） |
| `blurByPlaceholder` | `placeholder` | 让输入框失焦，触发失焦校验 |
| `blurByLabel` | `label`, `rowIndex?` | 同上，按 label |
| `selectByPlaceholder` | `placeholder`, `value` | 按占位符选择选项 |
| `selectByLabel` | `label`, `value`, `rowIndex?` | 按 label 选择选项 |
| `selectByRoleIndex` | `role=combobox`, `index`, `value` | 第 `index+1` 个下拉框选择文本为 `value` 的选项 |
| `triggerClientValidation` | `name` | 触发指定提交按钮的前端校验（不真正提交） |
| `deleteSampleRow` | `rowIndex?` | 删除样书明细的一行（仅 UI 操作） |
| `goBack` | — | 同源返回上一页 |
| `setViewport` | `width`, `height` | 设置视口，用于 PC/H5 布局断言 |
| `scrollToRatio` | `ratio` | 滚动到页面比例位置（0—1） |
| `setReducedMotion` | `value` | 模拟减少动效偏好 |
| `captureCurrentUrl` | — | 记录当前 URL，供后续比较 |
| `startFetchOrXhrCapture` | — | 开始捕获请求，配合 `assertNoFetchOrXhr` |

---

## 二、写步骤的几条硬规则

1. **必须有至少一个断言动作**，否则该用例会被判“断言不完整”而不执行。
2. **不要制造假通过**：断言要能因为产品缺陷而失败。只断言“元素存在”通常不足以证明业务结果。
3. **提交类动作被禁止**：`clickExactText` 命中“提交/保存/删除/支付/确认/下单/发送/重置/退出”等字样时会被安全策略拒绝；提交走授权写路径。
4. **先导航再断言**：断言只会看当前页面；跨页签要先 `clickExactText` 切过去。
5. **表格行**用 `rowIndex`（从 0 开始），列名当 label，例如：
   ```json
   { "action": "fillByLabel", "label": "数量（册）", "value": "1000", "rowIndex": 0 }
   ```
6. **远程搜索下拉**分两步：先 `fillByRoleIndex` 输入关键字，再 `selectByRoleIndex` 选候选，最后 `assertSelectedByRoleIndex` 核对选中值。
7. 动作名和字段名写错会被服务端拒绝；本页没有的动作就是不存在，不要臆造。

---

## 三、两个真实例子

**断言地区三级联动（xmind-46）**

```json
[
  { "action": "selectByRoleIndex", "role": "combobox", "index": 2, "value": "湖南省" },
  { "action": "assertSelectedByRoleIndex", "role": "combobox", "index": 2, "value": "湖南省" },
  { "action": "selectByRoleIndex", "role": "combobox", "index": 3, "value": "长沙市" },
  { "action": "assertSelectedByRoleIndex", "role": "combobox", "index": 3, "value": "长沙市" },
  { "action": "selectByRoleIndex", "role": "combobox", "index": 4, "value": "芙蓉区" },
  { "action": "assertSelectedByRoleIndex", "role": "combobox", "index": 4, "value": "芙蓉区" }
]
```

**数量上限拦截（case-134e82…）**

```json
[
  { "action": "clickExactText", "text": "继续添加样书" },
  { "action": "fillByLabel", "label": "数量（册）", "value": "1000", "rowIndex": 0 },
  { "action": "blurByLabel", "label": "数量（册）", "rowIndex": 0 },
  { "action": "assertValue", "label": "数量（册）", "value": "999", "rowIndex": 0 }
]
```

---

## 四、让 AI 写脚本时怎么用

把本页和用例的 `expected` 一起给 AI，要求它：

1. 只使用本页列出的 action；
2. 至少输出一个断言；
3. 保存前先展示差异，你说同意再 `testpilot_save_case`；
4. 保存后到网页点“脚本已核对”，模块执行才不会被拦。

保存后若被拒，错误信息里会指出具体字段，按提示改即可。
