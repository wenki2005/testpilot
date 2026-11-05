<!-- generated-code-index -->
# src/application

应用流程。文件清单由 `npm run code:index` 生成。功能总入口见仓库根目录“代码导航.md”。

## 子目录

- [artifacts](artifacts/)
- [cases](cases/)
- [ports](ports/)
- [projects](projects/)
- [runs](runs/)

## 文件职责

| 文件 | 用途 | 主要入口 |
| --- | --- | --- |
| [artifacts/document-run-finalization-service.ts](artifacts/document-run-finalization-service.ts) | document run finalization service | `DocumentRunFinalizationDependencies`、`createDocumentRunFinalizationService`、`finalize` |
| [artifacts/document-run-packaging-service.ts](artifacts/document-run-packaging-service.ts) | document run packaging service | `DocumentRunPackagingDependencies`、`createDocumentRunPackagingService`、`retry` |
| [artifacts/document-run-result-summary-service.ts](artifacts/document-run-result-summary-service.ts) | document run result summary service | `DocumentRunResultSummaryPorts`、`createDocumentRunResultSummaryService`、`summarize` |
| [artifacts/document-run-summary-service.ts](artifacts/document-run-summary-service.ts) | document run summary service | `generateAlignedDocumentRunSummary` |
| [cases/document-autonomous-plan-service.ts](cases/document-autonomous-plan-service.ts) | document autonomous plan service | `SavedAutonomousPlan`、`AutonomousPlanRepository`、`AutonomousPlanServiceError` |
| [cases/document-autonomous-regression-planner.ts](cases/document-autonomous-regression-planner.ts) | document autonomous regression planner | `RegressionEvidence`、`AutonomousRegressionAssessment`、`AutonomousRegressionEvaluatorPort` |
| [cases/document-case-markdown-service.ts](cases/document-case-markdown-service.ts) | document case markdown service | `canonicalCaseDigest`、`MarkdownImportError`、`MarkdownCaseImportPort` |
| [cases/document-case-selection-service.ts](cases/document-case-selection-service.ts) | document case selection service | `DocumentCaseSelectionErrorCode`、`DocumentCaseSelectionError`、`DocumentCaseSelectionResult` |
| [cases/document-case-step-authoring-service.ts](cases/document-case-step-authoring-service.ts) | document case step authoring service | `BrowserStepGenerationSummary`、`ExplorationDecisionInput`、`PageExplorationSession` |
| [cases/document-impact-review-service.ts](cases/document-impact-review-service.ts) | document impact review service | `DocumentImpactReviewErrorCode`、`DocumentImpactReviewError`、`DocumentImpactReviewResult` |
| [ports/chat-model.ts](ports/chat-model.ts) | chat model | `ChatMessage`、`ChatModelOptions`、`ChatModelPort` |
| [ports/document-case-navigation.ts](ports/document-case-navigation.ts) | document case navigation | `CaseNavigationCheck`、`CaseNavigationPage`、`CaseNavigationSelection` |
| [ports/document-exploration-decision.ts](ports/document-exploration-decision.ts) | document exploration decision | `ExplorationPageSnapshot`、`DocumentExplorationDecisionInput`、`DocumentExplorationDecision` |
| [ports/document-page-exploration.ts](ports/document-page-exploration.ts) | document page exploration | `DocumentPageExplorationSession`、`DocumentPageExplorationSessionPort` |
| [ports/document-project-repository.ts](ports/document-project-repository.ts) | document project repository | `DocumentProjectRepository` |
| [ports/document-run-repository.ts](ports/document-run-repository.ts) | document run repository | `DocumentRunRepository` |
| [projects/document-project-preparation-service.ts](projects/document-project-preparation-service.ts) | document project preparation service | `DocumentPreparationStage`、`DocumentPreparationTask`、`InputRole` |
| [projects/document-project-review-service.ts](projects/document-project-review-service.ts) | document project review service | `DocumentProjectReviewError`、`createDocumentProjectReviewService`、`approve` |
| [projects/document-project-session-service.ts](projects/document-project-session-service.ts) | document project session service | `DocumentProjectSessionErrorCode`、`DocumentProjectSessionError`、`DocumentProjectSessionDependencies` |
| [projects/document-project-update-service.ts](projects/document-project-update-service.ts) | document project update service | `createDocumentProjectUpdateService`、`update` |
| [projects/document-session-open-service.ts](projects/document-session-open-service.ts) | document session open service | `SessionOpenState`、`DocumentSessionOpenError`、`createDocumentSessionOpenService` |
| [projects/document-session-profile-service.ts](projects/document-session-profile-service.ts) | document session profile service | `DocumentSessionProfileError`、`createDocumentSessionProfileService`、`list` |
| [projects/document-site-version-service.ts](projects/document-site-version-service.ts) | document site version service | `DocumentSiteVersionErrorCode`、`DocumentSiteVersionError`、`createDocumentSiteVersionService` |
| [projects/document-website-map-service.ts](projects/document-website-map-service.ts) | document website map service | `WebsiteMapRepository`、`createDocumentWebsiteMapService`、`explore` |
| [projects/project-profile-execution-service.ts](projects/project-profile-execution-service.ts) | project profile execution service | `ApprovedProfileScriptSnapshot`、`PreparedProfile`、`executeProjectProfileSnapshot` |
| [projects/project-profile-run-service.ts](projects/project-profile-run-service.ts) | project profile run service | `ProjectProfileExecutionOutcome`、`createProjectProfileRunService`、`launch` |
| [runs/execution/active-document-run-registry.ts](runs/execution/active-document-run-registry.ts) | active document run registry | `ActiveDocumentRun`、`ActiveDocumentRunRegistry`、`ActiveDocumentRunRegistry.getRun` |
| [runs/execution/api-lane-service.ts](runs/execution/api-lane-service.ts) | api lane service | `executeDocumentRunApiLane` |
| [runs/execution/autonomous-plan-execution-service.ts](runs/execution/autonomous-plan-execution-service.ts) | autonomous plan execution service | `AutonomousPlanExecutionRecord`、`AutonomousPlanExecutionStatus`、`AutonomousPlanExecutionError` |
| [runs/execution/cancellation-result-service.ts](runs/execution/cancellation-result-service.ts) | cancellation result service | `buildDocumentRunCancellationResults` |
| [runs/execution/demo-run-service.ts](runs/execution/demo-run-service.ts) | demo run service | `DemoRunService`、`createDemoRunService`、`finishRun` |
| [runs/execution/journal-coordinator.ts](runs/execution/journal-coordinator.ts) | journal coordinator | `createDocumentRunJournalCoordinator` |
| [runs/execution/lane-execution-service.ts](runs/execution/lane-execution-service.ts) | lane execution service | `PreparedDocumentSteps`、`RecoverableResult`、`DocumentRunLaneExecutionPorts` |
| [runs/execution/lifecycle-service.ts](runs/execution/lifecycle-service.ts) | lifecycle service | `DocumentWorkflowState`、`DocumentRunLifecycleDependencies`、`projectDigest` |
| [runs/execution/parallel-run-service.ts](runs/execution/parallel-run-service.ts) | parallel run service | `ParallelRunGroup`、`ParallelRunError`、`createDocumentParallelRunService` |
| [runs/execution/project-run-submission-service.ts](runs/execution/project-run-submission-service.ts) | project run submission service | `DocumentRunProgressSnapshot`、`DocumentRunWorkflowLifecycle`、`DocumentProjectRunSubmissionPorts` |
| [runs/execution/project-run-usecase-service.ts](runs/execution/project-run-usecase-service.ts) | project run usecase service | `DocumentProjectRunRecoverySnapshot`、`DocumentProjectRunExecutionContext`、`DocumentProjectRunUsecaseDependencies` |
| [runs/execution/service.ts](runs/execution/service.ts) | service | `DocumentRunExecutionInput`、`DocumentRunExecutor`、`createDocumentRunApplicationService` |
| [runs/execution/step-revision-proposal-service.ts](runs/execution/step-revision-proposal-service.ts) | step revision proposal service | `StepRevisionProposalStatus`、`StepRevisionProposal`、`StepRevisionProposalRepository` |
| [runs/execution/workflow-coordinator.ts](runs/execution/workflow-coordinator.ts) | workflow coordinator | `WorkflowApprovalStatus`、`WorkflowStage`、`ActiveStage` |
| [runs/notifications/notification-service.ts](runs/notifications/notification-service.ts) | notification service | `NotificationConfig`、`NotificationReceipt`、`RunNotificationStatus` |
| [runs/preparation/execution-preparation-service.ts](runs/preparation/execution-preparation-service.ts) | execution preparation service | `DocumentRunExecutionPreparationOptions`、`DocumentRunExecutionPreparationPorts`、`stable` |
| [runs/preparation/project-run-preparation-service.ts](runs/preparation/project-run-preparation-service.ts) | project run preparation service | `DocumentProjectRunPreparationError`、`DocumentProjectRunPreparationDependencies`、`PreparedDocumentProjectRun` |
| [runs/preparation/project-workflow-preparation-service.ts](runs/preparation/project-workflow-preparation-service.ts) | project workflow preparation service | `WorkflowStage`、`WorkflowRecord`、`DocumentProjectWorkflowPreparationPorts` |
| [runs/preparation/scope-preparation-service.ts](runs/preparation/scope-preparation-service.ts) | scope preparation service | `DocumentRunScopePreparationInput`、`prepareDocumentRunScope` |
| [runs/preparation/step-generation-service.ts](runs/preparation/step-generation-service.ts) | step generation service | `PreparedDocumentSteps`、`createDocumentRunStepGenerationService`、`apply` |
| [runs/recovery/automatic-recovery-policy.ts](runs/recovery/automatic-recovery-policy.ts) | automatic recovery policy | `AutomaticRecoveryDecision`、`automaticRecoveryParentStopReason`、`decideAutomaticRecovery` |
| [runs/recovery/automatic-recovery-service.ts](runs/recovery/automatic-recovery-service.ts) | automatic recovery service | `AutomaticRecoveryRecord`、`AutomaticRecoveryStatus`、`AutomaticRecoveryRepository` |
| [runs/recovery/checkpoint-start-validation.ts](runs/recovery/checkpoint-start-validation.ts) | checkpoint start validation | `assertCheckpointRecoveryStart` |
| [runs/recovery/recovery-coordinator.ts](runs/recovery/recovery-coordinator.ts) | recovery coordinator | `RecoverableResult`、`RecoverableLane`、`createDocumentRunRecoveryCoordinator` |
| [runs/recovery/recovery-readiness-service.ts](runs/recovery/recovery-readiness-service.ts) | recovery readiness service | `DocumentRunRecoveryReadinessDependencies`、`RecoveryReadinessCandidate`、`RecoveryReadiness` |
| [runs/recovery/resume-start-validation.ts](runs/recovery/resume-start-validation.ts) | resume start validation | `ResumeStartValidationInput`、`stable`、`same` |
| [runs/results/baseline-service.ts](runs/results/baseline-service.ts) | baseline service | `targetOrigin`、`attachDocumentRunBaseline` |
| [runs/results/difference-analysis-service.ts](runs/results/difference-analysis-service.ts) | difference analysis service | `createDocumentRunDifferenceAnalysisService`、`analyze` |
| [runs/results/history-service.ts](runs/results/history-service.ts) | history service | `DocumentRunHistoryDependencies`、`countResults`、`executionState` |
| [runs/results/image-analysis-service.ts](runs/results/image-analysis-service.ts) | image analysis service | `DocumentRunImageAnalysis`、`DocumentRunImageAnalysisRepository`、`createDocumentRunImageAnalysisService` |
| [runs/results/investigation-service.ts](runs/results/investigation-service.ts) | investigation service | `InvestigationFact`、`InvestigationHypothesis`、`DocumentRunInvestigationRecord` |
| [runs/results/outcome-service.ts](runs/results/outcome-service.ts) | outcome service | `SnapshotInput`、`DocumentRunOutcomePorts`、`createDocumentRunOutcomeService` |
| [runs/results/snapshot-service.ts](runs/results/snapshot-service.ts) | snapshot service | `createDocumentRunSnapshot` |
| [source-test-job-service.ts](source-test-job-service.ts) | source test job service | `SourceTestJobStore`、`createSourceTestJobService`、`launch` |
