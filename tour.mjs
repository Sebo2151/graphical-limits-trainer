// A guided walkthrough: a spotlight cut out of a dimmed page, and a card beside it that
// explains the highlighted part. The engine knows nothing about limits; each step supplies
// its own target, text, and optional enter/leave hooks that draw on the graph.

const MOBILE_QUERY = '(max-width: 620px)';
const EDGE = 16;
const SPOTLIGHT_PADDING = 8;

export function createTour({
  root,
  steps,
  reducedMotion = () => false,
  obstructionTop = () => 0,
  onEnd = () => {},
}) {
  const spotlight = root.querySelector('.tour-spotlight');
  const card = root.querySelector('.tour-card');
  const count = root.querySelector('#tourStepCount');
  const title = root.querySelector('#tourTitle');
  const body = root.querySelector('#tourBody');
  const dots = root.querySelector('#tourDots');
  const backButton = root.querySelector('#tourBackButton');
  const nextButton = root.querySelector('#tourNextButton');
  const skipButton = root.querySelector('#tourSkipButton');
  const background = [...document.querySelectorAll('[data-tour-inert]')];
  let index = -1;
  let active = false;
  let positionFrame = null;

  backButton.addEventListener('click', () => go(index - 1));
  nextButton.addEventListener('click', () => (index >= steps.length - 1 ? finish('completed') : go(index + 1)));
  skipButton.addEventListener('click', () => finish('skipped'));
  root.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', schedulePosition);
  window.addEventListener('scroll', schedulePosition, { passive: true });

  function start() {
    if (active) return;
    active = true;
    root.hidden = false;
    root.classList.toggle('tour-reduced-motion', reducedMotion());
    // inert keeps keyboard focus and assistive technology inside the card while the page
    // behind it is dimmed and cannot be clicked.
    background.forEach((element) => { element.inert = true; });
    go(0);
  }

  function finish(reason) {
    if (!active) return;
    steps[index]?.onLeave?.();
    active = false;
    index = -1;
    root.hidden = true;
    background.forEach((element) => { element.inert = false; });
    onEnd(reason);
  }

  function go(nextIndex) {
    if (!active || nextIndex < 0 || nextIndex >= steps.length) return;
    steps[index]?.onLeave?.();
    index = nextIndex;
    const step = steps[index];

    count.textContent = `${index + 1} of ${steps.length}`;
    title.textContent = step.title;
    body.innerHTML = step.body();
    dots.replaceChildren(...steps.map((_, dotIndex) => {
      const dot = document.createElement('span');
      if (dotIndex === index) dot.className = 'tour-dot-current';
      else if (dotIndex < index) dot.className = 'tour-dot-done';
      return dot;
    }));
    backButton.hidden = index === 0;
    skipButton.hidden = index === steps.length - 1;
    nextButton.textContent = step.nextLabel || (index === steps.length - 1 ? 'Done' : 'Next');

    step.onEnter?.();
    bringIntoView(step);
    position();
    nextButton.focus({ preventScroll: true });
  }

  function targetOf(step) {
    const target = step.target?.();
    return target && !target.hidden && target.getClientRects().length ? target : null;
  }

  function isSheet() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  // The visible band is what is left once the sticky question strip (on a phone) and the
  // card itself are accounted for. Scroll only as far as needed to fit the target into it.
  function bringIntoView(step) {
    const target = targetOf(step);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const top = obstructionTop(target) + EDGE;
    const bottom = window.innerHeight - (isSheet() ? card.offsetHeight : 0) - EDGE;
    let delta = 0;
    if (rect.top < top) delta = rect.top - top;
    else if (rect.bottom > bottom) delta = Math.min(rect.bottom - bottom, rect.top - top);
    if (Math.abs(delta) < 1) return;
    window.scrollBy({ top: delta, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  function schedulePosition() {
    if (!active || positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = null;
      position();
    });
  }

  function position() {
    if (!active) return;
    const target = targetOf(steps[index]);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (!target) {
      // A zero-size spotlight in the middle still casts its shadow over the whole page.
      Object.assign(spotlight.style, {
        top: `${viewportHeight / 2}px`, left: `${viewportWidth / 2}px`, width: '0px', height: '0px',
      });
      root.classList.add('tour-centered');
      clearCardPosition();
      return;
    }
    root.classList.remove('tour-centered');

    const rect = target.getBoundingClientRect();
    Object.assign(spotlight.style, {
      top: `${rect.top - SPOTLIGHT_PADDING}px`,
      left: `${rect.left - SPOTLIGHT_PADDING}px`,
      width: `${rect.width + 2 * SPOTLIGHT_PADDING}px`,
      height: `${rect.height + 2 * SPOTLIGHT_PADDING}px`,
    });

    if (isSheet()) {
      clearCardPosition();
      return;
    }

    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    const gap = SPOTLIGHT_PADDING + 12;
    const clampX = (x) => Math.min(Math.max(x, EDGE), viewportWidth - cardWidth - EDGE);
    const clampY = (y) => Math.min(Math.max(y, EDGE), viewportHeight - cardHeight - EDGE);
    const placements = [
      rect.right + gap + cardWidth <= viewportWidth - EDGE && { left: rect.right + gap, top: clampY(rect.top) },
      rect.left - gap - cardWidth >= EDGE && { left: rect.left - gap - cardWidth, top: clampY(rect.top) },
      rect.bottom + gap + cardHeight <= viewportHeight - EDGE && { left: clampX(rect.left), top: rect.bottom + gap },
      rect.top - gap - cardHeight >= EDGE && { left: clampX(rect.left), top: rect.top - gap - cardHeight },
    ];
    const chosen = placements.find(Boolean)
      || { left: clampX(viewportWidth / 2 - cardWidth / 2), top: viewportHeight - cardHeight - EDGE };
    card.style.left = `${chosen.left}px`;
    card.style.top = `${chosen.top}px`;
  }

  function clearCardPosition() {
    card.style.left = '';
    card.style.top = '';
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish('skipped');
    } else if (event.key === 'ArrowRight' && index < steps.length - 1) {
      event.preventDefault();
      go(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === 'Tab') {
      // The rest of the page is inert, so wrap focus within the card rather than letting it
      // escape to the browser chrome.
      const focusable = [...card.querySelectorAll('button:not([hidden])')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  return {
    start,
    stop: () => finish('dismissed'),
    isActive: () => active,
  };
}
