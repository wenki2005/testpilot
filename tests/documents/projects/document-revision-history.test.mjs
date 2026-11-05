import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const makeCase = (id, title, steps = [{ action: 'assertExactVisible', text: 'Old title' }]) => ({
  id, title, source: 'requirements.md:1', modulePath: ['Landing'], requirementRefs: ['requirements.md:1'], priority: 'P1',
  category: 'functional', confidence: 'high', coverageAreas: ['functional'], selectedForRegression: true,
  preconditions: [], preconditionsConfirmed: true, testData: [], sideEffectRisk: 'none', cleanup: '', kind: 'visible',
  expected: 'Old title is visible', steps,
});

const makeProject = (id, overrides = {}) => ({
  id, name: id, fileName: 'requirements.md', format: 'markdown', targetUrl: 'http://127.0.0.1:5000/',
  sourceText: 'Requirement version one', sourceFiles: ['requirements.md'], sourceRoles: [{ fileName: 'requirements.md', role: 'requirements' }],
  sourceMaterials: [{ id: 'material-1', fileName: 'requirements.md', role: 'requirements', sha256: 'a'.repeat(64), byteLength: 24, createdAt: '2026-10-21T00:00:00.000Z' }],
  cases: [makeCase('landing-title', 'Landing title'), makeCase('footer-link', 'Footer link', [{ action: 'assertExactVisible', text: 'Contact' }])],
  testDataSets: [{ id: 'data-set-1', name: 'Synthetic input', values: { scenario: 'alpha' }, createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z' }],
  createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
  ...overrides,
});

test('project saves retain immutable case, step, material and test-data revisions', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'testpilot-revisions-'));
  const previousDataDir = process.env.TESTPILOT_DATA_DIR;
  process.env.TESTPILOT_DATA_DIR = dataDir;
  const { saveDocumentProject, listDocumentProjectRevisions, getDocumentProjectRevision } = await import(`../dist/adapters/document-test-workflow.js?revision=${Date.now()}`);
  t.after(async () => {
    if (previousDataDir === undefined) delete process.env.TESTPILOT_DATA_DIR;
    else process.env.TESTPILOT_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const original = makeProject('history-project');
  await saveDocumentProject(original);
  const edited = structuredClone(original);
  edited.cases[0].title = 'Landing heading';
  edited.cases[0].expected = 'Updated title is visible';
  edited.cases[0].steps = [{ action: 'assertExactVisible', text: 'Updated title' }];
  edited.sourceText = 'Requirement version two';
  edited.sourceMaterials = [{ ...edited.sourceMaterials[0], sha256: 'b'.repeat(64), byteLength: 25 }];
  edited.testDataSets[0].values.scenario = 'beta';
  edited.testDataSets[0].updatedAt = '2026-10-22T00:00:00.000Z';
  edited.updatedAt = '2026-10-22T00:00:00.000Z';
  await saveDocumentProject(edited);
  await saveDocumentProject({ ...edited, reviewNotes: 'metadata-only save', updatedAt: '2026-10-23T00:00:00.000Z' });

  const cases = (await listDocumentProjectRevisions('history-project', { kind: 'case', entityId: 'landing-title' })).items;
  const steps = (await listDocumentProjectRevisions('history-project', { kind: 'steps', entityId: 'landing-title' })).items;
  const materials = (await listDocumentProjectRevisions('history-project', { kind: 'materials' })).items;
  const dataSets = (await listDocumentProjectRevisions('history-project', { kind: 'test-data', entityId: 'data-set-1' })).items;
  const caseSets = (await listDocumentProjectRevisions('history-project', { kind: 'case-set' })).items;
  assert.deepEqual(cases.map(item => item.version), [2, 1]);
  assert.deepEqual(steps.map(item => item.version), [2, 1]);
  assert.deepEqual(materials.map(item => item.version), [2, 1]);
  assert.deepEqual(dataSets.map(item => item.version), [2, 1]);
  assert.deepEqual(caseSets.map(item => item.version), [2, 1]);
  assert.equal((await listDocumentProjectRevisions('history-project', { kind: 'case', entityId: 'footer-link' })).items.length, 1, 'unchanged cases do not gain duplicate revisions');

  const oldCase = await getDocumentProjectRevision('history-project', cases[1].id);
  const newCase = await getDocumentProjectRevision('history-project', cases[0].id);
  const oldMaterials = await getDocumentProjectRevision('history-project', materials[1].id);
  const newMaterials = await getDocumentProjectRevision('history-project', materials[0].id);
  assert.equal(oldCase.snapshot.title, 'Landing title');
  assert.equal(newCase.snapshot.title, 'Landing heading');
  assert.deepEqual((await getDocumentProjectRevision('history-project', steps[0].id)).snapshot, edited.cases[0].steps);
  assert.equal(oldMaterials.snapshot.sourceText, 'Requirement version one');
  assert.equal(newMaterials.snapshot.sourceText, 'Requirement version two');
  assert.equal((await getDocumentProjectRevision('history-project', dataSets[0].id)).snapshot.values.scenario, 'beta');
  assert.equal(await getDocumentProjectRevision('another-project', cases[0].id), undefined, 'revision IDs cannot be read through another project');
});

test('legacy run snapshots seed revision history without rewriting old runs', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'testpilot-revision-migration-'));
  const previousDataDir = process.env.TESTPILOT_DATA_DIR;
  process.env.TESTPILOT_DATA_DIR = dataDir;
  const { saveDocumentProject, listDocumentProjectRevisions, getDocumentProjectRevision } = await import(`../dist/adapters/document-test-workflow.js?legacyRevision=${Date.now()}`);
  t.after(async () => {
    if (previousDataDir === undefined) delete process.env.TESTPILOT_DATA_DIR;
    else process.env.TESTPILOT_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const project = makeProject('legacy-project');
  await mkdir(join(dataDir, 'document-tests', 'projects'), { recursive: true });
  await writeFile(join(dataDir, 'document-tests', 'projects', 'legacy-project.json'), JSON.stringify(project));
  await mkdir(join(dataDir, 'document-tests', 'runs', 'old-run'), { recursive: true });
  const oldCase = makeCase('landing-title', 'Legacy title', [{ action: 'assertExactVisible', text: 'Legacy title' }]);
  const run = { id: 'old-run', projectId: project.id, startedAt: '2026-10-20T00:00:00.000Z', completedAt: '2026-10-20T00:01:00.000Z', materialVersion: 'legacy-material-version', sourceMaterialsSnapshot: project.sourceMaterials, caseSnapshots: [oldCase] };
  await writeFile(join(dataDir, 'document-tests', 'runs', 'old-run', 'run.json'), JSON.stringify(run));

  const updated = structuredClone(project);
  updated.cases[0].title = 'Current title';
  updated.cases[0].steps = [{ action: 'assertExactVisible', text: 'Current title' }];
  updated.updatedAt = '2026-10-22T00:00:00.000Z';
  await saveDocumentProject(updated);
  const revisions = (await listDocumentProjectRevisions(project.id, { kind: 'case', entityId: 'landing-title' })).items;
  assert.deepEqual(revisions.map(item => item.version), [3, 2, 1]);
  const legacyRevision = revisions.find(item => item.source === 'run-snapshot');
  assert.ok(legacyRevision);
  assert.equal((await getDocumentProjectRevision(project.id, legacyRevision.id)).snapshot.title, 'Legacy title');
  assert.equal((await getDocumentProjectRevision(project.id, revisions[0].id)).snapshot.title, 'Current title');
  assert.equal(JSON.parse(await readFile(join(dataDir, 'document-tests', 'runs', 'old-run', 'run.json'), 'utf8')).caseSnapshots[0].title, 'Legacy title', 'migration preserves the historical run file');
  const legacyMaterial = (await listDocumentProjectRevisions(project.id, { kind: 'materials' })).items.find(item => item.source === 'run-snapshot');
  assert.ok(legacyMaterial);
  assert.equal((await getDocumentProjectRevision(project.id, legacyMaterial.id)).snapshot.sourceTextAvailable, false, 'migration does not present current material text as if it were preserved by an old run');
});

