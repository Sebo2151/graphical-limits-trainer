import {
  DEFAULT_CONFIG,
  Rational,
  answerText,
  answersEqual,
  choice,
  classificationLabel,
  diagnoseWrongAnswer,
  explanationText,
  generateProblem,
  mathQuestionDescription,
  normalizeConfig,
  parseLimitAnswer,
  serializeProblem,
} from './core.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_CONFIG = 'graphicalLimitsTrainer.config.v1';
const STORAGE_PROGRESS = 'graphicalLimitsTrainer.progress.v1';

const elements = {
  graphSvg: document.querySelector('#graphSvg'),
  seedLabel: document.querySelector('#seedLabel'),
  copySeedButton: document.querySelector('#copySeedButton'),
  questionHeading: document.querySelector('#questionHeading'),
  questionPrompt: document.querySelector('#questionPrompt'),
  answerForm: document.querySelector('#answerForm'),
  limitAnswerArea: document.querySelector('#limitAnswerArea'),
  choiceAnswerArea: document.querySelector('#choiceAnswerArea'),
  answerInput: document.querySelector('#answerInput'),
  feedbackPanel: document.querySelector('#feedbackPanel'),
  feedbackHeading: document.querySelector('#feedbackHeading'),
  feedbackMessage: document.querySelector('#feedbackMessage'),
  showMeButton: document.querySelector('#showMeButton'),
  nextProblemButton: document.querySelector('#nextProblemButton'),
  newProblemButton: document.querySelector('#newProblemButton'),
  optionsButton: document.querySelector('#optionsButton'),
  progressButton: document.querySelector('#progressButton'),
  optionsDialog: document.querySelector('#optionsDialog'),
  optionsForm: document.querySelector('#optionsForm'),
  difficultyInput: document.querySelector('#difficultyInput'),
  difficultyDescription: document.querySelector('#difficultyDescription'),
  seedInput: document.querySelector('#seedInput'),
  hapticsInput: document.querySelector('#hapticsInput'),
  reducedMotionInput: document.querySelector('#reducedMotionInput'),
  optionsError: document.querySelector('#optionsError'),
  saveOptionsButton: document.querySelector('#saveOptionsButton'),
  resetOptionsButton: document.querySelector('#resetOptionsButton'),
  progressDialog: document.querySelector('#progressDialog'),
  closeProgressButton: document.querySelector('#closeProgressButton'),
  progressSummary: document.querySelector('#progressSummary'),
  progressSkills: document.querySelector('#progressSkills'),
  resetProgressButton: document.querySelector('#resetProgressButton'),
  exportProgressButton: document.querySelector('#exportProgressButton'),
  animationControls: document.querySelector('#animationControls'),
  animationToggleButton: document.querySelector('#animationToggleButton'),
  replayAnimationButton: document.querySelector('#replayAnimationButton'),
  debugPanel: document.querySelector('#debugPanel'),
  debugOutput: document.querySelector('#debugOutput'),
};

let appConfig = loadConfig();
let progress = loadProgress();
let problem = null;
let wrongAttempts = 0;
let firstAttemptRecorded = false;
let solved = false;
let showMeUsed = false;
let animationState = {
  raf: null,
  running: false,
  paused: false,
  startTime: 0,
  elapsedBeforePause: 0,
  duration: 0,
  hold: 0,
  cycles: 0,
};

const SINGLE_ANIMATION_DURATION = 5200;
const TWO_SIDED_ANIMATION_DURATION = 9800;
const ANIMATION_HOLD = 1400;

const margins = { left: 72, right: 34, top: 30, bottom: 55 };
const viewport = { width: 900, height: 520 };

initialize();

function initialize() {
  bindEvents();
  populateOptionsForm();
  updateDifficultyDescription();
  const params = new URLSearchParams(location.search);
  // A shared link should set up this session only. Persisting it would silently overwrite
  // the settings of whoever opened the link.
  const sharedConfig = params.has('d') || params.get('q') || params.get('g');
  appConfig = configFromUrl(params, appConfig);
  if (!sharedConfig) saveConfigToStorage();
  populateOptionsForm();
  updateDifficultyDescription();
  const seed = params.get('seed') || randomSeed();
  if (params.get('debug') === '1') elements.debugPanel.hidden = false;
  startProblem(seed);
}

function bindEvents() {
  elements.answerForm.addEventListener('submit', handleLimitSubmit);
  elements.newProblemButton.addEventListener('click', () => startProblem(randomSeed()));
  elements.nextProblemButton.addEventListener('click', () => startProblem(randomSeed()));
  elements.optionsButton.addEventListener('click', openOptions);
  elements.progressButton.addEventListener('click', openProgress);
  elements.copySeedButton.addEventListener('click', copyProblemLink);
  elements.showMeButton.addEventListener('click', showExplanationAnimation);
  elements.animationToggleButton.addEventListener('click', toggleAnimation);
  elements.replayAnimationButton.addEventListener('click', replayAnimation);

  document.querySelectorAll('[data-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      if (elements.answerInput.disabled) return;
      elements.answerInput.value = button.dataset.answer;
      elements.answerInput.focus();
    });
  });

  document.querySelectorAll('#mobileKeypad [data-key]').forEach((button) => {
    button.addEventListener('click', () => useKeypad(button.dataset.key));
  });

  elements.difficultyInput.addEventListener('input', updateDifficultyDescription);
  elements.saveOptionsButton.addEventListener('click', saveOptions);
  elements.resetOptionsButton.addEventListener('click', resetOptionsForm);
  elements.closeProgressButton.addEventListener('click', () => elements.progressDialog.close());
  elements.resetProgressButton.addEventListener('click', resetProgress);
  elements.exportProgressButton.addEventListener('click', exportProgress);

  window.addEventListener('keydown', (event) => {
    if (!event.altKey || event.key?.toLowerCase() !== 'n') return;
    event.preventDefault();
    startProblem(randomSeed());
  });
}

