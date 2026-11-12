# AI 操作手册（先读我）

这个目录是给**接手本仓库的 AI** 看的操作说明。读完本页，你就知道用例放哪、怎么加、怎么改、怎么校验。

## 一、开始之前

按顺序读三样，其他文档按需再看：

| 顺序 | 文件 | 读它做什么 |
|---:|---|---|
| 1 | [`AGENTS.md`](../../AGENTS.md) | 硬规则：不许造假、不许删断言、不许改被测系统 |
| 2 | [`docs/requirements/`](../requirements/) | 需求原文（V1.0、V1.1），判断预期对错的唯一依据 |
| 3 | 本页 | 用例库结构、编号规则、加改流程 |

写脚本动作时再看 [`docs/tooling/case-step-dsl.md`](../tooling/case-step-dsl.md)（可用动作清单）。人读的入门说明在 [`使用指南.md`](../../使用指南.md)。

## 二、用例库在哪

```
project-resources/department-sample/
  project.json        项目标识
  modules.json        模块定义（id、名称、目录、caseKeys）
  cases/<模块目录>/<用例编号>.json     用例定义
  scripts/<模块目录>/<用例编号>.json   执行步骤
  chains/*.json       核心链路
  manifest.json       文件清单与哈希（程序生成，不要手改）
```

`cases` 与 `scripts` **必须同编号成对出现**；文件名就是用例编号。

## 三、六个模块

新增用例先选模块，目录和 `modules.json` 里的 `directory` 必须一致。

| 模块 id | 名称 | 目录 | 适用内容 |
|---|---|---|---|
| `2d6950a6-996d-4096-b820-22a0cd1a7d02` | 登录入口与公共基础 | `01-login` | 登录、身份准入、公共导航 |
| `e807d296-9a7b-4b96-8bf9-2f888ec834b9` | 申样申请与经销商数据 | `02-application` | 申请表单、字段校验、客户与图书数据 |
| `50defb76-157a-4ed1-9f91-10a8ba991e0c` | 申请记录与审批详情 | `03-approval` | 申请列表、审批详情、撤销与取消 |
| `b7de8f06-4e4d-4a62-a48d-881566a6f933` | 订单与物流 | `04-orders-logistics` | 订单列表、订单详情、物流时间轴 |
| `a1288838-bcb7-43a2-b79c-179e54132ebb` | PC/H5 横向适配 | `05-clients` | 响应式与端差异 |
| `d293ef3e-482d-4048-aa90-94260ef47596` | 数据与审计 | `06-audit` | 状态口径、数据一致性 |

## 四、编号规则

格式：`xmind-<批次>-<序号>`，例 `xmind-2-123`。

- 批次 1 = 最初导入的一批，批次 2 = V1.1 补充批，**新用例从 `xmind-3-001` 起**
- 序号在批次内唯一，**删除后不回收**，不要重排已有编号
- `cases` 和 `scripts` 文件名、JSON 里的 `id` / `caseId` 三处必须完全一致

## 五、新增一条用例

1. 选模块目录，取下一个可用编号
2. 写 `cases/<目录>/<编号>.json`，至少包含：`id`、`moduleId`、`title`、`expected`、`sourcePath`、`priority`
3. 写 `scripts/<目录>/<编号>.json`，`caseId` 同编号，`steps` 为动作数组；暂不写步骤就留空数组
4. 把 `"<moduleId>:<编号>"` 追加到 `modules.json` 对应模块的 `caseKeys`
5. 重建清单：`node scripts/resources/rebuild-manifest.mjs`（或按现有工具重建）
6. 本地校验：`npm run resources:check`
7. 推到运行中的工作台：`node scripts/resources/sync-project-resources.mjs --dir project-resources/department-sample`，按提示用预览/应用接口

## 六、修改一条用例

- **改步骤**：只动 `scripts/<...>.json` 的 `steps`，用例 `expected` 不动
- **改预期**：先确认需求文档支持，再改 `cases/<...>.json` 的 `expected`；需求文档没写的，记为待澄清，不要自己编
- 用例文字来自测试文档导入，**不要为了跑通去改原话**
- 改完同样要 `npm run resources:check` 并同步到运行中的工作台

## 七、禁止事项

- 不手改 `manifest.json`、不手改 `chains/*.json`（链路定义由代码维护）
- 不删除或弱化断言来让用例通过；阻塞和未执行不能算通过
- 不在用例里写死账号密码、token、真实个人信息
- 不修改被测系统代码

## 八、校验命令

| 命令 | 作用 |
|---|---|
| `npm run resources:check` | 用例/脚本成对、编号与文件名一致、模块引用完整、manifest 哈希匹配 |
| `npm run resources:sync` | 预览资源变更（不写入），确认 added/removed/changed 数量 |
| `npm run scripts:check` | 校验运行中的模块脚本镜像（需要服务在跑） |
