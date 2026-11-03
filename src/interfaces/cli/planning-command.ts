import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { option, reportPath } from './arguments.js';
import type { TestOrchestrator } from '../../orchestration/orchestrator.js';

export async function runPlanningCommand(command: 'plan' | 'explore', args: string[], outputRoot: string, orchestrator: TestOrchestrator): Promise<boolean> {
  if (command === 'plan') {
    const requirementsPath = option(args, '--requirements');
    if (!requirementsPath) throw new Error('Missing --requirements <file.md>');
    const absolutePath = resolve(requirementsPath);
    const sourceText = await readFile(absolutePath, 'utf8');
    const { record, recordPath } = await orchestrator.execute({
      mode: 'requirements',
      suiteName: `Requirements: ${absolutePath.split(/[\\/]/).pop() ?? 'input'}`,
      cases: [],
      projectRoot: process.cwd(),
      outputRoot,
      scope: ['requirements-driven test planning'],
      limitations: [`Loaded ${sourceText.length} characters from ${absolutePath}; planning provider is not configured.`],
    });
    console.log(`BLOCKED — ${record.limitations[0]}`);
    console.log(`Report: ${reportPath(recordPath)}`);
    process.exitCode = 2;
    return true;
  }

  if (command === 'explore') {
    const goal = option(args, '--goal');
    if (!goal) throw new Error('Missing --goal <text>');
    const scope = option(args, '--scope');
    const { record, recordPath } = await orchestrator.execute({
      mode: 'autonomous',
      suiteName: goal,
      cases: [],
      projectRoot: process.cwd(),
      outputRoot,
      ...(scope ? { scope: [scope] } : {}),
    });
    console.log(`BLOCKED — ${record.limitations[0]}`);
    console.log(`Report: ${reportPath(recordPath)}`);
    process.exitCode = 2;
    return true;
  }
  return false;
}
