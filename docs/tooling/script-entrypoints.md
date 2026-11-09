# 用例、脚本与代码入口

## 找功能实现

打开 [代码导航](../../代码导航.md)。它按页面、接口、执行服务、业务场景逐项定位；支持直接查找审批、库存、订单、保存脚本、报告下载等功能。

## 找某条用例

项目定义快照位于 project-resources/department-sample/，cases 和 scripts 按同一稳定用例 ID 存放。使用 npm run code:find -- xmind-85 可同时找到用例与脚本文件。

快照不会自动同步网页；当前网页模块版本及有效步骤缓存仍是执行准源。原始用例来源在 regression/packs/，旧的生成镜像已移除，避免与当前快照混用。网页用例与脚本会显示稳定编号、脚本路径和待核对标记；待核对条目可在目录筛选后逐条查看，确认脚本后才允许执行。

## 启动与维护

- 启动当前工作台：npm run workbench:start。
- 当前网页：http://127.0.0.1:4325/dify/?page=dify-regression。
- 代码索引更新：npm run code:index。
- 目录和命名：[项目目录](../project-layout.md)、[命名规范](../naming-conventions.md)。
- 工具入口分类：[scripts/README.md](../../scripts/README.md)。
- 业务资源：[project-resources/README.md](../../project-resources/README.md)。

## 运行数据

当前记录、截图、配置和登录态仍在原 runtime-data、artifacts 数据区。路径和历史引用未改动，不提交 Git。代码归类不等于已实现数据库物理迁移或完整新安装初始化。
