import { useCallback, useState } from "react";
import { startAndWaitForRun } from "../api/runs";
import type { RunProgress } from "../types";

/** Tracks the currently submitted run and owns its start/progress polling lifecycle. */
export function useDocumentRunExecution(onStatus: (message: string) => void, onProgress?: (progress: RunProgress) => void) {
  const [activeRunId, setActiveRunId] = useState("");
  const startRun = useCallback((projectId: string, body: Record<string, unknown>, action: "start" | "retest" | "checkpoint-retry" = "start") =>
    startAndWaitForRun(projectId, body, onStatus, action, setActiveRunId, progress => {
      if (progress.handoff?.status === 'paused-for-analysis' || progress.handoff?.status === 'ready-to-continue') onProgress?.(progress);
      else onProgress?.(progress);
    }), [onStatus, onProgress]);
  return { activeRunId, setActiveRunId, startRun };
}
