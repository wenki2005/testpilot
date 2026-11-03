# 失败/阻塞字段核对与脚本修正

用户要求检查失败/阻塞原因，修复测试脚本，并结合被测前端及数据库查找对应字段和数据。

## 本次变更

- `dify-connected-scenarios.ts` 的身份基线支持被测 store 使用的顶层 `deptName`，保留用户字段优先及旧结构兼容。公司及首次企微授权尚未完整验证，不因字段读取成功而直接算整条通过。
- `mysql-readonly-browser.ts`、`regression-database.ts`、`dify-record-scenarios.ts` 将个人列表核验上限统一为20，取消静默截取前10条；超限/重复/缺记录不放行。
- 增加 `readDepartmentBlockerInventory(userId)`：只接受本轮认证身份，通过固定、有时限的只读查询返回本人/其他账号状态、多行明细及下游关联的计数。不返回账号、申请号、审批号、订单号、配置值或个人资料。
- `dify-blocker-diagnostics.ts` 依据原始来源及预期追加解释，`dify-web-modules.ts` 仅为阻塞行添加本轮排查信息，不改变结果、原始预期或历史批次。
- 新增3项诊断/分页工具测试及1项顶层部门浏览器合成测试。

数据库补查属于取证，成功查询不代表业务用例通过。审批模板存在不代表配置值正确；订单候选字段匹配0不直接认定丢单。实时商品与失败降级仍需正确上游调用证据，禁止用整个详情接口失败冒充商品失败。

## 实际验证

- `node node_modules/typescript/bin/tsc -p tsconfig.json` 通过。
- `node --test tests/dify-blocker-diagnostics.test.mjs tests/regression-database.test.mjs tests/dify-owner-login-scenarios.test.mjs tests/dify-record-scenarios.test.mjs tests/dify-connected-scenarios.test.mjs`：16项通过。
- `node node_modules/typescript/bin/tsc --noEmit -p web/tsconfig.json`：6项已有未使用声明检查失败，涉及api-test-adapter、document-test-workflow、markdown-reporter未改动位置，本次未修复这些无关声明。
- 服务4321经活动任务为0及进程身份检查后重启，恢复原只读数据库连接；其他服务不变。
- 定向批次 `2cf6a474-ed19-45f7-874a-74d4698526d7`：10条，1失败、9阻塞、0异常，9条阻塞均包含本轮数据库说明。
- 全量基线 `d0fa9974-5374-4766-b981-64555b65b50c` 为28通过、15失败、86阻塞、2范围外。叠加本次10条复跑后统计不变；这是跨批次最新逐项结果，不是又跑了一轮131条。
- 原131条、版本、标题和预期逐项核对未变，43张通过/失败证据PNG可读取。

## 查到的数据事实

- 61条有效申请、80条明细；申请人、部门、审批号/模板、收件人/手机字段有值。
- 当前账号1条待审批营销申请，无订单引用、无多行申请；全库多行申请13条，不能借用他人记录作为本人页面正向样本。
- 61条申请均命中有效OA模板；仓库和关联表存在，但目标模板、长沙/天津仓及两个旺店通店铺仍缺独立期望配置。
- 24条订单引用在biz_order订单号/外部订单号/主键候选及物流关联上均未命中；相关失败日志、发送队列未找到申请关联记录。
- 第73条前端将申请人绑定申请类型字典，数据库姓名存在；数量最大值999及字段标红/原文差异也与实际失败观察相符。

完整逐项交付见工作区 `outputs/失败阻塞定位-20261103.md` 和同名JSON。未修改被测业务、未写业务数据库、未改变用例预期。没有提交或推送。
