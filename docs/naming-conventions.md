# 代码命名与存放规范

## 找功能的顺序

从根目录 [代码导航](../代码导航.md) 进入功能目录，再查看同目录 README 的文件职责和主要入口。不要从历史构建包或运行截图目录寻找源码。

## 文件与目录名称

- 目录和文件统一使用小写英文、连字符：`case-scripts`、`core-chain-store.ts`。
- 文件名直接表达职责：`execution-page.tsx` 是页面，`regression-routes.ts` 是接口，`module-execution-service.ts` 是执行服务，`run-report-store.ts` 是报告存储。
- 只有真实对接 Dify 的适配器保留该技术名称作为分类；业务场景用 `orders`、`books`、`application` 等业务名。旧类型名、接口 URL、数据文件名不在本次随意更改。
- 不再用编号缺陷名作为主要职责名，例如旧 `dify-order85-presentation.ts` 改为 `scenarios/orders/order-detail-presentation.ts`；编号通过索引和用例文件关联。
- 不用“新版”“最终版”“临时版”；版本由 Git、模块版本和资源清单管理。
- 不把新实现都塞进 `utils.ts`、`common.ts`。可复用文件按用途命名，例如 `project-selection.ts`、`test-file-discovery.mjs`。
- React 组件用 PascalCase，函数/变量用 camelCase，类型名表达业务含义；保留跨模块或对外使用的既有导出名称，避免为改名改变协议。

## 放在哪里

| 内容 | 位置 |
| --- | --- |
| 页面、页面组件和样式 | `web/src/features/<功能>/`，同一功能放一起 |
| 侧栏、工作台壳和页面路由 | `web/src/app/` |
| 前端跨页面共享事件或组件 | `web/src/shared/` |
| 纯业务规则和类型 | `src/domain/<功能>/`，不依赖执行适配器 |
| 应用流程和协调 | `src/application/<流程>/` |
| 浏览器、数据库、外部服务、实际执行 | `src/adapters/<功能>/` |
| HTTP 请求入口 | `src/interfaces/http/<功能>/` |
| 持久化实现 | `src/storage/<功能>/` |
| HTTP 服务启动和装配 | `src/server/`；`src/demo/server.ts` 只保留原启动路径兼容 |
| 工具测试 | `tests/<功能>/`，不与被测业务用例混放 |
| 构建、资源、数据维护脚本 | `scripts/build/`、`scripts/resources/`、`scripts/data/` |
| 开发维护和索引 | `scripts/maintenance/` |
| 当前数据清点与核验 | `scripts/verify/`；完成的一次性修复、旧转发不留在源码中 |
| 业务用例和脚本快照 | `project-resources/<项目>/cases/`、`scripts/`，同一稳定用例 ID |

新增代码遵循现有分层。不能为方便导入让 domain 调用 adapters，也不能从网页导入服务器实现。

## 排版与维护

- 一个文件围绕一个明确职责；页面组件、类型、样式按目录组织，不重复复制实现。
- 已将密集的 TypeScript/TSX 按语法结构展开。排版保留标识符、字面量和 JSX 文本，不顺带调整页面文案或业务判断。
- `npm run code:format` 默认只预览；需要应用时运行 `npm run code:format -- --write`。若格式化无法保留语法结构，工具跳过该文件。
- 文件移动/重命名需要同时更新引用、启动/打包入口、资源路径和测试文件路径；保留原断言及历史数据协议。
- 更新 `代码导航.md`，运行 `npm run code:index`。按中文功能或旧名称都应能找到新代码位置。
- 编译产物、运行库、截图、账号配置和登录态不提交 Git，不作为源文件复制维护。
