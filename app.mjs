import {
  DEFAULT_CONFIG,
  PRESETS,
  Rational,
  answerText,
  answersEqual,
  choice,
  classificationLabel,
  configForPreset,
  diagnoseSubmission,
  diagnoseWrongAnswer,
  explanationText,
  generateProblem,
  mathQuestionDescription,
  normalizeConfig,
  parseLimitAnswer,
  questionPrompt as familyQuestionPrompt,
  serializeProblem,
} from './advanced.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_CONFIG = 'graphicalLimitsTrainer.config.v1';
const STORAGE_PROGRESS = 'graphicalLimitsTrainer.progress.v1';

const elements = {
  graphSvg: document.querySelector('#graphSvg'),
  graphPanels: document.querySelector('#graphPanels'),
  graphHeading: document.querySelector('#graphHeading'),
  graphInstruction: document.querySelector('#graphInstruction'),
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
  presetInput: document.querySelector('#presetInput'),
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
  progressMisconceptions: document.querySelector('#progressMisconceptions'),
  practiceWeakButton: document.querySelector('#practiceWeakButton'),
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
let replaceMobileAnswer = false;
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
  const sharedConfig = params.has('d') || params.get('q') || params.get('g') || params.get('f');
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
  elements.copySeedButton.addEventListener('click', copyCurrentSeed);
  elements.showMeButton.addEventListener('click', showExplanationAnimation);
  elements.animationToggleButton.addEventListener('click', toggleAnimation);
  elements.replayAnimationButton.addEventListener('click', replayAnimation);

  document.querySelectorAll('[data-answer]').forEach((button) => {
    button.addEventListener('click', () => {
      if (elements.answerInput.disabled) return;
      elements.answerInput.value = button.dataset.answer;
      replaceMobileAnswer = false;
      elements.answerInput.focus();
    });
  });

  document.querySelectorAll('#mobileKeypad [data-key]').forEach((button) => {
    button.addEventListener('click', () => useKeypad(button.dataset.key));
  });

  elements.difficultyInput.addEventListener('input', updateDifficultyDescription);
  elements.presetInput.addEventListener('change', applySelectedPreset);
  document.querySelectorAll('input[name="family"], input[name="questionType"], input[name="feature"]').forEach((input) => {
    input.addEventListener('change', () => { elements.presetInput.value = 'custom'; });
  });
  elements.saveOptionsButton.addEventListener('click', saveOptions);
  elements.resetOptionsButton.addEventListener('click', resetOptionsForm);
  elements.closeProgressButton.addEventListener('click', () => elements.progressDialog.close());
  elements.resetProgressButton.addEventListener('click', resetProgress);
  elements.exportProgressButton.addEventListener('click', exportProgress);
  elements.practiceWeakButton.addEventListener('click', startWeakAreaPractice);

  const mobileQuery = window.matchMedia('(max-width: 620px)');
  mobileQuery.addEventListener?.('change', syncMobileInput);
  syncMobileInput();

  window.addEventListener('keydown', (event) => {
    if (!event.altKey || event.key?.toLowerCase() !== 'n') return;
    if (document.querySelector('dialog[open]')) return;
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
    version: 2,
    totalProblems: 0,
    firstCorrect: 0,
    eventualCorrect: 0,
    independentCorrect: 0,
    assistedCorrect: 0,
    showMe: 0,
    skills: {},
    misconceptions: {},
    recent: [],
  };
}

function loadProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_PROGRESS));
    if (!saved) return emptyProgress();
    if (saved.version === 2) return { ...emptyProgress(), ...saved };
    if (saved.version === 1) {
      const migrated = {
        ...emptyProgress(), ...saved, version: 2,
        independentCorrect: saved.eventualCorrect || 0,
      };
      for (const stats of Object.values(migrated.skills || {})) {
        stats.independentCorrect ??= stats.eventualCorrect || 0;
        stats.assistedCorrect ??= 0;
      }
      return migrated;
    }
    return emptyProgress();
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
  const targetSkill = appConfig.practiceMode === 'weak' ? chooseWeakSkill(seed) : null;
  problem = generateProblem(seed, { ...appConfig, targetSkill });
  wrongAttempts = 0;
  firstAttemptRecorded = false;
  solved = false;
  showMeUsed = false;
  replaceMobileAnswer = false;
  clearAnswerPulse();
  scrollToProblemStart();

  elements.answerInput.value = '';
  elements.answerInput.disabled = false;
  elements.feedbackPanel.hidden = true;
  elements.feedbackPanel.className = 'feedback-panel';
  elements.feedbackHeading.textContent = '';
  elements.feedbackMessage.textContent = '';
  elements.questionPrompt.hidden = true;
  elements.showMeButton.hidden = false;
  elements.nextProblemButton.hidden = true;
  elements.animationControls.hidden = false;
  elements.animationToggleButton.hidden = true;
  elements.replayAnimationButton.hidden = true;
  elements.animationToggleButton.disabled = false;
  elements.choiceAnswerArea.innerHTML = '';

  renderProblemGraphs();
  renderQuestion(problem.question);
  updateDebugPanel();

  updateUrl(seed);

  if (problem.question.inputMode === 'limit' && !isMobileLayout()) {
    requestAnimationFrame(() => elements.answerInput.focus({ preventScroll: true }));
  }
}

