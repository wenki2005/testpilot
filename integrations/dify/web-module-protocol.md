# 网页模块三阶段协议

这是本机协调的分阶段工作流，不是云端直接请求 localhost，也不宣称一个 Dify run 跨越全部阶段。

## 应用与输入

- prepare 使用 regression-drafts.yml 发布应用和 TESTPILOT_DIFY_API_KEY。source_json 包含原始预期、用例来源、已有步骤、前置条件及最小页面能力信息。模型提出步骤和待确认项；代码 guard 复制不可变来源并固定为未执行草稿。
- dispatch / report 使用 module-execution.yml 发布应用和 TESTPILOT_DIFY_EXECUTION_API_KEY。execution_json 保持已发布的 schema=1 协议，每批最多 20 条。真实网页包可达 200 条，由本机分批，不截断尾部。
- prepare 按内容大小和每批最多 6 条动态分批，每次输入小于 59000 字符；单条过长时明确报错。

## 同轮关联

本地 job ID 对应 execution_json.run_id；module_id 固定模块版本；plan_digest 绑定完整执行计划；suite_digest 在网页任务中绑定原始模块包指纹。记录分别保存每次 Dify workflow_run_id、阶段、批次、输入指纹、用例 ID 和成功/失败状态。

prepare 必须返回一一对应的原始 case_id、source_path、source_expected_verbatim、source_sha256，以及 draft/not_executed/null 状态。不得替换原始预期。派发和汇总再次核对身份、范围、顺序和指纹；浏览器始终执行本机验证后的固定步骤。report 只接收实际状态，本机对照计数，模型不能更改断言结果。

目标 URL、Cookie、密码、令牌、实时字段值和截图不发送给 Dify。页面能力只包含控件类型和原包已引用的控件名称；内容经过凭据脱敏。原始用例和实际截图留在本机。

旧云端版本不支持 web-package-check 时，仅对明确的 missing identity / unsupported phase 错误使用已有 dispatch 协议兼容检查，并标明 dispatch-compatible。新网页任务直接执行真实 prepare / dispatch / report，不依赖这项旧入口检查。

## 故障与恢复

- 已开始执行的任务不会自动重放；完整结果已落盘时可以仅恢复 Dify 汇总。
- 服务重启将未终结任务标为 interrupted；不偷偷续跑浏览器。
- requestId 幂等；同一编号不同范围会拒绝。
- 重测创建新的 job 和 document run，保留 parentJobId。失败项不能通过重试汇总变成通过。
- 人工登录使用现有项目会话和登录接力。只检测到目标页面不等于验证了身份或角色权限。

行为测试见 tests/dify-web-modules.test.mjs 和 tests/dify-auth-route.test.mjs；真实云端联调见 scripts/verify-dify-web-module.mjs。
