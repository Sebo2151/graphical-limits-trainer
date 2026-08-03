import {
  DEFAULT_CONFIG as POINT_DEFAULT_CONFIG,
  DNE,
  NEG_INF,
  POS_INF,
  RNG,
  Rational,
  answerKey,
  answerText,
  answersEqual,
  choice,
  classificationLabel,
  diagnoseWrongAnswer as diagnosePointAnswer,
  explanationText as pointExplanationText,
  finite,
  generateProblem as generatePointProblem,
  mathQuestionDescription as pointQuestionDescription,
  normalizeConfig as normalizePointConfig,
  parseLimitAnswer,
  serializeProblem as serializePointProblem,
} from './core.mjs';

// Answer handling is deliberately not reimplemented here. The point parser already
// normalizes the Unicode minus sign and interior whitespace, and a second copy drifted out
// of step with it.
export {
  DNE, NEG_INF, POS_INF, RNG, Rational, answerText, answersEqual, choice, classificationLabel,
  finite, parseLimitAnswer,
};

export const PRESETS = Object.freeze({
  functionValues: {
    label: 'Reading Function Values',
    families: { point: true, atInfinity: false, limitLaws: false, composition: false },
    questionTypes: { functionValue: true, oneSided: false, twoSided: false, continuity: false, classification: false },
  },
  oneSided: {
    label: 'One-Sided Limits',
    families: { point: true, atInfinity: false, limitLaws: false, composition: false },
    questionTypes: { functionValue: false, oneSided: true, twoSided: false, continuity: false, classification: false },
  },
  twoSided: {
    label: 'Two-Sided Limits',
    families: { point: true, atInfinity: false, limitLaws: false, composition: false },
    questionTypes: { functionValue: false, oneSided: false, twoSided: true, continuity: false, classification: false },
  },
  infinite: {
    label: 'Infinite Limits',
    families: { point: true, atInfinity: false, limitLaws: false, composition: false },
    questionTypes: { functionValue: false, oneSided: true, twoSided: true, continuity: false, classification: false },
    features: { continuous: false, removable: false, jump: false, infinite: true, oscillatory: false },
  },
  atInfinity: {
    label: 'Limits at Infinity',
    families: { point: false, atInfinity: true, limitLaws: false, composition: false },
  },
  continuity: {
    label: 'Continuity',
    families: { point: true, atInfinity: false, limitLaws: false, composition: false },
    questionTypes: { functionValue: false, oneSided: false, twoSided: false, continuity: true, classification: true },
  },
  limitLaws: {
    label: 'Limit Laws',
    families: { point: false, atInfinity: false, limitLaws: true, composition: false },
  },
  composition: {
    label: 'Composition',
    families: { point: false, atInfinity: false, limitLaws: false, composition: true },
  },
  examReview: {
    label: 'Exam 1 Review',
    families: { point: true, atInfinity: true, limitLaws: true, composition: true },
  },
  weakAreas: {
    label: 'Practice My Weak Areas',
    families: { point: true, atInfinity: true, limitLaws: true, composition: true },
    practiceMode: 'weak',
  },
});

export const DEFAULT_CONFIG = Object.freeze({
  ...POINT_DEFAULT_CONFIG,
  preset: 'examReview',
  practiceMode: 'mixed',
  families: Object.freeze({ point: true, atInfinity: true, limitLaws: true, composition: true }),
});

export function normalizeConfig(raw = {}) {
  const point = normalizePointConfig(raw);
  const families = { ...DEFAULT_CONFIG.families, ...(raw.families || {}) };
  if (!Object.values(families).some(Boolean)) families.point = true;
  return {
    ...point,
    preset: PRESETS[raw.preset] ? raw.preset : 'custom',
    practiceMode: raw.practiceMode === 'weak' ? 'weak' : 'mixed',
    families,
    targetSkill: typeof raw.targetSkill === 'string' ? raw.targetSkill : null,
  };
}

export function configForPreset(name, current = DEFAULT_CONFIG) {
  const preset = PRESETS[name] || PRESETS.examReview;
  return normalizeConfig({
    ...current,
    preset: name,
    practiceMode: preset.practiceMode || 'mixed',
    families: preset.families || current.families,
    questionTypes: preset.questionTypes || POINT_DEFAULT_CONFIG.questionTypes,
    features: preset.features || POINT_DEFAULT_CONFIG.features,
  });
}

