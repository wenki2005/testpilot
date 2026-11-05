import { createHash, randomUUID } from "node:crypto";
import type { DocumentRun } from "../../../domain/documents/shared/test-model.js";
export type InvestigationFact = {
    factId: string;
    caseId: string;
    kind: "result" | "step-log" | "frozen-expected" | "evidence-metadata" | "comparison";
    text: string;
};
export type InvestigationHypothesis = {
    caseId: string;
    category: "product" | "test" | "environment" | "unknown";
    summary: string;
    evidence: Array<{
        factId: string;
        quote: string;
    }>;
    nextAction: string;
};
export type DocumentRunInvestigationRecord = {
    id: string;
    runId: string;
    projectId: string;
    runDigest: string;
    createdAt: string;
    provisional: true;
    coverage: "complete" | "partial";
    facts: InvestigationFact[];
    hypotheses: InvestigationHypothesis[];
};
export interface DocumentRunInvestigationRepository {
    save(record: DocumentRunInvestigationRecord): Promise<void>;
    getLatest(runId: string): Promise<DocumentRunInvestigationRecord | null>;
}
export interface DocumentRunInvestigationEvaluator {
    evaluate(input: {
        runId: string;
        projectId: string;
        facts: InvestigationFact[];
    }): Promise<unknown>;
}
/** Canonical fact snapshot and digest used to bind stored advice to the current run. */
export function getDocumentRunInvestigationFactSnapshot(run: DocumentRun, redactText: (text: string) => string): {
    facts: InvestigationFact[];
    runDigest: string;
} {
    const facts = buildFacts(run, redactText);
    return { facts, runDigest: createHash("sha256").update(JSON.stringify(facts)).digest("hex") };
}
export function createDocumentRunInvestigationService(deps: {
    loadRun(runId: string): Promise<DocumentRun | null>;
    repository: DocumentRunInvestigationRepository;
    evaluator: DocumentRunInvestigationEvaluator;
    redactText(text: string): string;
    now?: () => string;
}) {
    const inflight = new Map<string, Promise<DocumentRunInvestigationRecord>>();
    return {
        isInvestigating(runId: string): boolean { return inflight.has(runId); },
        investigate(runId: string): Promise<DocumentRunInvestigationRecord> {
            const active = inflight.get(runId);
            if (active)
                return active;
            const task = investigateOnce(runId).finally(() => inflight.delete(runId));
            inflight.set(runId, task);
            return task;
        },
        async get(runId: string) {
            let run: DocumentRun | null;
            let record: DocumentRunInvestigationRecord | null;
            try {
                run = await deps.loadRun(runId);
                if (!isInvestigableRun(run, runId))
                    return null;
                record = await deps.repository.getLatest(runId);
            }
            catch {
                throw new Error("Run investigation history could not be read.");
            }
            return record?.runId === run.id && record.projectId === run.projectId && record.provisional === true ? record : null;
        },
    };
    async function investigateOnce(runId: string): Promise<DocumentRunInvestigationRecord> {
        let run: DocumentRun | null;
        try {
            run = await deps.loadRun(runId);
        }
        catch {
            throw new Error("Completed non-passing document run was not found.");
        }
        if (!isInvestigableRun(run, runId))
            throw new Error("Completed non-passing document run was not found.");
        const { facts, runDigest } = getDocumentRunInvestigationFactSnapshot(run, deps.redactText);
        if (!facts.length)
            throw new Error("No failed or unresolved case facts are available.");
        if (facts.length > 1000 || JSON.stringify(facts).length > 80000)
            throw new Error("Run investigation facts exceed capacity.");
        let previous: DocumentRunInvestigationRecord | null;
        try {
            previous = await deps.repository.getLatest(runId);
        }
        catch {
            throw new Error("Run investigation history could not be read.");
        }
        if (previous?.runId === run.id && previous.projectId === run.projectId && previous.provisional === true && previous.runDigest === runDigest)
            return previous;
        let output: unknown;
        try {
            output = await deps.evaluator.evaluate({ runId: run.id, projectId: run.projectId, facts: structuredClone(facts) });
        }
        catch {
            throw new Error("Run investigation evaluation failed.");
        }
        const expectedCaseIds = [...new Set(facts.map(f => f.caseId))];
        const hypotheses = validateHypotheses(output, expectedCaseIds, facts, deps.redactText);
        const byCase = new Set(hypotheses.map(h => h.caseId));
        const omitted = expectedCaseIds.some(caseId => !byCase.has(caseId));
        for (const caseId of expectedCaseIds)
            if (!byCase.has(caseId))
                hypotheses.push({ caseId, category: "unknown", summary: "Available stored evidence was insufficient to identify a likely cause.", evidence: facts.filter(f => f.caseId === caseId).slice(0, 1).map(f => ({ factId: f.factId, quote: f.text.slice(0, 240) })), nextAction: "Review the stored case result and collect additional evidence before changing the test or product." });
        const record: DocumentRunInvestigationRecord = { id: randomUUID(), runId: run.id, projectId: run.projectId, runDigest, createdAt: (deps.now ?? (() => new Date().toISOString()))(), provisional: true, coverage: omitted ? "partial" : "complete", facts, hypotheses };
        try {
            await deps.repository.save(record);
        }
        catch {
            throw new Error("Run investigation result could not be saved.");
        }
        return record;
    }
}
function isInvestigableRun(run: DocumentRun | null, requestedId: string): run is DocumentRun {
    return Boolean(run && run.id === requestedId && typeof run.completedAt === "string" && Number.isFinite(Date.parse(run.completedAt)) && ["failed", "partial", "unresolved", "cancelled"].includes(run.overall));
}
function buildFacts(run: DocumentRun, redact: (text: string) => string): InvestigationFact[] {
    const relevant = new Set([
        ...[...run.deterministic.results, ...run.ai.results, ...(run.apiContract?.results ?? [])].filter(r => ["failed", "blocked", "unresolved", "cancelled"].includes(r.status)).map(r => r.id),
        ...run.comparisons.filter(item => item.resolution === "unresolved" || item.resolution === "mismatch").map(item => item.id),
    ]);
    const facts: InvestigationFact[] = [];
    const add = (caseId: string, kind: InvestigationFact["kind"], value: unknown) => {
        const text = redact(String(value ?? "")).trim();
        if (!text)
            return;
        facts.push({ factId: `f${facts.length + 1}`, caseId, kind, text });
    };
    for (const id of relevant) {
        for (const lane of [run.deterministic, run.ai, ...(run.apiContract ? [run.apiContract] : [])])
            for (const result of lane.results)
                if (result.id === id && ["failed", "blocked", "unresolved", "cancelled"].includes(result.status))
                    add(id, "result", `${result.status}: ${result.detail}`);
        const snapshot = [...(run.executionCaseSnapshots ?? []), ...(run.caseSnapshots ?? [])].find(c => c.id === id);
        if (snapshot)
            add(id, "frozen-expected", `Frozen expectation: ${snapshot.expected}`);
        for (const log of run.stepLogs ?? [])
            if (log.caseId === id)
                add(id, "step-log", `Step ${log.stepIndex} ${log.action} ${log.phase}: ${log.detail ?? ""}`);
        for (const evidence of run.evidence ?? [])
            if (evidence.caseId === id)
                add(id, "evidence-metadata", `Evidence ${evidence.type}; ${evidence.reason}; sha256=${evidence.sha256 ?? "unavailable"}; image pixels not inspected.`);
        for (const comparison of run.comparisons)
            if (comparison.id === id)
                add(id, "comparison", `${comparison.resolution ?? "unknown"}: ${comparison.issue}; next action: ${comparison.nextAction ?? "none"}`);
    }
    return facts;
}
function validateHypotheses(raw: unknown, caseIds: string[], facts: InvestigationFact[], redact: (text: string) => string): InvestigationHypothesis[] {
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as {
        hypotheses?: unknown;
    }).hypotheses))
        throw new Error("Investigation evaluator returned invalid output.");
    const valid = new Map(facts.map(f => [f.factId, f]));
    const output: InvestigationHypothesis[] = [];
    for (const h of (raw as {
        hypotheses: unknown[];
    }).hypotheses) {
        if (!h || typeof h !== "object")
            continue;
        const v = h as Record<string, unknown>;
        if (typeof v.caseId !== "string" || !caseIds.includes(v.caseId) || !["product", "test", "environment", "unknown"].includes(String(v.category)) || typeof v.summary !== "string" || typeof v.nextAction !== "string" || !Array.isArray(v.evidence))
            continue;
        const evidence = v.evidence.flatMap(item => {
            if (!item || typeof item !== "object")
                return [];
            const e = item as Record<string, unknown>;
            const fact = typeof e.factId === "string" ? valid.get(e.factId) : undefined;
            if (!fact || fact.caseId !== v.caseId || typeof e.quote !== "string" || !e.quote.trim() || !fact.text.includes(e.quote))
                return [];
            return [{ factId: fact.factId, quote: e.quote }];
        });
        if (!evidence.length || !v.summary.trim() || !v.nextAction.trim())
            continue;
        output.push({ caseId: v.caseId, category: v.category as InvestigationHypothesis["category"], summary: redact(v.summary).slice(0, 1200), evidence, nextAction: redact(v.nextAction).slice(0, 1200) });
    }
    return output;
}