function loadConfig() {
  const fallback = {
    ...normalizeConfig(DEFAULT_CONFIG),
    haptics: true,
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_CONFIG));
    if (!saved) return fallback;
    return {
      ...normalizeConfig(saved),
      haptics: saved.haptics !== false,
      reducedMotion: Boolean(saved.reducedMotion),
    };
  } catch {
    return fallback;
  }
}

function saveConfigToStorage() {
  try {
    localStorage.setItem(STORAGE_CONFIG, JSON.stringify(appConfig));
  } catch {
    // The trainer remains usable when browser storage is blocked.
  }
}

function emptyProgress() {
  return {
    version: 1,
    totalProblems: 0,
    firstCorrect: 0,
    eventualCorrect: 0,
    showMe: 0,
    skills: {},
  };
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_PROGRESS));
    return saved?.version === 1 ? saved : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_PROGRESS, JSON.stringify(progress));
  } catch {
    // Progress persistence is optional; practice itself should continue.
  }
}

function randomSeed() {
  const bytes = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    bytes[0] = Math.floor(Math.random() * 2 ** 32);
    bytes[1] = Math.floor(Math.random() * 2 ** 32);
  }
  return `${Date.now().toString(36)}-${bytes[0].toString(36)}${bytes[1].toString(36)}`;
}

function startProblem(seed) {
  stopAnimation();
  problem = generateProblem(seed, appConfig);
  wrongAttempts = 0;
  firstAttemptRecorded = false;
  solved = false;
  showMeUsed = false;

  elements.answerInput.value = '';
  elements.answerInput.disabled = false;
  elements.feedbackPanel.hidden = true;
  elements.feedbackPanel.className = 'feedback-panel';
  elements.feedbackHeading.textContent = '';
  elements.feedbackMessage.textContent = '';
  elements.questionPrompt.hidden = true;
  elements.showMeButton.hidden = true;
  elements.nextProblemButton.hidden = true;
  elements.animationControls.hidden = true;
  elements.animationToggleButton.hidden = true;
  elements.replayAnimationButton.hidden = true;
  elements.animationToggleButton.disabled = false;
  elements.choiceAnswerArea.innerHTML = '';

  renderGraph(problem.scene);
  renderQuestion(problem.question);
  updateDebugPanel();

  elements.seedLabel.textContent = `Seed ${shortSeed(seed)}`;
  elements.copySeedButton.textContent = 'Copy link';
  elements.copySeedButton.setAttribute('aria-label', `Copy link for seed ${seed}`);

  updateUrl(seed);

  if (problem.question.inputMode === 'limit') {
    requestAnimationFrame(() => elements.answerInput.focus({ preventScroll: true }));
  }
}