function renderQuestion(question) {
  elements.questionHeading.className = `question-math question-${question.type}`;
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
      button.addEventListener('click', () => submitChoice(item.value, button));
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
  const a = question.a !== undefined ? rationalMathML(question.a) : '';
  const unknownTail = '<mrow class="question-tail"><mo>=</mo><mo>?</mo></mrow>';
  if (question.type === 'limitAtInfinity') {
    const infinity = question.direction < 0 ? '<mrow><mo>−</mo><mi>∞</mi></mrow>' : '<mi>∞</mi>';
    return `<math display="block"><munder><mo movablelimits="true">lim</mo><mrow><mi>x</mi><mo>→</mo>${infinity}</mrow></munder><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo>${unknownTail}</math>`;
  }
  if (question.type === 'limitLaw') {
    let expression;
    if (question.operation === 'scale') expression = `${rationalMathML(question.scalar)}<mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo>`;
    else if (question.operation === 'product') expression = '<mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo><mi>g</mi><mo>(</mo><mi>x</mi><mo>)</mo>';
    else if (question.operation === 'quotient') expression = '<mfrac><mrow><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo></mrow><mrow><mi>g</mi><mo>(</mo><mi>x</mi><mo>)</mo></mrow></mfrac>';
    else expression = `<mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>${question.operation === 'add' ? '+' : '−'}</mo><mi>g</mi><mo>(</mo><mi>x</mi><mo>)</mo>`;
    return `<math display="block"><munder><mo movablelimits="true">lim</mo><mrow><mi>x</mi><mo>→</mo>${a}</mrow></munder><mrow>${expression}</mrow>${unknownTail}</math>`;
  }
  if (question.type === 'composition') {
    return `<math display="block"><munder><mo movablelimits="true">lim</mo><mrow><mi>x</mi><mo>→</mo>${a}</mrow></munder><mi>f</mi><mo>(</mo><mi>g</mi><mo>(</mo><mi>x</mi><mo>)</mo><mo>)</mo>${unknownTail}</math>`;
  }
  const fAtA = `<math display="block"><mi>f</mi><mo>(</mo>${a}<mo>)</mo>${unknownTail}</math>`;
  if (question.type === 'functionValue') return fAtA;
  // These are sentences, not formulas. A single block of MathML cannot wrap, so in the
  // narrow desktop question column it was clipped behind a scrollbar mid-question.
  if (question.type === 'continuity') {
    return `Is <math><mi>f</mi></math> continuous at <span class="question-tail"><math><mi>x</mi><mo>=</mo>${a}</math>?</span>`;
  }
  if (question.type === 'classification') {
    return `Classify <math><mi>f</mi></math> at <span class="question-tail"><math><mi>x</mi><mo>=</mo>${a}</math>.</span>`;
  }

  let approach = a;
  if (question.type === 'leftLimit') approach = `<msup>${a}<mo>−</mo></msup>`;
  if (question.type === 'rightLimit') approach = `<msup>${a}<mo>+</mo></msup>`;
  return `<math display="block"><munder><mo movablelimits="true">lim</mo><mrow><mi>x</mi><mo>→</mo>${approach}</mrow></munder><mi>f</mi><mo>(</mo><mi>x</mi><mo>)</mo>${unknownTail}</math>`;
}

function questionPrompt(question) {
  const advancedPrompt = familyQuestionPrompt(question);
  if (advancedPrompt) return advancedPrompt;
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
    // A malformed answer is not a wrong attempt, but it still needs to be visible: on a
    // phone this message sits below the fold exactly like the graded feedback does.
    showFeedback('incorrect', 'Check the answer format', error.message);
    pulseAnswerArea('incorrect');
    revealFeedback();
    return;
  }
  evaluateSubmission(submitted);
}

function submitChoice(value, button) {
  if (solved || problem.question.inputMode !== 'choice') return;
  evaluateSubmission(choice(value));
  // A rejected choice stays visibly ruled out, so it cannot be clicked again and logged as
  // a second misconception.
  if (!solved && button) {
    button.disabled = true;
    button.classList.add('choice-eliminated');
  }
}

function evaluateSubmission(submitted) {
  const correct = answersEqual(submitted, problem.question.answer);
  recordFirstAttempt(correct);

  if (correct) {
    solved = true;
    recordEventualCorrect();
    disableAnswerControls();
    showFeedback('correct', showMeUsed ? 'Completed with help' : positiveHeading(), explanationText(problem));
    elements.nextProblemButton.hidden = false;
    vibrate('correct');
    pulseAnswerArea('correct');
    revealFeedback();
    return;
  }

  wrongAttempts += 1;
  elements.questionPrompt.hidden = false;
  const diagnosis = diagnoseSubmission(problem, submitted);
  recordMisconception(diagnosis.misconception);
  const message = diagnosis.message || diagnoseWrongAnswer(problem, submitted);
  const extension = wrongAttempts >= 2 && !showMeUsed ? ' Show me can trace the reasoning step by step.' : '';
  showFeedback('incorrect', wrongAttempts === 1 ? 'Not quite' : 'Try tracing the approach', `${message}${extension}`);
  vibrate('incorrect');
  pulseAnswerArea('incorrect');
  revealFeedback();

  // Once Show me has run, its animation owns the graph and the pause/replay controls.
  // Swapping in the static hint here hid those controls while the animation kept drawing.
  if (wrongAttempts >= 2 && !showMeUsed) {
    elements.animationControls.hidden = false;
    elements.showMeButton.hidden = false;
    elements.animationToggleButton.hidden = true;
    elements.replayAnimationButton.hidden = true;
    renderStaticHint();
  }
  if (problem.question.inputMode === 'limit') {
    if (isMobileLayout()) replaceMobileAnswer = true;
    else elements.answerInput.select();
  }
}

// On a phone the keypad pushes the feedback panel below the fold, so submitting could look
// like nothing happened. The pulse is the immediate verdict, delivered where the student is
// already looking; the scroll then carries them to the reasoning and to Next problem.
function activeAnswerArea() {
  return problem?.question.inputMode === 'choice' ? elements.choiceAnswerArea : elements.limitAnswerArea;
}

function pulseAnswerArea(type) {
  const area = activeAnswerArea();
  if (!area) return;
  area.classList.remove('answer-pulse-correct', 'answer-pulse-incorrect');
  if (appConfig.reducedMotion) {
    // A held tint rather than a flash, so the verdict still registers without movement.
    area.classList.add(`answer-pulse-${type}`, 'answer-pulse-static');
    return;
  }
  area.classList.remove('answer-pulse-static');
  // Reading offsetWidth restarts the animation when the same class is re-applied.
  void area.offsetWidth;
  area.classList.add(`answer-pulse-${type}`);
}

function clearAnswerPulse() {
  for (const area of [elements.limitAnswerArea, elements.choiceAnswerArea]) {
    area?.classList.remove('answer-pulse-correct', 'answer-pulse-incorrect', 'answer-pulse-static');
  }
}

function scrollBehavior() {
  return appConfig.reducedMotion ? 'auto' : 'smooth';
}

function revealFeedback() {
  if (!isMobileLayout()) return;
  const panel = elements.feedbackPanel;
  if (!panel || panel.hidden) return;
  const box = panel.getBoundingClientRect();
  if (box.top >= 0 && box.bottom <= window.innerHeight) return;
  // 'nearest' scrolls the minimum distance, so after a wrong answer the graph stays as
  // visible as it can while the hint comes into view.
  panel.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
}

function scrollToProblemStart() {
  if (!isMobileLayout()) return;
  window.scrollTo({ top: 0, behavior: scrollBehavior() });
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
  recordRecent({ skill: problem.question.skill, result: correct ? 'first-correct' : 'incorrect' });
  saveProgress();
}

function recordEventualCorrect() {
  progress.eventualCorrect += 1;
  const stats = getSkillStats(problem.question.skill);
  stats.eventualCorrect += 1;
  if (showMeUsed) {
    progress.assistedCorrect += 1;
    stats.assistedCorrect += 1;
    recordRecent({ skill: problem.question.skill, result: 'assisted' });
  } else {
    progress.independentCorrect += 1;
    stats.independentCorrect += 1;
    recordRecent({ skill: problem.question.skill, result: 'independent' });
  }
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
  progress.skills[skill] ??= {
    attempts: 0, firstCorrect: 0, eventualCorrect: 0,
    independentCorrect: 0, assistedCorrect: 0, showMe: 0,
  };
  return progress.skills[skill];
}

