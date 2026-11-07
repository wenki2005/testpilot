# AI编辑器维护用例

入口：**用例与脚本 → AI 接入说明 → 下载接入包**。把整个解压文件夹交给agent，让它先读README.md和AGENT-GUIDE.md，再按所在编辑器的MCP设置接入config/mcp.json。

下载包使用当前TestPilot安装目录的真实MCP服务及Node路径；无需另装大模型。编辑器提供AI，TestPilot提供项目数据、校验和版本保存。移动程序或换电脑后重新下载配置。连接是否成功以调用testpilot_cases能读到当前项目为准，网页不模拟“已连接”状态。

## 新手复制给AI

把下载的整个文件夹交给AI后，直接复制下面这段话：

```text
请阅读这个接入包中的README.md和AGENT-GUIDE.md，使用config/mcp.json连接TestPilot MCP。连接后只做读取检查：调用testpilot_cases搜索xmind-84，并返回用例标题、版本号和模块。不要修改、保存或执行测试。
```

连接检查成功后，再使用 `examples/prompts.md` 中的读取和修改指令。修改用例时必须先展示差异，得到明确同意后才保存；保存不会执行测试。

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

## 新版用例后的脚本核对

上传预览会列“脚本待核对”；应用后打开对应单条用例，编辑区上方显示“脚本待核对”和“脚本已核对”按钮。当前左侧目录及执行测试模块列表尚没有统一的待核对徽标或筛选；执行待核对用例/引用它的核心链路会被拒绝并提示返回核对。

可以让编辑器通过testpilot_resources读取定义，筛出scriptReview.status为pending的用例，再逐条testpilot_case读取最新版并用testpilot_save_case保存修改。默认单条保存保留pending状态，不代表审核完成或测试通过；网页查看实际差异后点击“脚本已核对”，再进入执行测试。新脚本必须非空才能确认。该MCP没有专用的批量核对或执行工具，不会自动运行测试验证AI生成的步骤。

## 验证

真实stdio初始化、tools/list、读取及HTTP保存桥接已通过合成样例检查。另验证新版本、来源、历史保留及过期版本拒绝；所有执行依赖在夹具中禁止调用。没有向被测申样系统发业务请求。
