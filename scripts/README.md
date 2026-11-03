# scripts 目录说明

这里只放 TestPilot 的构建、启动、导入导出、测试和验收入口。业务回归的固定步骤不在这里，而是在 `regression/scripts/`（生成镜像，见 [规范](../docs/collaboration/回归脚本与目录规范.md)）。

## 规则

1. 新脚本用动词开头，文件名能看出用途；不要用“临时/最终/新版”。
2. 一次性验收、审计、修复脚本放 `scripts/verify/`，并在本文件登记；`scripts/` 根只保留长期入口。
3. 脚本头部写清：用途、运行前提、示例命令、是否只读、会不会写目标系统。
4. 不把密钥、Cookie、真实个人资料写进脚本或默认参数。
5. 业务用例的固定步骤不放 `scripts/`；用 `npm run scripts:export` 从 TestPilot 模块版本生成到 `regression/scripts/`。

## 长期入口

| 脚本 | 用途 |
| --- | --- |
| `clean.mjs` | 构建前清理 `dist` |
| `run-tests.mjs` | `npm run test:all` 的串行测试入口 |
| `clean-test-artifacts.mjs` | 清理已完成的测试运行目录 |
| `test-browser-processes.mjs` | 测试进程/浏览器清理辅助 |
| `package-demo.mjs` | 打包 Windows 演示包 |
| `start-dify.ps1` | 启动 Dify 回归工作台（默认 4319） |
| `start-fixed-regression.ps1` | 在原 4321 地址加载固定回归版本，复用 `demo-toolrun` 数据和原账号；有活动任务时拒绝重启，启动前核对旧服务身份，不建立新演示实例 |
| `dify-machine-transfer.mjs` | 导出/导入系统、模块版本、最小范围和固定测试数据 |
| `build-dify-module.mjs` | 从用例表构建 Dify 模块包 |
| `package-department-sample-suite.mjs` | 打包部门申样用例集 |
| `export-regression-scripts.mjs` | 从运行中的 TestPilot 导出固定步骤镜像到 `regression/scripts/`（默认数据目录 `artifacts/demo`） |
| `check-regression-scripts.mjs` | 校验镜像与当前模块版本一致、无过期文件 |
| `run-regression-plan.mjs` | 按 `regression/plans/*.json` 的固定版本/用例清单创建 fixed 批次；支持 `--dry-run` |

### 恢复后的固定回归

原服务入口为 `http://127.0.0.1:4321`，数据目录为演示包的 `artifacts/demo-toolrun`。
运行 `启动固定回归.cmd` 加载当前已构建版本；`-Restart` 仅在核实本机服务身份且没有活动任务时重启。

固定清单：`regression/plans/fixed-recovery-21-2026-11-02.json`（原17条加4条字段校验，保留失败和阻塞）；`fixed-recovery-131-2026-11-02.json` 保留原始五模块全量范围。
使用 `node scripts/run-regression-plan.mjs --plan <清单> --base-url http://127.0.0.1:4321` 执行。

脚本镜像导出和检查可加 `--system-id <系统ID> --active-only`，只包含指定系统的未归档模块；两条命令必须使用相同的服务、数据目录和筛选参数。
镜像只记录固定子步骤；需要查询读回、样式或完整表单有效性转换的用例应从工作台运行完整核验。

## 一次性验收/审计（历史位置，后续迁到 `scripts/verify/`）

| 脚本 | 用途 |
| --- | --- |
| `verify-dify-13-minimal.mjs` | 审计 13 条最小回归批次 |
| `verify-dify-completion.mjs` | 审计 Dify 完成度 |
| `verify-dify-core-regression.mjs` | 审计核心回归 |
| `verify-dify-database-regression.mjs` | 审计只读数据库证据 |
| `verify-dify-expansion.mjs` | 审计五模块扩展批次 |
| `verify-dify-markdown-fixed.mjs` | 审计 Markdown/固定步骤 |
| `verify-dify-minimal.mjs` | 审计最小回归 |
| `verify-dify-other-minimal.mjs` | 审计其他模块最小集 |
| `verify-dify-readonly-expansion.mjs` | 审计只读扩展 |
| `verify-dify-readonly-starter.mjs` | 审计只读起步集 |
| `verify-dify-web-module.mjs` | 审计网页模块 |
| `verify-system-module-regression.mjs` | 审计按系统按模块回归 |
| `build-case156-executable-matrix.mjs` | 构建用例可执行矩阵 |
| `build-department-blocker-audit.mjs` | 部门阻塞审计 |
| `build-department-run-analysis.mjs` | 部门运行分析 |
| `build-department-sample-suite.mjs` | 构建部门申样套件 |
| `package-department-sample-suite.mjs` | 打包部门申样套件 |
| `repair-department-sample-current-project.mjs` | 修复当前项目数据（按需、先备份） |
| `repair-run-comparison-labels.mjs` | 修复运行对比标签（按需、先备份） |
| `curate-xmind-ui-steps.mjs` | 整理 XMind UI 步骤 |
| `generate-xmind-ui-steps.mjs` | 生成 XMind UI 步骤 |
| `sync-xmind-browser-steps.mjs` | 同步 XMind 浏览器步骤 |

## 新增脚本放哪

- 构建/启动/打包/导入导出 → `scripts/`
- 一次性验收、审计、修复 → `scripts/verify/`（见该目录 README）
- 共用函数 → `scripts/lib/`
- TestPilot 自身测试 → `tests/`
- 业务固定步骤 → 不进 `scripts/`，由模块版本导出到 `regression/scripts/`
