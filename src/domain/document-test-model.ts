import type { DocumentSessionProfile } from "./document-session-profile.js";
import type { DocumentApiLane, DocumentApiMapping, DocumentImpactSuggestion, GeneratedTestCase, ImportedDocument } from "./document-test-contracts.js";
import type { CaseCategory, CaseConfidence } from "./document-test-types.js";

export type BrowserStep =
  | { action: "goBack" }
  | { action: "assertControlEnabled"; text: string }
  | { action: "fillByLabel"; label: string; value: string; rowIndex?: number }
  | { action: "fillByPlaceholder"; placeholder: string; value: string }
  | { action: "fillByRoleIndex"; role: "combobox"; index: number; value: string }
  | { action: "blurByLabel"; label: string; rowIndex?: number }
  | { action: "blurByPlaceholder"; placeholder: string }
  | { action: "selectByLabel"; label: string; value: string; rowIndex?: number }
  | { action: "selectByPlaceholder"; placeholder: string; value: string }
  | { action: "selectByRoleIndex"; role: "combobox"; index: number; value: string }
  | { action: "clickByRole"; role: "button" | "radio" | "checkbox" | "tab" | "link"; name: string }
  | { action: "triggerClientValidation"; name: string }
  | { action: "clickExactText"; text: string }
  | { action: "assertText"; text: string }
  | { action: "assertVisible"; text: string }
  | { action: "assertNotVisible"; text: string }
  | { action: "assertExactVisible"; text: string }
  | { action: "assertRoleVisible"; role: "button" | "radio" | "checkbox" | "tab" | "link"; name: string }
  | { action: "assertValue"; label: string; value: string; rowIndex?: number }
  | { action: "assertValueByPlaceholder"; placeholder: string; value: string }
  | { action: "assertDisabled"; label: string }
  | { action: "assertFieldInvalid"; label: string; rowIndex?: number }
  | { action: "captureCurrentUrl" }
  | { action: "assertCurrentUrlUnchanged" }
  | { action: "assertRoleDisabled"; role: "button" | "radio" | "checkbox" | "tab" | "link"; name: string }
  | { action: "assertMaxLengthOrMessage"; label: string; maxLength: number; message: string }
  | { action: "startFetchOrXhrCapture" }
  | { action: "assertNoFetchOrXhr"; quietMs?: number }
  | { action: "assertNoHorizontalOverflow" }
  | { action: "setViewport"; width: number; height: number }
  | { action: "scrollToRatio"; ratio: number }
  | { action: "setReducedMotion"; value: boolean };
