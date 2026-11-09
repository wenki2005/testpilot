# 用例迭代与 AI 接入指南

面向接手的人：**在另一台电脑从零跑起来**、**改用例**、**加用例**，以及**把项目接到你自己的 AI 工具上继续迭代**。

本指南里的数字和路径均按 2026-11-09 的实际状态核对过；如与实际不符，以页面上看到的为准，并回来修这份文档。

---

## 一、另一台电脑从零启动

### 前提

| 项 | 要求 |
| --- | --- |
| 系统 | Windows，已安装 Microsoft Edge |
| Node.js | ≥ 22.19（`node -v` 自检） |
| 构建依赖 | 需要 `npm`；源码版没有预置 `node_modules` 和 `dist` |
| 网络 | 能访问 GitHub；直连失败时给 git 配代理（见文末） |

### 四条命令

```powershell
git clone --branch main https://github.com/wenki2005/testpilot.git testpilot
cd testpilot
npm ci
npm run build
npm run workbench:start
```

也可以双击根目录的 `启动测试工作台.cmd`，效果等价。

### 启动后应看到

| 检查点 | 期望 |
| --- | --- |
| `GET http://127.0.0.1:4323/api/health` | `{"ok":true}` |
| 网页 `http://127.0.0.1:4325/dify/?page=dify-regression` | 能打开“TestPilot · 测试工作台” |
| `GET /api/system-module-regression/resources/initialization` | `status=initialized`、6 模块、253 用例、4 链路 |
| `case-editor` 里的用例 | 253 条，其中 136 条有脚本步骤、117 条待补 |
| 运行批次 | 0 条（不带任何人的历史） |
| 数据目录 | `%LOCALAPPDATA%\TestPilot\workspaces\dify`，在仓库之外 |

首次启动会**自动**从 `project-resources/department-sample` 建项目，不需要手工导入。
重复启动不会重复初始化，也不会覆盖本机已有的编辑、历史和报告。

> `resources/initialization` 是“首次初始化回执”，不会随编辑实时变化；要看实时数量用 `case-editor`。

---

## 二、改一条已有的用例

路径：**用例与脚本 → 左侧选模块 → 选中用例 → 右侧编辑“预期”或脚本步骤 → 保存**。

- 保存会生成新版本，旧版本可在版本面板查看、对比、恢复。
- 恢复旧版本后要再“保存”才会生效，并产生一个新版本（不会抹掉中间历史）。

**版本号是模块级的**：改一条用例会让该模块所有用例的显示版本一起前进，`changeSource` 也会变成本次渠道（手动 / 资源导入 / MCP）。判断某条用例到底有没有变，要比对内容差异，不能只看版本号。详见[更新用例](case-version-updates.md)。

底线：不要通过删断言、放宽预期或忽略报错让用例变绿。

---

## 三、新增一条用例

当前版本**没有独立的“新增”按钮**，新增走资源导入，这是设计内的入口：

1. 用例与脚本 → **资源** → 导出，拿到当前资源 JSON；
2. 在 `cases` 数组里加一条（`modules`、`chains` 保持不动）；
3. 导入该 JSON → **预览**（应显示“新增 1 / 未变 N”）；
4. 确认后点 **应用**。

一条新用例的最小结构：

```json
{
  "id": "xmind-322",
  "moduleId": "<目标模块的 UUID，从现有用例的 moduleId 复制>",
  "title": "订单列表分页加载",
  "expected": "每页 20 条，翻页后编号不重复",
  "manualSteps": [],
  "prerequisites": [],
  "script": { "caseId": "xmind-322", "dependsOn": [], "steps": [] }
}
```

规则：

- `id` 必须稳定且不与现有编号冲突；
- `script.caseId` 必须等于 `id`；
- 脚本留空时，页面会标“待补脚本”，**不会**被执行；
- 未预览直接调应用接口会被拒绝（HTTP 400），这是防止半成品入库；
- 要让它能进回归：先补 `steps`，再在用例详情点“脚本已核对”，模块执行才不会被拦。

增删改都能回滚：改的用版本面板恢复，新增的用“导出 → 删掉该条 → 导入 → 预览显示移除 1 → 应用”。

---

## 四、接到你自己的 AI 工具

### 1. 拿接入包

网页 **用例与脚本 → AI 接入说明 → 下载接入包**，解压后包含 `README.md`、`AGENT-GUIDE.md`、`config/mcp.json`、`examples/prompts.md`。

`config/mcp.json` 已经填好本机路径和项目 ID，正常情况下不用改：

