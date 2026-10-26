# API / 后台 / 集成通道审计（部门申样书 156 条矩阵）

审计对象：`department-sample-apply-v1.0-full-suite.json`（caseCount=156）。本文件只补充 API 通道能力映射；没有读取/改写权威 JSON，也未调用目标系统。矩阵的测试前提反复声明需要专用测试环境、测试账号、接口 mock/沙箱数据，且工作区没有目标业务应用源码、凭证或接口契约（参见 `department-sample-book-v1.0.md`）。因此以下“可承接”表示 runner 具备表达/断言能力，不表示用例已准备好可执行。

## 通用 runner 能力

- `src/storage/api-suite-loader.ts`：suite v1 静态校验；HTTP 方法、相对路径、headers/body/status/JSON/header/时长断言、principal/role matrix、最多 10 步 setup/cleanup。写请求强制 `${RUN_ID}` 隔离且 cleanup 必须命中 RUN_ID；credential header 必须用 `${ENV:NAME}`。
- `src/adapters/api-test-adapter.ts`：受限 HTTP runner，按 suite base URL 限定 origin/prefix，支持 response/status/header/JSON 子集断言、超时、并发显式许可、写操作显式许可，证据脱敏与报告/ZIP；失败/阻断有逐例结果。它不是业务 UI/数据库浏览器，也不负责创建任意后台状态。
- `src/adapters/api-suite-authoring.ts` + `src/adapters/openapi-summary.ts`：可从用户提供的 OpenAPI 与需求生成保守候选；引用操作、声明状态、基础边界覆盖对照；不会提供业务契约，也不会替用户猜接口。
- `src/adapters/api-suite-workflow.ts` / `src/mcp/server.ts`：suite 草稿、审核、批准后执行、结果读取/导出；MCP 是本机服务 API 的工作流控制面，不能据此推断目标业务服务端点。网络、变更、并发有明确运行门控。
- 现有验证夹具：`tests/api-test-adapter.test.mjs`、`tests/api-suite-authoring.test.mjs`、`tests/api-mcp.integration.test.mjs`，以及 `artifacts/api-adapter-fixture/` 下的本地 mock 运行产物。它们验证框架，不是申样业务数据/接口契约。

## 矩阵分组 → 承接能力 → 缺失输入

| 矩阵用例组（case ID） | API runner 可承接范围 | 执行所缺契约 / 环境 / 夹具 |
|---|---|---|
| 易诚通客户分类、过滤、搜索、实时数据（xmind-17–24） | GET 成功/错误、响应字段断言；有确定字段和数据后可验证分类包含/排除。UI 展示和输入不调用接口本身仍属 UI。 | 客户查询 endpoint/method/参数、分类字段名与编码、分页/排序/实时性定义、错误响应/降级约定；隔离客户记录各分类的稳定 ID；目标系统测试 base URL、认证授权角色。xmind-20、23 当前待澄清，不能臆造验收结果。 |
| 图书编码查询与重量/库存规则（xmind-25–34、134） | GET 查询断言；若服务端实际提交接口契约覆盖 `weight`、数量规则，可做响应校验或负向请求。非数字输入“不调用接口”需浏览器网络观察/客户端测试。 | 图书查询和申请提交的真实契约、字段和错误码；已知存在/不存在/无重量/边界重量/库存图书 fixture；需明确库存查询来源及副作用隔离。xmind-134 的 body、响应状态/错误体均未由矩阵给出。 |
| 申请提交、审批单创建与事务/补偿（xmind-6–15、35–52、144–148） | 有 schema 和沙箱后可发 POST、断言状态/响应 JSON；RUN_ID 隔离 setup/cleanup；角色 token；可用并发参数表达压力/竞争请求。runner 不验证跨系统事务内部状态，除非有可读取的观测 API。 | submit/createApproval/callback/补偿的 endpoint、请求/响应 schema、幂等键、错误语义、回调签名/重放规则、事务最终状态查询；企微审批沙箱及隔离用户/申请/商品/库存；故障注入（createApproval 成功后数据库失败）、并发控制和清理策略。xmind-146/147 属跨服务事务/竞态，单纯 HTTP response 断言不足，需要观测/管理端查询或服务端集成测试 harness。 |
| PC 管理后台查询、订单历史、权限/状态（xmind-90–115、151、154–156） | 若后台实际暴露稳定 HTTP API，可按已知契约做 GET 查询、角色矩阵和字段断言；跨账号资源授权可用不同 principal 对同一记录分别断言 2xx/401/403。UI 过滤、分页展示、下载不由 API runner覆盖。 | 管理端 API 合约、角色与字段级权限矩阵、A/B 测试用户 token、A 的申请记录/状态 fixture、归属规则、分页/搜索/排序/状态字典；含退单、发货中、撤回状态的记录。xmind-151 要求确认无权时确切拒绝码/不泄露响应体；xmind-156 待澄清。 |
| 审批回调、WMS/旺店通、易诚通出库、物流查询/状态流转（xmind-116–133、147–148） | 只适合在每个系统有独立 QA/mock 合约时分别断言单次请求/响应；只读物流查询可运行。写出库可经隔离 setup/cleanup。 | 各系统 endpoint/schema/auth、字段映射与状态转换表、沙箱账号、可预测回调、模拟成功/拒绝/超时/重复回调、订单/物流夹具；确认跨系统 trace/correlation ID 以及状态最终一致的查询途径。超72小时场景需要可控时钟/时间注入或预置老化记录；单纯 runner 没有等待/时钟推进能力。 |
| 直连 API 服务端防线（xmind-139–145） | POST 负向输入、请求体 JSON 边界、显式预期 status/响应 JSON；每个变更场景需隔离 RUN_ID、cleanup。最适合成为 API suite，但应有契约验证请求字段确实属于目标 submit 操作。 | 真实 submit path/method/header、完整合法基线 payload、必填字段、字段名/类型、数量/手机号/备注/地址约束与错误状态/错误体；服务端专用 QA 环境；安全的无副作用拒绝行为/清理证明。矩阵里写出的业务规则是期望，不足以推导协议 schema 或 HTTP 状态。 |
| 后端计算映射：用途→备注/店铺/出库类别、审批流与客户绑定（xmind-6–15、17–19、40–52） | 若有“提交后查询详情/出库记录”的只读 API，能比较输出字段；对集成请求可用 stub/mock 接收端记录事件。 | 规则源/版本、后端记录查询 API、跨系统映射表、唯一关联 ID；stub 或沙箱收件端；并确认目标环境开关不会触发真实下游出库。若只能观察 H5 文案或下拉列表，仍是 UI 用例。 |

