<!-- generated-code-index -->
# src/adapters/regression

申样回归执行。文件清单由 `npm run code:index` 生成。功能总入口见仓库根目录“代码导航.md”。

## 子目录

- [authoring](authoring/)
- [browser](browser/)
- [catalog](catalog/)
- [chains](chains/)
- [config](config/)
- [evidence](evidence/)
- [execution](execution/)
- [exports](exports/)
- [notifications](notifications/)
- [resources](resources/)
- [scenarios](scenarios/)

## 文件职责

| 文件 | 用途 | 主要入口 |
| --- | --- | --- |
| [authoring/case-baseline-store.ts](authoring/case-baseline-store.ts) | 原始用例基线、辅助整理版本、审核与历史 | `Task`、`Review`、`Result` |
| [authoring/case-quality.ts](authoring/case-quality.ts) | case quality | `difyCoverageGap` |
| [authoring/case-readiness.ts](authoring/case-readiness.ts) | case readiness | `DifyReviewKind`、`DifyBlockerCode`、`difyBlocker` |
| [authoring/markdown-case-pack.ts](authoring/markdown-case-pack.ts) | markdown case pack | `parseDifyMarkdown`、`formatDifyMarkdown` |
| [browser/module-browser.ts](browser/module-browser.ts) | 模块执行与浏览器、数据库、授权写入的装配 | `evidenceLoginPage`、`captureMissingDifyFailureEvidence`、`captureDifyBlockedEvidence` |
| [catalog/module-regression-service.ts](catalog/module-regression-service.ts) | 系统、模块、用例编辑、前置校验和批次调度 | `SystemModuleRegression`、`SystemModuleRegression.list`、`SystemModuleRegression.save` |
| [chains/core-chain-browser.ts](chains/core-chain-browser.ts) | 审批、库存、锁单、订单、物流链路浏览器核验 | `Row`、`Fixture`、`CorePatch` |
| [chains/core-chain-store.ts](chains/core-chain-store.ts) | 核心链路任务调度、恢复、结果与截图存储 | `DepartmentCoreChainStore`、`DepartmentCoreChainStore.list`、`DepartmentCoreChainStore.save` |
| [config/approval-templates.ts](config/approval-templates.ts) | 企微/OA 审批模板、仓库及下游配置基线核验 | `departmentOaTemplateBaseline`、`OaTemplateConfigurationSnapshot`、`verifyDepartmentOaTemplateConfiguration` |
| [config/test-fixtures.ts](config/test-fixtures.ts) | test fixtures | `DifyCustomerFixture`、`validateDifyCustomerFixtures`、`loadDifyCustomerFixtures` |
| [evidence/approval-order-readback.ts](evidence/approval-order-readback.ts) | 审批、锁单和订单同单证据核验 | `Row`、`verifyApprovedChainEvidence` |
| [evidence/blocker-diagnostics.ts](evidence/blocker-diagnostics.ts) | blocker diagnostics | `departmentBlockerDiagnostic` |
| [evidence/business-readback.ts](evidence/business-readback.ts) | 业务链路证据归类、关联及核验 | `DepartmentBusinessFact`、`observeDepartmentBusinessEvidence`、`finish` |
| [evidence/connected-evidence-contract.ts](evidence/connected-evidence-contract.ts) | connected evidence contract |  |
| [evidence/evidence-paths.ts](evidence/evidence-paths.ts) | evidence paths | `difyModuleEvidencePath` |
| [evidence/integration-assertions.ts](evidence/integration-assertions.ts) | integration assertions | `Row`、`assertExpenseApplication`、`assertApprovalProgress` |
| [evidence/module-evidence.ts](evidence/module-evidence.ts) | module evidence | `captureDifyPng`、`maskDifyProfileEvidence` |
| [execution/execution-manifest-store.ts](execution/execution-manifest-store.ts) | 固定执行清单与派发、汇总协议 | `ModulePlan`、`State`、`Outcome` |
| [execution/module-execution-service.ts](execution/module-execution-service.ts) | 模块版本、执行任务、步骤准备和结果汇总 | `moduleDigest`、`Outcome`、`WebModule` |
| [exports/export-policy.ts](exports/export-policy.ts) | 导出材料中的凭据与敏感字段检查 | `assertDifyExportSafe` |
| [exports/script-package.ts](exports/script-package.ts) | 逐模块脚本包组装 | `ScriptPackageContext`、`DifyScriptModuleInput`、`difyPortableRunner` |
| [notifications/batch-notifier.ts](notifications/batch-notifier.ts) | 批次通知、通知重试和失败信息 | `Payload`、`Transport`、`difyNotificationWebhook` |
| [resources/project-resource-contract.ts](resources/project-resource-contract.ts) | 资源定义、差异与前置引用校验 | `projectResourceSchema`、`ProjectResources`、`ResourceCase` |
| [resources/resource-directory.ts](resources/resource-directory.ts) | 逐条资源文件读入、摘要和目录边界校验 | `readResourceDirectory` |
| [scenarios/application/client-validation.ts](scenarios/application/client-validation.ts) | 前端拦截、按钮与字段校验 | `ClientValidationKind`、`Result`、`clientValidationKind` |
| [scenarios/application/excluded-customers.ts](scenarios/application/excluded-customers.ts) | excluded customers | `isExcludedCustomer`、`reviewExcludedCustomer`、`verifyExcludedCustomer` |
| [scenarios/application/field-validation.ts](scenarios/application/field-validation.ts) | 表单字段有效性校验 | `FieldValidityKind`、`fieldValidityKind`、`reviewFieldValidity` |
| [scenarios/application/form-baseline.ts](scenarios/application/form-baseline.ts) | 申样表单初始状态与配置基线 | `waitForDepartmentFormBaseline` |
| [scenarios/application/sample-book-rows.ts](scenarios/application/sample-book-rows.ts) | 多行图书、数量、金额和删除行场景 | `isSampleRowDelete`、`verifySampleRowDelete` |
| [scenarios/application/submission-receipts.ts](scenarios/application/submission-receipts.ts) | 提交、撤销等操作凭证与重复执行保护 | `readDepartmentCreationReceipts`、`DepartmentCreationBaseline`、`readDepartmentCreationBaselines` |
| [scenarios/application/submit-application.ts](scenarios/application/submit-application.ts) | 真实提交申样申请、唯一标记及提交后核验 | `Row`、`DepartmentWriteResult`、`AuthorizationBase` |
| [scenarios/books/book-search.ts](scenarios/books/book-search.ts) | 图书编码、商品查询与图书字段 | `DifyBookFixture`、`DifyBookKind`、`difyBookKind` |
| [scenarios/books/invalid-books.ts](scenarios/books/invalid-books.ts) | 无效图书和查询异常场景 | `InvalidBookKind`、`Result`、`invalidBookKind` |
| [scenarios/clients/device-layout.ts](scenarios/clients/device-layout.ts) | device layout | `DifyDeviceKind`、`difyDeviceKind`、`reviewDifyDevice` |
| [scenarios/connected-systems.ts](scenarios/connected-systems.ts) | 上游调用、通知与下游系统关联核验 | `Row`、`Result`、`reviewConnectedEvidence` |
| [scenarios/identity/applicant-identity.ts](scenarios/identity/applicant-identity.ts) | 申请人身份与账号范围 | `Result`、`isApplicantIdentity`、`reviewApplicantIdentity` |
| [scenarios/orders/admin-order-records.ts](scenarios/orders/admin-order-records.ts) | 管理订单数据读回及关联 | `Row`、`Result`、`AdminRecordKind` |
| [scenarios/orders/my-orders.ts](scenarios/orders/my-orders.ts) | 本人订单查询和归属核验 | `Row`、`Result`、`OwnedOrderKind` |
| [scenarios/orders/order-creation-readback.ts](scenarios/orders/order-creation-readback.ts) | 下单结果与申请、订单引用关联核验 | `Row`、`departmentMinute`、`assertCreationTimes` |
| [scenarios/orders/order-detail-presentation.ts](scenarios/orders/order-detail-presentation.ts) | 订单详情字段、状态、物流展示核验，关联原85号用例 | `Row`、`Order85Presentation`、`inspectOrder85Presentation` |
| [scenarios/orders/welfare-orders.ts](scenarios/orders/welfare-orders.ts) | 福利用途订单场景 | `Row`、`Response`、`Result` |
| [scenarios/records/application-detail.ts](scenarios/records/application-detail.ts) | 申请明细及审批详情场景 | `Row`、`Result`、`DifyRecordKind` |
| [scenarios/records/application-list.ts](scenarios/records/application-list.ts) | 申请记录列表和筛选 | `DifyListKind`、`difyListKind`、`reviewDifyList` |
| [scenarios/scenario-planner.ts](scenarios/scenario-planner.ts) | 只读业务场景的步骤规划与独立性判定 | `DepartmentReadOnlyKind`、`noMatchProbe`、`departmentReadOnlyKind` |
