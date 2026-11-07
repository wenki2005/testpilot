# 项目目录

第一入口为根目录 [代码导航](../代码导航.md)，新增或重命名文件遵循 [命名规范](naming-conventions.md)。

## 根目录已精简

- 启动只看 `启动测试工作台.cmd`。旧启动副本、历史归档、重复转发、旧 UI 构建、旧批次计划和旧脚本镜像已从当前目录清除。
- 当前产品说明在 `docs/product/`，脚本入口在 `docs/tooling/`；完成的一次性修复和历史进度文档不随源码保存。
- 主要功能目录保留18份自动说明，子目录不重复生成说明。
- 根目录的 `node_modules`、`dist` 和 `web/dist` 是本机依赖与构建；当前工作区的数据已外置到 `%LOCALAPPDATA%/TestPilot/workspaces/dify`。旧 `runtime-data` 保留迁移回退，不加入源码包。源码工作副本仍不等于完整发行包。

## 实际源码结构

```text
src/
  server/                         HTTP服务启动与装配
  demo/server.ts                  原启动路径的兼容入口
  compat/                         原类型、HTTP辅助的兼容导出
  domain/<功能>/                  纯规则与数据契约
  application/
    cases/                        用例准备与规划
    projects/                     项目维护与会话
    runs/
      preparation/                执行前准备
      execution/                  执行协调与生命周期
      recovery/                   断点与恢复
      results/                    结果、对比和调查
      notifications/              通知流程
  adapters/
    regression/
      catalog/                    项目、模块、版本、用例与批次
      execution/                  模块执行任务与清单
      chains/                     核心链路调度及浏览器核验
      scenarios/                  application/books/records/orders等业务场景
      evidence/                   数据读回、证据与阻塞定位
      authoring/                  用例基线、质量、步骤准备
      config/                     测试输入和审批配置核验
      exports/                    脚本包和导出规则
      notifications/              批次通知
    browser/                      浏览器、登录及操作适配
    database/                     数据库查询与SQLite迁移
    documents/                    既有网页测试实现，按用例/证据/执行/资源分组
    api/ ai/ source-tests/        接口、模型、源码测试适配
    integrations/dify/            真实工作流连接
  interfaces/http/<功能>/         按功能分类的HTTP接口
  storage/<功能>/                 按功能分类的存储实现
web/src/
  main.tsx                        网页启动
  assets.d.ts                     资源类型
  app/                            工作台、侧栏、路由和基础样式
  shared/                         跨页面共享事件与组件
  features/
    execution/                    执行测试、核心链路和结果
    case-scripts/                 用例、脚本、前置、对比和版本
    run-reports/                  报告及导出
    settings/                     设置
    …                             其他既有页面各自独立
scripts/
  build/ resources/ data/ execution/ maintenance/ lib/
  verify/                         数据清点、迁移核验与前置整理
  start-integrated-workspaces.mjs  原启动入口保留
  serve-integrated-entry.mjs       原入口转发保留
  stop-integrated-workspaces.mjs    原停止入口保留
tests/<功能>/                      原测试按功能分类，断言保留
project-resources/department-sample/ 用例与脚本定义快照
```

主要功能目录的 README 列出具体文件职责及主要函数/类。机器可读索引为 [code-index.json](code-index.json)，按需运行 npm run code:index 更新。

## 按功能查找

```powershell
npm run code:find -- "库存"
npm run code:find -- "saveEditorCase"
npm run code:find -- "dify-order85-presentation"
npm run code:find -- xmind-85
```

旧名称通过 [迁移映射](collaboration/source-layout-moves.json) 定位新实现，不需要猜测哪个历史版本才是有效代码。

## 四类内容仍分开

- 01 工具源码：指向本仓库，实际实现已在仓库内部按功能归类，不再只是外部导航。
- 02 业务资源：131条用例、对应脚本、前置和4条核心链路的定义文件，不含结果和截图；文件同步通过资源预览/应用接口，首次安装导入见模块交付计划。
- 03 发行产物：Windows完整运行包，含Node、依赖和全部资源，不当作源码维护。
- 04 本机数据：导航到外部工作区，运行记录、截图及私有配置不入 Git；升级沿用同一数据位置。

src/demo/server.ts保留服务启动兼容入口，并在加载适配器前设置外部数据位置。已完成旧数据的受控迁移和数据库摘要核对；历史证据引用随迁移更新，源数据保留回退。
