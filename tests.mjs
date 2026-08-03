import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DNE,
  NEG_INF,
  POS_INF,
  Rational,
  answerText,
  answersEqual,
  choice,
  diagnoseWrongAnswer,
  explanationText,
  generateProblem,
  normalizeConfig,
  parseLimitAnswer,
  serializeProblem,
} from './core.mjs';
import {
  answerText as advancedAnswerText,
  diagnoseSubmission,
  explanationText as advancedExplanationText,
  generateProblem as generateAdvancedProblem,
  mathQuestionDescription as advancedQuestionDescription,
  normalizeConfig as normalizeAdvancedConfig,
  parseLimitAnswer as advancedParseLimitAnswer,
  serializeProblem as serializeAdvancedProblem,
} from './advanced.mjs';

const CLASSIFICATIONS = ['continuous', 'removable', 'jump', 'infinite', 'oscillatory'];

function testRationalArithmetic() {
  assert.equal(new Rational(2n, 4n).toString(), '1/2');
  assert.equal(new Rational(-6n, -8n).toString(), '3/4');
  assert.equal(Rational.parse('1.25').toString(), '5/4');
  assert.equal(Rational.parse('-0.5').toString(), '-1/2');
  assert.equal(Rational.parse('6/8').toString(), '3/4');
  assert(new Rational(1, 3).add(new Rational(1, 6)).equals(new Rational(1, 2)));
}

function testAnswerParser() {
  assert(answersEqual(parseLimitAnswer('+infinity'), POS_INF));
  assert(answersEqual(parseLimitAnswer('-∞'), NEG_INF));
  assert(answersEqual(parseLimitAnswer('does not exist'), DNE));
  assert.equal(answerText(parseLimitAnswer('1.5')), '3/2');
}

function testConfigFallback() {
  const config = normalizeConfig({
    questionTypes: { functionValue: false, oneSided: false, twoSided: false, continuity: false, classification: false },
    features: { continuous: false, removable: false, jump: false, infinite: false, oscillatory: false },
  });
  assert.equal(config.questionTypes.oneSided, true);
  assert.equal(config.features.continuous, true);
}

