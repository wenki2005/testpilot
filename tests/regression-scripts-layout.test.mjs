import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMirror, safeCaseFile, sha256, slugify } from '../scripts/lib/regression-scripts-layout.mjs';

const readiness = (fixed) => ({ hasFixedSteps: fixed, coverageGap: '', detail: '', nextAction: '' });

function registry() {
  return {
    generatedAt: '2026-11-01T00:00:00.000Z',
    baseUrl: 'http://127.0.0.1:4319',
    systems: [{
      id: '11111111-1111-1111-1111-111111111111',
      name: '部门申样系统',
      modules: [
        {
          id: '22222222-2222-2222-2222-222222222222',
          name: '模块 A',
          archived: false,
          version: { id: '33333333-3333-3333-3333-333333333333', version: 1, digest: 'digest-a' },
          cases: [
            {
              id: 'xmind-17',
              title: '有步骤的用例',
              priority: 'P0',
              expected: '预期 A',
              source: '来源 A',
              modulePath: ['模块 A'],
              steps: [{ action: 'assertText', text: '小计' }],
              readiness: readiness(true),
            },
            {
              id: 'xmind-18',
              title: '没有步骤的用例',
              priority: 'P1',
              expected: '预期 B',
              source: '来源 B',
              modulePath: ['模块 A'],
              steps: [],
              readiness: readiness(false),
            },
          ],
        },
      ],
    }],
  };
}

test('slug and case file names are stable and filesystem-safe', () => {
  assert.equal(slugify('部门申样系统', 'fallback'), '部门申样系统');
  assert.equal(slugify('模块 A / 子模块', 'fallback'), '模块-A-子模块');
  assert.equal(slugify('...', 'abcdef12-0000'), 'item-abcdef12');
  assert.equal(safeCaseFile('xmind-17'), 'xmind-17.json');
  assert.equal(safeCaseFile('local/27'), 'local-27.json');
});

test('mirror exports one file per case and exposes no-step cases', () => {
  const { files, index } = buildMirror(registry());
  assert.equal(index.totals.systems, 1);
  assert.equal(index.totals.modules, 1);
  assert.equal(index.totals.cases, 2);
  assert.equal(index.totals.fixed, 1);
  assert.equal(index.totals.noSteps, 1);
  assert.ok(files.has('部门申样系统/模块-A/xmind-17.json'));
  assert.ok(files.has('部门申样系统/模块-A/xmind-18.json'));
  assert.ok(files.has('部门申样系统/模块-A/_module.json'));
  assert.ok(files.has('部门申样系统/_index.json'));
  assert.ok(files.has('_index.json'));
  const fixed = JSON.parse(files.get('部门申样系统/模块-A/xmind-17.json'));
  assert.equal(fixed.script.status, 'fixed');
  assert.equal(fixed.script.stepCount, 1);
  assert.equal(fixed.version.digest, 'digest-a');
  assert.equal(fixed.caseDigest, sha256({ id: 'xmind-17', expected: '预期 A', steps: [{ action: 'assertText', text: '小计' }] }));
  const empty = JSON.parse(files.get('部门申样系统/模块-A/xmind-18.json'));
  assert.equal(empty.script.status, 'no-steps');
  assert.equal(empty.script.stepCount, 0);
});

test('duplicate module and case names cannot overwrite each other', () => {
  const input = registry();
  const module = input.systems[0].modules[0];
  input.systems[0].modules.push({
    ...module,
    id: '44444444-4444-4444-4444-444444444444',
    cases: [{ ...module.cases[0], id: 'xmind-17' }],
  });
  const { index } = buildMirror(input);
  assert.equal(index.totals.modules, 2);
  assert.equal(index.totals.cases, 3);
  assert.equal(index.systems[0].fixed, 2);
});
