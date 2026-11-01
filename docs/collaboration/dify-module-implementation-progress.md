# Dify 模块流程实施台账

更新时间：2026-10-30T07:45:15.083Z

## 基线与范围

源码：D:\TestPilot-Demo-0.2.0-Windows\TestPilot-Demo-0.2.0-Windows

分支：codex/dify-module-orchestration；原有未提交改动全部保留，未提交/推送/合并。

运行：127.0.0.1:4319，最终 dist/demo/server.js，读取本机 .env。数据：artifacts/demo；新模块记录：dify-web-modules/records.sqlite；复用 document-tests 网页运行和项目会话。

## 阶段进度

- [x] 0：阅读实施计划/AGENTS，保护基线，建立分支和台账。
- [x] 1：定位真实 Dify missing identity，兼容旧固定派发协议并保存失败运行编号；Python/YAML guard 同步。
- [x] 2：模块版本、原始用例、任务/计划快照、幂等、指纹、结果持久化。
- [x] 3：真实 prepare（用例内容 + 模型）/ dispatch / report，动态分批，云端 ID 同轮关联。
- [x] 4：项目会话与登录接力、基于证据准备步骤、原始预期不变、必要前置数据确认；SPA hash 保留；修复 redirect 登录漏判。
- [x] 5：复用网页执行器；逐条结果和截图落盘；取消、中断、恢复汇总不重复执行。
- [x] 6：统一简洁主页面，旧流程与 API 记录在高级入口；宽屏/390px 视口验证。
- [x] 7：模块选择、历史、报告、截图、失败筛选和定向重测；范围外不算通过。
- [x] 8：57 行为测试 + 4 浏览器测试，类型/构建通过；真实 Dify + 5 条受控用例完整联调及单项重测通过。
- [x] 9：操作说明、协议、启动脚本、真实界面、截图和交付报告。

## 验收证据

- 主受控任务 f8561d26-85d7-4fb8-87df-11352a1aafcc，网页运行 286e1471-702c-49fd-a5a5-5be902b31abb；4 通过 + 1 已知失败正确检出；全部截图端点 HTTP 200。
- prepare 509c4ca0-13eb-4769-87ed-f918482d3cc2；dispatch f8a4c30f-3ca4-4fdb-bad1-fd25c465f0b8；report 9355e23c-30a7-4011-a11d-de8e7241aaaa。
- 空 steps 用例 sample-no-script 自动准备后通过；原始快照仍为空步骤。
- 失败重测 0e49be52-31ac-43f6-8fbd-605e4f75a4ba，仅 1 条，保留失败且关联父任务。
- UI 上传/开始验证任务 7fe3dba9-03d4-4f03-9f8c-79b19b34f20a。
- 自动化日志 .local/dify-module-full-test-final.log；云端联调 .local/dify-module-real-e2e-final.log。
- 主界面截图：C:/Users/Administrator/Documents/Codex/2026-10-27/https-github-com-wenki2005-testpilot-https/outputs/Dify模块测试-最终界面.png。

## 唯一待用户参与的验收

真实申样系统任务 31e738d2-e8c8-40dd-95ef-8417fbe32c4d 当前 awaiting-login，业务用例 not_executed。需要有效企业微信登录会话/可供项目测试窗口使用的登录方式。已发出异步询问，不能假定用户已登录。其他开发、测试、受控联调和交付工作已完成；真实申样业务验收尚未完成，不把样例通过混入。

登录后在该任务点“我已登录”；若等待已超时，点“重试当前阶段”。后续只继续这个真实目标验收，勿重做已完成开发或反复重跑受控样例。