function enabledFamilies(config) {
  const target = config.targetSkill || '';
  if (target.startsWith('at-infinity')) return ['atInfinity'];
  if (target.startsWith('limit-law')) return ['limitLaws'];
  if (target.startsWith('composition')) return ['composition'];
  if (target && /^(function-value|left-limit|right-limit|two-sided|continuity|classification)/.test(target)) return ['point'];
  return Object.entries(config.families).filter(([, on]) => on).map(([name]) => name);
}

export function generateProblem(seed, rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const family = new RNG(`${seed}:family`).pick(enabledFamilies(config));
  if (family === 'atInfinity') return generateAtInfinity(seed, config);
  if (family === 'limitLaws') return generateLimitLaw(seed, config);
  if (family === 'composition') return generateComposition(seed, config);
  const point = generatePointProblem(seed, pointConfigForTarget(config));
  alignPointSideWithTarget(point, config.targetSkill);
  return {
    ...point,
    config,
    family: 'point',
    panels: [{ key: 'f', label: 'f', type: 'single', scene: point.scene }],
  };
}

function alignPointSideWithTarget(point, targetSkill) {
  const category = (targetSkill || '').split(':')[0];
  if (category !== 'left-limit' && category !== 'right-limit') return;
  const side = category === 'left-limit' ? 'left' : 'right';
  const branch = point.scene[side];
  point.question = {
    id: `${point.seed}:${side}Limit`,
    type: `${side}Limit`,
    a: point.scene.a,
    sceneSeed: point.scene.seed,
    skill: `${side}-limit:${branch.kind}`,
    answer: branch.limit,
    inputMode: 'limit',
    side,
  };
}

function pointConfigForTarget(config) {
  const target = config.targetSkill || '';
  const [category, detail] = target.split(':');
  const questionMap = {
    'function-value': 'functionValue',
    'left-limit': 'oneSided',
    'right-limit': 'oneSided',
    'two-sided': 'twoSided',
    continuity: 'continuity',
    classification: 'classification',
  };
  if (!questionMap[category]) return config;
  const questionTypes = Object.fromEntries(Object.keys(POINT_DEFAULT_CONFIG.questionTypes).map((key) => [key, false]));
  questionTypes[questionMap[category]] = true;
  const targeted = { ...config, questionTypes };
  const featureMap = {
    continuous: 'continuous', removable: 'removable', jump: 'jump',
    infinite: 'infinite', oscillatory: 'oscillatory',
  };
  if (featureMap[detail]) {
    targeted.features = Object.fromEntries(Object.keys(POINT_DEFAULT_CONFIG.features).map((key) => [key, key === featureMap[detail]]));
  } else if (detail === 'polynomial') {
    targeted.features = {
      continuous: true, removable: true, jump: true, infinite: false, oscillatory: false,
    };
  }
  return targeted;
}

function rational(rng, difficulty, min = -3, max = 3, nonzero = false) {
  let value;
  do {
    if (difficulty > 1 && rng.bool(0.28)) value = new Rational(rng.int(min * 2, max * 2), 2);
    else value = new Rational(rng.int(min, max));
  } while (nonzero && value.n === 0n);
  return value;
}

function localBranch(side, a, limit, options = {}) {
  if (limit.kind === 'posInf' || limit.kind === 'negInf') {
    const sign = limit.kind === 'posInf' ? 1 : -1;
    return {
      kind: 'infinite', side, a, limit, power: options.power || 1, scale: options.scale || 1,
      eval(x) { return sign * this.scale / Math.max(Math.abs(x - a), 1e-8) ** this.power; },
    };
  }
  if (limit.kind === 'dne') {
    return {
      kind: 'oscillatory', side, a, limit: DNE, amplitude: 2, offset: 0, frequency: 1,
      eval(x) { return this.offset + this.amplitude * Math.sin(this.frequency / Math.max(Math.abs(x - a), 1e-8)); },
    };
  }
  const direction = options.approachDirection || (side === 'left' ? -1 : 1);
  const slope = options.slope ?? (direction * (side === 'left' ? -1 : 1));
  const curvature = options.curvature || 0;
  return {
    kind: 'polynomial', side, a, limit, slope, curvature,
    eval(x) {
      const dx = x - a;
      if (options.approachDirection) return limit.value.toNumber() + direction * Math.abs(dx) + 0.12 * curvature * dx * dx;
      return limit.value.toNumber() + slope * dx + 0.25 * curvature * dx * dx;
    },
  };
}

