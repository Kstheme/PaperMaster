import test from 'node:test';
import assert from 'node:assert/strict';
import { solveDemo } from '../server/interaction-math.js';

test('recomputes overlap and the enclosing area when a rectangle moves', () => {
  const demo = { inputs: [{ id: 'x', min: 0, max: 6, value: 1 }], steps: [
    { id: 'a', expr: ['rectangle', [0, 0], [2, 2]] },
    { id: 'b', expr: ['rectangle', ['x', 0], [['add', 'x', 2], 2]] },
    { id: 'overlap', expr: ['area', ['intersection', 'a', 'b']] },
    { id: 'union', expr: ['sub', ['add', ['area', 'a'], ['area', 'b']], 'overlap'] },
    { id: 'enclosing', expr: ['area', ['enclosure', 'a', 'b']] },
    { id: 'giou', expr: ['sub', ['div', 'overlap', 'union'], ['div', ['sub', 'enclosing', 'union'], 'enclosing']] },
  ] };
  assert.equal(solveDemo(demo).giou, 1 / 3);
  assert.equal(solveDemo(demo, { x: 2 }).giou, 0);
  assert.ok(solveDemo(demo, { x: 3 }).giou < 0);
  assert.throws(() => solveDemo(demo, { x: 9 }), /输入超出/);
});

test('rejects unknown operators and reports undefined math', () => {
  const base = { inputs: [{ id: 'x', min: 0, max: 2, value: 0 }] };
  assert.throws(() => solveDemo({ ...base, steps: [{ id: 'o', expr: ['constructor', 'x'] }] }), /未知/);
  assert.throws(() => solveDemo({ ...base, steps: [{ id: 'o', expr: ['div', 1, 'x'] }] }), /定义域/);
});