export type CasePriority = "P0" | "P1" | "P2" | "P3";
export type CaseLifecycleStatus = "draft" | "runnable" | "disabled";
export type SideEffectRisk = "none" | "reversible" | "irreversible" | "unknown";
export type DocumentRunMode = "regression" | "compare";
export type DocumentRunScopePlan = { mode: "single" | "feature" | "impact" | "full" | "custom"; targetCaseIds: string[]; impactCaseIds: string[]; prerequisiteCaseIds?: string[]; orderedCaseIds?: string[]; handoffAfterPrerequisites?: boolean; impactReasons?: Record<string, string[]> };
export type ExecutionRoute = "browser-ui" | "api-contract" | "fixture-or-role" | "source-review" | "clarification" | "out-of-scope" | "manual-analysis";
export type CaseGenerationTrace = { sourceCaseId: string; sourceRefs: string[]; actions: string[]; scenarioType: GeneratedTestCase["scenarioType"]; clarificationNeeded: string[]; original: GeneratedTestCase };
export type BrowserCheck = { authorizedWriteOperationId?: string; writeResultOperationId?: string; writeResultSourceRunId?: string; requiredAssertions?: string[]; id: string; title: string; source: string; entryPath?: string; modulePath?: string[]; dependsOnCaseIds?: string[]; tags?: string[]; requirementRefs: string[]; priority: CasePriority; category: CaseCategory; confidence: CaseConfidence; coverageAreas: CaseCategory[]; lifecycleStatus?: CaseLifecycleStatus; selectedForRegression: boolean; preconditions: string[]; preconditionsConfirmed: boolean; testData: string[]; testDataRequirements?: Array<{ key: string; description: string; source?: string; required: boolean }>; sideEffectRisk: SideEffectRisk; cleanup: string; caseOrigin?: "held-out-benchmark" | "ai-generated" | "document-derived" | "manual" | "iteration-impact-draft"; caseGenerationTrace?: CaseGenerationTrace; explorationEvidence?: { evidenceId: string; snapshotSha256: string; capturedAt: string; route: string; observedFactSha256: string }; kind: "text" | "visible" | "field"; expected: string; steps: BrowserStep[]; baseline?: { strategy: "reload-target" | "unavailable"; reason?: string }; coverageGap?: string; executionRoute?: ExecutionRoute; executionReason?: string; nextAction?: string };
export type StepGenerationLocatorEvidence = { stepIndex: number; kind: "control-label" | "placeholder" | "role-name" | "visible-text" | "combobox-index"; valueSha256: string };
export type StepGenerationPageEvidenceReference = { evidenceId?: string; sha256: string; capturedAt: string; route: string; matchedLocators: StepGenerationLocatorEvidence[] };
export type PageExplorationTraceEntry = { sequence: number; decision: "follow-link" | "stop" | "incomplete"; inputEvidenceIds: string[]; latestEvidenceId?: string; linkIndex?: number; selectedLabel?: string; selectedPath?: string; resultingEvidenceId?: string; reason?: string; status: "followed" | "stopped" | "failed" | "incomplete" };
export type StepGenerationPageEvidence = {
  evidenceId?: string;
  sha256: string;
  caseRevisionDigest?: string;
  stepRevisionDigest?: string;
  capturedAt: string;
  route: string;
  matchedLocators: StepGenerationLocatorEvidence[];
  pages?: StepGenerationPageEvidenceReference[];
  explorationStatus?: "stopped" | "incomplete" | "legacy-single-page";
  decisionTrace?: PageExplorationTraceEntry[];
};
export type StepGenerationCaseResult = { databaseEvidence?: { id: string; sha256: string; capturedAt: string; queryKeys: string[] }; caseId: string; status: "generated" | "partial" | "blocked"; stepCount: number; detail: string; pageEvidence?: StepGenerationPageEvidence; authoringContext?: { sources: import('./document-authoring-context.js').DocumentAuthoringSourceReference[]; database: import('./document-authoring-context.js').DocumentAuthoringContext['database']; warnings: string[] } };
export type DocumentSiteVersion = { id: string; label: string; environment: string; targetUrl: string; changeNotes: string; createdAt: string };
/** The client surface this project is intended to exercise. Legacy projects stay explicitly unknown. */
export type DocumentProjectPlatform = "pc-web" | "mobile-web" | "wecom-workbench" | "unknown";
export type DocumentProjectPlatformSelection = { type: DocumentProjectPlatform; status: "confirmed" | "needs-confirmation"; confirmedAt?: string };
/** Per-surface launch and execution defaults; project fields remain authoritative for existing data. */
export type DocumentProjectExecutionConfig = {
  isMobile?: boolean;
  entryUrl?: string;
  viewport?: { width: number; height: number };
  browser?: "chromium" | "edge";
  hostApp?: "wecom";
};
export type DocumentStepRevisionAdoption = { proposalId: string; caseId: string; expected: string; currentStepsDigest: string; adoptedStepsDigest: string; adoptedAt: string };
export const documentProjectPlatformTemplates: Record<Exclude<DocumentProjectPlatform, "unknown">, DocumentProjectExecutionConfig> = {
  "pc-web": { viewport: { width: 1440, height: 900 }, browser: "chromium" },
  "mobile-web": { viewport: { width: 390, height: 844 }, browser: "chromium", isMobile: true },
  "wecom-workbench": { viewport: { width: 1280, height: 800 }, browser: "edge", hostApp: "wecom" },
};
export type DocumentTestDataSet = { id: string; name: string; values: Record<string, string>; createdAt: string; updatedAt: string };
export type DocumentSourceMaterial = { id: string; fileName: string; role: "requirements" | "coverage-reference" | "held-out-benchmark" | "website-content"; sha256: string; byteLength: number; createdAt: string };
export type DocumentImpactAnalysis = { id: string; siteVersionId: string; siteVersionLabel: string; changeNotesSnapshot: string; caseVersion: string; analyzedAt: string; matchingMethod: "keyword-evidence"; suggestions: DocumentImpactSuggestion[]; unmatchedTerms: string[]; status: "pending" | "accepted" | "rejected"; selectedCaseIds?: string[]; reviewNotes?: string; reviewedAt?: string };
export type CaseGenerationProvenance = { status: "captured" | "missing"; requirementsTextSha256?: string; websiteTextSha256?: string; websiteSource: "provided-text" | "public-read" | "missing"; websiteReference?: string; uploadedFiles: Array<{ fileName: string; role: string; bytesSha256: string; extractedTextSha256: string }>; researchSources: Array<{ url: string; snippetSha256: string }> };
export type DocumentProject = { platform?: DocumentProjectPlatformSelection; executionConfig?: DocumentProjectExecutionConfig; sessionProfiles?: DocumentSessionProfile[]; activeSessionProfileId?: string; id: string; name: string; fileName: string; workflowId?: string; siteVersions?: DocumentSiteVersion[]; activeSiteVersionId?: string; impactAnalyses?: DocumentImpactAnalysis[]; testDataSets?: DocumentTestDataSet[]; sourceMaterials?: DocumentSourceMaterial[]; materialTexts?: Record<string, string>; contextText?: string; sourceFiles?: string[]; sourceRoles?: Array<{ fileName: string; role: "requirements" | "coverage-reference" | "held-out-benchmark" | "website-content" }>; researchExamples?: Array<{ title: string; url: string; snippet: string }>; caseMode?: "existing" | "ai" | "both"; confirmationRequired?: boolean; generationWarning?: string; stepAuthoring?: { generatedAt: string; results: StepGenerationCaseResult[] }; stepRevisionAdoptions?: DocumentStepRevisionAdoption[]; workflowPlan?: string[]; caseGeneration?: { provenance?: CaseGenerationProvenance; artifactId: string; version: number; generatedAt: string; digest: string; requirements: CaseGenerationRequirementSnapshot[]; qualitySummary: Record<string, unknown>; warnings: string[]; sources: Array<{ kind: string; label: string; reference?: string }>; transferredCases: Array<{ sourceCaseId: string; projectCaseId: string }> }; apiContract?: { suiteId?: string; mappings?: DocumentApiMapping[]; allowNetwork?: boolean; allowMutations?: boolean; allowConcurrency?: boolean }; sessionIdentityNote?: string; format: ImportedDocument["format"]; targetUrl: string; sourceText: string; cases: BrowserCheck[]; reviewStatus?: "draft" | "approved"; reviewNotes?: string; createdAt: string; updatedAt: string };
export type DocumentProjectRevisionKind = "case" | "steps" | "step-evidence" | "case-set" | "case-generation" | "materials" | "test-data";
export type DocumentProjectRevisionSummary = { id: string; projectId: string; kind: DocumentProjectRevisionKind; entityId: string; version: number; digest: string; createdAt: string; source: "saved-project" | "run-snapshot"; summary: string };
export type DocumentProjectRevision = DocumentProjectRevisionSummary & { snapshot: unknown };
export type DocumentProjectSessionStatus = {
  state: "occupied" | "connected" | "unavailable" | "unknown";
  occupied: boolean;
  manualLoginRequired: boolean | null;
  identityNote?: string;
  identitySource?: "user-confirmed";
  checkedAt: string;
  message: string;
};
export type DocumentStepProbe = {
  caseId: string;
  stepIndex: number;
  action: string;
  status: "found" | "not-found" | "not-visible" | "ambiguous" | "not-required" | "blocked";
  locatorKind?: string;
  matchCount?: number;
  visibleCount?: number;
  elementTypes?: string[];
  checkedAt: string;
  detail: string;
};
type CaseGenerationRequirementSnapshot = { id: string; text: string; source: string; priority: string; confidence: string; scopeStatus: string; scopeRationale: string };
export type CaseResult = { id: string; title: string; status: "passed" | "failed" | "blocked" | "not-applicable" | "cancelled" | "not-run"; blockKind?: "dependency-blocked"; detail: string; durationMs: number };
export type LaneResult = { status: "passed" | "failed" | "blocked" | "not-applicable" | "cancelled"; summary: string; results: CaseResult[]; provider?: string; diagnostics?: string[] };
export type ComparisonResolution = "aligned" | "mismatch" | "unresolved" | "not-applicable";
export type DocumentCaseTriageCategory = "suspected-product-regression" | "case-or-expectation-review" | "locator-failure" | "environment-or-session" | "test-data-or-fixture" | "needs-review";
export type DocumentCaseTriage = { category: DocumentCaseTriageCategory; confidence: "evidence-based" | "tentative"; detail: string };
export type CaseComparison = { id: string; title: string; deterministic: CaseResult["status"]; computerUse: CaseResult["status"]; apiContract?: CaseResult["status"]; aligned: boolean; resolution?: ComparisonResolution; issue: string; nextAction?: string; triage?: DocumentCaseTriage };
export type BaselineDisposition = "regression" | "fixed" | "unchanged" | "case-changed" | "added" | "removed" | "not-run" | "no-baseline-result" | "unresolved";
export type DocumentBaselineComparison = { caseId: string; title: string; baselineStatus?: CaseResult["status"]; currentStatus?: CaseResult["status"]; caseChanged?: boolean; disposition: BaselineDisposition };