test('original source files use immutable content-addressed storage keys', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'testpilot-material-storage-'));
  const previousDataDir = process.env.TESTPILOT_DATA_DIR;
  process.env.TESTPILOT_DATA_DIR = dataDir;
  const { saveDocumentProject, listDocumentProjectRevisions, getDocumentProjectRevision, writeDocumentSource } = await import(`../dist/adapters/document-test-workflow.js?materialStorage=${Date.now()}`);
  t.after(async () => {
    if (previousDataDir === undefined) delete process.env.TESTPILOT_DATA_DIR;
    else process.env.TESTPILOT_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const firstBytes = Buffer.from('# Requirements v1\nKeep original copy.');
  const first = makeProject('material-storage-project', {
    sourceText: 'Requirements v1',
    sourceMaterials: [{ id: 'material-v1', fileName: 'requirements.md', role: 'requirements', sha256: createHash('sha256').update(firstBytes).digest('hex'), byteLength: firstBytes.byteLength, createdAt: '2026-10-21T00:00:00.000Z' }],
  });
  await writeDocumentSource(first, firstBytes, 'requirements.md', 1);
  await saveDocumentProject(first);
  const firstRevision = (await listDocumentProjectRevisions(first.id, { kind: 'materials' })).items[0];
  const firstSnapshot = await getDocumentProjectRevision(first.id, firstRevision.id);
  const firstPath = join(dataDir, 'document-tests', 'projects', ...firstSnapshot.snapshot.sourceMaterials[0].storageKey.split('/'));
  assert.equal((await readFile(firstPath)).toString(), firstBytes.toString());

  const secondBytes = Buffer.from('# Requirements v2\nUpdated rules.');
  const second = structuredClone(first);
  second.sourceText = 'Requirements v2';
  second.sourceMaterials = [{ id: 'material-v2', fileName: 'requirements.md', role: 'requirements', sha256: createHash('sha256').update(secondBytes).digest('hex'), byteLength: secondBytes.byteLength, createdAt: '2026-10-22T00:00:00.000Z' }];
  second.updatedAt = '2026-10-22T00:00:00.000Z';
  await writeDocumentSource(second, secondBytes, 'requirements.md', 1);
  await saveDocumentProject(second);
  const revisions = (await listDocumentProjectRevisions(first.id, { kind: 'materials' })).items;
  const latest = await getDocumentProjectRevision(first.id, revisions[0].id);
  const secondPath = join(dataDir, 'document-tests', 'projects', ...latest.snapshot.sourceMaterials[0].storageKey.split('/'));
  assert.notEqual(secondPath, firstPath);
  assert.equal((await readFile(secondPath)).toString(), secondBytes.toString());
  assert.equal((await readFile(firstPath)).toString(), firstBytes.toString(), 'updating a material keeps the prior source file intact');
  await assert.rejects(writeDocumentSource(second, firstBytes, 'requirements.md', 1), /摘要不匹配/u);
});
