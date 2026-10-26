import type { EngineMode, RunRecord, RunRequest, TestEngine } from "../domain/types.js";
import { saveRun } from "../reporters/markdown-reporter.js";

export interface OrchestratedRun {
  record: RunRecord;
  recordPath: string;
}

export class TestOrchestrator {
  private readonly engines: Map<EngineMode, TestEngine>;

  constructor(engines: TestEngine[]) {
    this.engines = new Map(engines.map((engine) => [engine.mode, engine]));
  }

  async execute(request: RunRequest): Promise<OrchestratedRun> {
    const engine = this.engines.get(request.mode);
    if (!engine) throw new Error(`No engine registered for mode: ${request.mode}`);
    const record = await engine.run(request);
    const recordPath = await saveRun(record, request.outputRoot);
    return { record, recordPath };
  }
}
