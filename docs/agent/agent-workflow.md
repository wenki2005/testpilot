# 外部 Agent 工作流：从拉代码到用例入库

面向使用 Cursor / Claude / Codex 等外部工具维护 TestPilot 用例的人。Agent 负责读取规则、归类、写步骤、自检、入库；人负责提供用例和最终确认。

## 0. 准备

```bash
git clone <repo>
node scripts/start-integrated-workspaces.mjs   # 本机 4325 / 4323
```

数据目录：`%LOCALAPPDATA%\TestPilot\workspaces\<工作区>`，运行库以它为准，仓库里的 `project-resources` 只是快照。

## 1. Agent 先读这些文件

| 文件 | 内容 |
| --- | --- |
| `AGENTS.md` | 协作规则入口 |
| `docs/agent/case-authoring.md` | 归类、执行方式、步骤写法、反例 |
| `docs/agent/step-schema.json` | 允许的动作与字段 |
| `docs/agent/modules.json` | 可选的模块 ID（生成物） |
| `docs/agent/test-data.md` | 常用测试数据 |

模块有增减时先重新导出：

```bash
npm run cases:context
```

## 2. 人提供新用例

CSV / Markdown / XMind 导出的文本，包含编号、标题、原始预期即可；不带步骤也可以，由 agent 补。

## 3. Agent 产出结构化用例

按 `case-authoring.md` 输出 JSON：模块 ID、执行方式、固定步骤、预期。

硬性约束：

- 模块只能从 `modules.json` 选，不能编造；
- 不能写死申请标题、单号（列表/详情用 `openLatestRecord`）；
- 至少一条断言；
- 预期原文照抄。

## 4. Agent 自检

```bash
npm run cases:validate -- <目录或文件>
```

校验内容：模块存在、动作合法、无写死标题、有断言、caseId 不重复、`modules.json` 未被手改。

不通过就按报错修改，不要跳过。

## 5. 入库（二选一）

**方式 A：改仓库 + 同步**

```bash
# 写入 project-resources/department-sample/scripts/...
node scripts/resources/sync-project-resources.mjs --dir project-resources/department-sample
```

先预览差异（默认不写入），确认 added/removed/changed 数量后再加 `--apply`。

**方式 B：调保存接口**

```
POST /dify/api/system-module-regression/case-editor/<moduleId>
```

逐条写入运行库，适合零散几条。

## 6. 人复核

打开「用例与脚本」：

- 列表可按待核对 / 待澄清筛选；
- 步骤和脚本可直接改，右上角或底部保存；
- 人工步骤为空时会只读展示脚本步骤。

## 7. 真跑验证

Agent 写的步骤只保证格式合规，**跑得通要真跑一次**：

- 执行测试 → 自选用例 → 选这条 → 运行；
- 通过后再当作可复用资产；
- 失败就回到第 3 步改步骤。

## 职责划分

| 谁 | 负责 |
| --- | --- |
| Agent | 读规则、归类、写步骤、自检、入库 |
| 人 | 提供用例、复核、真跑验证、决定是否纳入回归 |

## 常见坑

- 没跑 `cases:context`，模块清单过期 → 校验报“模块不存在”；
- 写死申请标题 → 换数据就等不到元素；
- 把预期改了来“通过” → 校验器不拦，但评审要拒；
- 同步前没预览 → 可能整模块覆盖。