function shortSeed(seed) {
  const text = String(seed);
  return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-5)}` : text;
}

function renderQuestion(question) {
  elements.questionHeading.innerHTML = questionMathML(question);
  // Assistive-technology support for MathML is uneven, so the heading also carries the
  // question as plain prose.
  elements.questionHeading.setAttribute('aria-label', mathQuestionDescription(question));
  elements.questionPrompt.textContent = questionPrompt(question);

  const isLimitInput = question.inputMode === 'limit';
  elements.limitAnswerArea.hidden = !isLimitInput;
  elements.choiceAnswerArea.hidden = isLimitInput;

  if (!isLimitInput) {
    elements.choiceAnswerArea.className = `choice-answer-area ${question.type === 'classification' ? 'classification-choices' : ''}`;
    question.choices.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.dataset.value = item.value;
      button.addEventListener('click', () => submitChoice(item.value));
      elements.choiceAnswerArea.append(button);
    });
  }
}

function rationalMathML(rational) {
  const value = Rational.from(rational);
  if (value.d === 1n) {
    const number = String(value.n);
    return number.startsWith('-')
      ? `<mrow><mo>−</mo><mn>${number.slice(1)}</mn></mrow>`
      : `<mn>${number}</mn>`;
  }
  const negative = value.n < 0n;
  const numerator = negative ? -value.n : value.n;
  return `<mrow>${negative ? '<mo>−</mo>' : ''}<mfrac><mn>${numerator}</mn><mn>${value.d}</mn></mfrac></mrow>`;
}

function questionMathML(question) {
  const a = rationalMathML(question.a);
  const fAtA = `<math display="block"><mi>f</mi><mo>(</mo>${a}<mo>)</mo><mo>=</mo><mo>?</mo></math>`;
  if (question.type === 'functionValue') return fAtA;
  if (question.type === 'continuity') {
    return `<math display="block"><mtext>Is</mtext><mspace width="0.35em"/><mi>f</mi><mspace width="0.35em"/><mtext>continuous at</mtext><mspace width="0.35em"/><mi>x</mi><mo>=</mo>${a}<mo>?</mo></math>`;
  }
  if (question.type === 'classification') {
    return `<math display="block"><mtext>Classify</mtext><mspace width="0.35em"/><mi>f</mi><mspace width="0.35em"/><mtext>at</mtext><mspace width="0.35em"/><mi>x</mi><mo>=</mo>${a}<mo>.</mo></math>`;
  }

  let approach = a;
  if (question.type === 'leftLimit') approach = `<msup>${a}<mo>−</mo></msup>`;
  if (question.type === 'rightLimit') approach = `<msup>${a}<mo>+</mo></msup>`;
  return `<math display="block"><munder><mo movablelimits="true">lim</mo><mrow><mi>x</mi><mo>→</mo>${approach}</mrow></munder><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>=</mo><mo>?</mo></math>`;
}

function questionPrompt(question) {
  switch (question.type) {
    case 'functionValue': return 'Use the filled point at the indicated x-value.';
    case 'leftLimit': return 'Follow the graph as x approaches from smaller x-values.';
    case 'rightLimit': return 'Follow the graph as x approaches from larger x-values.';
    case 'twoSidedLimit': return 'Compare the behavior from the left and from the right.';
    case 'continuity': return 'Check the function value, the two-sided limit, and whether they agree.';
    case 'classification': return 'Compare both one-sided limits and the function value.';
    default: return '';
  }
}

function handleLimitSubmit(event) {
  event.preventDefault();
  if (solved || problem.question.inputMode !== 'limit') return;
  let submitted;
  try {
    submitted = parseLimitAnswer(elements.answerInput.value);
  } catch (error) {
    showFeedback('incorrect', 'Check the answer format', error.message);
    return;
  }
  evaluateSubmission(submitted);
}

function submitChoice(value) {
  if (solved || problem.question.inputMode !== 'choice') return;
  evaluateSubmission(choice(value));
}

function evaluateSubmission(submitted) {
  const correct = answersEqual(submitted, problem.question.answer);
  recordFirstAttempt(correct);

  if (correct) {
    solved = true;
    recordEventualCorrect();
    disableAnswerControls();
    showFeedback('correct', positiveHeading(), explanationText(problem));
    elements.nextProblemButton.hidden = false;
    vibrate('correct');
    return;
  }

  wrongAttempts += 1;
  elements.questionPrompt.hidden = false;
  const message = diagnoseWrongAnswer(problem, submitted);
  const extension = wrongAttempts >= 2 ? ' Use “Show me” below the graph to trace the approach.' : '';
  showFeedback('incorrect', wrongAttempts === 1 ? 'Not quite' : 'Try tracing the approach', `${message}${extension}`);
  vibrate('incorrect');

  if (wrongAttempts >= 2) {
    elements.animationControls.hidden = false;
    elements.showMeButton.hidden = false;
    elements.animationToggleButton.hidden = true;
    elements.replayAnimationButton.hidden = true;
    renderStaticHint();
  }
  if (problem.question.inputMode === 'limit') {
    elements.answerInput.select();
  }
}

function recordFirstAttempt(correct) {
  if (firstAttemptRecorded) return;
  firstAttemptRecorded = true;
  progress.totalProblems += 1;
  const stats = getSkillStats(problem.question.skill);
  stats.attempts += 1;
  if (correct) {
    progress.firstCorrect += 1;
    stats.firstCorrect += 1;
  }
  saveProgress();
}

function recordEventualCorrect() {
  progress.eventualCorrect += 1;
  getSkillStats(problem.question.skill).eventualCorrect += 1;
  saveProgress();
}

function recordShowMe() {
  if (showMeUsed) return;
  showMeUsed = true;
  progress.showMe += 1;
  getSkillStats(problem.question.skill).showMe += 1;
  saveProgress();
}

function getSkillStats(skill) {
  progress.skills[skill] ??= { attempts: 0, firstCorrect: 0, eventualCorrect: 0, showMe: 0 };
  return progress.skills[skill];
}

function positiveHeading() {
  const headings = ['Correct', 'Exactly right', 'Nice work', 'You’ve got it'];
  return headings[Math.abs(hashString(problem.seed)) % headings.length];
}

function hashString(text) {
  let h = 0;
  for (const character of String(text)) h = ((h << 5) - h + character.charCodeAt(0)) | 0;
  return h;
}

function showFeedback(type, heading, message) {
  elements.feedbackPanel.hidden = false;
  elements.feedbackPanel.className = `feedback-panel ${type}`;
  elements.feedbackHeading.textContent = heading;
  elements.feedbackMessage.textContent = message;
}

function disableAnswerControls() {
  elements.answerInput.disabled = true;
  elements.choiceAnswerArea.querySelectorAll('button').forEach((button) => { button.disabled = true; });
}

function useKeypad(key) {
  const input = elements.answerInput;
  if (input.disabled) return;
  if (key === 'clear') {
    input.value = '';
  } else if (key === 'backspace') {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    if (start !== end) input.setRangeText('', start, end, 'end');
    else if (start > 0) input.setRangeText('', start - 1, start, 'end');
  } else {
    const display = key === '-' ? '-' : key;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(display, start, end, 'end');
  }
  input.focus({ preventScroll: true });
}

function vibrate(type) {
  if (!appConfig.haptics || !navigator.vibrate) return;
  navigator.vibrate(type === 'correct' ? 35 : [70, 45, 70]);
}

function svgElement(name, attributes = {}, text = null) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text !== null) node.textContent = text;
  return node;
}

function mapX(x, scene = problem.scene) {
  const plotWidth = viewport.width - margins.left - margins.right;
  return margins.left + ((x - scene.xRange.min) / (scene.xRange.max - scene.xRange.min)) * plotWidth;
}

function mapY(y, scene = problem.scene) {
  const plotHeight = viewport.height - margins.top - margins.bottom;
  return margins.top + ((scene.yRange.max - y) / (scene.yRange.max - scene.yRange.min)) * plotHeight;
}

function renderGraph(scene) {
  const svg = elements.graphSvg;
  svg.replaceChildren();

  const title = svgElement('title', { id: 'graphTitle' }, 'Graph of a piecewise function f');
  const desc = svgElement('desc', { id: 'graphDescription' }, 'A coordinate graph with a marked piecewise function. Open circles are excluded and filled circles are included.');
  svg.append(title, desc);

  const defs = svgElement('defs');
  const clip = svgElement('clipPath', { id: 'plotClip' });
  clip.append(svgElement('rect', {
    x: margins.left,
    y: margins.top,
    width: viewport.width - margins.left - margins.right,
    height: viewport.height - margins.top - margins.bottom,
  }));
  defs.append(clip);
  svg.append(defs);

  renderGridAndAxes(svg, scene);

  const plotGroup = svgElement('g', { 'clip-path': 'url(#plotClip)' });
  if (scene.left.kind === 'infinite' || scene.right.kind === 'infinite') {
    plotGroup.append(svgElement('line', {
      x1: mapX(scene.aNumber, scene), y1: margins.top,
      x2: mapX(scene.aNumber, scene), y2: viewport.height - margins.bottom,
      class: 'graph-asymptote',
    }));
  }

  plotGroup.append(renderBranchPath(scene.left, scene));
  plotGroup.append(renderBranchPath(scene.right, scene));
  svg.append(plotGroup);
  renderEndpointMarkers(svg, scene);
  renderDistractorMarkers(svg, scene);

  const label = svgElement('text', {
    x: mapX(scene.xRange.min + 0.7, scene),
    y: mapY(scene.yRange.max - 0.7, scene),
    class: 'graph-label',
  }, 'f');
  label.setAttribute('font-style', 'italic');
  label.setAttribute('font-size', '22');
  label.setAttribute('font-weight', '700');
  label.setAttribute('fill', 'var(--curve)');
  svg.append(label);

  svg.append(svgElement('g', { id: 'animationLayer', 'pointer-events': 'none' }));
}

function renderGridAndAxes(svg, scene) {
  const gridGroup = svgElement('g');
  const xStart = Math.ceil(scene.xRange.min);
  const xEnd = Math.floor(scene.xRange.max);
  const yStart = Math.ceil(scene.yRange.min);
  const yEnd = Math.floor(scene.yRange.max);

  if (scene.difficulty >= 2) {
    for (let x = Math.ceil(scene.xRange.min * 2) / 2; x <= scene.xRange.max; x += 0.5) {
      if (Number.isInteger(x)) continue;
      const px = mapX(x, scene);
      const line = svgElement('line', { x1: px, y1: margins.top, x2: px, y2: viewport.height - margins.bottom, class: 'graph-grid' });
      line.setAttribute('opacity', '0.45');
      gridGroup.append(line);
    }
    for (let y = Math.ceil(scene.yRange.min * 2) / 2; y <= scene.yRange.max; y += 0.5) {
      if (Number.isInteger(y)) continue;
      const py = mapY(y, scene);
      const line = svgElement('line', { x1: margins.left, y1: py, x2: viewport.width - margins.right, y2: py, class: 'graph-grid' });
      line.setAttribute('opacity', '0.45');
      gridGroup.append(line);
    }
  }

  for (let x = xStart; x <= xEnd; x += 1) {
    const px = mapX(x, scene);
    gridGroup.append(svgElement('line', {
      x1: px, y1: margins.top, x2: px, y2: viewport.height - margins.bottom,
      class: x === 0 ? 'graph-axis' : 'graph-grid',
    }));
    gridGroup.append(svgElement('line', {
      x1: px, y1: mapY(0, scene) - 5, x2: px, y2: mapY(0, scene) + 5,
      class: 'graph-tick',
    }));
    if (x !== 0) {
      gridGroup.append(svgElement('text', {
        x: px, y: mapY(0, scene) + 23, 'text-anchor': 'middle', class: 'graph-label',
      }, String(x).replace('-', '−')));
    }
  }

  for (let y = yStart; y <= yEnd; y += 1) {
    const py = mapY(y, scene);
    gridGroup.append(svgElement('line', {
      x1: margins.left, y1: py, x2: viewport.width - margins.right, y2: py,
      class: y === 0 ? 'graph-axis' : 'graph-grid',
    }));
    gridGroup.append(svgElement('line', {
      x1: mapX(0, scene) - 5, y1: py, x2: mapX(0, scene) + 5, y2: py,
      class: 'graph-tick',
    }));
    if (y !== 0) {
      gridGroup.append(svgElement('text', {
        x: mapX(0, scene) - 11, y: py + 5, 'text-anchor': 'end', class: 'graph-label',
      }, String(y).replace('-', '−')));
    }
  }

  gridGroup.append(svgElement('text', {
    x: viewport.width - margins.right - 3, y: mapY(0, scene) - 12, 'text-anchor': 'end', class: 'graph-axis-label',
  }, 'x'));
  gridGroup.append(svgElement('text', {
    x: mapX(0, scene) + 12, y: margins.top + 20, class: 'graph-axis-label',
  }, 'y'));
  gridGroup.append(svgElement('text', {
    x: mapX(0, scene) - 10, y: mapY(0, scene) + 22, 'text-anchor': 'end', class: 'graph-label',
  }, '0'));
  svg.append(gridGroup);
}

function renderBranchPath(branch, scene) {
  const path = svgElement('path', { class: 'graph-curve' });
  const points = sampleBranch(branch, scene);
  const d = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${mapX(x, scene).toFixed(2)} ${mapY(y, scene).toFixed(2)}`).join(' ');
  path.setAttribute('d', d);
  return path;
}