function classifyLocal(scene) {
  if (scene.value && scene.left.limit.kind === 'finite' && answersEqual(scene.left.limit, scene.right.limit)
    && scene.value.equals(scene.left.limit.value)) return 'continuous';
  if (scene.left.kind === 'oscillatory' || scene.right.kind === 'oscillatory') return 'oscillatory';
  if (scene.left.limit.kind === 'finite' && scene.right.limit.kind === 'finite') {
    return answersEqual(scene.left.limit, scene.right.limit) ? 'removable' : 'jump';
  }
  return 'infinite';
}

function localScene(seed, a, leftLimit, rightLimit, options = {}) {
  const left = localBranch('left', a, leftLimit, options.left || {});
  const right = localBranch('right', a, rightLimit, options.right || {});
  const twoSidedLimit = answersEqual(leftLimit, rightLimit) ? leftLimit : DNE;
  const scene = {
    seed: String(seed), feature: options.feature || 'advanced', difficulty: options.difficulty || 1,
    a: new Rational(a), aNumber: Number(a), left, right, value: options.value ?? null,
    xRange: options.xRange || { min: Number(a) - 5, max: Number(a) + 5 },
    yRange: options.yRange || { min: -6, max: 6 }, twoSidedLimit, distractors: options.distractors || [],
    hideEndpointMarkers: Boolean(options.hideEndpointMarkers),
    axisStep: options.axisStep || ((options.difficulty || 1) >= 2
      && new RNG(`${seed}:axis-scale`).bool((options.difficulty || 1) === 3 ? 0.45 : 0.18) ? 0.5 : 1),
  };
  scene.classification = classifyLocal(scene);
  scene.isContinuous = scene.classification === 'continuous';
  return scene;
}

function endBranch(side, rng, difficulty, requestedLimit = null) {
  const limit = requestedLimit || rng.pick([finite(rational(rng, difficulty, -3, 3)), POS_INF, NEG_INF]);
  const power = difficulty === 1 ? 1 : rng.pick([1, 1, 2, 3]);
  const amplitudes = limit.kind === 'finite'
    ? [-3, -2, 2, 3].filter((candidate) => Math.abs(limit.value.toNumber() + candidate) <= 5.4)
    : [-3, -2, 2, 3];
  const amplitude = rng.pick(amplitudes);
  return {
    kind: 'end', side, a: 0, limit, endLimit: limit, power, amplitude,
    eval(x) {
      const distance = Math.abs(x) + 1;
      if (limit.kind === 'finite') return limit.value.toNumber() + amplitude / distance;
      const sign = limit.kind === 'posInf' ? 1 : -1;
      return sign * (0.16 * distance ** power + Math.abs(amplitude) * 0.3);
    },
  };
}

function generateAtInfinity(seed, config) {
  const rng = new RNG(`${seed}:at-infinity`);
  const target = (config.targetSkill || '').split(':');
  const direction = target[1] === 'left' ? -1 : target[1] === 'right' ? 1 : rng.bool() ? 1 : -1;
  const requested = target[2] === 'finite' ? finite(rational(rng, config.difficulty, -3, 3))
    : target[2] === 'posInf' ? POS_INF
      : target[2] === 'negInf' ? NEG_INF
        : config.difficulty === 1 && rng.bool(0.65) ? finite(rational(rng, config.difficulty, -3, 3)) : null;
  const left = endBranch('left', rng, config.difficulty, direction < 0 ? requested : null);
  const right = endBranch('right', rng, config.difficulty, direction > 0 ? requested : null);
  const scene = localScene(`${seed}:end`, 0, left.limit, right.limit, {
    difficulty: config.difficulty, feature: 'endBehavior',
    xRange: { min: -8, max: 8 }, yRange: { min: -6, max: 6 },
  });
  scene.left = left;
  scene.right = right;
  scene.endLimits = { left: left.endLimit, right: right.endLimit };
  scene.breakpoint = {
    xNumber: 0,
    closedSide: rng.bool() ? 'left' : 'right',
    leftY: left.eval(0),
    rightY: right.eval(0),
  };
  const answer = direction < 0 ? left.endLimit : right.endLimit;
  const sideName = direction < 0 ? 'left' : 'right';
  const question = {
    id: `${seed}:limitAtInfinity`, type: 'limitAtInfinity', family: 'atInfinity',
    direction, answer, inputMode: 'limit', side: sideName,
    skill: `at-infinity:${sideName}:${answer.kind}`, misconceptions: ['x-y-swap', 'infinity-sign'],
  };
  return { seed: String(seed), config, family: 'atInfinity', scene, question,
    panels: [{ key: 'f', label: 'f', type: 'single', scene }] };
}

