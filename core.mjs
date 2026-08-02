export class Rational {
  constructor(numerator, denominator = 1n) {
    let n = BigInt(numerator);
    let d = BigInt(denominator);
    if (d === 0n) throw new Error('Denominator cannot be zero.');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(absBigInt(n), d);
    this.n = n / g;
    this.d = d / g;
    Object.freeze(this);
  }

  static from(value) {
    if (value instanceof Rational) return value;
    if (typeof value === 'bigint' || Number.isInteger(value)) return new Rational(value);
    return Rational.parse(String(value));
  }

  static parse(text) {
    const raw = String(text).trim().replace(/\s+/g, '');
    if (!raw) throw new Error('Enter a number.');
    if (/^[+-]?\d+$/.test(raw)) return new Rational(BigInt(raw));
    const fraction = raw.match(/^([+-]?\d+)\/([+-]?\d+)$/);
    if (fraction) return new Rational(BigInt(fraction[1]), BigInt(fraction[2]));
    const decimal = raw.match(/^([+-]?)(\d*)\.(\d+)$/);
    if (decimal) {
      const sign = decimal[1] === '-' ? -1n : 1n;
      const digits = `${decimal[2] || '0'}${decimal[3]}`;
      const denominator = 10n ** BigInt(decimal[3].length);
      return new Rational(sign * BigInt(digits), denominator);
    }
    throw new Error('Use an integer, decimal, or fraction such as 3/2.');
  }

  add(other) {
    const r = Rational.from(other);
    return new Rational(this.n * r.d + r.n * this.d, this.d * r.d);
  }

  sub(other) {
    const r = Rational.from(other);
    return new Rational(this.n * r.d - r.n * this.d, this.d * r.d);
  }

  mul(other) {
    const r = Rational.from(other);
    return new Rational(this.n * r.n, this.d * r.d);
  }

  div(other) {
    const r = Rational.from(other);
    return new Rational(this.n * r.d, this.d * r.n);
  }

  neg() {
    return new Rational(-this.n, this.d);
  }

  equals(other) {
    const r = Rational.from(other);
    return this.n === r.n && this.d === r.d;
  }

  toNumber() {
    return Number(this.n) / Number(this.d);
  }

  toString() {
    return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`;
  }

  toJSON() {
    return this.toString();
  }
}

function absBigInt(n) {
  return n < 0n ? -n : n;
}

function gcd(a, b) {
  let x = a;
  let y = b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x === 0n ? 1n : x;
}

export function finite(value) {
  return Object.freeze({ kind: 'finite', value: Rational.from(value) });
}

export const POS_INF = Object.freeze({ kind: 'posInf' });
export const NEG_INF = Object.freeze({ kind: 'negInf' });
export const DNE = Object.freeze({ kind: 'dne' });

export function choice(value) {
  return Object.freeze({ kind: 'choice', value });
}

export function answersEqual(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'finite') return a.value.equals(b.value);
  if (a.kind === 'choice') return a.value === b.value;
  return true;
}

export function answerKey(answer) {
  if (answer.kind === 'finite') return `finite:${answer.value}`;
  if (answer.kind === 'choice') return `choice:${answer.value}`;
  return answer.kind;
}

export function answerText(answer) {
  switch (answer.kind) {
    case 'finite': return answer.value.toString();
    case 'posInf': return '+∞';
    case 'negInf': return '−∞';
    case 'dne': return 'DNE';
    case 'choice': return answer.value;
    default: throw new Error(`Unknown answer kind: ${answer.kind}`);
  }
}

export function parseLimitAnswer(text) {
  const normalized = String(text)
    .trim()
    .toLowerCase()
    .replace(/\u2212/g, '-')
    .replace(/\s+/g, '');

  if (!normalized) throw new Error('Enter an answer.');
  if (['dne', 'doesnotexist', 'undefined', 'doesn\'texist'].includes(normalized)) return DNE;
  if (['∞', '+∞', 'infinity', '+infinity', 'inf', '+inf'].includes(normalized)) return POS_INF;
  if (['-∞', '-infinity', '-inf'].includes(normalized)) return NEG_INF;
  return finite(Rational.parse(normalized));
}

export function seedFromString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(text).length; i += 1) {
    h ^= String(text).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 0x9e3779b9;
}

export class RNG {
  constructor(seed) {
    this.state = (typeof seed === 'number' ? seed : seedFromString(seed)) >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }

  int(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  bool(probability = 0.5) {
    return this.next() < probability;
  }

  pick(items) {
    if (!items.length) throw new Error('Cannot choose from an empty array.');
    return items[this.int(0, items.length - 1)];
  }

  shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

export const DEFAULT_CONFIG = Object.freeze({
  difficulty: 1,
  questionTypes: {
    functionValue: true,
    oneSided: true,
    twoSided: true,
    continuity: true,
    classification: true,
  },
  features: {
    continuous: true,
    removable: true,
    jump: true,
    infinite: true,
    oscillatory: true,
  },
});

export function normalizeConfig(config = {}) {
  const merged = {
    difficulty: clampInteger(config.difficulty ?? DEFAULT_CONFIG.difficulty, 1, 3),
    questionTypes: { ...DEFAULT_CONFIG.questionTypes, ...(config.questionTypes || {}) },
    features: { ...DEFAULT_CONFIG.features, ...(config.features || {}) },
  };
  if (!Object.values(merged.questionTypes).some(Boolean)) merged.questionTypes.oneSided = true;
  if (!Object.values(merged.features).some(Boolean)) merged.features.continuous = true;
  return merged;
}

function clampInteger(value, min, max) {
  const n = Math.round(Number(value));
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

function niceRational(rng, difficulty, min = -4, max = 4) {
  if (difficulty === 1 || rng.bool(0.7)) return new Rational(rng.int(min, max));
  const denominator = 2;
  let numerator = rng.int(min * denominator, max * denominator);
  if (numerator === 0 && rng.bool(0.5)) numerator = rng.pick([-1, 1]);
  return new Rational(numerator, denominator);
}

function distinctRational(rng, from, difficulty, min = -4, max = 4) {
  let candidate;
  do candidate = niceRational(rng, difficulty, min, max);
  while (candidate.equals(from));
  return candidate;
}

function polynomialBranch(side, a, limit, rng, difficulty) {
  const slopeChoices = difficulty === 1 ? [-2, -1, 1, 2] : [-3, -2, -1, 1, 2, 3];
  const curvatureChoices = difficulty === 1 ? [0, 0, 0, 1, -1] : [0, 0, 1, -1, 2, -2];
  const slope = rng.pick(slopeChoices);
  const curvature = rng.pick(curvatureChoices);
  return {
    kind: 'polynomial',
    side,
    a,
    limit: finite(limit),
    slope,
    curvature,
    eval(x) {
      const dx = x - a;
      return limit.toNumber() + slope * dx + 0.25 * curvature * dx * dx;
    },
  };
}

function infiniteBranch(side, a, target, rng, difficulty) {
  const power = difficulty === 1 ? rng.pick([1, 2]) : rng.pick([1, 1, 2, 3]);
  const scale = difficulty === 3 ? rng.pick([1, 1, 2]) : 1;
  const sign = target === 'posInf' ? 1 : -1;
  return {
    kind: 'infinite',
    side,
    a,
    power,
    scale,
    limit: target === 'posInf' ? POS_INF : NEG_INF,
    eval(x) {
      const distance = Math.max(Math.abs(x - a), 1e-8);
      return sign * scale / (distance ** power);
    },
  };
}

function oscillatoryBranch(side, a, rng, difficulty) {
  const amplitude = difficulty === 1 ? 2 : rng.pick([1.5, 2, 2.5]);
  const offset = difficulty === 1 ? 0 : rng.pick([-1, 0, 0, 1]);
  const frequency = difficulty === 3 ? rng.pick([1, 1, 2]) : 1;
  return {
    kind: 'oscillatory',
    side,
    a,
    amplitude,
    offset,
    frequency,
    limit: DNE,
    eval(x) {
      const distance = Math.max(Math.abs(x - a), 1e-8);
      return offset + amplitude * Math.sin(frequency / distance);
    },
  };
}

function chooseA(rng, difficulty) {
  const choices = difficulty === 1 ? [-2, -1, 0, 1, 2] : [-3, -2, -1, 0, 1, 2, 3];
  return rng.pick(choices);
}

function polynomialValueAt(branch, x) {
  const xValue = Rational.from(x);
  const dx = xValue.sub(new Rational(branch.a));
  return branch.limit.value
    .add(dx.mul(branch.slope))
    .add(dx.mul(dx).mul(branch.curvature).div(4));
}

function finiteSalientValues(scene) {
  const values = [];
  for (const answer of [scene.left.limit, scene.right.limit]) {
    if (answer.kind === 'finite') values.push(answer.value);
  }
  if (scene.value !== null) values.push(scene.value);
  return values.filter((value, index) => values.findIndex((candidate) => candidate.equals(value)) === index);
}

function makeDistractor(scene, xValue, desiredValue, purpose, rng) {
  const x = Rational.from(xValue);
  const xNumber = x.toNumber();
  if (Math.abs(xNumber - scene.aNumber) < 1.5) return null;
  if (xNumber <= scene.xRange.min + 0.65 || xNumber >= scene.xRange.max - 0.65) return null;

  const branch = xNumber < scene.aNumber ? scene.left : scene.right;
  const exactHoleValue = branch.kind === 'polynomial' ? polynomialValueAt(branch, x) : null;
  const holeY = exactHoleValue ? exactHoleValue.toNumber() : branch.eval(xNumber);
  if (!Number.isFinite(holeY) || holeY <= scene.yRange.min + 0.7 || holeY >= scene.yRange.max - 0.7) return null;

  let value = Rational.from(desiredValue);
  let resolvedPurpose = purpose;
  if (Math.abs(value.toNumber() - holeY) < 0.85) {
    const alternatives = rng.shuffle([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
    const replacement = alternatives.find((candidate) => Math.abs(candidate - holeY) >= 1.25);
    if (replacement === undefined) return null;
    value = new Rational(replacement);
    if (resolvedPurpose === 'coordinate-swap') resolvedPurpose = 'secondary-feature';
  }

  return {
    kind: 'removablePoint',
    purpose: resolvedPurpose,
    x,
    xNumber,
    holeValue: exactHoleValue,
    holeY,
    value,
  };
}

function buildDistractors(scene, rng) {
  const shouldAdd = rng.bool(scene.difficulty === 1 ? 0.78 : 0.9);
  if (!shouldAdd) return [];
  const requestedCount = scene.difficulty === 1 ? 1 : rng.pick([1, 1, 1, 2]);
  const distractors = [];

  const readableSalientValues = finiteSalientValues(scene).filter((value) => {
    if (scene.difficulty === 1 && value.d !== 1n) return false;
    const x = value.toNumber();
    return Math.abs(x - scene.aNumber) >= 1.5
      && x > scene.xRange.min + 0.65
      && x < scene.xRange.max - 0.65;
  });

  for (const value of rng.shuffle(readableSalientValues)) {
    if (distractors.length >= requestedCount) break;
    const distractor = makeDistractor(scene, value, scene.a, 'coordinate-swap', rng);
    if (distractor && !distractors.some((item) => item.x.equals(distractor.x))) distractors.push(distractor);
  }

  const offsetCandidates = rng.shuffle([-5, -4, -3, -2, 2, 3, 4, 5]);
  for (const offset of offsetCandidates) {
    if (distractors.length >= requestedCount) break;
    const x = new Rational(scene.aNumber + offset);
    if (distractors.some((item) => item.x.equals(x))) continue;
    const distractor = makeDistractor(scene, x, scene.a, 'secondary-feature', rng);
    if (distractor) distractors.push(distractor);
  }

  return distractors;
}

function constructScene(seed, config) {
  const rng = new RNG(seed);
  const difficulty = config.difficulty;
  const enabledFeatures = Object.entries(config.features).filter(([, on]) => on).map(([name]) => name);
  let feature = rng.pick(enabledFeatures);

  // Infinite scenes include both matching and mismatching one-sided behavior.
  if (feature === 'infinite') {
    feature = rng.pick(['infiniteSame', 'infiniteOpposite', 'infiniteMixed']);
  }

  const a = chooseA(rng, difficulty);
  let left;
  let right;
  let value = null;

  switch (feature) {
    case 'continuous': {
      const limit = niceRational(rng, difficulty, -3, 3);
      left = polynomialBranch('left', a, limit, rng, difficulty);
      right = polynomialBranch('right', a, limit, rng, difficulty);
      value = limit;
      break;
    }
    case 'removable': {
      const limit = niceRational(rng, difficulty, -3, 3);
      left = polynomialBranch('left', a, limit, rng, difficulty);
      right = polynomialBranch('right', a, limit, rng, difficulty);
      value = rng.bool(0.45) ? null : distinctRational(rng, limit, difficulty, -4, 4);
      break;
    }
    case 'jump': {
      const leftLimit = niceRational(rng, difficulty, -3, 3);
      const rightLimit = distinctRational(rng, leftLimit, difficulty, -3, 3);
      left = polynomialBranch('left', a, leftLimit, rng, difficulty);
      right = polynomialBranch('right', a, rightLimit, rng, difficulty);
      value = rng.pick([leftLimit, rightLimit, null, distinctRational(rng, leftLimit, difficulty, -4, 4)]);
      if (value && value.equals(rightLimit) && value.equals(leftLimit)) value = null;
      break;
    }
    case 'infiniteSame': {
      const target = rng.bool() ? 'posInf' : 'negInf';
      left = infiniteBranch('left', a, target, rng, difficulty);
      right = infiniteBranch('right', a, target, rng, difficulty);
      value = rng.bool(0.25) ? niceRational(rng, difficulty, -3, 3) : null;
      break;
    }
    case 'infiniteOpposite': {
      const leftTarget = rng.bool() ? 'posInf' : 'negInf';
      const rightTarget = leftTarget === 'posInf' ? 'negInf' : 'posInf';
      left = infiniteBranch('left', a, leftTarget, rng, difficulty);
      right = infiniteBranch('right', a, rightTarget, rng, difficulty);
      value = rng.bool(0.2) ? niceRational(rng, difficulty, -3, 3) : null;
      break;
    }
    case 'infiniteMixed': {
      const infiniteOnLeft = rng.bool();
      const target = rng.bool() ? 'posInf' : 'negInf';
      const finiteLimit = niceRational(rng, difficulty, -3, 3);
      left = infiniteOnLeft
        ? infiniteBranch('left', a, target, rng, difficulty)
        : polynomialBranch('left', a, finiteLimit, rng, difficulty);
      right = infiniteOnLeft
        ? polynomialBranch('right', a, finiteLimit, rng, difficulty)
        : infiniteBranch('right', a, target, rng, difficulty);
      value = rng.bool(0.25) ? niceRational(rng, difficulty, -3, 3) : null;
      break;
    }
    case 'oscillatory': {
      const oscillatesLeft = rng.bool(0.65);
      const oscillatesRight = rng.bool(0.65);
      const atLeastOne = oscillatesLeft || oscillatesRight;
      const leftOsc = atLeastOne ? oscillatesLeft : true;
      const rightOsc = atLeastOne ? oscillatesRight : false;
      const finiteLimit = niceRational(rng, difficulty, -2, 2);
      left = leftOsc
        ? oscillatoryBranch('left', a, rng, difficulty)
        : polynomialBranch('left', a, finiteLimit, rng, difficulty);
      right = rightOsc
        ? oscillatoryBranch('right', a, rng, difficulty)
        : polynomialBranch('right', a, finiteLimit, rng, difficulty);
      value = rng.bool(0.25) ? niceRational(rng, difficulty, -3, 3) : null;
      break;
    }
    default:
      throw new Error(`Unsupported feature: ${feature}`);
  }

  const scene = {
    seed: String(seed),
    feature,
    difficulty,
    a: new Rational(a),
    aNumber: a,
    left,
    right,
    value,
    xRange: { min: a - 6, max: a + 6 },
    yRange: { min: -6, max: 6 },
  };

  scene.twoSidedLimit = twoSidedLimit(scene);
  scene.isContinuous = isContinuous(scene);
  scene.classification = classifyScene(scene);
  scene.distractors = buildDistractors(scene, rng);
  return scene;
}

export function twoSidedLimit(scene) {
  const left = scene.left.limit;
  const right = scene.right.limit;
  if (answersEqual(left, right)) return left;
  return DNE;
}

export function isContinuous(scene) {
  return scene.value !== null
    && scene.twoSidedLimit.kind === 'finite'
    && scene.value.equals(scene.twoSidedLimit.value);
}

export function classifyScene(scene) {
  if (isContinuous(scene)) return 'continuous';
  if (scene.left.kind === 'oscillatory' || scene.right.kind === 'oscillatory') return 'oscillatory';
  if (scene.left.limit.kind === 'finite' && scene.right.limit.kind === 'finite') {
    return answersEqual(scene.left.limit, scene.right.limit) ? 'removable' : 'jump';
  }
  return 'infinite';
}

const CLASSIFICATION_LABELS = Object.freeze({
  continuous: 'continuous',
  removable: 'removable discontinuity',
  jump: 'jump discontinuity',
  infinite: 'infinite discontinuity',
  oscillatory: 'oscillatory discontinuity',
});

export function classificationLabel(key) {
  return CLASSIFICATION_LABELS[key] || key;
}

function availableQuestionTypes(config) {
  const result = [];
  if (config.questionTypes.functionValue) result.push('functionValue');
  if (config.questionTypes.oneSided) result.push('leftLimit', 'rightLimit');
  if (config.questionTypes.twoSided) result.push('twoSidedLimit');
  if (config.questionTypes.continuity) result.push('continuity');
  if (config.questionTypes.classification) result.push('classification');
  return result;
}

export function buildQuestion(scene, config, rng = new RNG(`${scene.seed}:question`)) {
  const type = rng.pick(availableQuestionTypes(config));
  const a = scene.a;
  const common = {
    id: `${scene.seed}:${type}`,
    type,
    a,
    sceneSeed: scene.seed,
  };

  switch (type) {
    case 'functionValue':
      return {
        ...common,
        skill: 'function-value',
        answer: scene.value === null ? DNE : finite(scene.value),
        inputMode: 'limit',
      };
    case 'leftLimit':
      return {
        ...common,
        skill: `left-limit:${scene.left.kind}`,
        answer: scene.left.limit,
        inputMode: 'limit',
        side: 'left',
      };
    case 'rightLimit':
      return {
        ...common,
        skill: `right-limit:${scene.right.kind}`,
        answer: scene.right.limit,
        inputMode: 'limit',
        side: 'right',
      };
    case 'twoSidedLimit':
      return {
        ...common,
        skill: `two-sided:${scene.classification}`,
        answer: scene.twoSidedLimit,
        inputMode: 'limit',
        side: 'both',
      };
    case 'continuity':
      return {
        ...common,
        skill: `continuity:${scene.classification}`,
        answer: choice(scene.isContinuous ? 'yes' : 'no'),
        inputMode: 'choice',
        choices: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      };
    case 'classification':
      return {
        ...common,
        skill: `classification:${scene.classification}`,
        answer: choice(scene.classification),
        inputMode: 'choice',
        choices: rng.shuffle([
          { value: 'continuous', label: 'Continuous' },
          { value: 'removable', label: 'Removable' },
          { value: 'jump', label: 'Jump' },
          { value: 'infinite', label: 'Infinite' },
          { value: 'oscillatory', label: 'Oscillatory' },
        ]),
      };
    default:
      throw new Error(`Unknown question type: ${type}`);
  }
}

export function generateProblem(seed, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const scene = constructScene(seed, config);
  const question = buildQuestion(scene, config);
  return { seed: String(seed), config, scene, question };
}

export function mathQuestionDescription(question) {
  switch (question.type) {
    case 'functionValue': return `Find f(${question.a}).`;
    case 'leftLimit': return `Find the left-hand limit as x approaches ${question.a}.`;
    case 'rightLimit': return `Find the right-hand limit as x approaches ${question.a}.`;
    case 'twoSidedLimit': return `Find the two-sided limit as x approaches ${question.a}.`;
    case 'continuity': return `Is f continuous at x = ${question.a}?`;
    case 'classification': return `Classify the behavior of f at x = ${question.a}.`;
    default: return 'Answer the question.';
  }
}

export function diagnoseWrongAnswer(problem, submitted) {
  const { scene, question } = problem;
  const correct = question.answer;

  if (question.inputMode === 'choice') {
    if (question.type === 'continuity') {
      if (!scene.value && submitted.value === 'yes') {
        return 'The function is not defined at the point, so it cannot be continuous there.';
      }
      if (scene.twoSidedLimit.kind !== 'finite' && submitted.value === 'yes') {
        return 'Continuity requires a finite two-sided limit that equals the function value.';
      }
      if (scene.twoSidedLimit.kind === 'finite' && scene.value && !scene.value.equals(scene.twoSidedLimit.value)) {
        return 'The nearby values approach a finite number, but the function value is different.';
      }
      return 'Compare the function value with the behavior from both sides.';
    }
    if (question.type === 'classification') {
      if (submitted.value === 'jump' && scene.left.limit.kind === 'finite' && scene.right.limit.kind === 'finite') {
        return 'A jump requires different finite left- and right-hand limits.';
      }
      if (submitted.value === 'removable') {
        return 'A removable discontinuity requires the same finite limit from both sides.';
      }
      if (submitted.value === 'infinite') {
        return 'An infinite discontinuity has values that grow without bound near the point.';
      }
      if (submitted.value === 'oscillatory') {
        return 'Oscillatory behavior repeatedly visits different y-values instead of settling.';
      }
      return 'Compare both one-sided limits and the function value.';
    }
  }

  if (question.type === 'functionValue' && submitted.kind === 'finite') {
    const matchesNearbyLimit = [scene.left.limit, scene.right.limit]
      .some((limit) => limit.kind === 'finite' && submitted.value.equals(limit.value));
    if (matchesNearbyLimit && (scene.value === null || !submitted.value.equals(scene.value))) {
      return 'You entered a nearby limiting value. The function value is determined only by the filled point.';
    }
  }

  if (question.type !== 'functionValue' && scene.value !== null && submitted.kind === 'finite' && submitted.value.equals(scene.value)) {
    return 'You entered the function value. A limit asks what nearby values approach.';
  }

  if (question.type === 'twoSidedLimit') {
    if (answersEqual(submitted, scene.left.limit) && !answersEqual(scene.left.limit, scene.right.limit)) {
      return 'That is the left-hand behavior. A two-sided limit also requires agreement from the right.';
    }
    if (answersEqual(submitted, scene.right.limit) && !answersEqual(scene.left.limit, scene.right.limit)) {
      return 'That is the right-hand behavior. A two-sided limit also requires agreement from the left.';
    }
  }

  if (question.type === 'leftLimit' && answersEqual(submitted, scene.right.limit) && !answersEqual(scene.left.limit, scene.right.limit)) {
    return 'You read the branch on the right. Approach the marked x-value from smaller x-values.';
  }
  if (question.type === 'rightLimit' && answersEqual(submitted, scene.left.limit) && !answersEqual(scene.left.limit, scene.right.limit)) {
    return 'You read the branch on the left. Approach the marked x-value from larger x-values.';
  }

  if ((correct.kind === 'posInf' || correct.kind === 'negInf') && submitted.kind === 'dne') {
    return 'The values do not approach a finite number, but they do grow without bound in one direction.';
  }
  if (correct.kind === 'posInf' && submitted.kind === 'negInf') {
    return 'Check whether the graph rises or falls as it approaches the point.';
  }
  if (correct.kind === 'negInf' && submitted.kind === 'posInf') {
    return 'Check whether the graph rises or falls as it approaches the point.';
  }
  if (correct.kind === 'dne' && (submitted.kind === 'posInf' || submitted.kind === 'negInf')) {
    return 'For a two-sided limit, both sides must have the same behavior—including the same infinity sign.';
  }

  if (question.type === 'functionValue' && correct.kind === 'dne') {
    return 'Look for a filled point at the marked x-value. An open circle is not a function value.';
  }

  return 'Focus only on the branch or point named in the question.';
}

export function explanationText(problem) {
  const { scene, question } = problem;
  const a = scene.a.toString();
  const answer = answerText(question.answer);
  switch (question.type) {
    case 'functionValue':
      return question.answer.kind === 'dne'
        ? `There is no filled point at x = ${a}, so f(${a}) is undefined.`
        : `The filled point at x = ${a} has y-coordinate ${answer}, so f(${a}) = ${answer}.`;
    case 'leftLimit':
      return `As x approaches ${a} from the left, the graph's y-values approach ${answer}.`;
    case 'rightLimit':
      return `As x approaches ${a} from the right, the graph's y-values approach ${answer}.`;
    case 'twoSidedLimit':
      if (question.answer.kind === 'dne') {
        return `The left- and right-hand behaviors do not settle at the same value, so the two-sided limit does not exist.`;
      }
      return `Both sides approach ${answer}, so the two-sided limit is ${answer}.`;
    case 'continuity':
      return scene.isContinuous
        ? `The two-sided limit exists and equals f(${a}), so f is continuous at x = ${a}.`
        : `Continuity fails because the two-sided limit, the function value, and their equality do not all hold.`;
    case 'classification':
      return `The behavior at x = ${a} is classified as ${classificationLabel(scene.classification)}.`;
    default:
      return `The answer is ${answer}.`;
  }
}

export function serializeProblem(problem) {
  const { scene, question } = problem;
  return {
    seed: problem.seed,
    feature: scene.feature,
    classification: scene.classification,
    a: scene.a.toString(),
    value: scene.value?.toString() ?? null,
    leftLimit: answerText(scene.left.limit),
    rightLimit: answerText(scene.right.limit),
    twoSidedLimit: answerText(scene.twoSidedLimit),
    distractors: scene.distractors.map((item) => ({
      purpose: item.purpose,
      x: item.x.toString(),
      holeY: item.holeValue?.toString() ?? Number(item.holeY.toFixed(4)),
      value: item.value.toString(),
    })),
    questionType: question.type,
    expected: answerText(question.answer),
  };
}
