<!-- generated-code-index -->
# web/src/features/execution

执行测试。文件清单由 `npm run code:index` 生成。功能总入口见仓库根目录“代码导航.md”。

## 子目录

- [core-chains](core-chains/)
- [module-preview](module-preview/)

## 文件职责

| 文件 | 用途 | 主要入口 |
| --- | --- | --- |
| [core-chains/core-chain-results.tsx](core-chains/core-chain-results.tsx) | 核心链路按顺序展示步骤结果 | `Counts`、`CountsView`、`CoreChainResults` |
| [core-chains/core-chain-selector.tsx](core-chains/core-chain-selector.tsx) | 核心链路选择及启动入口 | `api`、`DepartmentCoreChains`、`perform` |
| [core-chains/core-chains.css](core-chains/core-chains.css) | core chains（页面样式） |  |
| [execution-page.css](execution-page.css) | 执行测试主页面：范围、模块、批次和执行结果（页面样式） |  |
| [execution-page.tsx](execution-page.tsx) | 执行测试主页面：范围、模块、批次和执行结果 | `api`、`Modal`、`CasePack` |
| [latest-case-results.ts](latest-case-results.ts) | 按版本读取逐条最新结果 | `CaseResult`、`LatestResult`、`LatestModuleResults` |
| [module-preview/module-workbench.css](module-preview/module-workbench.css) | module workbench（页面样式） |  |
| [module-preview/module-workbench.tsx](module-preview/module-workbench.tsx) | module workbench | `Module`、`Job`、`State` |
| [selected-case-results.tsx](selected-case-results.tsx) | 所选范围的逐条结果展示 | `Scope`、`Counts`、`CasePack` |
