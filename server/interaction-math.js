const MAX_NUMBER = 1e12;
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_NUMBER;
const vector = value => Array.isArray(value) && value.length >= 2 && value.length <= 8 && value.every(finite);
const dot = (a, b) => {
  if (!vector(a) || !vector(b) || a.length !== b.length) throw new Error('向量维度不匹配。');
  return a.reduce((sum, item, index) => sum + item * b[index], 0);
};
const length = a => Math.sqrt(dot(a, a));
const pairwise = (a, b, fn) => {
  dot(a, b);
  return a.map((item, index) => fn(item, b[index]));
};
const bounds = (a, b, minimum, maximum) => {
  if (!vector(a) || !vector(b) || a.length !== 4 || b.length !== 4) throw new Error('需要两个矩形。');
  return [minimum(a[0], b[0]), minimum(a[1], b[1]), maximum(a[2], b[2]), maximum(a[3], b[3])];
};
const unary = fn => [1, fn];
const binary = fn => [2, fn];
const scalar = fn => binary((a, b) => {
  if (!finite(a) || !finite(b)) throw new Error('需要两个数值。');
  return fn(a, b);
});
const operations = {
  add: scalar((a, b) => a + b), sub: scalar((a, b) => a - b), mul: scalar((a, b) => a * b),
  div: scalar((a, b) => a / b), pow: scalar(Math.pow), min: scalar(Math.min), max: scalar(Math.max),
  sqrt: unary(a => finite(a) ? Math.sqrt(a) : NaN), abs: unary(a => finite(a) ? Math.abs(a) : NaN),
  vec: binary((a, b) => [a, b]), dot: binary(dot), norm: unary(length),
  plus: binary((a, b) => pairwise(a, b, (x, y) => x + y)),
  minus: binary((a, b) => pairwise(a, b, (x, y) => x - y)),
  distance: binary((a, b) => length(pairwise(a, b, (x, y) => x - y))),
  scale: binary((a, b) => vector(a) && finite(b) ? a.map(x => x * b) : NaN),
  normalize: unary(a => { const n = length(a); return a.map(x => x / n); }),
  project: binary((a, b) => { const k = dot(a, b) / dot(b, b); return b.map(x => x * k); }),
  matvec: binary((a, b) => Array.isArray(a) && a.length >= 2 && a.length <= 4 ? a.map(row => dot(row, b)) : NaN),
  index: binary((a, b) => Number.isInteger(b) && vector(a) ? a[b] : NaN),
  softmax: unary(a => {
    if (!vector(a)) throw new Error('Softmax 需要一个数值向量。');
    const peak = Math.max(...a);
    const terms = a.map(x => Math.exp(x - peak));
    const sum = terms.reduce((total, item) => total + item, 0);
    return terms.map(x => x / sum);
  }),
  rectangle: binary((a, b) => {
    if (!vector(a) || !vector(b) || a.length !== 2 || b.length !== 2) return NaN;
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }),
  intersection: binary((a, b) => bounds(a, b, Math.max, Math.min)),
  enclosure: binary((a, b) => bounds(a, b, Math.min, Math.max)),
  area: unary(a => vector(a) && a.length === 4 ? Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]) : NaN),
};

function evaluate(expression, variables, budget, depth = 0) {
  if (--budget.remaining < 0 || depth > 12) throw new Error('演算表达式超出范围。');
  if (finite(expression)) return expression;
  if (typeof expression === 'string' && variables.has(expression)) return variables.get(expression);
  if (!Array.isArray(expression) || expression.length < 1 || expression.length > 8) throw new Error('未知变量或运算。');
  const known = typeof expression[0] === 'string' && Object.hasOwn(operations, expression[0]);
  const args = (known ? expression.slice(1) : expression).map(item => evaluate(item, variables, budget, depth + 1));
  if (!known) {
    if (typeof expression[0] === 'string' && !variables.has(expression[0])) throw new Error('未知变量或运算。');
    return args;
  }
  const [arity, call] = operations[expression[0]];
  if (args.length !== arity) throw new Error('运算参数数量不正确。');
  const result = call(...args);
  if (!finite(result) && !vector(result)) throw new Error('此输入超出公式定义域。');
  return result;
}

export function solveDemo(demo, input = {}) {
  const values = new Map(demo.inputs.map(item => {
    const value = Object.hasOwn(input, item.id) ? input[item.id] : item.value;
    if (!finite(value) || value < item.min || value > item.max) throw new Error('输入超出允许范围。');
    return [item.id, value];
  }));
  const budget = { remaining: 500 };
  for (const step of demo.steps) {
    try { values.set(step.id, evaluate(step.expr, values, budget)); }
    catch (error) { throw new Error(step.id + '：' + error.message); }
  }
  return Object.fromEntries(values);
}

export const demoOperations = Object.keys(operations).join('、');