ID 分组按矩阵 `source` 主题归纳；最终细分应沿用原始 case ID 和原始预期，不能把业务验收文字改写成未确认的 endpoint/status。

## 推荐 suite 模板（结构示意，字段值待真实契约填写）

下面是可供团队复制的形状，不是可运行样例；占位 endpoint、字段和状态均刻意留空。先根据真实 OpenAPI/接口文档填充，再静态解析。不要把此片段提交为执行候选。

```json
{
  "version": 1,
  "name": "department-sample-api-contract-pending",
  "description": "待补：测试环境、契约版本、下游 mock 与数据清理约定。",
  "baseUrl": "",
  "principals": {
    "applicant_a": { "headers": { "Authorization": "Bearer ${ENV:DEPT_SAMPLE_A_TOKEN}" } },
    "applicant_b": { "headers": { "Authorization": "Bearer ${ENV:DEPT_SAMPLE_B_TOKEN}" } }
  },
  "fixtures": {
    "setup": [],
    "cleanup": []
  },
  "cases": [
    {
      "id": "xmind-139-qty-upper-bound",
      "title": "按已确认的服务端契约拒绝超上限数量",
      "source": "部门申样书_V1.0_测试用例.xmind › 白盒扫描补充验证",
      "requirementRefs": ["xmind-139"],
      "priority": "P1",
      "request": {
        "method": "POST",
        "path": "",
        "headers": { "Authorization": "Bearer ${ENV:DEPT_SAMPLE_A_TOKEN}" },
        "body": {},
        "timeoutMs": 10000
      },
      "expect": { "status": 0, "json": {} }
    },
    {
      "id": "xmind-151-cross-owner-access",
      "title": "员工 B 读取员工 A 资源时按契约拒绝",
      "source": "部门申样书_V1.0_测试用例.xmind › 白盒扫描补充验证",
      "requirementRefs": ["xmind-151"],
      "priority": "P0",
      "request": { "method": "GET", "path": "", "timeoutMs": 10000 },
      "expect": { "status": 0 },
      "accessControl": {
        "principals": ["applicant_a", "applicant_b"],
        "expectByPrincipal": { "applicant_a": { "status": 0 }, "applicant_b": { "status": 0 } }
      }
    }
  ]
}
```

### 获取/确认 fixture 清单

1. 目标系统负责人提供专用 QA base URL、部署/版本标识、网络允许范围；确认无生产路由及无真实企业微信/ERP/WMS副作用。
2. 获取 OpenAPI 3.x（或签字确认的等价接口文档）、鉴权方案、字段/状态/错误码、幂等和分页约定；列明未公开的接口及文档版本。不要从页面流量自行猜接口。
3. 发放最小权限测试账号 A/B（以及有权限管理角色，如确有需要），以环境变量注入 token；给出 token 轮换/失效方法，不把凭据写入 JSON。
4. 预置可清理的实体：可分类客户（合作/部门费用/排除分类）、图书（存在/不存在/无重量/有重量/库存边界）、申请 A/B 归属、审批各终态、下游出库与物流状态。提供创建、查询和删除接口或每次运行自动化 reset 机制。
5. 提供下游 mock/sandbox：企微审批创建与回调、易诚通客户/图书/库存/出库、旺店通出库、易查单物流；至少能确定性切换成功、业务拒绝、超时、重复消息、部分失败。写清 correlation ID 与最终一致等待 SLA。
6. 为 xmind-146/147 准备故障注入和竞争测试夹具（审批已创建但后续持久化故障、回调与补偿任务同时触发）；能查询审批单/申请/库存锁的最终数量和状态，并提供回滚。
7. 约定 suite 级隔离键 `${RUN_ID}` 如何映射到业务字段/资源键，cleanup 即使请求中断也可安全重试；验证清理未触及运行外数据。没有可复现的隔离/cleanup 时不要运行写 case。
8. 将每个矩阵 ID 对应到 requirementRef、业务契约 operation、数据 fixture 和证据读取 API；所有“待澄清”先由需求方定标准。

## 静态校验边界

`parseApiSuite()` 是运行时代码中的 schema/语义校验器；静态调用它只解析对象，不发送 HTTP。当前模板保留空 path/status 和 `baseUrl`，因此应被 loader 拒绝，作为待填模板更安全；填完真实值后可调用本地 `parseApiSuite` 做离线校验。不要调用 `runApiSuite`、MCP run、批准/候选创建流程或任何目标服务。OpenAPI 操作覆盖检查也只能基于已提供的契约文件运行。