function sampleBranch(branch, scene) {
  const epsilon = 0.025;
  const outer = branch.side === 'left' ? scene.xRange.min : scene.xRange.max;
  const maxDistance = Math.abs(outer - branch.a);
  const points = [];

  if (branch.kind === 'oscillatory') {
    const tMin = branch.frequency / maxDistance;
    const tMax = 42 * branch.frequency;
    const count = 1100;
    for (let i = 0; i <= count; i += 1) {
      const t = tMin + (tMax - tMin) * (i / count);
      const distance = branch.frequency / t;
      const x = branch.side === 'left' ? branch.a - distance : branch.a + distance;
      points.push([x, branch.eval(x)]);
    }
    return points;
  }

  const count = branch.kind === 'infinite' ? 300 : 180;
  for (let i = 0; i <= count; i += 1) {
    let x;
    if (branch.kind === 'infinite') {
      const ratio = i / count;
      const distance = maxDistance * ((epsilon / maxDistance) ** ratio);
      x = branch.side === 'left' ? branch.a - distance : branch.a + distance;
    } else {
      const t = i / count;
      x = branch.side === 'left'
        ? scene.xRange.min + (branch.a - epsilon - scene.xRange.min) * t
        : branch.a + epsilon + (scene.xRange.max - branch.a - epsilon) * t;
    }
    points.push([x, branch.eval(x)]);
  }
  return points;
}