function testGeneratedProblems() {
  const configs = [1, 2, 3].map((difficulty) => ({
    difficulty,
    questionTypes: { functionValue: true, oneSided: true, twoSided: true, continuity: true, classification: true },
    features: { continuous: true, removable: true, jump: true, infinite: true, oscillatory: true },
  }));

  const seenFeatures = new Set();
  const seenQuestions = new Set();
  let scenesWithDistractors = 0;
  let coordinateSwapScenes = 0;
  for (const config of configs) {
    for (let i = 0; i < 2500; i += 1) {
      const problem = generateProblem(`test-${config.difficulty}-${i}`, config);
      const { scene, question } = problem;
      seenFeatures.add(scene.feature);
      seenQuestions.add(question.type);

      assert(scene.aNumber >= scene.xRange.min && scene.aNumber <= scene.xRange.max);
      assert(scene.value === null || scene.value instanceof Rational);
      assert(CLASSIFICATIONS.includes(scene.classification));
      assert(question.answer);
      assert.equal(problem.seed, `test-${config.difficulty}-${i}`);
      assert(Array.isArray(scene.distractors));

      if (scene.distractors.length) scenesWithDistractors += 1;
      if (scene.distractors.some((item) => item.purpose === 'coordinate-swap')) coordinateSwapScenes += 1;
      for (const distractor of scene.distractors) {
        assert(distractor.x instanceof Rational);
        assert(distractor.value instanceof Rational);
        assert(Math.abs(distractor.xNumber - scene.aNumber) >= 1.5);
        assert(distractor.xNumber > scene.xRange.min && distractor.xNumber < scene.xRange.max);
        assert(distractor.holeY > scene.yRange.min && distractor.holeY < scene.yRange.max);
        assert(distractor.value.toNumber() > scene.yRange.min && distractor.value.toNumber() < scene.yRange.max);

        // An open circle drawn off the grid, or off the curve it punctures, reads as a
        // drawing mistake rather than as a hole in the function.
        assert(distractor.holeValue instanceof Rational,
          'A distractor hole must sit at an exact height.');
        assert(scene.difficulty === 1 ? distractor.holeValue.d === 1n : distractor.holeValue.d <= 2n,
          `Hole at unreadable height ${distractor.holeValue} on difficulty ${scene.difficulty}.`);
        const holeBranch = distractor.xNumber < scene.aNumber ? scene.left : scene.right;
        assert(Math.abs(holeBranch.eval(distractor.xNumber) - distractor.holeValue.toNumber()) < 1e-9,
          'A distractor hole must lie exactly on the drawn curve.');

        if (distractor.purpose === 'coordinate-swap') {
          assert(distractor.value.equals(scene.a));
          const finiteValues = [scene.left.limit, scene.right.limit]
            .filter((answer) => answer.kind === 'finite')
            .map((answer) => answer.value);
          if (scene.value !== null) finiteValues.push(scene.value);
          assert(finiteValues.some((value) => value.equals(distractor.x)));
        }
      }

      assert(Array.isArray(scene.domainEndpoints));
      for (const endpoint of scene.domainEndpoints) {
        const branch = scene[endpoint.side];
        assert.equal(branch.domainOuter, endpoint.xNumber);
        assert(Math.abs(branch.eval(endpoint.xNumber) - endpoint.y) < 1e-9);
        assert(endpoint.xNumber > scene.xRange.min && endpoint.xNumber < scene.xRange.max);

        // A domain endpoint carries an open or filled circle, so it needs the same exact,
        // grid-readable height a distractor hole does.
        assert(endpoint.yValue instanceof Rational,
          'A domain endpoint must sit at an exact height.');
        assert(endpoint.yValue.d <= 2n,
          `Domain endpoint at unreadable height ${endpoint.yValue}.`);
        assert.equal(branch.kind, 'polynomial',
          'Only a polynomial branch can place a domain endpoint at a readable height.');
      }

      if (scene.classification === 'continuous') {
        assert.equal(scene.isContinuous, true);
        assert(scene.value !== null);
        assert.equal(scene.twoSidedLimit.kind, 'finite');
        assert(scene.value.equals(scene.twoSidedLimit.value));
      }
      if (scene.classification === 'removable') {
        assert.equal(scene.twoSidedLimit.kind, 'finite');
        assert(scene.value === null || !scene.value.equals(scene.twoSidedLimit.value));
      }
      if (scene.classification === 'jump') {
        assert.equal(scene.left.limit.kind, 'finite');
        assert.equal(scene.right.limit.kind, 'finite');
        assert(!answersEqual(scene.left.limit, scene.right.limit));
      }
      if (scene.classification === 'oscillatory') {
        assert(scene.left.kind === 'oscillatory' || scene.right.kind === 'oscillatory');
      }
      if (scene.twoSidedLimit.kind !== 'dne') {
        assert(answersEqual(scene.left.limit, scene.right.limit));
      }

      for (const branch of [scene.left, scene.right]) {
        if (branch.kind === 'polynomial') {
          const epsilon = 1e-7;
          const x = branch.side === 'left' ? scene.aNumber - epsilon : scene.aNumber + epsilon;
          assert(Math.abs(branch.eval(x) - branch.limit.value.toNumber()) < 1e-4);
        }
        if (branch.kind === 'infinite') {
          const xFar = branch.side === 'left' ? scene.aNumber - 0.5 : scene.aNumber + 0.5;
          const xNear = branch.side === 'left' ? scene.aNumber - 0.05 : scene.aNumber + 0.05;
          assert(Math.abs(branch.eval(xNear)) > Math.abs(branch.eval(xFar)));
          assert(Math.sign(branch.eval(xNear)) === (branch.limit.kind === 'posInf' ? 1 : -1));
        }
      }

      const summary = serializeProblem(problem);
      assert(summary.expected.length > 0);
    }
  }

  for (const expected of ['continuous', 'removable', 'jump', 'infiniteSame', 'infiniteOpposite', 'infiniteMixed', 'oscillatory']) {
    assert(seenFeatures.has(expected), `Expected generated feature ${expected}`);
  }
  for (const expected of ['functionValue', 'leftLimit', 'rightLimit', 'twoSidedLimit', 'continuity', 'classification']) {
    assert(seenQuestions.has(expected), `Expected generated question ${expected}`);
  }
  // Scenes whose branches are all infinite or oscillatory cannot carry a readable secondary
  // hole, so these rates are lower than they would be if unreadable holes were allowed.
  assert(scenesWithDistractors > 4200, 'Most generated scenes should contain a secondary salient feature.');
  assert(coordinateSwapScenes > 1000, 'Coordinate-swap distractors should occur regularly.');
}

