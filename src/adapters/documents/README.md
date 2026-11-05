<!-- generated-code-index -->
# src/adapters/documents

网页测试。文件清单由 `npm run code:index` 生成。功能总入口见仓库根目录“代码导航.md”。

## 子目录

- [cases](cases/)
- [evidence](evidence/)
- [execution](execution/)
- [resources](resources/)

## 文件职责

| 文件 | 用途 | 主要入口 |
| --- | --- | --- |
| [cases/authoring-context.ts](cases/authoring-context.ts) | authoring context | `Binding`、`createDocumentAuthoringContextReader` |
| [cases/case-code-source.ts](cases/case-code-source.ts) | case code source | `createDocumentCaseCodeSource` |
| [cases/case-entry.ts](cases/case-entry.ts) | case entry |  |
| [cases/case-quality.ts](cases/case-quality.ts) | case quality |  |
| [cases/case-routing.ts](cases/case-routing.ts) | case routing |  |
| [cases/case-scope.ts](cases/case-scope.ts) | case scope |  |
| [cases/generation-batches.ts](cases/generation-batches.ts) | generation batches | `DocumentGenerationBatch`、`planDocumentGenerationBatches` |
| [cases/impact-analysis.ts](cases/impact-analysis.ts) | impact analysis | `ImpactCase`、`DocumentImpactScan`、`noteTerms` |
| [cases/source-roles.ts](cases/source-roles.ts) | source roles | `DocumentInputRole`、`ResolvedDocumentInputRole`、`DocumentInput` |
| [evidence/agent-database.ts](evidence/agent-database.ts) | agent database | `bindDepartmentDatabaseFixture`、`missingDepartmentDatabaseFixtureAssertion`、`isDepartmentDatabaseTarget` |
| [evidence/page-evidence.ts](evidence/page-evidence.ts) | page evidence | `CurrentPageEvidence`、`captureCurrentPageEvidence`、`DocumentPageEvidenceProject` |
| [evidence/sensitive-data.ts](evidence/sensitive-data.ts) | sensitive data | `normalizedWords`、`isSensitiveExportField`、`containsCredentialLikeValue` |
| [execution/baseline-comparison.ts](execution/baseline-comparison.ts) | baseline comparison |  |
| [execution/browser-lane.ts](execution/browser-lane.ts) | browser lane | `DocumentBrowserLaneHelpers`、`createDocumentBrowserLaneAdapter` |
| [execution/legacy-type-exports.ts](execution/legacy-type-exports.ts) | legacy type exports |  |
| [execution/result-classification.ts](execution/result-classification.ts) | result classification |  |
| [execution/run-executor.ts](execution/run-executor.ts) | run executor | `unsupportedWeChatClientGateMessage`、`documentRunNotifications`、`projectRepository` |
| [execution/run-parameters.ts](execution/run-parameters.ts) | run parameters | `collectDocumentParameterNames`、`resolveDocumentRunParameters`、`resolveBrowserStepParameters` |
| [execution/workflow-facade.ts](execution/workflow-facade.ts) | workflow facade |  |
| [execution/workflow-record.ts](execution/workflow-record.ts) | workflow record | `DOCUMENT_WORKFLOW_SCHEMA_VERSION`、`DOCUMENT_WORKFLOW_STORE_DIRECTORY`、`DocumentWorkflowApprovalPolicy` |
| [resources/importer.ts](resources/importer.ts) | importer | `extractDocument`、`extractCaseCsv`、`decodeText` |
| [resources/package-builder.ts](resources/package-builder.ts) | package builder | `buildDocumentPackageInput` |
| [resources/package-refresh.ts](resources/package-refresh.ts) | package refresh | `PackageProject`、`PackageRun`、`ArtifactSource` |