const OP_LABELS = Object.freeze({ add: '+', subtract: '\u2212', scale: '', product: '\u00b7', quotient: '/' });

function finiteOperation(op, fValue, gValue, scalar = null) {
  if (op === 'add') return finite(fValue.add(gValue));
  if (op === 'subtract') return finite(fValue.sub(gValue));
  if (op === 'product') return finite(fValue.mul(gValue));
  if (op === 'quotient') return finite(fValue.div(gValue));
  return finite(fValue.mul(scalar));
}

function generateLimitLaw(seed, config) {
  const rng = new RNG(`${seed}:limit-law`);
  const difficulty = config.difficulty;
  // There is deliberately no "the law is inconclusive" case. That idea only makes sense when
  // the limits are given as facts and the graphs are withheld; once both graphs are on
  // screen the combined limit is always determined by them. Every construction of it here
  // also had a provable answer — with lim g finite, lim f nonexistent forces lim (f+g) to
  // not exist — so a student answering DNE was correct and was marked wrong.
  const cases = difficulty === 1
    ? ['finite', 'finite', 'finite']
    : difficulty === 2
      ? ['finite', 'finite', 'zeroDenominator']
      : ['finite', 'zeroDenominator', 'cancellation'];
  const target = (config.targetSkill || '').split(':');
  const requestedCase = ['finite', 'zeroDenominator', 'cancellation'].includes(target[1]) ? target[1] : null;
  const caseType = requestedCase || rng.pick(cases);
  const a = rng.int(-2, 2);
  let operation = ['add', 'subtract', 'scale', 'product', 'quotient'].includes(target[2])
    ? target[2]
    : rng.pick(['add', 'subtract', 'scale', 'product', 'quotient']);
  let scalar = null;
  let fScene;
  let gScene;
  let answer;
  let combinedSideLimits;

  if (caseType === 'finite') {
    const fValue = rational(rng, difficulty, -3, 3);
    let gValue = rational(rng, difficulty, -3, 3);
    if (operation === 'quotient' && gValue.n === 0n) gValue = new Rational(rng.bool() ? 1 : -1);
    scalar = operation === 'scale' ? new Rational(rng.pick([-3, -2, 2, 3])) : null;
    fScene = localScene(`${seed}:f`, a, finite(fValue), finite(fValue), {
      difficulty, value: fValue, left: { slope: rng.pick([-2, -1, 1, 2]) }, right: { slope: rng.pick([-2, -1, 1, 2]) },
    });
    gScene = localScene(`${seed}:g`, a, finite(gValue), finite(gValue), {
      difficulty, value: gValue, left: { slope: rng.pick([-2, -1, 1, 2]) }, right: { slope: rng.pick([-2, -1, 1, 2]) },
    });
    answer = finiteOperation(operation, fValue, gValue, scalar);
    combinedSideLimits = { left: answer, right: answer };
  } else if (caseType === 'zeroDenominator') {
    operation = 'quotient';
    const numerator = rational(rng, difficulty, -3, 3, true);
    const sameSign = rng.bool();
    const denominatorDirections = sameSign ? [1, 1] : [-1, 1];
    fScene = localScene(`${seed}:f`, a, finite(numerator), finite(numerator), { difficulty, value: numerator });
    gScene = localScene(`${seed}:g`, a, finite(0), finite(0), {
      difficulty, value: null,
      left: { approachDirection: denominatorDirections[0] },
      right: { approachDirection: denominatorDirections[1] },
    });
    const quotientSide = (denominatorSign) => (numerator.n > 0n) === (denominatorSign > 0) ? POS_INF : NEG_INF;
    combinedSideLimits = {
      left: quotientSide(denominatorDirections[0]),
      right: quotientSide(denominatorDirections[1]),
    };
    answer = answersEqual(combinedSideLimits.left, combinedSideLimits.right) ? combinedSideLimits.left : DNE;
  } else {
    operation = 'add';
    const left = rational(rng, difficulty, -3, 0);
    const right = rational(rng, difficulty, 1, 4);
    fScene = localScene(`${seed}:f`, a, finite(left), finite(right), { difficulty, value: null });
    gScene = localScene(`${seed}:g`, a, finite(left.neg()), finite(right.neg()), {
      difficulty, value: null, left: { slope: -1 }, right: { slope: -1 },
    });
    answer = finite(0);
    combinedSideLimits = { left: finite(0), right: finite(0) };
  }

  gScene.xRange = { ...fScene.xRange };
  gScene.yRange = { ...fScene.yRange };
  const question = {
    id: `${seed}:limitLaw`, type: 'limitLaw', family: 'limitLaws', a: new Rational(a),
    answer, inputMode: 'limit', side: 'both', operation, scalar, caseType,
    combinedSideLimits,
    skill: `limit-law:${caseType}:${operation}`,
    misconceptions: ['quotient-zero', 'operation-error'],
  };
  return {
    seed: String(seed), config, family: 'limitLaws', scene: fScene, question,
    panels: [{ key: 'fg', label: 'f and g', type: 'overlay', scenes: [
      { key: 'f', label: 'f', scene: fScene }, { key: 'g', label: 'g', scene: gScene },
    ] }],
  };
}