function recordMisconception(name) {
  if (!name) return;
  progress.misconceptions[name] = (progress.misconceptions[name] || 0) + 1;
  recordRecent({ skill: problem.question.skill, result: 'misconception', misconception: name });
  saveProgress();
}

function recordRecent(event) {
  progress.recent.push({ ...event, at: Date.now() });
  progress.recent = progress.recent.slice(-60);
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
  if (isMobileLayout()) {
    if (key === 'clear' || (key === 'backspace' && replaceMobileAnswer)) {
      input.value = '';
      replaceMobileAnswer = false;
    } else if (key === 'backspace') {
      input.value = input.value.slice(0, -1);
    } else {
      const display = key === '-' ? '-' : key;
      input.value = replaceMobileAnswer ? display : input.value + display;
      replaceMobileAnswer = false;
    }
    return;
  }
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
  if (!isMobileLayout()) input.focus({ preventScroll: true });
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 620px)').matches;
}

function syncMobileInput() {
  const mobile = isMobileLayout();
  elements.answerInput.readOnly = mobile;
  elements.answerInput.inputMode = mobile ? 'none' : 'decimal';
  elements.answerInput.setAttribute('aria-label', mobile ? 'Answer display; use the keypad below' : 'Your answer');
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

function renderProblemGraphs() {
  const panels = problem.panels || [{ key: 'f', label: 'f', type: 'single', scene: problem.scene }];
  elements.graphPanels.replaceChildren();
  elements.graphPanels.className = `graph-panels ${panels.length > 1 ? 'multi-panel' : ''}`;
  elements.graphHeading.textContent = panels.length > 1 ? 'Follow both graphs' : `Graph of ${panels[0].label}`;
  elements.graphInstruction.textContent = problem.family === 'composition'
    ? 'Read the inner graph first, then carry its output and direction to the outer graph.'
    : problem.family === 'limitLaws'
      ? 'The solid graph is f and the dashed graph is g.'
      : 'Read values and limiting behavior directly from the graph.';

  panels.forEach((panel, panelIndex) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'graph-panel';
    if (panels.length > 1) {
      const heading = document.createElement('h3');
      heading.className = 'graph-panel-heading';
      heading.textContent = panel.label;
      wrapper.append(heading);
    }
    const frame = document.createElement('div');
    frame.className = 'graph-frame';
    const svg = svgElement('svg', {
      viewBox: '0 0 900 520', role: 'img',
      'aria-label': panel.type === 'overlay' ? 'Graphs of f and g on shared axes' : `Graph of ${panel.label}`,
    });
    frame.append(svg);
    wrapper.append(frame);
    elements.graphPanels.append(wrapper);
    const functions = panel.type === 'overlay' ? panel.scenes : [{ key: panel.key, label: panel.key, scene: panel.scene }];
    renderGraph(functions[0].scene, svg, { panelKey: panel.key, panelIndex, functions });
    if (panelIndex === 0) elements.graphSvg = svg;
  });
}