function renderEndpointMarkers(svg, scene) {
  const finiteLimits = [];
  for (const branch of [scene.left, scene.right]) {
    if (branch.limit.kind === 'finite') finiteLimits.push(branch.limit.value);
  }
  const unique = [];
  for (const value of finiteLimits) {
    if (!unique.some((candidate) => candidate.equals(value))) unique.push(value);
  }

  unique.forEach((limit) => {
    if (scene.value && scene.value.equals(limit)) return;
    svg.append(svgElement('circle', {
      cx: mapX(scene.aNumber, scene),
      cy: mapY(limit.toNumber(), scene),
      r: 8,
      class: 'graph-open-point',
    }));
  });

  if (scene.value !== null) {
    svg.append(svgElement('circle', {
      cx: mapX(scene.aNumber, scene),
      cy: mapY(scene.value.toNumber(), scene),
      r: 8,
      class: 'graph-closed-point',
    }));
  }
}

function renderDistractorMarkers(svg, scene) {
  for (const distractor of scene.distractors || []) {
    svg.append(svgElement('circle', {
      cx: mapX(distractor.xNumber, scene),
      cy: mapY(distractor.holeY, scene),
      r: 8,
      class: 'graph-open-point',
    }));
    svg.append(svgElement('circle', {
      cx: mapX(distractor.xNumber, scene),
      cy: mapY(distractor.value.toNumber(), scene),
      r: 8,
      class: 'graph-closed-point',
    }));
  }
}

function renderStaticHint() {
  const layer = document.querySelector('#animationLayer');
  if (!layer) return;
  layer.replaceChildren();
  const aX = mapX(problem.scene.aNumber);
  layer.append(svgElement('line', {
    x1: aX, y1: margins.top, x2: aX, y2: viewport.height - margins.bottom,
    class: 'animation-focus',
  }));

  const side = problem.question.side;
  if (side === 'left' || side === 'both') layer.append(directionArrow('left'));
  if (side === 'right' || side === 'both') layer.append(directionArrow('right'));
}

function directionArrow(side) {
  const a = problem.scene.aNumber;
  const start = side === 'left' ? a - 2.3 : a + 2.3;
  const end = side === 'left' ? a - 0.35 : a + 0.35;
  const y = mapY(0) + 32;
  const group = svgElement('g');
  group.append(svgElement('line', {
    x1: mapX(start), y1: y, x2: mapX(end), y2: y,
    class: side === 'left' ? 'animation-guide-left' : 'animation-guide-right',
    'marker-end': 'url(#none)',
  }));
  group.append(svgElement('text', {
    x: (mapX(start) + mapX(end)) / 2,
    y: y + 28,
    'text-anchor': 'middle',
    class: 'animation-label',
  }, side === 'left' ? 'from the left' : 'from the right'));
  return group;
}

function showExplanationAnimation() {
  recordShowMe();
  showFeedback('explanation', 'Trace the graph', explanationText(problem));
  elements.showMeButton.hidden = true;
  elements.animationControls.hidden = false;
  elements.animationToggleButton.hidden = false;
  elements.replayAnimationButton.hidden = false;
  startAnimation({ cycles: 2 });
}

function animationDurationForQuestion() {
  return problem.question.side === 'both' ? TWO_SIDED_ANIMATION_DURATION : SINGLE_ANIMATION_DURATION;
}

function startAnimation({ cycles = 1 } = {}) {
  stopAnimation();
  animationState.running = true;
  animationState.paused = false;
  animationState.startTime = performance.now();
  animationState.elapsedBeforePause = 0;
  animationState.duration = animationDurationForQuestion();
  animationState.hold = ANIMATION_HOLD;
  animationState.cycles = cycles;
  elements.animationToggleButton.textContent = 'Pause animation';

  if (appConfig.reducedMotion) {
    renderAnimationFrame(1);
    animationState.running = false;
    elements.animationToggleButton.textContent = 'Animation reduced';
    elements.animationToggleButton.disabled = true;
    return;
  }

  elements.animationToggleButton.disabled = false;
  animationState.raf = requestAnimationFrame(animationLoop);
}

function animationLoop(timestamp) {
  if (!animationState.running || animationState.paused) return;
  const cycle = animationState.duration + animationState.hold;
  const elapsed = timestamp - animationState.startTime;
  const cycleIndex = Math.floor(elapsed / cycle);
  if (cycleIndex >= animationState.cycles) {
    renderAnimationFrame(1);
    animationState.running = false;
    animationState.raf = null;
    elements.animationToggleButton.textContent = 'Animation complete';
    elements.animationToggleButton.disabled = true;
    return;
  }
  const cycleTime = elapsed - cycleIndex * cycle;
  const progressValue = Math.min(1, cycleTime / animationState.duration);
  renderAnimationFrame(progressValue);
  animationState.raf = requestAnimationFrame(animationLoop);
}

function toggleAnimation() {
  if (appConfig.reducedMotion) return;
  if (animationState.paused) {
    animationState.paused = false;
    animationState.startTime = performance.now() - animationState.elapsedBeforePause;
    elements.animationToggleButton.textContent = 'Pause animation';
    animationState.raf = requestAnimationFrame(animationLoop);
  } else {
    animationState.paused = true;
    animationState.elapsedBeforePause = performance.now() - animationState.startTime;
    if (animationState.raf) cancelAnimationFrame(animationState.raf);
    elements.animationToggleButton.textContent = 'Resume animation';
  }
}

function replayAnimation() {
  startAnimation({ cycles: 1 });
}

function stopAnimation() {
  if (animationState.raf) cancelAnimationFrame(animationState.raf);
  animationState = {
    raf: null,
    running: false,
    paused: false,
    startTime: 0,
    elapsedBeforePause: 0,
    duration: 0,
    hold: 0,
    cycles: 0,
  };
  const layer = document.querySelector('#animationLayer');
  if (layer) layer.replaceChildren();
}

