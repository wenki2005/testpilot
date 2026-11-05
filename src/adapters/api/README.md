<!-- generated-code-index -->
# src/adapters/api

公共基础。文件清单由 `npm run code:index` 生成。功能总入口见仓库根目录“代码导航.md”。

## 文件职责

| 文件 | 用途 | 主要入口 |
| --- | --- | --- |
| [document-lane.ts](document-lane.ts) | document lane | `ReviewedApiCandidate`、`DocumentApiCase`、`executeDocumentApiLane` |
| [document-run-api-adapter.ts](document-run-api-adapter.ts) | document run api adapter | `dispatchDocumentRunApiLane` |
| [expectation-review.ts](expectation-review.ts) | expectation review | `conflictingReadOnlyExpectations` |
| [finding-tracker.ts](finding-tracker.ts) | finding tracker | `ApiFinding`、`ApiFindingStore`、`ApiFindingUpdate` |
| [openapi-summary.ts](openapi-summary.ts) | openapi summary | `OpenApiSummary`、`openApiOperationFacts`、`hasBoundaryConstraint` |
| [suite-authoring.ts](suite-authoring.ts) | suite authoring | `generateApiSuite`、`validateOpenApiTrace`、`prefixApiPaths` |
| [suite-workflow.ts](suite-workflow.ts) | suite workflow | `ApiSuiteCandidate`、`createApiSuiteCandidate`、`updateApiSuiteCandidate` |
| [test-adapter.ts](test-adapter.ts) | test adapter | `runApiSuite`、`executeConfiguredCase`、`combinePrincipalResults` |
