import { dirname, resolve, join } from 'node:path';
import { option, reportPath } from './arguments.js';
import { resolveProjectRoot, loadProjectProfile, loadSuite } from '../../storage/suite-loader.js';
import { prepareProfile, preserveProfileArtifacts } from '../../adapters/project-profile-adapter.js';
import type { TestOrchestrator } from '../../orchestration/orchestrator.js';

export async function runProjectCommand(args: string[], outputRoot: string, orchestrator: TestOrchestrator): Promise<void> {
  const profileName = option(args, '--profile');
  if (profileName) {
    if (!/^[a-z0-9-]+$/i.test(profileName)) throw new Error('Profile name may contain only letters, digits and hyphens.');
    const profile = await loadProjectProfile(join(process.cwd(), 'examples', 'profiles', `${profileName}.json`));
    const prepared = await prepareProfile(profile);
    try {
      const cases = profile.suite.cases.map(testCase => ({
        ...testCase,
        command: {
          ...testCase.command,
          cleanEnvironment: true,
          env: Object.fromEntries(Object.entries({ ...testCase.command.env, ...prepared.env }).map(([key, value]) => [key, value.replaceAll('{DEMO_URL}', prepared.env.DEMO_URL ?? '')])),
        },
      }));
      const { record, recordPath } = await orchestrator.execute({
        mode: 'deterministic',
        suiteName: profile.suite.name,
        cases,
        projectRoot: prepared.projectRoot,
        outputRoot,
        scope: [`Existing suite in ${profile.name}`, 'Disposable snapshot of the configured local project'],
        limitations: ['This profile executes the project\'s pre-existing tests; it does not generate or heal tests.', 'Project files and generated test artifacts run in an isolated temporary copy.'],
      });
      await preserveProfileArtifacts(profile, prepared.projectRoot, dirname(recordPath));
      console.log(`${record.status.toUpperCase()} — ${record.suiteName}`);
      console.log(`Cases: ${record.results.filter(item => item.status === 'passed').length} passed / ${record.results.length} total`);
      console.log(`Report: ${reportPath(recordPath)}`);
      if (record.status !== 'passed') process.exitCode = 1;
    } finally { await prepared.close(); }
    return;
  }

  const suitePath = option(args, '--suite');
  if (!suitePath) throw new Error('Missing --suite <file.json>');
  const suite = await loadSuite(resolve(suitePath));
  const { record, recordPath } = await orchestrator.execute({
    mode: 'deterministic',
    suiteName: suite.name,
    cases: suite.cases,
    projectRoot: resolveProjectRoot(option(args, '--project-root')),
    outputRoot,
  });
  console.log(`${record.status.toUpperCase()} — ${record.suiteName}`);
  console.log(`Cases: ${record.results.filter(item => item.status === 'passed').length} passed / ${record.results.length} total`);
  console.log(`Report: ${reportPath(recordPath)}`);
  if (record.status !== 'passed') process.exitCode = 1;
}
