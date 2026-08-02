import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DNE,
  NEG_INF,
  POS_INF,
  Rational,
  answerText,
  answersEqual,
  generateProblem,
  normalizeConfig,
  parseLimitAnswer,
  serializeProblem,
} from './core.mjs';

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
      assert(['continuous', 'removable', 'jump', 'infinite', 'oscillatory'].includes(scene.classification));
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
        if (distractor.purpose === 'coordinate-swap') {
          assert(distractor.value.equals(scene.a));
          const finiteValues = [scene.left.limit, scene.right.limit]
            .filter((answer) => answer.kind === 'finite')
            .map((answer) => answer.value);
          if (scene.value !== null) finiteValues.push(scene.value);
          assert(finiteValues.some((value) => value.equals(distractor.x)));
        }
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
  assert(scenesWithDistractors > 4500, 'Most generated scenes should contain a secondary salient feature.');
  assert(coordinateSwapScenes > 1500, 'Coordinate-swap distractors should occur regularly.');
}

function testInterfaceRegressions() {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8');

  assert(css.includes('[hidden] { display: none !important; }'));
  assert(html.includes('id="questionPrompt" class="question-prompt" hidden'));
  assert(html.includes('id="seedInput"'));
  assert(html.indexOf('id="showMeButton"') < html.indexOf('id="animationToggleButton"'));
  assert(app.includes('renderTwoSidedExplanation'));
  assert(app.includes('startAnimation({ cycles: 2 })'));
}

testRationalArithmetic();
testAnswerParser();
testConfigFallback();
testGeneratedProblems();
testInterfaceRegressions();
console.log('All semantic generator tests passed.');
