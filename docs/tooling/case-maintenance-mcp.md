# AI编辑器维护用例

入口：**用例与脚本 → AI 接入说明 → 下载接入包**。把整个解压文件夹交给agent，让它先读README.md和AGENT-GUIDE.md，再按所在编辑器的MCP设置接入config/mcp.json。

下载包使用当前TestPilot安装目录的真实MCP服务及Node路径；无需另装大模型。编辑器提供AI，TestPilot提供项目数据、校验和版本保存。移动程序或换电脑后重新下载配置。连接是否成功以调用testpilot_cases能读到当前项目为准，网页不模拟“已连接”状态。

## 能做什么

| 工具 | 用途 |
| --- | --- |
| testpilot_cases | 查找编号、模块和版本 |
| testpilot_case | 读取完整用例、前置和脚本 |
| testpilot_case_versions | 读取历史版本 |
| testpilot_save_case | 按当前versionId保存单条修改 |
| testpilot_resources | 读取全量定义和revision |
| testpilot_preview_resources | 校验新增、修改、移除及依赖 |
| testpilot_apply_resources | 应用已预览的全量变更 |

只开放配置项目的定义维护，没有执行测试、SQL、浏览器、命令和发送通知工具。服务入口为dist/mcp/maintenance-server.js；源码版构建后也可直接启动，环境变量TESTPILOT_BASE_URL默认http://127.0.0.1:4325/dify/，TESTPILOT_SYSTEM_ID必须是当前项目UUID。

## 修改规则

先读取当前内容和版本，展示计划及差异，再按本次任务的授权保存。旧版本会被拒绝；重新读取并合并并发修改。前置用例必须要求passed，不能凭已有脚本制造通过。新增使用新的稳定ID，保留不相关的模块、范围和链路；完整变更先preview再apply。

网页约4秒检查一次有效版本。没有本地编辑时自动同步，显示修改对比；有未保存编辑时保留内容，提示外部已有新版本，由用户选择查看。历史版本标注MCP、手动或资源导入。该标签表示保存渠道，不是认证人员身份。

## 验证

真实stdio初始化、tools/list、读取及HTTP保存桥接已通过合成样例检查。另验证新版本、来源、历史保留及过期版本拒绝；所有执行依赖在夹具中禁止调用。没有向被测申样系统发业务请求。