function renderAnimationFrame(progressValue) {
  const layer = document.querySelector('#animationLayer');
  if (!layer) return;
  layer.replaceChildren();
  const scene = problem.scene;
  const aX = mapX(scene.aNumber);
  layer.append(svgElement('line', {
    x1: aX, y1: margins.top, x2: aX, y2: viewport.height - margins.bottom,
    class: 'animation-focus',
  }));

  if (problem.question.type === 'functionValue') {
    renderFunctionValueExplanation(layer, progressValue);
    if (progressValue > 0.78) renderAnswerBanner(layer);
  } else if (problem.question.side === 'both') {
    renderTwoSidedExplanation(layer, progressValue);
  } else {
    const sides = animationSides(problem.question);
    sides.forEach((side) => renderApproach(layer, side, progressValue));
    if (progressValue > 0.78) renderAnswerBanner(layer);
  }
}

function animationSides(question) {
  if (question.type === 'leftLimit') return ['left'];
  if (question.type === 'rightLimit') return ['right'];
  return ['left', 'right'];
}

function renderTwoSidedExplanation(layer, progressValue) {
  const leftEnd = 0.3;
  const rightEnd = 0.6;
  const togetherEnd = 0.9;

  if (progressValue < leftEnd) {
    renderPhaseLabel(layer, 'First: approach from the left');
    renderApproach(layer, 'left', progressValue / leftEnd);
    return;
  }

  if (progressValue < rightEnd) {
    renderPhaseLabel(layer, 'Next: approach from the right');
    renderApproach(layer, 'left', 1);
    renderApproach(layer, 'right', (progressValue - leftEnd) / (rightEnd - leftEnd));
    return;
  }

  if (progressValue < togetherEnd) {
    renderPhaseLabel(layer, needsFunctionValue() ? 'Finally: compare both sides with f(a)' : 'Finally: compare both sides');
    const togetherProgress = (progressValue - rightEnd) / (togetherEnd - rightEnd);
    renderApproach(layer, 'left', togetherProgress);
    renderApproach(layer, 'right', togetherProgress);
    return;
  }

  renderApproach(layer, 'left', 1);
  renderApproach(layer, 'right', 1);
  if (needsFunctionValue()) renderFunctionValueMarker(layer);
  renderAnswerBanner(layer);
}

// Continuity and classification both turn on f(a) as well as the two one-sided limits, so
// the trace has to end by pointing at the filled point rather than only at the approaches.
function needsFunctionValue() {
  return problem.question.type === 'continuity' || problem.question.type === 'classification';
}

function renderFunctionValueMarker(layer) {
  const scene = problem.scene;
  const x = mapX(scene.aNumber);
  if (scene.value === null) {
    layer.append(svgElement('text', {
      x, y: mapY(0) - 30, 'text-anchor': 'middle', class: 'animation-label',
    }, `no value at x = ${scene.a}`));
    return;
  }
  const y = mapY(scene.value.toNumber());
  layer.append(svgElement('circle', { cx: x, cy: y, r: 15, class: 'animation-target' }));
  layer.append(svgElement('text', {
    x: x + 22, y: y - 18, class: 'animation-label',
  }, `f(${scene.a}) = ${scene.value}`));
}

function renderPhaseLabel(layer, text) {
  const width = Math.min(410, 120 + text.length * 7.4);
  const x = (viewport.width - width) / 2;
  const y = viewport.height - margins.bottom - 48;
  layer.append(svgElement('rect', { x, y, width, height: 38, rx: 10, class: 'animation-phase-banner' }));
  layer.append(svgElement('text', {
    x: viewport.width / 2,
    y: y + 25,
    'text-anchor': 'middle',
    class: 'animation-phase-label',
  }, text));
}

function renderFunctionValueExplanation(layer, progressValue) {
  const scene = problem.scene;
  const x = mapX(scene.aNumber);
  if (scene.value !== null) {
    const y = mapY(scene.value.toNumber());
    layer.append(svgElement('circle', { cx: x, cy: y, r: 15 + 4 * Math.sin(progressValue * Math.PI), class: 'animation-target' }));
    layer.append(svgElement('line', { x1: x, y1: mapY(0), x2: x, y2: y, class: 'animation-guide-right' }));
  } else {
    const finiteBranch = [scene.left, scene.right].find((branch) => branch.limit.kind === 'finite');
    const y = finiteBranch ? mapY(finiteBranch.limit.value.toNumber()) : mapY(0);
    layer.append(svgElement('text', { x, y: y - 20, 'text-anchor': 'middle', class: 'animation-label' }, 'open, not filled'));
  }
}

function approachDistance(branch, progressValue) {
  if (branch.kind === 'oscillatory') return branch.frequency / (0.5 + 34 * progressValue);
  return 0.075 + 3.7 * ((1 - progressValue) ** 2.2);
}

function clampToPlot(y, scene) {
  return Math.min(scene.yRange.max - 0.08, Math.max(scene.yRange.min + 0.08, y));
}

// An oscillating branch never settles, which a single moving dot cannot show. Leaving a
// fading trail of earlier y-readouts makes the values visibly revisit the same band no
// matter how close x gets to a.
function renderOscillationTrail(layer, side, progressValue, pointClass) {
  const scene = problem.scene;
  const branch = side === 'left' ? scene.left : scene.right;
  const yAxisX = mapX(0);
  for (let step = 1; step <= 7; step += 1) {
    const past = progressValue - step * 0.04;
    if (past <= 0) break;
    const distance = approachDistance(branch, past);
    const x = side === 'left' ? scene.aNumber - distance : scene.aNumber + distance;
    const marker = svgElement('circle', {
      cx: yAxisX, cy: mapY(clampToPlot(branch.eval(x), scene)), r: 5, class: pointClass,
    });
    marker.setAttribute('opacity', (0.5 - step * 0.055).toFixed(2));
    layer.append(marker);
  }
}