// Only a finite limit is a value that y-values "approach". Saying they approach DNE, or
// approach +∞, models exactly the language this trainer exists to correct.
function testExplanationLanguage() {
  const seen = new Set();
  for (let difficulty = 1; difficulty <= 3; difficulty += 1) {
    for (let i = 0; i < 2000; i += 1) {
      const problem = generateProblem(`language-${difficulty}-${i}`, { difficulty });
      const { question, scene } = problem;
      const text = explanationText(problem);
      seen.add(`${question.type}:${question.answer.kind}`);

      assert(!/approach(es)? (DNE|\+∞|−∞|-∞)/.test(text),
        `An explanation treats a non-value as something the graph approaches: ${text}`);
      assert(!text.includes('DNE'),
        `Explanations should spell the reasoning out in prose rather than print DNE: ${text}`);

      if (['leftLimit', 'rightLimit', 'twoSidedLimit'].includes(question.type)) {
        if (question.answer.kind === 'dne') {
          assert(/does not exist/.test(text), `A nonexistent limit must say so: ${text}`);
        }
        if (question.answer.kind === 'posInf') {
          assert(/increases? without bound/.test(text), `+∞ must be described as unbounded growth: ${text}`);
        }
        if (question.answer.kind === 'negInf') {
          assert(/decreases? without bound/.test(text), `−∞ must be described as unbounded decrease: ${text}`);
        }
      }

      // A student who got continuity wrong needs to know which of the three conditions failed.
      if (question.type === 'continuity' && !scene.isContinuous) {
        const namesTheFailure = scene.value === null
          ? /undefined/.test(text)
          : /not a finite number/.test(text) || /but f\(/.test(text);
        assert(namesTheFailure, `A continuity failure must name the condition that fails: ${text}`);
      }
    }
  }

  for (const expected of [
    'leftLimit:dne', 'leftLimit:posInf', 'rightLimit:negInf',
    'twoSidedLimit:dne', 'twoSidedLimit:posInf', 'continuity:choice',
  ]) {
    assert(seen.has(expected), `Expected to exercise the ${expected} explanation.`);
  }
}

// Wrong-answer feedback is read against the graph in front of the student. Citing a
// requirement their scene already satisfies reads as agreement with the wrong answer.
function testClassificationDiagnosis() {
  const pairsSeen = new Set();

  for (let difficulty = 1; difficulty <= 3; difficulty += 1) {
    for (let i = 0; i < 1500; i += 1) {
      const problem = generateProblem(`classify-${difficulty}-${i}`, { difficulty });
      if (problem.question.type !== 'classification') continue;
      const { scene } = problem;
      const actual = scene.classification;
      const bothFinite = scene.left.limit.kind === 'finite' && scene.right.limit.kind === 'finite';
      const limitsAgree = answersEqual(scene.left.limit, scene.right.limit);

      for (const guess of CLASSIFICATIONS) {
        if (guess === actual) continue;
        const message = diagnoseWrongAnswer(problem, choice(guess));
        pairsSeen.add(`${actual}->${guess}`);

        assert(message.length > 0);
        assert(!/^Compare both one-sided limits/.test(message),
          `Classification feedback fell through to the generic message (${actual} -> ${guess}).`);

        if (guess === 'removable' && bothFinite && limitsAgree) {
          assert(/filled point/.test(message),
            'Telling a student that a removable discontinuity "requires the same finite limit from both '
            + `sides" confirms their wrong answer when the scene has exactly that: ${message}`);
        }
        if (guess === 'jump' && bothFinite) {
          assert(/same/.test(message),
            `A jump guess on agreeing limits must point out that they agree: ${message}`);
        }
        if (guess === 'jump' && !bothFinite) {
          assert(/finite/.test(message),
            `A jump guess on an unbounded side must mention the missing finiteness: ${message}`);
        }
        if (guess === 'continuous' && scene.value === null) {
          assert(/no filled point|undefined/.test(message),
            `An undefined f(a) is the simplest reason continuity fails and must be named: ${message}`);
        }
      }
    }
  }

  for (const expected of [
    'continuous->removable', 'continuous->jump', 'removable->continuous',
    'jump->removable', 'infinite->jump', 'oscillatory->removable',
  ]) {
    assert(pairsSeen.has(expected), `Expected to exercise the ${expected} misconception.`);
  }
}

function testContinuityDiagnosis() {
  const modes = new Set();

  for (let difficulty = 1; difficulty <= 3; difficulty += 1) {
    for (let i = 0; i < 1500; i += 1) {
      const problem = generateProblem(`continuity-${difficulty}-${i}`, { difficulty });
      if (problem.question.type !== 'continuity') continue;
      const { scene } = problem;
      const message = diagnoseWrongAnswer(problem, choice(scene.isContinuous ? 'no' : 'yes'));

      if (scene.isContinuous) {
        modes.add('falseNegative');
        assert(/all three conditions hold/i.test(message),
          `Someone who said "no" about a continuous graph should be told all three conditions hold: ${message}`);
      } else if (scene.value === null) {
        modes.add('undefined');
        assert(/no filled point/.test(message) && /undefined/.test(message), message);
      } else if (scene.twoSidedLimit.kind !== 'finite') {
        modes.add('unbounded');
        assert(/finite two-sided limit/.test(message), message);
      } else {
        modes.add('mismatch');
        assert(/different height/.test(message), message);
      }
    }
  }

  for (const mode of ['falseNegative', 'undefined', 'unbounded', 'mismatch']) {
    assert(modes.has(mode), `Expected to exercise the ${mode} continuity failure.`);
  }
}

// Locating x = a on the axis is part of reading a graph. If the window is always centred on
// it, that step disappears from every problem.
function testGraphFraming() {
  const offsets = new Set();
  for (let difficulty = 1; difficulty <= 3; difficulty += 1) {
    for (let i = 0; i < 1500; i += 1) {
      const { scene } = generateProblem(`framing-${difficulty}-${i}`, { difficulty });
      const leftRoom = scene.aNumber - scene.xRange.min;
      const rightRoom = scene.xRange.max - scene.aNumber;
      offsets.add(leftRoom);

      assert(leftRoom >= 3.5 && rightRoom >= 3.5,
        `The tested x-value needs curve on both sides (left ${leftRoom}, right ${rightRoom}).`);
      // The explanation animation reads y-values back against the y-axis, so it must stay
      // comfortably on screen whatever the framing.
      assert(scene.xRange.min <= -2 && scene.xRange.max >= 2,
        `The y-axis must stay inside the frame (${scene.xRange.min} to ${scene.xRange.max}).`);
    }
  }
  assert(offsets.size >= 3,
    'The graph window must not sit at the same offset from x = a in every problem.');
}

// This trainer states an unbounded two-sided limit as +∞ or −∞ rather than reporting it as
// DNE. That is a course-level convention, so it is pinned here along with the requirement
// that rejecting DNE explains itself rather than just marking the student wrong.
function testTwoSidedInfinityConvention() {
  let checked = 0;
  for (let i = 0; i < 4000 && checked < 50; i += 1) {
    const problem = generateProblem(`convention-${i}`, { difficulty: 2 });
    const { question } = problem;
    if (question.type !== 'twoSidedLimit') continue;
    if (question.answer.kind !== 'posInf' && question.answer.kind !== 'negInf') continue;
    checked += 1;

    assert(!answersEqual(DNE, question.answer),
      'DNE must not be accepted for an unbounded two-sided limit under this convention.');
    assert(/without bound/.test(diagnoseWrongAnswer(problem, DNE)),
      'Rejecting DNE must explain that the values grow without bound.');
  }
  assert(checked > 0, 'Expected some unbounded two-sided limits in the sample.');
}

function familyConfig(family, difficulty) {
  return {
    difficulty,
    families: {
      point: family === 'point',
      atInfinity: family === 'atInfinity',
      limitLaws: family === 'limitLaws',
      composition: family === 'composition',
    },
  };
}

function testAdvancedFamilies() {
  const seen = {
    atInfinity: new Set(),
    limitLaws: new Set(),
    composition: new Set(),
  };

  for (const family of Object.keys(seen)) {
    for (let difficulty = 1; difficulty <= 3; difficulty += 1) {
      for (let i = 0; i < 1400; i += 1) {
        const seed = `advanced-${family}-${difficulty}-${i}`;
        const config = familyConfig(family, difficulty);
        const problem = generateAdvancedProblem(seed, config);
        const duplicate = generateAdvancedProblem(seed, config);
        assert.equal(problem.family, family);
        assert.equal(problem.seed, seed);
        assert(problem.question.answer);
        assert(problem.panels.length >= 1);
        assert.equal(
          JSON.stringify(serializeAdvancedProblem(problem)),
          JSON.stringify(serializeAdvancedProblem(duplicate)),
          'Advanced generation must remain deterministic.',
        );
        assert(advancedAnswerText(problem.question.answer).length > 0);
        assert(advancedExplanationText(problem).length > 20);
        assert(advancedQuestionDescription(problem.question).length > 20);

        if (family === 'atInfinity') {
          seen.atInfinity.add(problem.question.answer.kind);
          const expected = problem.question.direction < 0
            ? problem.scene.endLimits.left
            : problem.scene.endLimits.right;
          assert(answersEqual(problem.question.answer, expected));
          assert.equal(problem.scene.feature, 'endBehavior');
          assert(['left', 'right'].includes(problem.scene.breakpoint.closedSide));
          assert.equal(problem.scene.breakpoint.xNumber, 0);
          assert.equal(problem.scene.breakpoint.leftY, problem.scene.left.eval(0));
          assert.equal(problem.scene.breakpoint.rightY, problem.scene.right.eval(0));
          assert(Math.abs(problem.scene.breakpoint.leftY) <= 5.4);
          assert(Math.abs(problem.scene.breakpoint.rightY) <= 5.4);
        }

        if (family === 'limitLaws') {
          const { question } = problem;
          seen.limitLaws.add(question.caseType);
          assert.equal(problem.panels[0].type, 'overlay');
          assert.equal(problem.panels[0].scenes.length, 2);
          assert(question.combinedSideLimits?.left);
          assert(question.combinedSideLimits?.right);
          if (answersEqual(question.combinedSideLimits.left, question.combinedSideLimits.right)) {
            assert(answersEqual(question.answer, question.combinedSideLimits.left));
          } else {
            assert.equal(question.answer.kind, 'dne');
          }
          // Showing both graphs always determines the combined limit, so no limit-law
          // problem may answer "cannot be determined". Every construction of that case also
          // had a provable answer, which meant grading a correct DNE as wrong.
          assert.notEqual(question.caseType, 'lawInconclusive',
            'The inconclusive limit-law case is not answerable from graphs and was removed.');
          assert.notEqual(question.answer.kind, 'inconclusive',
            'A limit-law answer must be a value, an infinity, or DNE.');
          if (question.caseType === 'cancellation') {
            assert.equal(problem.panels[0].scenes[0].scene.twoSidedLimit.kind, 'dne');
            assert.equal(problem.panels[0].scenes[1].scene.twoSidedLimit.kind, 'dne');
            assert.equal(question.answer.kind, 'finite');
            assert(question.answer.value.equals(new Rational(0)));
            assert(question.combinedSideLimits.left.value.equals(new Rational(0)));
            assert(question.combinedSideLimits.right.value.equals(new Rational(0)));
          }
          if (question.caseType === 'zeroDenominator') {
            assert(['posInf', 'negInf', 'dne'].includes(question.answer.kind));
            assert(['posInf', 'negInf'].includes(question.combinedSideLimits.left.kind));
            assert(['posInf', 'negInf'].includes(question.combinedSideLimits.right.kind));
          }
        }

        if (family === 'composition') {
          const { question } = problem;
          seen.composition.add(question.caseType);
          assert.equal(problem.panels.length, 2);
          assert.equal(problem.panels[0].key, 'g');
          assert.equal(problem.panels[1].key, 'f');
          if (question.caseType === 'splitDirections') assert.equal(question.answer.kind, 'dne');
          if (question.caseType === 'innerDneOuterExists') {
            assert.equal(problem.panels[0].scene.twoSidedLimit.kind, 'dne');
            assert.equal(question.answer.kind, 'finite');
          }
          if (question.caseType === 'oneSided') {
            assert(['left', 'right'].includes(question.innerDirection));
            const outer = problem.panels[1].scene;
            assert(answersEqual(question.answer, outer[question.innerDirection].limit));
          }
        }
      }
    }
  }

  for (const kind of ['finite', 'posInf', 'negInf']) {
    assert(seen.atInfinity.has(kind), `Expected limits at infinity to include ${kind}.`);
  }
  for (const caseType of ['finite', 'zeroDenominator', 'cancellation']) {
    assert(seen.limitLaws.has(caseType), `Expected limit-law case ${caseType}.`);
  }
  assert(!seen.limitLaws.has('lawInconclusive'), 'The inconclusive limit-law case must not generate.');
  for (const caseType of ['direct', 'oneSided', 'splitDirections', 'innerDneOuterExists']) {
    assert(seen.composition.has(caseType), `Expected composition case ${caseType}.`);
  }

  const fallback = normalizeAdvancedConfig({ families: { point: false, atInfinity: false, limitLaws: false, composition: false } });
  assert.equal(fallback.families.point, true);

  const targets = [
    ['left-limit:infinite', 'point', 'leftLimit'],
    ['right-limit:oscillatory', 'point', 'rightLimit'],
    ['at-infinity:left:negInf', 'atInfinity', 'limitAtInfinity'],
    ['limit-law:zeroDenominator:quotient', 'limitLaws', 'limitLaw'],
    ['composition:oneSided', 'composition', 'composition'],
  ];
  for (const [targetSkill, family, type] of targets) {
    const targeted = generateAdvancedProblem(`target-${targetSkill}`, { difficulty: 3, targetSkill });
    assert.equal(targeted.family, family);
    assert.equal(targeted.question.type, type);
    if (family === 'limitLaws') assert.equal(targeted.question.caseType, 'zeroDenominator');
    if (family === 'composition') assert.equal(targeted.question.caseType, 'oneSided');
  }

  // A stale targetSkill pointing at the removed case must still yield a usable problem.
  const retired = generateAdvancedProblem('target-retired', { difficulty: 3, targetSkill: 'limit-law:lawInconclusive:add' });
  assert.equal(retired.family, 'limitLaws');
  assert.notEqual(retired.question.caseType, 'lawInconclusive');
}

// The advanced module re-exports the point parser rather than keeping a second copy. The
// fork it replaced had dropped Unicode-minus and interior-whitespace handling, so answers
// that the app itself can produce were rejected as malformed.
function testAdvancedParserMatchesCore() {
  const inputs = [
    '−3', '−1/2', '- inf', '+ infinity', '-∞', '−∞', '+∞',
    'DNE', ' dne ', 'does not exist', '3/2', '1.25', '-0.5',
  ];
  for (const input of inputs) {
    const expected = answerText(parseLimitAnswer(input));
    let actual;
    try {
      actual = advancedAnswerText(advancedParseLimitAnswer(input));
    } catch (error) {
      assert.fail(`advanced.parseLimitAnswer rejected ${JSON.stringify(input)}, which core accepts as ${expected}.`);
    }
    assert.equal(actual, expected, `Parsers disagree on ${JSON.stringify(input)}.`);
  }
}

// The same standard core explanations are held to: nothing is described as approaching a
// non-value, and the reasoning is spelled out rather than printing a bare DNE.
function testAdvancedExplanationLanguage() {
  for (const family of ['atInfinity', 'limitLaws', 'composition']) {
    for (let difficulty = 1; difficulty <= 3; difficulty += 1) {
      for (let i = 0; i < 600; i += 1) {
        const problem = generateAdvancedProblem(`advlang-${family}-${difficulty}-${i}`, familyConfig(family, difficulty));
        const text = advancedExplanationText(problem);
        assert(!/approach(es)? (DNE|\+∞|−∞|-∞)/.test(text),
          `An explanation treats a non-value as something the graph approaches: ${text}`);
        assert(!/\bDNE\b/.test(text),
          `Explanations should spell the reasoning out rather than print DNE: ${text}`);
        assert(!/the (add|subtract|scale) law/.test(text),
          `Limit laws have names: ${text}`);
        // "y-values" is plural. A singular subject such as "the quotient" still takes -s,
        // so this is targeted rather than a blanket ban on the verb form.
        assert(!/y-values (increases|decreases) /.test(text),
          `Subject-verb disagreement: ${text}`);
        if (problem.question.answer.kind === 'posInf') {
          assert(/increases? without bound/.test(text), `+∞ must be described as unbounded growth: ${text}`);
        }
        if (problem.question.answer.kind === 'negInf') {
          assert(/decreases? without bound/.test(text), `−∞ must be described as unbounded decrease: ${text}`);
        }
        if (problem.question.answer.kind === 'dne') {
          assert(/does not exist/.test(text), `A nonexistent limit must say so: ${text}`);
        }
      }
    }
  }
}

function testInterfaceRegressions() {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8');

  assert(css.includes('[hidden] { display: none !important; }'));
  assert(html.includes('id="questionPrompt" class="question-prompt" hidden'));
  assert(html.includes('id="seedInput"'));
  assert(!html.includes('class="seed-control"'), 'The seed control should not consume space in the graph header.');
  assert(html.indexOf('id="copySeedButton"') > html.indexOf('id="optionsDialog"'),
    'The current-seed copy action belongs in Options, not the main interface.');
  assert(html.indexOf('id="showMeButton"') < html.indexOf('id="animationToggleButton"'));
  assert(app.includes('renderTwoSidedExplanation'));
  assert(app.includes('startAnimation({ cycles: 2 })'));

  // The remaining checks guard behaviour that lives in the DOM layer, which this suite
  // cannot execute, so they inspect the source rather than run it.
  assert(app.includes('if (!unbounded)'),
    'The approach animation must not read an unbounded branch back against the y-axis, which '
    + 'would announce a finite height the function never approaches.');
  assert(app.includes('renderOscillationTrail'),
    'An oscillating branch needs a trail, or a single moving dot cannot show it never settles.');
  assert(app.includes('renderFunctionValueMarker'),
    'Continuity and classification traces must finish by pointing at f(a).');
  assert(app.includes('mathQuestionDescription'),
    'The question heading needs a plain-text alternative to its MathML.');
  assert(app.includes('if (elements.answerInput.disabled) return;'),
    'Special-answer buttons must not rewrite the answer of an already solved problem.');
  assert(app.includes('setTimeout(() => URL.revokeObjectURL(url)'),
    'Revoking the export URL in the same tick races the download.');
  assert(app.includes('if (!sharedConfig) saveConfigToStorage();'),
    'Opening a shared problem link must not overwrite the reader\'s own saved settings.');
  assert(!/function resetOptionsForm\(\)\s*\{\s*appConfig =/.test(app),
    'Resetting the options form must not mutate the live configuration.');
  assert(css.includes('.graph-label { font-size: 32px; }'),
    'Graph text is sized in viewBox units and needs a mobile override to stay legible.');
  assert(css.includes('aspect-ratio: 900 / 520'),
    'The mobile graph frame must match the viewBox instead of letterboxing.');
  assert(html.includes('id="graphPanels"'), 'Advanced families need a dynamic graph-panel host.');
  assert(!html.includes('inconclusiveButton'),
    'The inconclusive answer control went with the limit-law case that needed it.');
  assert(app.includes('if (!yOutOfView) {'),
    'The limit-at-infinity trace must not read a clamped value back against the y-axis, which '
    + 'would announce a finite height on a branch that grows without bound.');
  assert(app.includes('horizontalAsymptotes'),
    'A finite limit at infinity needs a drawn asymptote; the curve is still a fifth of a unit '
    + 'short of it at the plot edge, which is not distinguishable from a neighbouring value.');
  assert(app.includes('pulseAnswerArea') && app.includes('revealFeedback'),
    'On a phone the keypad pushes the feedback below the fold, so submitting needs both an '
    + 'immediate local verdict and a scroll to the reasoning.');
  assert(/block: 'nearest'/.test(app),
    'Feedback must scroll into view by the smallest amount, so a wrong answer keeps the graph visible.');
  assert(css.includes('.answer-pulse-static { animation: none !important; }'),
    'The pulse must degrade to a static tint under the reduced-motion setting.');
  assert(!/\.graph-panels\.multi-panel \{ grid-template-columns: 1fr; \}[\s\S]*\.graph-panels\.multi-panel \{ grid-template-columns: 1fr; \}/.test(css),
    'The mobile multi-panel rule duplicates the base rule and should not be restated.');
  assert(app.includes('? outer + (branch.a - epsilon - outer) * t'),
    'A branch with a restricted domain must stop being drawn at its endpoint, not at the plot '
    + 'edge, or the curve runs straight through the marker saying the domain ends there.');
  assert(!html.includes('id="animationControls" class="animation-controls" hidden'),
    'Show me must be available immediately.');
  assert(app.includes("showMeUsed ? 'Completed with help'"),
    'A copied post-explanation answer must be recorded as assisted.');
  assert(app.includes("elements.answerInput.readOnly = mobile"),
    'The mobile answer display must not summon the system keyboard.');
  assert(app.includes('renderAdvancedAnimation'), 'Every advanced family needs an explanation sequence.');
  assert(css.includes('grid-template-areas: "question" "graph" "answer" "debug"'),
    'The mobile prompt, graph, and answer tray must stay in reading order.');
}

testRationalArithmetic();
testAnswerParser();
testConfigFallback();
testGeneratedProblems();
testExplanationLanguage();
testClassificationDiagnosis();
testContinuityDiagnosis();
testGraphFraming();
testTwoSidedInfinityConvention();
testAdvancedFamilies();
testAdvancedParserMatchesCore();
testAdvancedExplanationLanguage();
testInterfaceRegressions();
console.log('All semantic generator tests passed.');