export type CoverageSummary = { projectAreas: CaseCategory[]; selectedAreas: CaseCategory[]; notCoveredThisRun: CaseCategory[] };


export type DocumentRunDiagnostic = { caseId: string; classification: "mismatch" | "unverified" | "aligned" | "not-applicable"; deterministicEvidence: string; computerUseEvidence: string; apiEvidence?: string; resolution: ComparisonResolution };
export type DocumentRunBaselineSnapshot = { runId: string; startedAt: string; completedAt: string; runMode?: DocumentRunMode; siteVersionSnapshot?: DocumentSiteVersion; caseVersion?: string; materialVersion?: string; testDataVersion?: string; scopePlan?: DocumentRunScopePlan; selectedCaseCount: number; totalCases: number };
export type DocumentRunEvidence = { evidenceId: string; runId: string; caseId: string; stepIndex?: number; attempt: number; type: "screenshot" | "unavailable"; reason: string; createdAt: string; relativeKey?: string; sha256?: string; mimeType?: "image/png" };
export type AdoptedRecoveryAdvice = { recordId: string; runDigest: string; caseId: string; category: "product" | "test" | "environment" | "unknown"; strategy: "human-review" | "rebuild-readonly-case"; summary: string; evidence: Array<{ factId: string; quote: string }>; adoptedAt: string };
export type CheckpointRecoveryRequest = { parentRunId: string; caseId: string; stepIndex: number; trigger?: 'human' | 'automatic-policy'; adoptedAdvice?: AdoptedRecoveryAdvice };
export type DocumentRun = { databaseEvidence?: import("./document-database-evidence.js").DocumentDatabaseEvidence; readOnlyBusinessFacts?: Array<{kind:string;observedAt:string;requestKey:string;availableFields:string[];fields:Record<string,string|number>}>; checkpointRecovery?: CheckpointRecoveryRequest; targetUrlSnapshot?: string; autonomousPlanId?: string; autonomousPlanContextDigest?: string; sessionProfileSnapshot?: DocumentSessionProfile; id: string; projectId: string; workflowId?: string; runMode?: DocumentRunMode; scopePlan?: DocumentRunScopePlan; siteVersionSnapshot?: DocumentSiteVersion; materialVersion?: string; sourceMaterialsSnapshot?: DocumentSourceMaterial[]; baselineRunId?: string; baselineRunSnapshot?: DocumentRunBaselineSnapshot; baselineEnvironmentComparison?: "same" | "different" | "unknown"; baselineRunModeComparison?: "same" | "different" | "unknown"; baselineMaterialChanged?: boolean; baselineTestDataChanged?: boolean; baselineComparison?: DocumentBaselineComparison[]; testDataSetId?: string; testDataVersion?: string; parameterValues?: Record<string, string>; caseSnapshotVersion?: 1; caseSnapshots?: BrowserCheck[]; executionCaseSnapshots?: BrowserCheck[]; caseVersions?: Record<string, string>; caseTitles?: Record<string, string>; caseInventory?: Record<string, string>; parentRunId?: string; caseVersion?: string; retestSelection?: string[]; retestNotes?: string; retestScopeNote?: string; stepCheckpoint?: ExecutionJournal["checkpoint"]; stepLogs?: ExecutionJournal["stepLogs"]; evidence?: DocumentRunEvidence[]; startedAt: string; completedAt: string; caseScope: { selectedCaseIds: string[]; excludedCaseIds: string[]; totalCases: number }; caseScopeKnown?: boolean; recovery?: { resumeCount: number; replayedFromBeginning: false; skippedCompletedCaseIds: string[]; interruptedRetryCaseIds: string[] }; coverageSummary?: CoverageSummary; stepGeneration?: { generatedCaseIds: string[]; caseResults?: StepGenerationCaseResult[]; warning?: string; requiresReview: boolean }; deterministic: LaneResult; ai: LaneResult & { provider?: string }; apiContract?: DocumentApiLane; comparisons: CaseComparison[]; diagnostics?: DocumentRunDiagnostic[]; analysis?: string; finalReady: boolean; reportReady?: boolean; packageReady?: boolean; overall: "passed" | "failed" | "partial" | "unresolved" | "cancelled"; report: string; packagePath: string };
export type DocumentRunProgress = {
  runId: string;
  cancelRequested?: boolean;
  workflowId?: string;
  status: "running" | "pause-requested" | "paused" | "completed" | "failed" | "cancelled";
  stage: ExecutionJournal["stage"];
  workflowStatus?: "running" | "waiting" | "failed" | "completed" | "cancelled";
  startedAt: string;
  updatedAt: string;
  resumeCount: number;
  currentCase?: ExecutionJournal["currentCase"];
  stepGeneration?: DocumentRun["stepGeneration"];
  siteVersionSnapshot?: DocumentSiteVersion;
  progress: { completed: number; total: number; counts: Record<string, number> };
  results: NonNullable<ExecutionJournal["caseResults"]>;
  checkpoint?: ExecutionJournal["checkpoint"];
  stepLogs?: ExecutionJournal["stepLogs"];
  run?: DocumentRun;
  lastError?: string;
  handoff?: ExecutionJournal["handoff"];
};
export type DocumentRunHandoff = { status: "waiting-prerequisites" | "paused-for-analysis" | "ready-to-continue" | "blocked"; prerequisiteCaseIds: string[]; targetCaseIds: string[]; pageContextId?: string; evidence?: { evidenceId: string; sourceUrl: string; title: string; visibleText: string; imagePixelsInspected: false; capturedAt: string }; analysis?: { summary: string; citations: Array<{ quote: string }>; imagePixelsInspected: false }; reason?: string; updatedAt: string };
export type ExecutionJournal = { checkpointRecovery?: CheckpointRecoveryRequest; autonomousPlanId?: string; autonomousPlanContextDigest?: string; handoff?: DocumentRunHandoff; version: 1; runId: string; projectId: string; workflowId?: string; runMode?: DocumentRunMode; scopePlan?: DocumentRunScopePlan; siteVersionSnapshot?: DocumentSiteVersion; materialVersion?: string; sourceMaterialsSnapshot?: DocumentSourceMaterial[]; baselineRunId?: string; testDataSetId?: string; parameterValues?: Record<string, string>; projectDigest: string; targetUrl: string; selectedCaseIds: string[]; startedAt: string; updatedAt: string; status: "running" | "completed" | "failed" | "cancelled"; stage: "starting" | "deterministic" | "computer-use" | "awaiting-login" | "analysis" | "report" | "packaging"; resumeCount: number; parentRunId?: string; retestNotes?: string; retestScopeNote?: string; caseResults?: Array<{ lane: "deterministic" | "computer-use"; id: string; title: string; status: CaseResult["status"]; blockKind?: CaseResult["blockKind"]; detail: string; durationMs: number; updatedAt: string; actions?: number }>; currentCase?: { lane: "deterministic" | "computer-use"; id: string; title: string }; checkpoint?: { caseId: string; stepIndex: number; nextStepIndex: number; phase: "before" | "after" | "failed"; at: string; replayRequired?: boolean; reason?: string }; stepLogs?: Array<{ caseId: string; stepIndex: number; action: string; phase: "before" | "passed" | "failed"; detail?: string; at: string }>; evidence?: DocumentRunEvidence[]; stepGeneration?: DocumentRun["stepGeneration"]; finalizationRun?: DocumentRun; lastError?: string };
export type DocumentRunRecovery = { runId: string; workflowId?: string; runMode?: DocumentRunMode; siteVersionSnapshot?: DocumentSiteVersion; baselineRunId?: string; testDataSetId?: string; parameterValues?: Record<string, string>; parentRunId?: string; retestSelection?: string[]; retestNotes?: string; retestScopeNote?: string; selectedCaseIds?: string[]; startedAt: string; updatedAt: string; stage: ExecutionJournal["stage"]; resumeCount: number; canResume: boolean; canFinalizePackage?: boolean; lastError?: string; isRunning?: boolean; progress?: { completed: number; total: number; currentCase?: { lane: "deterministic" | "computer-use"; id: string; title: string }; counts: Record<string, number> }; recordedResultCount?: number; recordedResults?: Array<{ lane: "deterministic" | "computer-use"; id: string; title: string; status: CaseResult["status"]; durationMs: number; updatedAt: string; actions?: number }>; reason: string };