function renderApproach(layer, side, progressValue) {
  const scene = problem.scene;
  const branch = side === 'left' ? scene.left : scene.right;
  const unbounded = branch.limit.kind === 'posInf' || branch.limit.kind === 'negInf';
  const distance = approachDistance(branch, progressValue);
  const xValue = side === 'left' ? scene.aNumber - distance : scene.aNumber + distance;
  const visibleY = clampToPlot(branch.eval(xValue), scene);
  const px = mapX(xValue);
  const py = mapY(visibleY);
  const axisY = mapY(0);
  const yAxisX = mapX(0);
  const guideClass = side === 'left' ? 'animation-guide-left' : 'animation-guide-right';
  const pointClass = side === 'left' ? 'animation-point-left' : 'animation-point-right';

  layer.append(svgElement('circle', { cx: px, cy: axisY, r: 7, class: pointClass }));
  layer.append(svgElement('line', { x1: px, y1: axisY, x2: px, y2: py, class: guideClass }));
  layer.append(svgElement('circle', { cx: px, cy: py, r: 8, class: pointClass }));

  // The y-value is clamped to keep the dot on screen, so on an unbounded branch reading it
  // back against the y-axis would announce a finite height the function never approaches.
  if (!unbounded) {
    if (branch.kind === 'oscillatory') renderOscillationTrail(layer, side, progressValue, pointClass);
    layer.append(svgElement('line', { x1: px, y1: py, x2: yAxisX, y2: py, class: guideClass }));
    layer.append(svgElement('circle', { cx: yAxisX, cy: py, r: 7, class: pointClass }));
  }

  if (branch.limit.kind === 'finite') {
    layer.append(svgElement('circle', {
      cx: mapX(scene.aNumber), cy: mapY(branch.limit.value.toNumber()), r: 15,
      class: 'animation-target',
    }));
  } else if (unbounded) {
    const upward = branch.limit.kind === 'posInf';
    const edgeY = upward ? margins.top + 4 : viewport.height - margins.bottom - 4;
    layer.append(svgElement('line', { x1: px, y1: py, x2: px, y2: edgeY, class: guideClass }));
    layer.append(svgElement('text', {
      x: px, y: upward ? margins.top + 26 : viewport.height - margins.bottom - 14,
      'text-anchor': 'middle', class: 'animation-label',
    }, upward ? '↑ +∞' : '↓ −∞'));
  } else if (progressValue > 0.68) {
    layer.append(svgElement('text', {
      x: mapX(scene.aNumber) + (side === 'left' ? -35 : 35),
      y: mapY(branch.offset ?? 0),
      'text-anchor': 'middle',
      class: 'animation-label',
    }, '?'));
  }
}

function renderAnswerBanner(layer) {
  const text = answerBannerText();
  const width = Math.min(620, 170 + text.length * 8.2);
  const x = (viewport.width - width) / 2;
  const y = margins.top + 10;
  layer.append(svgElement('rect', { x, y, width, height: 48, rx: 12, class: 'animation-banner' }));
  layer.append(svgElement('text', {
    x: viewport.width / 2, y: y + 31, 'text-anchor': 'middle', class: 'animation-label',
  }, text));
}

function answerBannerText() {
  const answer = answerText(problem.question.answer);
  if (problem.question.type === 'continuity') return `Continuous? ${answer === 'yes' ? 'Yes' : 'No'}`;
  if (problem.question.type === 'classification') return classificationLabel(problem.question.answer.value);
  return `Answer: ${answer}`;
}

function populateOptionsForm() {
  elements.difficultyInput.value = String(appConfig.difficulty);
  // Left blank so that saving new settings serves a fresh problem, as the help text says.
  // The current seed is offered as a placeholder for anyone who wants to reuse it.
  elements.seedInput.value = '';
  elements.seedInput.placeholder = problem?.seed ?? '';
  document.querySelectorAll('input[name="questionType"]').forEach((input) => {
    input.checked = Boolean(appConfig.questionTypes[input.value]);
  });
  document.querySelectorAll('input[name="feature"]').forEach((input) => {
    input.checked = Boolean(appConfig.features[input.value]);
  });
  elements.hapticsInput.checked = appConfig.haptics;
  elements.reducedMotionInput.checked = appConfig.reducedMotion;
}

function openOptions() {
  populateOptionsForm();
  elements.optionsError.textContent = '';
  elements.optionsDialog.showModal();
}

function updateDifficultyDescription() {
  const descriptions = {
    1: 'Integer values, clear scales, and relatively simple branches.',
    2: 'Some fractional values and less uniform graph shapes.',
    3: 'More varied scales, curvature, and oscillatory or unbounded behavior.',
  };
  elements.difficultyDescription.textContent = descriptions[elements.difficultyInput.value];
}

function saveOptions() {
  const questionTypes = {};
  document.querySelectorAll('input[name="questionType"]').forEach((input) => { questionTypes[input.value] = input.checked; });
  const features = {};
  document.querySelectorAll('input[name="feature"]').forEach((input) => { features[input.value] = input.checked; });

  if (!Object.values(questionTypes).some(Boolean)) {
    elements.optionsError.textContent = 'Select at least one question type.';
    return;
  }
  if (!Object.values(features).some(Boolean)) {
    elements.optionsError.textContent = 'Select at least one kind of graph behavior.';
    return;
  }

  appConfig = {
    ...normalizeConfig({ difficulty: Number(elements.difficultyInput.value), questionTypes, features }),
    haptics: elements.hapticsInput.checked,
    reducedMotion: elements.reducedMotionInput.checked,
  };
  saveConfigToStorage();
  elements.optionsDialog.close();
  startProblem(elements.seedInput.value.trim() || randomSeed());
}

// Only the form is reset. Touching appConfig here would leave memory, storage, and the
// problem on screen disagreeing if the dialog were then dismissed instead of saved.
function resetOptionsForm() {
  const defaults = normalizeConfig(DEFAULT_CONFIG);
  elements.difficultyInput.value = String(defaults.difficulty);
  elements.seedInput.value = '';
  document.querySelectorAll('input[name="questionType"]').forEach((input) => {
    input.checked = Boolean(defaults.questionTypes[input.value]);
  });
  document.querySelectorAll('input[name="feature"]').forEach((input) => {
    input.checked = Boolean(defaults.features[input.value]);
  });
  elements.hapticsInput.checked = true;
  elements.reducedMotionInput.checked = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  updateDifficultyDescription();
  elements.optionsError.textContent = '';
}