```json
{
  "mcpServers": {
    "testpilot": {
      "command": "<本机 node.exe 绝对路径>",
      "args": ["<仓库绝对路径>/dist/mcp/maintenance-server.js"],
      "env": {
        "TESTPILOT_BASE_URL": "http://127.0.0.1:4325/dify/",
        "TESTPILOT_SYSTEM_ID": "436847ad-f144-425f-b303-1ca9b22e0b52"
      }
    }
  }
}
```

两个环境变量必须对：`BASE_URL` 指向正在运行的工作台入口，`SYSTEM_ID` 是当前项目 UUID（换项目要改）。

### 2. 加到你编辑器的 MCP 配置

把上面的 `testpilot` 段落到你所用工具的 MCP 配置里（**路径随版本会变，以官方文档为准**）：

| 工具 | 常见位置 |
| --- | --- |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | 项目内 `.cursor/mcp.json`，或用户级 `~/.cursor/mcp.json` |
| Codex CLI | `~/.codex/config.toml` 里的 `[mcp_servers.testpilot]` |

最省事的做法：把解压后的整个目录丢给你的 AI，让它读 `README.md` 和 `AGENT-GUIDE.md` 自己接。

### 3. 连接检查（只读）

让 AI 调用 `testpilot_cases` 搜索 `xmind-84`，能返回标题、版本号、模块就算接通。**不要**用“跑一次测试”当连接检查。

### 4. 能做什么

| 工具 | 用途 |
| --- | --- |
| `testpilot_cases` | 按编号/内容查用例 |
| `testpilot_pending_script_reviews` | 列脚本待核对清单 |
| `testpilot_case` | 读完整用例、前置、脚本 |
| `testpilot_case_versions` | 读历史版本 |
| `testpilot_save_case` | 按当前 `versionId` 保存单条修改 |
| `testpilot_resources` | 读全量定义和 revision |
| `testpilot_preview_resources` | 预览新增/修改/移除及依赖 |
| `testpilot_apply_resources` | 应用已预览的全量变更 |

边界：只有定义维护，**没有**执行测试、连数据库、开浏览器、跑命令、发通知的能力。

---

## 五、推荐的迭代节奏

```text
读（testpilot_case）
  → AI 给出差异
    → 你确认
      → 保存（testpilot_save_case，带 versionId）
        → 网页看新版本 / 待核对徽标
          → 补脚本并“脚本已核对”
            → 执行测试
```

要点：

- 保存不会执行测试，执行必须由人在网页点；
- 版本过期（别人先改了）会被拒绝，重新读取再合并，不要强行覆盖；
- 批量改动先 `preview_resources` 再 `apply_resources`。

---

## 六、已知限制（会造成困惑，先看这里）

| 限制 | 说明 |
| --- | --- |
| 版本是模块级的 | 改一条用例，同模块所有用例版本一起前进，属设计行为，见[更新用例](case-version-updates.md) |
| CSV 上限 200 条 | 导入器硬编码（`src/adapters/documents/resources/importer.ts`）；当前 253 条，**整份 CSV 传不了**，需按模块拆。JSON / Markdown / XMind 不受此限（后两者上限 2000 条） |
| 没有“新增用例”按钮 | 新增走资源导入（本文第三节） |
| 空脚本用例不执行 | 记为待补/阻塞，不是失败 |
| 初始化接口非实时 | 它是首次回执，实时数量看 `case-editor` |
| 第三方编辑器未逐一验证 | MCP 协议层已实测可读写；具体编辑器 UI 需按你所用工具实际试一次 |

---

## 七、验收清单

在一台干净机器上，按顺序勾选：

- [ ] `npm ci` + `npm run build` + `npm run workbench:start` 成功
- [ ] 初始化显示 6 模块 / 253 用例 / 136 条有步骤 / 117 条待补 / 4 链路
- [ ] 运行批次为 0，账号未连接，数据目录在 `%LOCALAPPDATA%`
- [ ] 改一条用例：版本 +1，历史里能看到旧版本
- [ ] 新增一条用例：预览显示“新增 1”，应用后总数 +1
- [ ] AI 工具能调 `testpilot_cases` 读到用例
- [ ] AI 工具能调 `testpilot_save_case` 保存，网页能看到新版本

---

## 附：GitHub 直连失败的临时处理

```powershell
git config --global http.proxy  http://127.0.0.1:<你的代理端口>
git config --global https.proxy http://127.0.0.1:<你的代理端口>
```

网络恢复后撤销：`git config --global --unset http.proxy`（https 同理）。
