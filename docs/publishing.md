# 上传与分发

## GitHub源码范围

| 内容 | 路径 |
| --- | --- |
| 服务端与网页源码 | src/、web/src/、web根目录构建配置 |
| 当前全部用例、对应脚本、前置和核心链路 | project-resources/department-sample/ |
| 原始用例来源、前置编号维护清单 | regression/ |
| 启动、导出、构建和维护工具 | scripts/、packaging/、integrations/ |
| 工具测试与合成样例 | tests/、examples/ |
| 维护和使用说明 | docs/、README.md、代码导航.md、AGENTS.md、.agents/、.github/ |
| 依赖与构建约定 | package.json、package-lock.json、tsconfig.json、playwright.config.ts、.gitattributes、.gitignore |
| 启停及空配置模板 | 启动测试工作台.cmd、停止测试工作台.cmd、.env.example、.env.regression.example |

用例和脚本按稳定ID保存，模块按功能组织。保留全部定义和已有步骤；缺步骤不删除用例，也不标成已实现。不要在源码中累积旧导出、旧构建、历史批次计划或重复启动副本。

## 本机内容

不提交node_modules、dist、web/dist、runtime-data、artifacts、.local、真实.env、浏览器登录目录、数据库文件、数据库备份、日志、运行报告、执行截图和临时调查材料。tests中的合成夹具与SQL建表样例属于源码资源，不是实际业务库备份。

.gitignore阻止新增本机文件，但不能移除已追踪的文件。提交前检查完整暂存清单；不要依赖“文件夹看起来干净”判断发布内容。

## 源码仓库与可用发行包

源码仓库保存程序和业务定义。当前定义快照含253条用例、253份对应脚本、6个模块和4条核心链路；136条有步骤，117条尚缺步骤。网页有效版本是执行准源，文件更新通过资源预览/应用同步。

完整Windows包自带编译程序、全部业务资源、Node.js及依赖。首次打开项目、用例和脚本可见，报告为空，用例显示未执行，账号由使用者连接。使用npm run package:windows装配；运行记录、凭据和截图不入包，详见packaging/windows/README.md。

升级只更新程序和受控资源版本，不覆盖使用者的运行记录、截图、配置和登录态。仅上传源码不代表以上首次安装和升级流程已实现。

## 仓库目标

本次仅提交到个人GitHub的wenki2005/testpilot仓库，在整理分支交付，由PR检查后合入。公司Codeup不属于本次推送目标。
