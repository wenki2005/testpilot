import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuantity } from '../quantity.mjs';

test('QTY-001: valid integers including 1000 and 9999 remain unchanged',()=>{
  for(const quantity of [1,999,1000,9999])assert.equal(normalizeQuantity(quantity),quantity);
});
test('QTY-002: zero, negatives, fractions and nonnumeric strings return null',()=>{
  for(const value of [0,-1,1.5,'not-a-number'])assert.equal(normalizeQuantity(value),null);
});
