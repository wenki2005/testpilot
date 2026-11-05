<!-- generated-code-index -->
# src/adapters/database

数据库。文件清单由 `npm run code:index` 生成。功能总入口见仓库根目录“代码导航.md”。

## 子目录

- [sqlite](sqlite/)

## 文件职责

| 文件 | 用途 | 主要入口 |
| --- | --- | --- |
| [mysql-browser.ts](mysql-browser.ts) | MySQL 结构、表和数据查询 | `MysqlTable`、`MysqlColumn`、`MysqlRowsPage` |
| [regression-readback.ts](regression-readback.ts) | 测试数据库连接、申请商品与订单字段读回 | `Row`、`compareDepartmentList`、`compareDepartmentGoods` |
| [sqlite/migration-workflow.ts](sqlite/migration-workflow.ts) | migration workflow | `SqliteMigrationCandidate`、`validate`、`createSqliteMigrationCandidate` |
| [sqlite/sqlite-migration-adapter.ts](sqlite/sqlite-migration-adapter.ts) | SQLite 迁移场景执行 | `MigrationStatus`、`ScenarioOutcome`、`runSqliteMigrationSuite` |
| [sqlite/sqlite-migration-worker.ts](sqlite/sqlite-migration-worker.ts) | SQLite 隔离执行子进程 | `ScenarioInput`、`SqliteChildProcess` |
