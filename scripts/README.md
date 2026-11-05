# 开发与维护脚本

找功能实现先看 [代码导航](../代码导航.md)。这里仅保留当前工具，不留旧转发和已完成的一次性修复。

| 目录 | 用途 |
| --- | --- |
| build/ | 服务端清理、Windows 演示包构建 |
| resources/ | 当前用例、脚本导出与校验、工作流构建 |
| data/ | 配置和工作区数据迁入、数据库连接 |
| execution/ | 按指定清单执行回归 |
| maintenance/ | 架构检查、测试入口、代码索引和排版 |
| lib/ | 路径、脚本布局、测试发现和进程辅助 |
| verify/ | 数据清点、迁移核验、完成记录补迁和前置整理 |

## 常用入口

- npm run workbench:start：启动当前工作台，复用运行实例。
- npm run resources:export -- --system <UUID> --out <新目录>：从当前网页只读导出资源快照。
- npm run scripts:export / scripts:check：导出、校验步骤镜像；可指定 --base-url、--data-dir、--out。源码不附带旧镜像。
- npm run package:demo：既有 Windows 演示包；完整业务资源初始化仍待完成。
- npm run code:find -- "审批"：按功能、函数、旧文件名、用例编号查找代码。
- npm run code:index：更新代码索引和18个主要目录说明。
- npm run code:format：预览排版，--write 才写入。

启动、转发、停止由根目录的 start-integrated-workspaces.mjs、serve-integrated-entry.mjs、stop-integrated-workspaces.mjs 管理，配合仓库根的“启动测试工作台.cmd”。

迁移和前置整理工具可能写本机数据，执行前阅读参数；本次目录清理没有执行它们。