function renderGraph(scene, svg = elements.graphSvg, options = {}) {
  const panelKey = options.panelKey || 'f';
  const functions = options.functions || [{ key: 'f', label: 'f', scene }];
  svg.replaceChildren();

  const title = svgElement('title', {}, functions.length > 1 ? 'Graphs of f and g' : `Graph of ${functions[0].label}`);
  const desc = svgElement('desc', {}, 'Coordinate graph. Open circles are excluded and filled circles are included.');
  svg.append(title, desc);

  const defs = svgElement('defs');
  const clipId = `plotClip-${panelKey}`;
  const clip = svgElement('clipPath', { id: clipId });
  clip.append(svgElement('rect', {
    x: margins.left,
    y: margins.top,
    width: viewport.width - margins.left - margins.right,
    height: viewport.height - margins.top - margins.bottom,
  }));
  defs.append(clip);
  svg.append(defs);

  renderGridAndAxes(svg, scene);

  functions.forEach((entry, functionIndex) => {
    const current = entry.scene;
    const variant = functionIndex === 0 ? '' : '-g';
    const plotGroup = svgElement('g', { 'clip-path': `url(#${clipId})` });
    if (current.left.kind === 'infinite' || current.right.kind === 'infinite') {
      plotGroup.append(svgElement('line', {
        x1: mapX(current.aNumber, current), y1: margins.top,
        x2: mapX(current.aNumber, current), y2: viewport.height - margins.bottom,
        class: 'graph-asymptote',
      }));
    }
    appendHorizontalAsymptotes(plotGroup, current);
    plotGroup.append(renderBranchPath(current.left, current, variant));
    plotGroup.append(renderBranchPath(current.right, current, variant));
    svg.append(plotGroup);
    renderHorizontalAsymptoteLabels(svg, current);
    if (current.feature === 'endBehavior') renderEndBehaviorBreakpointMarkers(svg, current, variant);
    else if (!current.hideEndpointMarkers) renderEndpointMarkers(svg, current, variant);
    renderDistractorMarkers(svg, current, variant);
    renderDomainEndpoints(svg, current, variant);
    renderContinuationIndicators(svg, current, variant);
  });

  functions.forEach((entry, functionIndex) => {
    const current = entry.scene;
    const variant = functionIndex === 0 ? '' : '-g';
    const sharedPlane = functions.length > 1;
    const labelY = sharedPlane
      ? margins.top + 30 + functionIndex * 40
      : mapY(current.yRange.max - 0.65, current);
    const labelX = sharedPlane ? margins.left + 82 : mapX(current.xRange.min + 0.7, current);
    if (sharedPlane) {
      svg.append(svgElement('line', {
        x1: margins.left + 18, y1: labelY - 7,
        x2: margins.left + 68, y2: labelY - 7,
        class: `graph-curve graph-curve${variant} graph-legend-swatch`,
      }));
    }
    const label = svgElement('text', {
      x: labelX,
      y: labelY,
      class: `graph-label graph-function-label${variant}`,
    }, entry.label || entry.key);
    label.setAttribute('font-style', 'italic');
    label.setAttribute('font-weight', '700');
    svg.append(label);
  });

  svg.append(svgElement('g', {
    id: options.panelIndex === 0 ? 'animationLayer' : `animationLayer-${panelKey}`,
    'data-animation-layer': panelKey, 'pointer-events': 'none',
  }));
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
      if (scene.axisStep === 0.5) {
        gridGroup.append(svgElement('text', {
          x: px, y: mapY(0, scene) + 21, 'text-anchor': 'middle', class: 'graph-label graph-fractional-label',
        }, String(x).replace('-', '−')));
      }
    }
    for (let y = Math.ceil(scene.yRange.min * 2) / 2; y <= scene.yRange.max; y += 0.5) {
      if (Number.isInteger(y)) continue;
      const py = mapY(y, scene);
      const line = svgElement('line', { x1: margins.left, y1: py, x2: viewport.width - margins.right, y2: py, class: 'graph-grid' });
      line.setAttribute('opacity', '0.45');
      gridGroup.append(line);
      if (scene.axisStep === 0.5) {
        gridGroup.append(svgElement('text', {
          x: mapX(0, scene) - 9, y: py + 4, 'text-anchor': 'end', class: 'graph-label graph-fractional-label',
        }, String(y).replace('-', '−')));
      }
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

function renderBranchPath(branch, scene, variant = '') {
  const path = svgElement('path', { class: `graph-curve graph-curve${variant}` });
  const points = sampleBranch(branch, scene);
  const d = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${mapX(x, scene).toFixed(2)} ${mapY(y, scene).toFixed(2)}`).join(' ');
  path.setAttribute('d', d);
  return path;
}

function sampleBranch(branch, scene) {
  const epsilon = 0.025;
  const outer = branch.domainOuter ?? (branch.side === 'left' ? scene.xRange.min : scene.xRange.max);
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
      // `outer`, not the plot edge: a branch with a restricted domain must stop at its
      // endpoint, or the curve is drawn straight through the marker saying it ends there.
      const t = i / count;
      x = branch.side === 'left'
        ? outer + (branch.a - epsilon - outer) * t
        : branch.a + epsilon + (outer - branch.a - epsilon) * t;
    }
    points.push([x, branch.eval(x)]);
  }
  return points;
}

function renderEndpointMarkers(svg, scene, variant = '') {
  if (scene.isContinuous) return;
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
      class: `graph-open-point graph-open-point${variant} graph-interest-point`,
    }));
  });

  if (scene.value !== null) {
    svg.append(svgElement('circle', {
      cx: mapX(scene.aNumber, scene),
      cy: mapY(scene.value.toNumber(), scene),
      r: 8,
      class: `graph-closed-point graph-closed-point${variant} graph-interest-point`,
    }));
  }
}

function renderEndBehaviorBreakpointMarkers(svg, scene, variant = '') {
  const breakpoint = scene.breakpoint;
  if (!breakpoint) return;
  const closedY = breakpoint.closedSide === 'left' ? breakpoint.leftY : breakpoint.rightY;
  const openY = breakpoint.closedSide === 'left' ? breakpoint.rightY : breakpoint.leftY;
  const x = mapX(breakpoint.xNumber, scene);

  if (Math.abs(openY - closedY) > 1e-9) {
    svg.append(svgElement('circle', {
      cx: x,
      cy: mapY(openY, scene),
      r: 8,
      class: `graph-open-point graph-open-point${variant} graph-breakpoint-open`,
    }));
  }
  svg.append(svgElement('circle', {
    cx: x,
    cy: mapY(closedY, scene),
    r: 8,
    class: `graph-closed-point graph-closed-point${variant} graph-breakpoint-closed`,
  }));
}

function renderDistractorMarkers(svg, scene, variant = '') {
  for (const distractor of scene.distractors || []) {
    svg.append(svgElement('circle', {
      cx: mapX(distractor.xNumber, scene),
      cy: mapY(distractor.holeY, scene),
      r: 8,
      class: `graph-open-point graph-open-point${variant}`,
    }));
    svg.append(svgElement('circle', {
      cx: mapX(distractor.xNumber, scene),
      cy: mapY(distractor.value.toNumber(), scene),
      r: 8,
      class: `graph-closed-point graph-closed-point${variant}`,
    }));
  }
}

function renderContinuationIndicators(svg, scene, variant = '') {
  if (scene.feature === 'endBehavior') {
    for (const side of ['left', 'right']) {
      const branch = scene[side];
      const exit = endBehaviorExit(branch, scene);
      svg.append(svgElement('path', {
        d: arrowheadPath(exit.px, exit.py, exit.fromPx, exit.fromPy),
        class: `graph-continuation graph-continuation${variant} graph-end-continuation`,
        'data-side': side,
        'data-exit-edge': exit.edge,
      }));
    }
  }

  for (const branch of [scene.left, scene.right]) {
    if (branch.kind !== 'infinite') continue;
    const upward = branch.limit.kind === 'posInf';
    const targetY = upward ? scene.yRange.max - 0.18 : scene.yRange.min + 0.18;
    const distance = (branch.scale / Math.max(0.5, Math.abs(targetY))) ** (1 / branch.power);
    const x = branch.side === 'left' ? branch.a - distance : branch.a + distance;
    const px = mapX(x, scene);
    const py = mapY(targetY, scene);
    const direction = upward ? -1 : 1;
    svg.append(svgElement('path', {
      d: `M ${px - 10} ${py - direction * 18} L ${px} ${py} L ${px + 10} ${py - direction * 18} Z`,
      class: `graph-continuation graph-continuation${variant}`,
    }));
  }
}

// Without a drawn asymptote the student has to judge a limit from a curve that is still
// 0.22 to 0.33 units short of it at the plot edge, which is not distinguishable from a
// neighbouring half-unit value. Textbooks draw the dashed line for exactly this reason.
// Each line spans only its own branch's half, so two different end limits stay legible.
function horizontalAsymptotes(scene) {
  if (scene.feature !== 'endBehavior') return [];
  const found = [];
  for (const side of ['left', 'right']) {
    const branch = scene[side];
    if (branch?.limit?.kind !== 'finite') continue;
    found.push({
      side,
      value: branch.limit.value,
      y: branch.limit.value.toNumber(),
      // y = L + amplitude/(|x|+1), so the sign of amplitude says which side of the line the
      // curve sits on. The label goes on the other side to avoid overlapping it.
      curveAbove: (branch.amplitude ?? 0) > 0,
    });
  }
  return found;
}

function appendHorizontalAsymptotes(plotGroup, scene) {
  for (const asymptote of horizontalAsymptotes(scene)) {
    // An asymptote at y = 0 is the x-axis, already drawn. A dashed line laid over it reads
    // as a second, misaligned axis, so only the label is kept in that case.
    if (asymptote.value.n === 0n) continue;
    const outerX = mapX(asymptote.side === 'left' ? scene.xRange.min : scene.xRange.max, scene);
    plotGroup.append(svgElement('line', {
      x1: outerX, y1: mapY(asymptote.y, scene),
      x2: mapX(0, scene), y2: mapY(asymptote.y, scene),
      class: 'graph-asymptote graph-horizontal-asymptote',
    }));
  }
}

function renderHorizontalAsymptoteLabels(svg, scene) {
  for (const asymptote of horizontalAsymptotes(scene)) {
    const outer = asymptote.side === 'left' ? scene.xRange.min : scene.xRange.max;
    const inset = asymptote.side === 'left' ? outer + 0.35 : outer - 0.35;
    const py = mapY(asymptote.y, scene);
    svg.append(svgElement('text', {
      x: mapX(inset, scene),
      y: asymptote.curveAbove ? py + 26 : py - 12,
      'text-anchor': asymptote.side === 'left' ? 'start' : 'end',
      class: 'graph-label graph-asymptote-label',
    }, `y = ${asymptote.value.toString().replace('-', '−')}`));
  }
}

function endBehaviorExit(branch, scene) {
  const direction = branch.side === 'left' ? -1 : 1;
  const horizontalX = branch.side === 'left' ? scene.xRange.min + 0.18 : scene.xRange.max - 0.18;
  const maxDistance = Math.abs(horizontalX - branch.a);
  const minY = scene.yRange.min + 0.25;
  const maxY = scene.yRange.max - 0.25;
  const atDistance = (distance) => branch.eval(branch.a + direction * distance);
  let distance = maxDistance;
  let edge = 'horizontal';

  if (atDistance(maxDistance) < minY || atDistance(maxDistance) > maxY) {
    edge = 'vertical';
    let inside = 0;
    let outside = maxDistance;
    for (let step = 0; step < 45; step += 1) {
      const candidate = (inside + outside) / 2;
      const y = atDistance(candidate);
      if (y >= minY && y <= maxY) inside = candidate;
      else outside = candidate;
    }
    distance = inside;
  }

  const x = branch.a + direction * distance;
  const y = Math.max(minY, Math.min(maxY, atDistance(distance)));
  const inwardDistance = Math.max(0, distance - Math.min(0.45, Math.max(0.12, distance * 0.18)));
  const inwardX = branch.a + direction * inwardDistance;
  const inwardY = Math.max(minY, Math.min(maxY, atDistance(inwardDistance)));
  return {
    edge,
    px: mapX(x, scene),
    py: mapY(y, scene),
    fromPx: mapX(inwardX, scene),
    fromPy: mapY(inwardY, scene),
  };
}

function arrowheadPath(tipX, tipY, fromX, fromY, length = 18, halfWidth = 10) {
  const magnitude = Math.hypot(tipX - fromX, tipY - fromY) || 1;
  const ux = (tipX - fromX) / magnitude;
  const uy = (tipY - fromY) / magnitude;
  const baseX = tipX - ux * length;
  const baseY = tipY - uy * length;
  const perpendicularX = -uy * halfWidth;
  const perpendicularY = ux * halfWidth;
  return `M ${baseX + perpendicularX} ${baseY + perpendicularY} L ${tipX} ${tipY} L ${baseX - perpendicularX} ${baseY - perpendicularY} Z`;
}

function renderDomainEndpoints(svg, scene, variant = '') {
  for (const endpoint of scene.domainEndpoints || []) {
    const size = 12;
    const x = mapX(endpoint.xNumber, scene);
    const y = mapY(endpoint.y, scene);
    svg.append(svgElement(endpoint.closed ? 'rect' : 'circle', endpoint.closed ? {
      x: x - size / 2, y: y - size / 2, width: size, height: size,
      class: `graph-closed-point graph-closed-point${variant}`,
    } : {
      cx: x, cy: y, r: size / 2,
      class: `graph-open-point graph-open-point${variant}`,
    }));
  }
}

function renderStaticHint() {
  if (problem.family !== 'point') {
    renderAdvancedAnimation(0.22);
    return;
  }
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
  }));
  group.append(svgElement('path', {
    d: arrowheadPath(mapX(end), y, mapX(start), y),
    class: side === 'left' ? 'animation-point-left' : 'animation-point-right',
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
  if (!firstAttemptRecorded) recordFirstAttempt(false);
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
  document.querySelectorAll('[data-animation-layer]').forEach((layer) => layer.replaceChildren());
}

function renderAnimationFrame(progressValue) {
  if (problem.family !== 'point') {
    renderAdvancedAnimation(progressValue);
    return;
  }
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

function animationLayer(key) {
  return document.querySelector(`[data-animation-layer="${key}"]`);
}

function clearAnimationLayers() {
  document.querySelectorAll('[data-animation-layer]').forEach((layer) => layer.replaceChildren());
}

function renderAdvancedAnimation(progressValue) {
  clearAnimationLayers();
  if (problem.family === 'atInfinity') {
    renderAtInfinityAnimation(animationLayer('f'), progressValue);
  } else if (problem.family === 'limitLaws') {
    renderLimitLawAnimation(animationLayer('fg'), progressValue);
  } else if (problem.family === 'composition') {
    renderCompositionAnimation(progressValue);
  }
}

function renderAtInfinityAnimation(layer, progressValue) {
  if (!layer) return;
  const scene = problem.scene;
  const side = problem.question.direction < 0 ? 'left' : 'right';
  const branch = scene[side];
  const start = side === 'left' ? -1 : 1;
  const end = side === 'left' ? scene.xRange.min + 0.25 : scene.xRange.max - 0.25;
  const x = start + (end - start) * progressValue;
  for (let step = 1; step <= 7; step += 1) {
    const past = Math.max(0, progressValue - step * 0.075);
    const trailX = start + (end - start) * past;
    const trail = svgElement('circle', {
      cx: mapX(trailX, scene), cy: mapY(clampToPlot(branch.eval(trailX), scene), scene), r: 5,
      class: side === 'left' ? 'animation-point-left' : 'animation-point-right',
    });
    trail.setAttribute('opacity', String(0.48 - step * 0.05));
    layer.append(trail);
  }
  const yValue = branch.eval(x);
  const visibleY = clampToPlot(yValue, scene);
  const yOutOfView = yValue < scene.yRange.min + 0.08 || yValue > scene.yRange.max - 0.08;
  const px = mapX(x, scene);
  const py = mapY(visibleY, scene);
  const axisY = mapY(0, scene);
  const yAxisX = mapX(0, scene);
  const guideClass = side === 'left' ? 'animation-guide-left' : 'animation-guide-right';
  const pointClass = side === 'left' ? 'animation-point-left' : 'animation-point-right';

  layer.append(svgElement('line', {
    x1: px, y1: axisY, x2: px, y2: py,
    class: `${guideClass} animation-at-infinity-x-guide`,
  }));
  // Once the value leaves the plot its marker is clamped to the edge, so reading it back
  // against the y-axis would announce a finite height the function never approaches. The
  // printed f(x) value below stays honest either way.
  if (!yOutOfView) {
    layer.append(svgElement('line', {
      x1: px, y1: py, x2: yAxisX, y2: py,
      class: `${guideClass} animation-at-infinity-y-guide`,
    }));
    layer.append(svgElement('circle', { cx: yAxisX, cy: py, r: 7, class: pointClass }));
  }
  layer.append(svgElement('circle', { cx: px, cy: axisY, r: 7, class: pointClass }));
  if (yOutOfView) {
    const fromY = py + (yValue > 0 ? 30 : -30);
    layer.append(svgElement('path', {
      d: arrowheadPath(px, py, px, fromY),
      class: `${pointClass} animation-out-of-view-arrow`,
    }));
  } else {
    layer.append(svgElement('circle', { cx: px, cy: py, r: 9, class: pointClass }));
  }
  layer.append(svgElement('text', {
    x: px, y: axisY + 39, 'text-anchor': 'middle',
    class: 'animation-label animation-at-infinity-x-value',
  }, `x = ${formatAnimationValue(x)}`));
  layer.append(svgElement('text', {
    x: yAxisX + (side === 'left' ? 14 : -14),
    y: py + (py < axisY ? 34 : -14),
    'text-anchor': side === 'left' ? 'start' : 'end',
    class: 'animation-label animation-at-infinity-y-value',
  }, `f(x) = ${formatAnimationValue(yValue)}`));
  layer.append(svgElement('text', {
    x: viewport.width / 2, y: margins.top + 30, 'text-anchor': 'middle', class: 'animation-direction-badge',
  }, side === 'left' ? 'x → −∞' : 'x → +∞'));
  if (progressValue > 0.78) renderAnswerBanner(layer);
}

function formatAnimationValue(value) {
  if (Math.abs(value) >= 1000) return value.toExponential(1).replace('e+', 'e');
  const rounded = Math.round(value * 10) / 10;
  return String(Object.is(rounded, -0) ? 0 : rounded).replace('-', '−');
}

function renderLimitLawAnimation(layer, progressValue) {
  if (!layer) return;
  const panel = problem.panels[0];
  const fScene = panel.scenes[0].scene;
  const gScene = panel.scenes[1].scene;
  const sideResults = problem.question.combinedSideLimits;
  const aX = mapX(fScene.aNumber, fScene);
  layer.append(svgElement('line', { x1: aX, y1: margins.top, x2: aX, y2: viewport.height - margins.bottom, class: 'animation-focus' }));
  if (progressValue < 0.4) {
    const p = progressValue / 0.4;
    renderPhaseLabel(layer, 'From the left: apply the law to f and g');
    renderApproach(layer, 'left', p, fScene);
    renderApproach(layer, 'left', p, gScene);
    if (p > 0.62) renderLimitLawSideResult(layer, 'left', sideResults.left);
  } else if (progressValue < 0.8) {
    const p = (progressValue - 0.4) / 0.4;
    renderPhaseLabel(layer, 'From the right: apply the law to f and g');
    renderApproach(layer, 'right', p, fScene);
    renderApproach(layer, 'right', p, gScene);
    if (p > 0.62) renderLimitLawSideResult(layer, 'right', sideResults.right);
  } else {
    renderPhaseLabel(layer, 'Finally: compare the combined one-sided limits');
    renderApproach(layer, 'left', 1, fScene);
    renderApproach(layer, 'right', 1, fScene);
    renderApproach(layer, 'left', 1, gScene);
    renderApproach(layer, 'right', 1, gScene);
    renderLimitLawComparison(layer, sideResults);
  }
}

function renderLimitLawSideResult(layer, side, result) {
  const text = `${side === 'left' ? 'Left' : 'Right'}-hand result: ${answerText(result)}`;
  const width = Math.min(570, 185 + text.length * 8.2);
  const x = (viewport.width - width) / 2;
  const y = margins.top + 10;
  layer.append(svgElement('rect', { x, y, width, height: 48, rx: 8, class: 'animation-banner' }));
  layer.append(svgElement('text', {
    x: viewport.width / 2, y: y + 31, 'text-anchor': 'middle',
    class: 'animation-label animation-limit-law-side-result',
  }, text));
}

function renderLimitLawComparison(layer, sideResults) {
  const left = answerText(sideResults.left);
  const right = answerText(sideResults.right);
  const text = `Left: ${left}   Right: ${right}   answer: ${answerText(problem.question.answer)}`;
  const width = Math.min(760, 185 + text.length * 8.2);
  const x = (viewport.width - width) / 2;
  const y = margins.top + 10;
  layer.append(svgElement('rect', { x, y, width, height: 48, rx: 8, class: 'animation-final-note' }));
  layer.append(svgElement('text', {
    x: viewport.width / 2, y: y + 31, 'text-anchor': 'middle',
    class: 'animation-label animation-limit-law-comparison',
  }, text));
}

function renderCompositionAnimation(progressValue) {
  const gLayer = animationLayer('g');
  const fLayer = animationLayer('f');
  const inner = problem.panels[0].scene;
  const outer = problem.panels[1].scene;
  if (progressValue > 0.9 && gLayer) {
    renderApproach(gLayer, 'left', 1, inner);
    renderApproach(gLayer, 'right', 1, inner);
    renderPhaseLabel(gLayer, 'g determines the inputs sent to f');
  }
  if (progressValue < 0.48) {
    if (!gLayer) return;
    renderPhaseLabel(gLayer, 'First: follow g(x)');
    renderApproach(gLayer, 'left', progressValue / 0.48, inner);
    renderApproach(gLayer, 'right', progressValue / 0.48, inner);
    return;
  }
  if (!fLayer) return;
  const direction = problem.question.innerDirection;
  renderPhaseLabel(fLayer, direction === 'left' || direction === 'right'
    ? `Then: approach f from the ${direction}` : 'Then: carry those outputs into f');
  const p = Math.min(1, (progressValue - 0.48) / 0.42);
  if (direction === 'left' || direction === 'right') renderApproach(fLayer, direction, p, outer);
  else {
    renderApproach(fLayer, 'left', p, outer);
    renderApproach(fLayer, 'right', p, outer);
  }
  if (progressValue > 0.9) renderAnswerBanner(fLayer);
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
    // With two infinite branches there is no open circle to point at, only an asymptote.
    const finiteBranch = [scene.left, scene.right].find((branch) => branch.limit.kind === 'finite');
    const y = finiteBranch ? mapY(finiteBranch.limit.value.toNumber()) : mapY(0);
    layer.append(svgElement('text', { x, y: y - 20, 'text-anchor': 'middle', class: 'animation-label' },
      finiteBranch ? 'open, not filled' : 'no filled point'));
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
function renderOscillationTrail(layer, side, progressValue, pointClass, scene = problem.scene) {
  const branch = side === 'left' ? scene.left : scene.right;
  const yAxisX = mapX(0, scene);
  for (let step = 1; step <= 7; step += 1) {
    const past = progressValue - step * 0.04;
    if (past <= 0) break;
    const distance = approachDistance(branch, past);
    const x = side === 'left' ? scene.aNumber - distance : scene.aNumber + distance;
    const marker = svgElement('circle', {
      cx: yAxisX, cy: mapY(clampToPlot(branch.eval(x), scene), scene), r: 5, class: pointClass,
    });
    marker.setAttribute('opacity', (0.5 - step * 0.055).toFixed(2));
    layer.append(marker);
  }
}

function renderApproach(layer, side, progressValue, scene = problem.scene) {
  const branch = side === 'left' ? scene.left : scene.right;
  const unbounded = branch.limit.kind === 'posInf' || branch.limit.kind === 'negInf';
  const distance = approachDistance(branch, progressValue);
  const xValue = side === 'left' ? scene.aNumber - distance : scene.aNumber + distance;
  const visibleY = clampToPlot(branch.eval(xValue), scene);
  const px = mapX(xValue, scene);
  const py = mapY(visibleY, scene);
  const axisY = mapY(0, scene);
  const yAxisX = mapX(0, scene);
  const guideClass = side === 'left' ? 'animation-guide-left' : 'animation-guide-right';
  const pointClass = side === 'left' ? 'animation-point-left' : 'animation-point-right';

  layer.append(svgElement('circle', { cx: px, cy: axisY, r: 7, class: pointClass }));
  layer.append(svgElement('line', { x1: px, y1: axisY, x2: px, y2: py, class: guideClass }));
  layer.append(svgElement('circle', { cx: px, cy: py, r: 8, class: pointClass }));

  // The y-value is clamped to keep the dot on screen, so on an unbounded branch reading it
  // back against the y-axis would announce a finite height the function never approaches.
  if (!unbounded) {
    if (branch.kind === 'oscillatory') {
      renderOscillationTrail(layer, side, progressValue, pointClass, scene);
      layer.append(svgElement('rect', {
        x: mapX(scene.aNumber - 0.55, scene), y: mapY((branch.offset ?? 0) + (branch.amplitude ?? 2), scene),
        width: Math.abs(mapX(scene.aNumber + 0.55, scene) - mapX(scene.aNumber - 0.55, scene)),
        height: Math.abs(mapY((branch.offset ?? 0) - (branch.amplitude ?? 2), scene) - mapY((branch.offset ?? 0) + (branch.amplitude ?? 2), scene)),
        class: 'animation-oscillation-band',
      }));
    }
    layer.append(svgElement('line', { x1: px, y1: py, x2: yAxisX, y2: py, class: guideClass }));
    layer.append(svgElement('circle', { cx: yAxisX, cy: py, r: 7, class: pointClass }));
  }

  if (branch.limit.kind === 'finite') {
    layer.append(svgElement('circle', {
      cx: mapX(scene.aNumber, scene), cy: mapY(branch.limit.value.toNumber(), scene), r: 15,
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
      x: mapX(scene.aNumber, scene) + (side === 'left' ? -35 : 35),
      y: mapY(branch.offset ?? 0, scene),
      'text-anchor': 'middle',
      class: 'animation-label',
    }, '?'));
  }
  layer.append(svgElement('text', {
    x: side === 'left' ? mapX(scene.aNumber, scene) - 34 : mapX(scene.aNumber, scene) + 34,
    y: margins.top + 30, 'text-anchor': 'middle', class: 'animation-direction-badge',
  }, side === 'left' ? 'a−' : 'a+'));
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
  elements.presetInput.value = PRESETS[appConfig.preset] ? appConfig.preset : 'custom';
  // Left blank so that saving new settings serves a fresh problem, as the help text says.
  // The current seed is offered as a placeholder for anyone who wants to reuse it.
  elements.seedInput.value = '';
  elements.seedInput.placeholder = problem?.seed ?? '';
  document.querySelectorAll('input[name="family"]').forEach((input) => {
    input.checked = Boolean(appConfig.families[input.value]);
  });
  document.querySelectorAll('input[name="questionType"]').forEach((input) => {
    input.checked = Boolean(appConfig.questionTypes[input.value]);
  });
  document.querySelectorAll('input[name="feature"]').forEach((input) => {
    input.checked = Boolean(appConfig.features[input.value]);
  });
  elements.hapticsInput.checked = appConfig.haptics;
  elements.reducedMotionInput.checked = appConfig.reducedMotion;
}

function applySelectedPreset() {
  if (elements.presetInput.value === 'custom') return;
  const preview = configForPreset(elements.presetInput.value, {
    ...appConfig,
    difficulty: Number(elements.difficultyInput.value),
  });
  document.querySelectorAll('input[name="family"]').forEach((input) => {
    input.checked = Boolean(preview.families[input.value]);
  });
  document.querySelectorAll('input[name="questionType"]').forEach((input) => {
    input.checked = Boolean(preview.questionTypes[input.value]);
  });
  document.querySelectorAll('input[name="feature"]').forEach((input) => {
    input.checked = Boolean(preview.features[input.value]);
  });
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
  const families = {};
  document.querySelectorAll('input[name="family"]').forEach((input) => { families[input.value] = input.checked; });
  const questionTypes = {};
  document.querySelectorAll('input[name="questionType"]').forEach((input) => { questionTypes[input.value] = input.checked; });
  const features = {};
  document.querySelectorAll('input[name="feature"]').forEach((input) => { features[input.value] = input.checked; });

  if (!Object.values(families).some(Boolean)) {
    elements.optionsError.textContent = 'Select at least one major family.';
    return;
  }
  if (families.point && !Object.values(questionTypes).some(Boolean)) {
    elements.optionsError.textContent = 'Select at least one question type.';
    return;
  }
  if (families.point && !Object.values(features).some(Boolean)) {
    elements.optionsError.textContent = 'Select at least one kind of graph behavior.';
    return;
  }

  appConfig = {
    ...normalizeConfig({
      difficulty: Number(elements.difficultyInput.value), questionTypes, features, families,
      preset: elements.presetInput.value,
      practiceMode: elements.presetInput.value === 'weakAreas' ? 'weak' : 'mixed',
    }),
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
  elements.presetInput.value = 'examReview';
  elements.difficultyInput.value = String(defaults.difficulty);
  elements.seedInput.value = '';
  document.querySelectorAll('input[name="family"]').forEach((input) => {
    input.checked = Boolean(defaults.families[input.value]);
  });
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
    <div class="summary-stat"><strong>${progress.independentCorrect}</strong><span>solved independently</span></div>
    <div class="summary-stat"><strong>${progress.assistedCorrect}</strong><span>completed with help</span></div>
  `;

  const skills = Object.entries(progress.skills).sort((a, b) => b[1].attempts - a[1].attempts);
  if (!skills.length) {
    elements.progressSkills.innerHTML = '<p class="help-text">No practice data yet. Your results will appear here after your first submission.</p>';
    elements.progressMisconceptions.replaceChildren();
    return;
  }

  elements.progressSkills.replaceChildren();
  skills.forEach(([skill, stats]) => {
    const rate = stats.attempts ? Math.round((stats.firstCorrect / stats.attempts) * 100) : 0;
    const mastery = masteryFor(stats);
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.innerHTML = `
      <div class="skill-name">${escapeHtml(skillLabel(skill))}<br><span class="mastery-label mastery-${mastery.className}">${mastery.label}</span></div>
      <div class="skill-bar" aria-label="${rate}% first-attempt accuracy"><span style="width:${rate}%"></span></div>
      <div class="skill-stat">${stats.firstCorrect}/${stats.attempts} first try</div>
    `;
    elements.progressSkills.append(row);
  });

  renderMisconceptions();
}

function masteryFor(stats) {
  if (stats.attempts < 3) return { label: 'Developing', className: 'developing' };
  const score = (stats.firstCorrect + 0.35 * (stats.assistedCorrect || 0)) / stats.attempts;
  if (score >= 0.8) return { label: 'Strong', className: 'strong' };
  if (score >= 0.5) return { label: 'Developing', className: 'developing' };
  return { label: 'Needs practice', className: 'needs-practice' };
}

function renderMisconceptions() {
  const entries = Object.entries(progress.misconceptions || {}).sort((a, b) => b[1] - a[1]);
  elements.progressMisconceptions.replaceChildren();
  if (!entries.length) return;
  const heading = document.createElement('h3');
  heading.textContent = 'Patterns to revisit';
  elements.progressMisconceptions.append(heading);
  entries.slice(0, 6).forEach(([name, count]) => {
    const row = document.createElement('div');
    row.className = 'misconception-row';
    row.innerHTML = `<span>${escapeHtml(misconceptionLabel(name))}</span><strong>${count}</strong>`;
    elements.progressMisconceptions.append(row);
  });
}

function misconceptionLabel(name) {
  const labels = {
    'function-value-vs-limit': 'Function value versus limit',
    'wrong-one-sided-branch': 'Wrong one-sided branch',
    'infinity-sign': 'Positive versus negative infinity',
    'infinity-vs-dne': 'Infinity versus DNE',
    'x-y-swap': 'Roles of x and y',
    'quotient-zero': 'Quotient law with denominator tending to zero',
    'composition-direction': 'Direction through a composition',
    'inner-outer-swap': 'Inner versus outer function',
    'direct-substitution': 'Overusing direct substitution',
    'operation-error': 'Limit-law arithmetic',
    'graph-reading': 'Graph interpretation',
  };
  return labels[name] || name.replaceAll('-', ' ');
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
    'at-infinity': 'Limits at infinity',
    'limit-law': 'Limit laws',
    composition: 'Composition',
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

function chooseWeakSkill(seed) {
  const candidates = Object.entries(progress.skills || {}).map(([skill, stats]) => {
    const attempts = Math.max(1, stats.attempts || 0);
    const success = ((stats.firstCorrect || 0) + 0.35 * (stats.assistedCorrect || 0)) / attempts;
    const recentMisses = (progress.recent || []).slice(-24)
      .filter((event) => event.skill === skill && (event.result === 'incorrect' || event.result === 'misconception')).length;
    return { skill, need: (1 - success) + Math.min(0.45, recentMisses * 0.09) + (attempts < 3 ? 0.2 : 0) };
  }).sort((a, b) => b.need - a.need);
  if (!candidates.length) return null;
  const shortlist = candidates.slice(0, Math.min(3, candidates.length));
  return shortlist[Math.abs(hashString(`${seed}:weak`)) % shortlist.length].skill;
}

function startWeakAreaPractice() {
  appConfig = {
    ...configForPreset('weakAreas', appConfig),
    haptics: appConfig.haptics,
    reducedMotion: appConfig.reducedMotion,
  };
  saveConfigToStorage();
  elements.progressDialog.close();
  startProblem(randomSeed());
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
  const f = params.get('f');
  if (!params.has('d') && !q && !g && !f) return fallback;

  const questionCodes = { f: 'functionValue', o: 'oneSided', t: 'twoSided', c: 'continuity', k: 'classification' };
  const featureCodes = { c: 'continuous', r: 'removable', j: 'jump', i: 'infinite', o: 'oscillatory' };
  const questionTypes = Object.fromEntries(Object.values(questionCodes).map((key) => [key, false]));
  const features = Object.fromEntries(Object.values(featureCodes).map((key) => [key, false]));
  const familyCodes = { p: 'point', a: 'atInfinity', l: 'limitLaws', m: 'composition' };
  const families = Object.fromEntries(Object.values(familyCodes).map((key) => [key, false]));
  for (const code of q || '') if (questionCodes[code]) questionTypes[questionCodes[code]] = true;
  for (const code of g || '') if (featureCodes[code]) features[featureCodes[code]] = true;
  for (const code of f || '') if (familyCodes[code]) families[familyCodes[code]] = true;
  // Every problem rewrites the address bar, so a plain reload arrives here too. Without the
  // preset it came back as Custom, and Practice My Weak Areas silently stopped targeting.
  const preset = PRESETS[params.get('p')] ? params.get('p') : 'custom';

  return {
    ...normalizeConfig({
      preset,
      practiceMode: PRESETS[preset]?.practiceMode === 'weak' ? 'weak' : 'mixed',
      difficulty: Number(params.get('d') || fallback.difficulty),
      questionTypes: q ? questionTypes : fallback.questionTypes,
      features: g ? features : fallback.features,
      families: f ? families : (q || g
        ? { point: true, atInfinity: false, limitLaws: false, composition: false }
        : fallback.families),
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
  const f = [
    ['p', 'point'], ['a', 'atInfinity'], ['l', 'limitLaws'], ['m', 'composition'],
  ].filter(([, key]) => appConfig.families[key]).map(([code]) => code).join('');
  url.searchParams.set('q', q);
  url.searchParams.set('g', g);
  url.searchParams.set('f', f);
  if (PRESETS[appConfig.preset]) url.searchParams.set('p', appConfig.preset);
  else url.searchParams.delete('p');
  return url;
}

function updateUrl(seed) {
  history.replaceState(null, '', problemUrl(seed));
}

async function copyCurrentSeed() {
  const seed = String(problem.seed);
  try {
    await navigator.clipboard.writeText(seed);
    elements.copySeedButton.textContent = 'Copied';
    setTimeout(() => { elements.copySeedButton.textContent = 'Copy current seed'; }, 1300);
  } catch {
    prompt('Copy this problem seed:', seed);
  }
}

function updateDebugPanel() {
  if (elements.debugPanel.hidden) return;
  const data = serializeProblem(problem);
  if (problem.family === 'point') {
    data.leftBranch = describeBranch(problem.scene.left);
    data.rightBranch = describeBranch(problem.scene.right);
  }
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