function constantScene(seed, center, value, difficulty) {
  const limit = finite(value);
  return localScene(seed, center, limit, limit, {
    difficulty, value, left: { slope: 0 }, right: { slope: 0 },
    xRange: { min: center - 5, max: center + 5 },
  });
}

function generateComposition(seed, config) {
  const rng = new RNG(`${seed}:composition`);
  const difficulty = config.difficulty;
  const cases = difficulty === 1
    ? ['direct', 'direct', 'oneSided']
    : difficulty === 2
      ? ['direct', 'oneSided', 'splitDirections']
      : ['oneSided', 'splitDirections', 'innerDneOuterExists'];
  const target = (config.targetSkill || '').split(':');
  const requestedCase = ['direct', 'oneSided', 'splitDirections', 'innerDneOuterExists'].includes(target[1]) ? target[1] : null;
  const caseType = requestedCase || rng.pick(cases);
  const a = rng.int(-2, 2);
  const b = rng.int(-2, 2);
  let inner;
  let outer;
  let answer;
  let innerDirection = 'both';

  if (caseType === 'direct') {
    const c = rational(rng, difficulty, -3, 3);
    inner = localScene(`${seed}:g`, a, finite(b), finite(b), {
      difficulty, value: new Rational(b), left: { slope: -1 }, right: { slope: 1 },
    });
    outer = localScene(`${seed}:f`, b, finite(c), finite(c), {
      difficulty, value: c, left: { slope: rng.pick([-2, -1, 1]) }, right: { slope: rng.pick([-1, 1, 2]) },
    });
    answer = finite(c);
  } else if (caseType === 'oneSided') {
    innerDirection = rng.bool() ? 'left' : 'right';
    const leftOuter = rational(rng, difficulty, -3, 0);
    const rightOuter = rational(rng, difficulty, 1, 4);
    const sign = innerDirection === 'left' ? -1 : 1;
    inner = localScene(`${seed}:g`, a, finite(b), finite(b), {
      difficulty, value: new Rational(b),
      left: { approachDirection: sign }, right: { approachDirection: sign },
    });
    outer = localScene(`${seed}:f`, b, finite(leftOuter), finite(rightOuter), { difficulty, value: null });
    answer = finite(innerDirection === 'left' ? leftOuter : rightOuter);
  } else if (caseType === 'splitDirections') {
    const leftOuter = rational(rng, difficulty, -3, 0);
    const rightOuter = rational(rng, difficulty, 1, 4);
    inner = localScene(`${seed}:g`, a, finite(b), finite(b), {
      difficulty, value: new Rational(b),
      left: { approachDirection: -1 }, right: { approachDirection: 1 },
    });
    outer = localScene(`${seed}:f`, b, finite(leftOuter), finite(rightOuter), { difficulty, value: null });
    answer = DNE;
    innerDirection = 'split';
  } else {
    const bLeft = rng.int(-3, -1);
    const bRight = rng.int(1, 3);
    const c = rational(rng, difficulty, -2, 2);
    inner = localScene(`${seed}:g`, a, finite(bLeft), finite(bRight), { difficulty, value: null });
    outer = constantScene(`${seed}:f`, 0, c, difficulty);
    answer = finite(c);
    innerDirection = 'none';
  }

  const question = {
    id: `${seed}:composition`, type: 'composition', family: 'composition', a: new Rational(a),
    answer, inputMode: 'limit', side: 'both', caseType, innerDirection,
    innerLimit: inner.twoSidedLimit, outerInput: new Rational(b),
    skill: `composition:${caseType}`, misconceptions: ['composition-direction', 'inner-outer-swap', 'direct-substitution'],
  };
  return {
    seed: String(seed), config, family: 'composition', scene: inner, question,
    panels: [
      { key: 'g', label: 'Inner function g', type: 'single', scene: inner },
      { key: 'f', label: 'Outer function f', type: 'single', scene: outer },
    ],
  };
}

