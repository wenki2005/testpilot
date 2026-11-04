# 一次性验收/审计脚本

- `inventory-workspace-sources.mjs <候选数据目录...>`：只读列出本机候选数据目录的项目摘要；用于确定迁入来源，不读取密钥、Cookie 或业务输入。
- `verify-workspace-migration.mjs --workspace <模块>`：只读核对迁入文件和来源、目标的 SQLite 表内容；不执行业务用例，不连接目标测试库。
- `append-dify-terminal-results.mjs --source <目录> [--apply]`：默认只读预览缺失的已结束 Dify 批次、任务及引用截图；应用时要求 Dify 服务停止，先备份，再追加不存在的记录和请求绑定，不覆盖历史、不复制凭据、不重跑业务、不操作网页回归数据区。

新的一次性验收、审计、修复脚本放这里，不再放 `scripts/` 根目录。

规则：

1. 文件名动词开头，例如 `verify-dify-13-minimal.mjs`、`audit-regression-layout.mjs`。
2. 文件头写清用途、运行前提、示例命令、是否只读、是否会写目标系统。
3. 在 `scripts/README.md` 的“一次性验收/审计”表里登记用途。
4. 不把密钥、Cookie、真实个人资料写进脚本或默认参数。
5. 需要长期复用的入口留在 `scripts/`，不要放这里。

历史脚本目前仍在 `scripts/` 根目录，后续逐步迁入本目录；迁移时同步更新 README 和文档中的命令。
