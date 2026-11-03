# 生成的回归脚本镜像

自动生成，请勿手改。修改用例/步骤后，在 TestPilot 运行状态下执行 npm run scripts:export 重新生成。

- 来源：http://127.0.0.1:4321
- 数据目录：D:\TestPilot-Demo-0.2.0-Windows\TestPilot-Demo-0.2.0-Windows\artifacts\demo-toolrun
- 系统 1 / 模块 5 / 用例 131
- 有固定步骤 64；仅运行期生成 0；无步骤 67

目录：`<系统>/<模块>/<用例>.json`，每个用例一份 BrowserStep 固定步骤；`_module.json` 和 `_index.json` 是索引。
场景类用例（图书/列表/设备等）的步骤可能由运行期只读场景生成，标记为 `derived-at-run`，并在有缓存时导出缓存步骤。
镜像只记录 BrowserStep，不是完整独立执行包。查询读回、样式与完整表单有效性转换等补充核验须由 TestPilot 固定回归入口执行；不能只运行缓存子步骤便宣称整条通过。

校验：`npm run scripts:check`。修改用例请改 TestPilot 模块版本，再重新导出，不要手改本目录。