function operationText(question) {
  if (question.operation === 'scale') {
    const scalar = question.scalar.toString().replace('-', '−');
    return `${question.scalar.n < 0n ? `(${scalar})` : scalar}f(x)`;
  }
  if (question.operation === 'product') return 'f(x)g(x)';
  if (question.operation === 'quotient') return 'f(x)/g(x)';
  return `f(x) ${OP_LABELS[question.operation]} g(x)`;
}

// "Apply the add law" is not what these are called.
const LAW_NAMES = Object.freeze({
  add: 'sum', subtract: 'difference', scale: 'constant-multiple', product: 'product', quotient: 'quotient',
});

export function mathQuestionDescription(question) {
  if (question.type === 'limitAtInfinity') {
    return `Find the limit of f(x) as x approaches ${question.direction < 0 ? 'negative infinity' : 'positive infinity'}.`;
  }
  if (question.type === 'limitLaw') {
    return `Find the limit as x approaches ${question.a} of ${operationText(question)}.`;
  }
  if (question.type === 'composition') return `Find the limit as x approaches ${question.a} of f(g(x)).`;
  return pointQuestionDescription(question);
}

export function questionPrompt(question) {
  if (question.type === 'limitAtInfinity') return 'Trace the end of the graph in the direction x is moving.';
  if (question.type === 'limitLaw') return 'Read the constituent behavior first, then apply the indicated operation.';
  if (question.type === 'composition') return 'First follow g(x), including its approach direction, then use that input on f.';
  return '';
}

