<!-- generated-code-index -->
# web/src/features/document-tests

网页测试。文件清单由 `npm run code:index` 生成。功能总入口见仓库根目录“代码导航.md”。

## 子目录

- [api](api/)
- [components](components/)
- [hooks](hooks/)
- [presentation](presentation/)

## 文件职责

| 文件 | 用途 | 主要入口 |
| --- | --- | --- |
| [api-mapping-candidates.ts](api-mapping-candidates.ts) | api mapping candidates | `MappingText`、`tokens`、`suggestApiMappingCandidates` |
| [api/automatic-recovery-control.ts](api/automatic-recovery-control.ts) | automatic recovery control | `AutomaticRecoveryControlAction`、`AutomaticRecoveryControlResult`、`isRecord` |
| [api/client.ts](api/client.ts) | client | `HttpRequestError`、`request` |
| [api/runs.ts](api/runs.ts) | runs | `startAndWaitForRun` |
| [case-selection.ts](case-selection.ts) | case selection | `SelectionCase`、`SelectionProject`、`ImpactCandidate` |
| [components/ApiContractPanel.tsx](components/ApiContractPanel.tsx) | ApiContractPanel | `ApiContractPanel` |
| [components/AutonomousRegressionPlans.tsx](components/AutonomousRegressionPlans.tsx) | AutonomousRegressionPlans | `Decision`、`Plan`、`Execution` |
| [components/CaseCodeViewer.tsx](components/CaseCodeViewer.tsx) | CaseCodeViewer | `CodeFile`、`CodeView`、`CaseCodeViewer` |
| [components/CaseMarkdownAssets.tsx](components/CaseMarkdownAssets.tsx) | CaseMarkdownAssets | `Preview`、`CaseMarkdownAssets` |
| [components/DailyRunOutcome.tsx](components/DailyRunOutcome.tsx) | DailyRunOutcome | `DailyRunOutcome` |
| [components/DailyRunStartPanel.tsx](components/DailyRunStartPanel.tsx) | DailyRunStartPanel | `Profile`、`ProfilesResponse`、`handoffModelBlocker` |
| [components/DocumentCaseEditorList.tsx](components/DocumentCaseEditorList.tsx) | DocumentCaseEditorList | `DocumentCaseEditorList` |
| [components/DocumentChangeImpactPanel.tsx](components/DocumentChangeImpactPanel.tsx) | DocumentChangeImpactPanel | `PanelProps`、`DocumentChangeImpactPanel` |
| [components/Lane.tsx](components/Lane.tsx) | Lane | `Lane` |
| [components/NotificationSettings.tsx](components/NotificationSettings.tsx) | NotificationSettings | `Settings`、`NotificationSettings` |
| [components/NotificationTrialPanel.tsx](components/NotificationTrialPanel.tsx) | NotificationTrialPanel | `Preview`、`NotificationTrialPanel` |
| [components/ParallelModuleRuns.tsx](components/ParallelModuleRuns.tsx) | ParallelModuleRuns | `Profile`、`ProfileList`、`Job` |
| [components/PrerequisiteHandoffNotice.tsx](components/PrerequisiteHandoffNotice.tsx) | PrerequisiteHandoffNotice | `PrerequisiteHandoffNotice` |
| [components/ProjectPlatformSetup.tsx](components/ProjectPlatformSetup.tsx) | ProjectPlatformSetup | `ProjectPlatformPicker`、`ProjectPlatformConfirmation` |
| [components/ProjectRevisionPanel.tsx](components/ProjectRevisionPanel.tsx) | ProjectRevisionPanel | `RevisionDetail`、`CaseGenerationSnapshot`、`isCaseGenerationSnapshot` |
| [components/RunAutomaticRecovery.tsx](components/RunAutomaticRecovery.tsx) | RunAutomaticRecovery | `AutomaticRecoveryStatus`、`RecoveryControlAction`、`RunAutomaticRecoveryView` |
| [components/RunConfigurationPanel.tsx](components/RunConfigurationPanel.tsx) | RunConfigurationPanel | `RunConfigurationPanel` |
| [components/RunExecutionActions.tsx](components/RunExecutionActions.tsx) | RunExecutionActions | `RunExecutionActionsProps`、`RunExecutionActions` |
| [components/RunHandoffNotice.tsx](components/RunHandoffNotice.tsx) | RunHandoffNotice | `RunHandoffNotice` |
| [components/RunHistoryPanel.tsx](components/RunHistoryPanel.tsx) | RunHistoryPanel | `RunHistoryPanel` |
| [components/RunInvestigation.tsx](components/RunInvestigation.tsx) | RunInvestigation | `InvestigationRecord`、`StepRevisionProposal`、`ImageAnalysis` |
| [components/RunNotificationStatus.tsx](components/RunNotificationStatus.tsx) | RunNotificationStatus | `RunNotificationStatusValue`、`notificationStatusLabel`、`NotificationStatusContent` |
| [components/RunRecoveryAdoption.tsx](components/RunRecoveryAdoption.tsx) | RunRecoveryAdoption | `RunRecoveryAdoption` |
| [components/RunRecoveryReadiness.tsx](components/RunRecoveryReadiness.tsx) | RunRecoveryReadiness | `RecoveryCandidate`、`RecoveryAdvice`、`RecoveryReadiness` |
| [components/RunResultsPanel.tsx](components/RunResultsPanel.tsx) | RunResultsPanel | `RunResultsPanel` |
| [components/SessionOpenControl.tsx](components/SessionOpenControl.tsx) | SessionOpenControl | `SessionTask`、`SessionOpenControl` |
| [components/SessionProfiles.tsx](components/SessionProfiles.tsx) | SessionProfiles | `Profile`、`ProfilesResponse`、`ProfileResponse` |
| [components/StepProbeNotice.tsx](components/StepProbeNotice.tsx) | StepProbeNotice | `StepProbeNotice` |
| [components/WebsiteDiscoveryPanel.tsx](components/WebsiteDiscoveryPanel.tsx) | WebsiteDiscoveryPanel | `WebsiteDiscoveryPanel` |
| [components/WorkflowRail.tsx](components/WorkflowRail.tsx) | WorkflowRail | `WorkflowRail` |
| [daily-run-selection.ts](daily-run-selection.ts) | daily run selection | `allDailyCasesKey`、`dailyCaseModulePath`、`dailyModuleOptions` |
| [document-tests-page.tsx](document-tests-page.tsx) | document tests page |  |
| [hooks/useDocumentApiSuiteCatalog.ts](hooks/useDocumentApiSuiteCatalog.ts) | useDocumentApiSuiteCatalog | `useDocumentApiSuiteCatalog` |
| [hooks/useDocumentCaseAuthoringActions.ts](hooks/useDocumentCaseAuthoringActions.ts) | useDocumentCaseAuthoringActions | `useDocumentCaseAuthoringActions` |
| [hooks/useDocumentCaseEditor.ts](hooks/useDocumentCaseEditor.ts) | useDocumentCaseEditor | `useDocumentCaseEditor` |
| [hooks/useDocumentCaseSelection.ts](hooks/useDocumentCaseSelection.ts) | useDocumentCaseSelection | `useDocumentCaseSelection` |
| [hooks/useDocumentChangeImpact.ts](hooks/useDocumentChangeImpact.ts) | useDocumentChangeImpact | `useDocumentChangeImpact` |
| [hooks/useDocumentProjectApproval.ts](hooks/useDocumentProjectApproval.ts) | useDocumentProjectApproval | `useDocumentProjectApproval` |
| [hooks/useDocumentProjectHistory.ts](hooks/useDocumentProjectHistory.ts) | useDocumentProjectHistory | `useDocumentProjectHistory` |
| [hooks/useDocumentProjectMaterials.ts](hooks/useDocumentProjectMaterials.ts) | useDocumentProjectMaterials | `MaterialRole`、`useDocumentProjectMaterials` |
| [hooks/useDocumentProjectPreparation.ts](hooks/useDocumentProjectPreparation.ts) | useDocumentProjectPreparation | `Dependencies`、`useDocumentProjectPreparation` |
| [hooks/useDocumentProjectSession.ts](hooks/useDocumentProjectSession.ts) | useDocumentProjectSession | `useDocumentProjectSession` |
| [hooks/useDocumentRunActions.ts](hooks/useDocumentRunActions.ts) | useDocumentRunActions | `StartRun`、`useDocumentRunActions` |
| [hooks/useDocumentRunExecution.ts](hooks/useDocumentRunExecution.ts) | useDocumentRunExecution | `useDocumentRunExecution` |
| [hooks/useDocumentRunHandoffs.ts](hooks/useDocumentRunHandoffs.ts) | useDocumentRunHandoffs | `useDocumentRunHandoffs` |
| [hooks/useDocumentStepProbe.ts](hooks/useDocumentStepProbe.ts) | useDocumentStepProbe | `useDocumentStepProbe`、`probe` |
| [hooks/useDocumentTestDataSets.ts](hooks/useDocumentTestDataSets.ts) | useDocumentTestDataSets | `useDocumentTestDataSets` |
| [legacy-case-selection-exports.ts](legacy-case-selection-exports.ts) | legacy case selection exports |  |
| [module-regression-page.tsx](module-regression-page.tsx) | module regression page | `ModulePlan`、`ModuleExecution`、`RecordRow` |
| [page.tsx](page.tsx) | page | `dependencyPreview`、`DocumentTestsPage` |
| [presentation.ts](presentation.ts) | presentation | `categoryOptions`、`baselineDispositionLabels`、`baselineStatusLabels` |
| [presentation/handoff-progress-state.ts](presentation/handoff-progress-state.ts) | handoff progress state | `visibleHandoffForProgress`、`pauseControlForProgress` |
| [project-platform.ts](project-platform.ts) | project platform | `ProjectPlatform`、`projectPlatformOptions`、`projectPlatformSelection` |
| [test-data-requirements-edit.ts](test-data-requirements-edit.ts) | test data requirements edit | `TestDataRequirement`、`applyTestDataRequirementsEdit` |
| [types.ts](types.ts) | types | `Step`、`TestDataSet`、`ProjectPlatform` |
