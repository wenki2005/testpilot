import test from 'node:test';
import assert from 'node:assert/strict';
import { profileIsOwned } from '../../scripts/lib/test-browser-processes.mjs';

test('browser cleanup requires an actual profile inside this run, not a path substring', () => {
  const roots = ['D:\\qa\\run-123'];
  assert.equal(profileIsOwned('msedge --user-data-dir="D:\\qa\\run-123\\profile one"', roots), true);
  assert.equal(profileIsOwned('msedge --user-data-dir=D:\\qa\\run-123-other\\profile', roots), false);
  assert.equal(profileIsOwned('msedge --log-file=D:\\qa\\run-123\\log --user-data-dir=D:\\real\\profile', roots), false);
  assert.equal(profileIsOwned('msedge --user-data-dir=D:\\qa\\run-123\\..\\real', roots), false);
  assert.equal(profileIsOwned('msedge --user-data-dir=D:\\qa\\run-123', roots), false);
});