export function diagnoseSubmission(problem, submitted) {
  if (problem.family === 'point') {
    const message = diagnosePointAnswer(problem, submitted);
    let misconception = 'graph-reading';
    if (/function value/.test(message)) misconception = 'function-value-vs-limit';
    else if (/branch on the right|branch on the left/.test(message)) misconception = 'wrong-one-sided-branch';
    else if (/rises or falls|infinity sign/.test(message)) misconception = 'infinity-sign';
    return { message, misconception };
  }

  const correct = problem.question.answer;
  if (problem.question.type === 'limitLaw' && problem.question.caseType === 'zeroDenominator') {
    return { misconception: 'quotient-zero', message: 'A denominator tending to zero blocks the quotient law. Read its sign from each side before deciding between an infinite limit and DNE.' };
  }
  if ((correct.kind === 'posInf' || correct.kind === 'negInf') && submitted.kind === 'dne') {
    return { misconception: 'infinity-vs-dne', message: 'The values grow without bound in one consistent direction, so the infinity sign carries information that DNE would discard.' };
  }
  if (problem.question.type === 'composition') {
    if (problem.question.innerDirection === 'left' || problem.question.innerDirection === 'right') {
      return { misconception: 'composition-direction', message: `Although g(x) tends to ${problem.question.outerInput}, it approaches that input from the ${problem.question.innerDirection}. Read that one-sided behavior on f.` };
    }
    if (problem.question.innerDirection === 'split') {
      return { misconception: 'composition-direction', message: 'The two sides of g(x) feed different sides of f. Compare those two outer one-sided limits.' };
    }
    return { misconception: 'direct-substitution', message: 'The inner limit need not exist when both sets of inner outputs are sent by f toward the same value.' };
  }
  if (problem.question.type === 'limitAtInfinity') {
    return { misconception: submitted.kind === 'finite' ? 'x-y-swap' : 'infinity-sign', message: 'Follow the requested end of the graph: x moves horizontally without bound while the y-values determine the answer.' };
  }
  return { misconception: 'operation-error', message: 'Read each constituent limit separately, then apply the operation to those limiting values.' };
}

export function diagnoseWrongAnswer(problem, submitted) {
  return diagnoseSubmission(problem, submitted).message;
}

export function explanationText(problem) {
  if (problem.family === 'point') return pointExplanationText(problem);
  const { question } = problem;
  if (question.type === 'limitAtInfinity') {
    const direction = question.direction < 0 ? 'left' : 'right';
    if (question.answer.kind === 'finite') return `Along the ${direction} end, the graph levels off at y = ${answerText(question.answer)}.`;
    const motion = question.answer.kind === 'posInf' ? 'increase' : 'decrease';
    return `Along the ${direction} end, the y-values ${motion} without bound.`;
  }
  if (question.type === 'limitLaw') {
    if (question.caseType === 'cancellation') {
      return `Neither constituent two-sided limit exists, but the left-hand sum is 0 and the right-hand sum is also 0. The combined one-sided limits agree, so the sum has limit ${answerText(question.answer)}.`;
    }
    if (question.caseType === 'zeroDenominator') {
      const opening = 'The quotient law does not apply because g(x) tends to 0.';
      if (question.answer.kind === 'dne') {
        return `${opening} The denominator changes sign at that point, so the quotient increases without bound on one side and decreases without bound on the other, and the two-sided limit does not exist.`;
      }
      const motion = question.answer.kind === 'posInf' ? 'increases' : 'decreases';
      return `${opening} The denominator keeps one sign on both sides, so the quotient ${motion} without bound and the limit is ${answerText(question.answer)}.`;
    }
    return `Apply the ${LAW_NAMES[question.operation]} law from the left and from the right. Both combined one-sided limits are ${answerText(question.answer)}, so the two-sided limit is ${answerText(question.answer)}.`;
  }
  if (question.type === 'composition') {
    if (question.caseType === 'innerDneOuterExists') {
      return `The inner function has no limit, but all of its nearby outputs land on a constant part of f. Therefore f(g(x)) tends to ${answerText(question.answer)}.`;
    }
    if (question.innerDirection === 'split') {
      return 'The two sides of g(x) approach the same input from opposite directions, and the corresponding one-sided limits of f differ, so the composition limit does not exist.';
    }
    if (question.innerDirection === 'left' || question.innerDirection === 'right') {
      return `g(x) approaches ${question.outerInput} from the ${question.innerDirection}, so use that one-sided limit of f. The composition limit is ${answerText(question.answer)}.`;
    }
    return `g(x) approaches ${question.outerInput}, where f is continuous, so the composition limit is ${answerText(question.answer)}.`;
  }
  return `The answer is ${answerText(question.answer)}.`;
}

export function serializeProblem(problem) {
  if (problem.family === 'point') return { family: 'point', ...serializePointProblem(problem) };
  return {
    seed: problem.seed,
    family: problem.family,
    questionType: problem.question.type,
    caseType: problem.question.caseType || null,
    skill: problem.question.skill,
    expected: answerText(problem.question.answer),
    panels: problem.panels.map((panel) => ({ key: panel.key, label: panel.label, type: panel.type })),
  };
}

export function answerIdentity(answer) {
  return answerKey(answer);
}
