import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { answerText, generateProblem } from './advanced.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const browserCandidates = process.platform === 'win32'
  ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
  : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const browserPath = browserCandidates.find(existsSync);

if (!browserPath) {
  console.log('Browser regression tests skipped: no supported Chrome or Edge executable found.');
  process.exit(0);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root) || !existsSync(filename)) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filename)] || 'application/octet-stream' });
    response.end(await readFile(filename));
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const appPort = server.address().port;
const debugPort = 9400 + Math.floor(Math.random() * 300);
const profile = await mkdtemp(path.join(os.tmpdir(), 'limits-browser-test-'));
const browser = spawn(browserPath, [
  '--headless=new', '--disable-gpu', '--disable-crash-reporter', '--no-first-run',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, 'about:blank',
], { stdio: 'ignore' });

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
  }

  async ready() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

async function waitForJson(url, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Browser startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

let cdp;
try {
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json`);
  const target = targets.find((item) => item.type === 'page');
  assert(target?.webSocketDebuggerUrl, 'Browser did not expose a page target.');
  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
    return result.result.value;
  }

  async function navigate(url, width, height) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width <= 620,
    });
    await cdp.send('Page.navigate', { url });
    const started = Date.now();
    while (Date.now() - started < 10000) {
      const ready = await evaluate("document.readyState === 'complete' && Boolean(document.querySelector('#questionHeading math'))");
      if (ready) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error(`App did not finish rendering ${url}`);
  }

  const base = `http://127.0.0.1:${appPort}`;
  await navigate(`${base}/?seed=mobile-composition&f=m&d=3`, 390, 844);
  const mobile = await evaluate(`(() => {
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { top: value.top, bottom: value.bottom, left: value.left, right: value.right, width: value.width, height: value.height };
    };
    const box = (selector) => rect(document.querySelector(selector));
    const panels = [...document.querySelectorAll('.graph-panel')].map(rect);
    return {
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      readOnly: document.querySelector('#answerInput').readOnly,
      showMeVisible: !document.querySelector('#showMeButton').hidden,
      mainSeedButton: Boolean(document.querySelector('.graph-card #copySeedButton')),
      question: box('.question-strip'), graph: box('.graph-card'), answer: box('.answer-card'), panels,
    };
  })()`);
  assert.equal(mobile.innerWidth, 390);
  assert(mobile.scrollWidth <= mobile.innerWidth, `Mobile page overflows horizontally (${mobile.scrollWidth}px).`);
  assert.equal(mobile.readOnly, true, 'Mobile answer input must suppress the system keyboard.');
  assert.equal(mobile.showMeVisible, true, 'Show me must be immediately visible.');
  assert.equal(mobile.mainSeedButton, false, 'The seed-copy control must not consume mobile graph-header space.');
  const questionTail = await evaluate(`(() => {
    const tail = document.querySelector('.question-tail').getBoundingClientRect();
    const math = document.querySelector('#questionHeading math').getBoundingClientRect();
    return { tailTop: tail.top, tailBottom: tail.bottom, mathTop: math.top, mathBottom: math.bottom };
  })()`);
  assert(questionTail.tailTop >= questionTail.mathTop && questionTail.tailBottom <= questionTail.mathBottom + 1,
    `The terminal question mark must remain attached to the MathML expression: ${JSON.stringify(questionTail)}`);
  assert(mobile.question.top < mobile.graph.top && mobile.graph.top < mobile.answer.top,
    `Mobile reading order must be question, graph, then answer: ${JSON.stringify(mobile)}`);
  assert.equal(mobile.panels.length, 2);
  assert(mobile.panels[1].top > mobile.panels[0].bottom, 'Composition panels must stack on mobile.');

  // The keypad pushes the feedback panel below the fold on a phone, so a submitted answer
  // used to look like it did nothing: no verdict, and Next problem off-screen entirely.
  // q=o pins a one-sided limit, so these two checks always exercise the typed-answer form
  // rather than landing on a multiple-choice question depending on the seed.
  await navigate(`${base}/?seed=mobile-reveal&f=p&q=o&d=2`, 390, 844);
  const beforeSubmit = await evaluate(`({
    feedbackHidden: document.querySelector('#feedbackPanel').hidden,
    scrollY: Math.round(scrollY),
  })`);
  assert.equal(beforeSubmit.feedbackHidden, true);
  // 999999 parses, so this exercises the graded path rather than the format-error path.
  await evaluate(`(() => {
    document.querySelector('#answerInput').value = '999999';
    document.querySelector('#answerForm').requestSubmit();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 900));
  const afterSubmit = await evaluate(`(() => {
    const panel = document.querySelector('#feedbackPanel').getBoundingClientRect();
    const area = document.querySelector('#limitAnswerArea');
    return {
      panelTop: panel.top,
      panelBottom: panel.bottom,
      innerHeight,
      pulsed: area.className,
      graphStillVisible: document.querySelector('.graph-card').getBoundingClientRect().bottom > 0,
    };
  })()`);
  assert(afterSubmit.panelTop < afterSubmit.innerHeight,
    `Feedback must be reachable after submitting on a phone: ${JSON.stringify(afterSubmit)}`);
  assert(/answer-pulse-(correct|incorrect)/.test(afterSubmit.pulsed),
    `The answer region must carry the immediate verdict: ${afterSubmit.pulsed}`);
  assert(afterSubmit.graphStillVisible,
    'Scrolling to the feedback must not push the graph off-screen after a wrong answer.');

  // A malformed answer returns before grading, so it needs the same treatment.
  await navigate(`${base}/?seed=mobile-format&f=p&q=o&d=2`, 390, 844);
  await evaluate(`(() => {
    document.querySelector('#answerInput').value = 'not a number';
    document.querySelector('#answerForm').requestSubmit();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 900));
  const formatError = await evaluate(`({
    heading: document.querySelector('#feedbackHeading').textContent,
    panelTop: document.querySelector('#feedbackPanel').getBoundingClientRect().top,
    innerHeight,
    pulsed: document.querySelector('#limitAnswerArea').className,
  })`);
  assert.equal(formatError.heading, 'Check the answer format');
  assert(formatError.panelTop < formatError.innerHeight,
    `A format error must also be reachable on a phone: ${JSON.stringify(formatError)}`);
  assert(/answer-pulse-incorrect/.test(formatError.pulsed),
    `A format error must pulse the answer region: ${formatError.pulsed}`);

  await navigate(`${base}/?seed=mobile-law&f=l&d=3`, 390, 844);
  const law = await evaluate(`({
    panels: document.querySelectorAll('.graph-panel').length,
    svgs: document.querySelectorAll('.graph-panel svg').length,
    curves: document.querySelectorAll('.graph-curve').length,
    swatches: [...document.querySelectorAll('.graph-legend-swatch')].map((element) => ({
      stroke: getComputedStyle(element).stroke,
      dash: getComputedStyle(element).strokeDasharray,
    })),
    gCurveDash: getComputedStyle(document.querySelector('path.graph-curve-g')).strokeDasharray,
    gCurveLinecap: getComputedStyle(document.querySelector('path.graph-curve-g')).strokeLinecap,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
  })`);
  assert.equal(law.panels, 1, 'Limit laws should share one coordinate plane.');
  assert.equal(law.svgs, 1);
  assert(law.curves >= 4, 'Shared limit-law graph must draw both sides of both functions.');
  assert.equal(law.swatches.length, 2, 'The shared graph legend must include a line swatch for each function.');
  assert.notEqual(law.swatches[0].stroke, law.swatches[1].stroke, 'Legend swatches must preserve the function colors.');
  assert.notEqual(law.swatches[0].dash, law.swatches[1].dash, 'The g swatch must preserve its dashed line style.');
  const mobileDash = law.gCurveDash.match(/[\d.]+/g).map(Number);
  assert(mobileDash[0] <= 6 && mobileDash[1] > mobileDash[0],
    `Mobile g dashes must be short and visibly separated: ${law.gCurveDash}`);
  assert.equal(law.gCurveLinecap, 'butt', 'Flat dash ends prevent mobile g dashes from visually merging.');
  assert(law.scrollWidth <= law.innerWidth, 'Limit-law controls must fit the phone viewport.');

  await navigate(`${base}/?seed=continuous-without-marker&f=p&g=c&q=fotck&d=2`, 390, 844);
  const continuousPointMarkers = await evaluate("document.querySelectorAll('.graph-interest-point').length");
  assert.equal(continuousPointMarkers, 0,
    'A continuous point of interest should look like an ordinary part of the curve, without a marker.');

  let cancellationIndex = 0;
  let cancellationProblem;
  const lawsOnly = { families: { point: false, atInfinity: false, limitLaws: true, composition: false }, difficulty: 3 };
  do {
    cancellationProblem = generateProblem(`law-animation-${cancellationIndex++}`, lawsOnly);
  } while (cancellationProblem.question.caseType !== 'cancellation');
  await evaluate(`localStorage.setItem('graphicalLimitsTrainer.config.v1', JSON.stringify({
    difficulty: 3,
    families: { point: false, atInfinity: false, limitLaws: true, composition: false },
    reducedMotion: true,
    haptics: false
  }))`);
  await navigate(`${base}/?seed=${encodeURIComponent(cancellationProblem.seed)}&f=l&d=3`, 390, 844);
  await evaluate("document.querySelector('#showMeButton').click()");
  const lawComparison = await evaluate("document.querySelector('.animation-limit-law-comparison')?.textContent || ''");
  assert(/Left: 0/.test(lawComparison), `Limit-law animation omitted the combined left-hand result: ${lawComparison}`);
  assert(/Right: 0/.test(lawComparison), `Limit-law animation omitted the combined right-hand result: ${lawComparison}`);
  assert(/answer: 0/.test(lawComparison), `Limit-law animation did not compare the side results: ${lawComparison}`);

  await evaluate(`localStorage.setItem('graphicalLimitsTrainer.config.v1', JSON.stringify({
    difficulty: 3,
    families: { point: false, atInfinity: true, limitLaws: false, composition: false },
    reducedMotion: true,
    haptics: false
  }))`);
  await navigate(`${base}/?seed=infinity-animation&f=a&d=3`, 390, 844);
  await evaluate("document.querySelector('#showMeButton').click()");
  const infinityReadout = await evaluate(`({
    xGuide: Boolean(document.querySelector('.animation-at-infinity-x-guide')),
    yGuide: Boolean(document.querySelector('.animation-at-infinity-y-guide')),
    xValue: document.querySelector('.animation-at-infinity-x-value')?.textContent || '',
    yValue: document.querySelector('.animation-at-infinity-y-value')?.textContent || '',
  })`);
  assert(infinityReadout.xGuide, 'A limit-at-infinity explanation must project the moving point to the x-axis.');
  assert(infinityReadout.yGuide, 'A limit-at-infinity explanation must project the moving point to the y-axis.');
  assert(/^x = −?\d/.test(infinityReadout.xValue), `Missing numeric x-value: ${infinityReadout.xValue}`);
  assert(/^f\(x\) = −?\d/.test(infinityReadout.yValue), `Missing numeric y-value: ${infinityReadout.yValue}`);

  let jumpIndex = 0;
  let infinityJumpProblem;
  const infinityOnly = { families: { point: false, atInfinity: true, limitLaws: false, composition: false }, difficulty: 3 };
  do {
    infinityJumpProblem = generateProblem(`infinity-jump-${jumpIndex++}`, infinityOnly);
  } while (Math.abs(infinityJumpProblem.scene.breakpoint.leftY - infinityJumpProblem.scene.breakpoint.rightY) < 1e-9);
  await navigate(`${base}/?seed=${encodeURIComponent(infinityJumpProblem.seed)}&f=a&d=3`, 390, 844);
  const breakpointMarkers = await evaluate(`({
    open: document.querySelectorAll('.graph-breakpoint-open').length,
    closed: document.querySelectorAll('.graph-breakpoint-closed').length,
  })`);
  assert.equal(breakpointMarkers.open, 1, 'A jump in an end-behavior graph must show the excluded endpoint.');
  assert.equal(breakpointMarkers.closed, 1, 'A jump in an end-behavior graph must show the included endpoint.');

  let steepIndex = 0;
  let steepInfinityProblem;
  let steepSide;
  do {
    steepInfinityProblem = generateProblem(`infinity-steep-${steepIndex++}`, infinityOnly);
    steepSide = steepInfinityProblem.question.direction < 0 ? 'left' : 'right';
    const branch = steepInfinityProblem.scene[steepSide];
    const edgeX = steepSide === 'left' ? -7.82 : 7.82;
    if ((steepInfinityProblem.question.answer.kind === 'posInf' || steepInfinityProblem.question.answer.kind === 'negInf')
      && Math.abs(branch.eval(edgeX)) > 5.75) break;
  } while (steepIndex < 500);
  assert(steepIndex < 500, 'Expected to generate a steep unbounded end-behavior branch.');
  await navigate(`${base}/?seed=${encodeURIComponent(steepInfinityProblem.seed)}&f=a&d=3`, 390, 844);
  const staticExitEdge = await evaluate(`document.querySelector(
    '.graph-end-continuation[data-side="${steepSide}"]'
  )?.dataset.exitEdge || ''`);
  assert.equal(staticExitEdge, 'vertical', 'A steep end-behavior arrow must sit where the curve exits vertically.');
  await evaluate("document.querySelector('#showMeButton').click()");
  const animatedOutOfViewArrow = await evaluate("Boolean(document.querySelector('.animation-out-of-view-arrow'))");
  assert(animatedOutOfViewArrow, 'An unbounded limit-at-infinity animation must point toward its off-screen function value.');

  let assistedSeed = 0;
  let assistedProblem;
  const pointOnly = { families: { point: true, atInfinity: false, limitLaws: false, composition: false }, difficulty: 2 };
  do {
    assistedProblem = generateProblem(`assisted-${assistedSeed++}`, pointOnly);
  } while (assistedProblem.question.inputMode !== 'limit');
  await navigate(`${base}/?seed=${encodeURIComponent(assistedProblem.seed)}&f=p&d=2`, 390, 844);
  await evaluate(`(() => {
    const input = document.querySelector('#answerInput');
    input.value = '999';
    document.querySelector('#answerForm').requestSubmit();
    for (const key of ['1', '2', '3']) document.querySelector('#mobileKeypad [data-key="' + key + '"]').click();
  })()`);
  const keypadAfterIncorrect = await evaluate("document.querySelector('#answerInput').value");
  assert.equal(keypadAfterIncorrect, '123',
    'Mobile keypad digits must replace an incorrect answer and remain in press order.');
  await evaluate("document.querySelector('#showMeButton').click()");
  await new Promise((resolve) => setTimeout(resolve, 180));
  const animationMarks = await evaluate("document.querySelectorAll('[data-animation-layer] > *').length");
  assert(animationMarks > 0, 'Show me must render an explanation frame.');
  const submitted = JSON.stringify(answerText(assistedProblem.question.answer));
  await evaluate(`(() => {
    const input = document.querySelector('#answerInput');
    input.value = ${submitted};
    document.querySelector('#answerForm').requestSubmit();
  })()`);
  const stored = await evaluate("JSON.parse(localStorage.getItem('graphicalLimitsTrainer.progress.v1'))");
  assert.equal(stored.firstCorrect, 0);
  assert.equal(stored.assistedCorrect, 1, 'A post-explanation solution must be recorded as assisted.');
  assert.equal(stored.independentCorrect, 0);

  await navigate(`${base}/?seed=desktop-review&f=palm&d=3`, 1280, 900);
  const desktop = await evaluate(`({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    questionRight: document.querySelector('.question-strip').getBoundingClientRect().right,
    graphRight: document.querySelector('.graph-card').getBoundingClientRect().right,
    questionScrollWidth: document.querySelector('#questionHeading').scrollWidth,
    questionClientWidth: document.querySelector('#questionHeading').clientWidth,
  })`);
  assert(desktop.scrollWidth <= desktop.innerWidth, 'Desktop layout must not overflow horizontally.');
  assert(desktop.graphRight < desktop.questionRight, 'Desktop graph and question columns must remain distinct.');
  assert(desktop.questionScrollWidth <= desktop.questionClientWidth,
    'The desktop MathML question must fit without a horizontal scrollbar.');

  // Continuity and classification questions are sentences. As one unwrappable block of
  // MathML they were clipped mid-question in the desktop column, and the answer card hung
  // far below the question because the graph's height was split across both grid rows.
  await navigate(`${base}/?seed=desktop-continuity&f=p&q=c&d=3`, 1280, 900);
  const sentence = await evaluate(`(() => {
    const heading = document.querySelector('#questionHeading');
    const question = document.querySelector('.question-strip').getBoundingClientRect();
    const answer = document.querySelector('.answer-card').getBoundingClientRect();
    return {
      scrollWidth: heading.scrollWidth, clientWidth: heading.clientWidth,
      scrollHeight: heading.scrollHeight, clientHeight: heading.clientHeight,
      gap: answer.top - question.bottom,
    };
  })()`);
  assert(sentence.scrollWidth <= sentence.clientWidth && sentence.scrollHeight <= sentence.clientHeight,
    `A continuity question must fit its column without scrolling: ${JSON.stringify(sentence)}`);
  assert(sentence.gap < 40, `The answer card must sit directly under the question: ${JSON.stringify(sentence)}`);

  // A rejected choice must not be clickable again, or it logs a second misconception.
  const eliminated = await evaluate(`(() => {
    const expected = ${JSON.stringify(answerText(generateProblem('desktop-continuity', {
      families: { point: true, atInfinity: false, limitLaws: false, composition: false },
      questionTypes: { functionValue: false, oneSided: false, twoSided: false, continuity: true, classification: false },
      difficulty: 3,
    }).question.answer))};
    const wrong = [...document.querySelectorAll('#choiceAnswerArea button')].find((b) => b.dataset.value !== expected);
    wrong.click();
    return { disabled: wrong.disabled, marked: wrong.classList.contains('choice-eliminated') };
  })()`);
  assert.deepEqual(eliminated, { disabled: true, marked: true }, 'A wrong choice must be ruled out after it is picked.');

  // Every problem rewrites the address bar, so a reload is read as a shared link. The preset
  // has to survive that, or Practice My Weak Areas silently turns into Custom.
  await evaluate(`localStorage.setItem('graphicalLimitsTrainer.config.v1', JSON.stringify({
    preset: 'weakAreas', practiceMode: 'weak', difficulty: 1, haptics: false, reducedMotion: true
  }))`);
  await navigate(`${base}/?seed=preset-roundtrip`, 1280, 900);
  const reloadUrl = await evaluate('location.href');
  assert(/[?&]p=weakAreas/.test(reloadUrl), `The address bar must carry the preset: ${reloadUrl}`);
  await navigate(reloadUrl, 1280, 900);
  assert.equal(await evaluate("document.querySelector('#presetInput').value"), 'weakAreas',
    'Reloading must keep the Practice My Weak Areas preset.');

  await navigate(`${base}/?seed=desktop-law-legend&f=l&d=3`, 1280, 900);
  const desktopLegend = await evaluate(`({
    fontSizes: [...document.querySelectorAll('.graph-function-label, .graph-function-label-g')]
      .map((element) => parseFloat(getComputedStyle(element).fontSize)),
    gDash: getComputedStyle(document.querySelector('.graph-legend-swatch.graph-curve-g')).strokeDasharray,
    gLinecap: getComputedStyle(document.querySelector('.graph-legend-swatch.graph-curve-g')).strokeLinecap,
  })`);
  assert(desktopLegend.fontSizes.every((size) => size >= 26),
    `Desktop legend labels should be larger than the old 22px labels: ${desktopLegend.fontSizes}`);
  assert.equal(desktopLegend.gLinecap, 'butt', 'The desktop g legend swatch must keep visible gaps between dashes.');
  assert(desktopLegend.gDash.match(/[\d.]+/g).map(Number)[1] >= 8,
    `The desktop g legend gap is too narrow: ${desktopLegend.gDash}`);

  await navigate(`${base}/?seed=desktop-composition&f=m&d=3`, 1280, 900);
  const desktopComposition = await evaluate(`(() => {
    const panels = [...document.querySelectorAll('.graph-panel')].map((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, width: rect.width };
    });
    return { panels, scrollWidth: document.documentElement.scrollWidth, innerWidth };
  })()`);
  assert.equal(desktopComposition.panels.length, 2);
  assert(desktopComposition.panels[1].top > desktopComposition.panels[0].bottom,
    'Dual graph panels must stack on desktop so each graph remains readable.');
  assert(desktopComposition.panels.every((panel) => panel.width > 600),
    `Stacked desktop graphs are unexpectedly narrow: ${JSON.stringify(desktopComposition.panels)}`);
  assert(desktopComposition.scrollWidth <= desktopComposition.innerWidth, 'Stacked desktop panels must not overflow horizontally.');

  // A finite limit at infinity needs a drawn asymptote to be readable, except at y = 0 where
  // the x-axis already is that line and a dashed copy reads as a second, misaligned axis.
  await navigate(`${base}/?seed=asymptote-probe&f=a&d=3`, 1280, 900);
  const asymptoteSeeds = await evaluate(`(async () => {
    const adv = await import('/advanced.mjs');
    const families = { point: false, atInfinity: true, limitLaws: false, composition: false };
    let zero = null; let nonZero = null;
    for (let i = 0; i < 800 && !(zero && nonZero); i += 1) {
      const p = adv.generateProblem('ha-' + i, { difficulty: 3, families });
      for (const side of ['left', 'right']) {
        const limit = p.scene[side].limit;
        if (limit.kind !== 'finite') continue;
        if (limit.value.n === 0n && !zero) zero = 'ha-' + i;
        if (limit.value.n !== 0n && !nonZero) nonZero = 'ha-' + i;
      }
    }
    return JSON.stringify({ zero, nonZero });
  })()`);
  const seeds = JSON.parse(asymptoteSeeds);
  assert(seeds.nonZero, 'Expected an at-infinity scene with a nonzero finite end limit.');

  await navigate(`${base}/?seed=${seeds.nonZero}&f=a&d=3`, 1280, 900);
  const drawn = await evaluate(`({
    lines: document.querySelectorAll('.graph-horizontal-asymptote').length,
    labels: [...document.querySelectorAll('.graph-asymptote-label')].map((t) => t.textContent),
  })`);
  assert(drawn.lines >= 1, 'A nonzero finite end limit must draw a dashed asymptote.');
  assert(drawn.labels.some((text) => /^y = /.test(text)), `Each asymptote needs a value label: ${JSON.stringify(drawn)}`);

  if (seeds.zero) {
    await navigate(`${base}/?seed=${seeds.zero}&f=a&d=3`, 1280, 900);
    const atZero = await evaluate(`(() => {
      const axis = [...document.querySelectorAll('.graph-axis')]
        .find((line) => line.getAttribute('y1') === line.getAttribute('y2'));
      const axisY = axis ? Number(axis.getAttribute('y1')) : null;
      return {
        axisY,
        overlapping: [...document.querySelectorAll('.graph-horizontal-asymptote')]
          .filter((line) => Math.abs(Number(line.getAttribute('y1')) - axisY) < 0.5).length,
        labels: [...document.querySelectorAll('.graph-asymptote-label')].map((t) => t.textContent),
      };
    })()`);
    assert.equal(atZero.overlapping, 0,
      'An asymptote at y = 0 must not be drawn over the x-axis.');
    assert(atZero.labels.includes('y = 0'),
      `The y = 0 asymptote still needs its label: ${JSON.stringify(atZero)}`);
  }

  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  assert(Buffer.from(screenshot.data, 'base64').length > 20000, 'Rendered desktop screenshot appears blank.');
  console.log('All browser and mobile regression tests passed.');
} finally {
  cdp?.close();
  browser.kill();
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