function openProgress() {
  renderProgress();
  elements.progressDialog.showModal();
}

function renderProgress() {
  const rate = (count) => (progress.totalProblems ? Math.round((count / progress.totalProblems) * 100) : 0);
  elements.progressSummary.innerHTML = `
    <div class="summary-stat"><strong>${progress.totalProblems}</strong><span>problems attempted</span></div>
    <div class="summary-stat"><strong>${rate(progress.firstCorrect)}%</strong><span>correct on first attempt</span></div>
    <div class="summary-stat"><strong>${rate(progress.eventualCorrect)}%</strong><span>solved eventually</span></div>
    <div class="summary-stat"><strong>${progress.showMe}</strong><span>show-me explanations</span></div>
  `;

  const skills = Object.entries(progress.skills).sort((a, b) => b[1].attempts - a[1].attempts);
  if (!skills.length) {
    elements.progressSkills.innerHTML = '<p class="help-text">No practice data yet. Your results will appear here after your first submission.</p>';
    return;
  }

  elements.progressSkills.replaceChildren();
  skills.forEach(([skill, stats]) => {
    const rate = stats.attempts ? Math.round((stats.firstCorrect / stats.attempts) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.innerHTML = `
      <div class="skill-name">${escapeHtml(skillLabel(skill))}</div>
      <div class="skill-bar" aria-label="${rate}% first-attempt accuracy"><span style="width:${rate}%"></span></div>
      <div class="skill-stat">${rate}% of ${stats.attempts}</div>
    `;
    elements.progressSkills.append(row);
  });
}

function skillLabel(skill) {
  const [category, detail] = skill.split(':');
  const categoryLabels = {
    'function-value': 'Function values',
    'left-limit': 'Left-hand limits',
    'right-limit': 'Right-hand limits',
    'two-sided': 'Two-sided limits',
    continuity: 'Continuity',
    classification: 'Classification',
  };
  const detailLabels = {
    polynomial: 'finite',
    infinite: 'infinite',
    oscillatory: 'oscillatory',
    continuous: 'continuous',
    removable: 'removable',
    jump: 'jump',
  };
  const base = categoryLabels[category] || category.replaceAll('-', ' ');
  return detail ? `${base}: ${detailLabels[detail] || detail}` : base;
}

function resetProgress() {
  if (!confirm('Reset all progress stored by this app on this device?')) return;
  progress = emptyProgress();
  saveProgress();
  renderProgress();
}

function exportProgress() {
  const blob = new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'graphical-limits-progress.json';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking in the same tick can cancel the download before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function configFromUrl(params, fallback) {
  const q = params.get('q');
  const g = params.get('g');
  if (!params.has('d') && !q && !g) return fallback;

  const questionCodes = { f: 'functionValue', o: 'oneSided', t: 'twoSided', c: 'continuity', k: 'classification' };
  const featureCodes = { c: 'continuous', r: 'removable', j: 'jump', i: 'infinite', o: 'oscillatory' };
  const questionTypes = Object.fromEntries(Object.values(questionCodes).map((key) => [key, false]));
  const features = Object.fromEntries(Object.values(featureCodes).map((key) => [key, false]));
  for (const code of q || '') if (questionCodes[code]) questionTypes[questionCodes[code]] = true;
  for (const code of g || '') if (featureCodes[code]) features[featureCodes[code]] = true;

  return {
    ...normalizeConfig({
      difficulty: Number(params.get('d') || fallback.difficulty),
      questionTypes: q ? questionTypes : fallback.questionTypes,
      features: g ? features : fallback.features,
    }),
    haptics: fallback.haptics,
    reducedMotion: fallback.reducedMotion,
  };
}

function problemUrl(seed) {
  const url = new URL(location.href);
  url.searchParams.set('seed', seed);
  url.searchParams.set('d', String(appConfig.difficulty));
  const q = [
    ['f', 'functionValue'], ['o', 'oneSided'], ['t', 'twoSided'], ['c', 'continuity'], ['k', 'classification'],
  ].filter(([, key]) => appConfig.questionTypes[key]).map(([code]) => code).join('');
  const g = [
    ['c', 'continuous'], ['r', 'removable'], ['j', 'jump'], ['i', 'infinite'], ['o', 'oscillatory'],
  ].filter(([, key]) => appConfig.features[key]).map(([code]) => code).join('');
  url.searchParams.set('q', q);
  url.searchParams.set('g', g);
  return url;
}

function updateUrl(seed) {
  history.replaceState(null, '', problemUrl(seed));
}

async function copyProblemLink() {
  const url = problemUrl(problem.seed);
  try {
    await navigator.clipboard.writeText(url.toString());
    elements.copySeedButton.textContent = 'Copied';
    setTimeout(() => { elements.copySeedButton.textContent = 'Copy link'; }, 1300);
  } catch {
    prompt('Copy this problem link:', url.toString());
  }
}

function updateDebugPanel() {
  if (elements.debugPanel.hidden) return;
  const data = serializeProblem(problem);
  data.leftBranch = describeBranch(problem.scene.left);
  data.rightBranch = describeBranch(problem.scene.right);
  elements.debugOutput.textContent = JSON.stringify(data, null, 2);
}

function describeBranch(branch) {
  if (branch.kind === 'polynomial') return `limit + ${branch.slope}(x-a) + 0.25(${branch.curvature})(x-a)^2`;
  if (branch.kind === 'infinite') return `${branch.limit.kind === 'posInf' ? '+' : '-'}${branch.scale}/|x-a|^${branch.power}`;
  return `${branch.offset} + ${branch.amplitude} sin(${branch.frequency}/|x-a|)`;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));
}
