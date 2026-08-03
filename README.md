# Graphical Limits Trainer

**[Open the trainer](https://sebo2151.github.io/graphical-limits-trainer/)**

A free, dependency-free Calculus I practice tool for reading function values, limits, continuity, limit laws, and compositions directly from graphs. Built for students at Wake Forest University and shared openly for use in other calculus courses.

Nothing you do in the app is collected or sent anywhere. Progress is stored only in your own browser (`localStorage`) and can be exported or reset at any time. There are no accounts, no server, and no tracking.

## Problem families

- Function values, one-sided limits, two-sided limits, continuity, and discontinuity classification at finite x-values
- Infinite limits as x approaches a finite number
- Limits as x approaches positive or negative infinity, including horizontal asymptotes and polynomial-like growth
- Limit laws for sums, differences, scalar multiples, products, and quotients of two graphed functions
- Composition limits that track whether the inner function approaches the outer input from the left or right
- Cases where the constituent limits fail while a combination or composition still has one, such as two jumps whose sum cancels

Every question is answerable from the graphs on screen. There is deliberately no "the law is inconclusive" case: that idea only applies when the limits are given as facts and the graphs are withheld, and every graphical construction of it had a provable answer that the app would then have marked wrong.

## Teaching and progress

- Exact rational grading for integers, decimals, and fractions
- Dedicated `DNE`, positive-infinity, and negative-infinity controls
- Targeted feedback and persistent misconception tracking
- Presets for each major skill, Exam 1 Review, and Practice My Weak Areas
- Qualitative Strong, Developing, and Needs practice ratings
- Separate first-attempt, independent-completion, and assisted-completion records
- Show Me is available immediately; using it marks a later correct response as completed with help rather than full independent credit
- Progress remains device-local and can be exported as JSON

## Graphs and animation

- Deterministic seeded scenes. The address bar carries the seed and the full configuration, so copying the URL reproduces a problem exactly; the options dialog also copies the current seed on its own
- Off-center tested points, secondary holes and jumps, turning points, intercepts, half-unit scales, and occasional domain endpoints
- Dashed horizontal asymptotes with `y = value` labels on limits at infinity, so a finite end limit can be read rather than estimated
- Shared axes with color and line-style redundancy for limit-law problems
- Separate inner and outer panels for composition, stacked at every width so each graph stays readable
- Direction badges, moving-point trails, oscillation bands, continuation arrows, staged two-sided reasoning, and stable annotated final frames
- Reduced-motion mode renders the complete final reasoning state without playing movement

## Mobile layout

On narrow screens the question appears immediately above the graph and stays pinned there while the student examines multi-panel problems. The graph uses the full content width, answer controls follow it directly, and the numeric/fraction keypad writes into a read-only answer display so focusing it cannot open the operating-system keyboard.

Because the keypad pushes the feedback panel below the fold on a phone, submitting an answer pulses the answer region green or red for the immediate verdict and then scrolls the feedback into view by the smallest amount that reveals it, which keeps the graph on screen after a wrong answer. Starting the next problem scrolls back to the question. Both respect the reduced-motion setting: the pulse becomes a held tint and the scrolling becomes instant.

## Credits

Built by Sebastian Bozlee ([Wake Forest University](https://wfu.edu)) in collaboration with Claude (Anthropic) and ChatGPT (OpenAI).

## License

[MIT](LICENSE) — free to use, adapt, and reshare, including for other courses and institutions. A link back is appreciated but not required.

---

## For developers

<details>
<summary>Running locally, tests, and file structure</summary>

### Run it locally

The app uses JavaScript modules, so serve the folder rather than opening `index.html` directly:

```bash
cd graphical-limits-trainer
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. The same folder can be published directly with GitHub Pages.

#### Test on a phone without deploying

The phone and computer must be on the same Wi-Fi network. On Windows:

```powershell
py -m http.server 8000 --bind 0.0.0.0
```

Find the computer's Wi-Fi IPv4 address with `ipconfig`, then open `http://ADDRESS:8000/` on the phone. A real phone is still useful for checking vibration behavior, although the app's custom answer keypad now prevents the system keyboard from covering the exercise.

### Tests

Run semantic generator tests with:

```bash
node tests.mjs
```

The semantic suite samples the classic generator across 7,500 problems and samples every advanced family across all three difficulties. It checks exact arithmetic, deterministic generation, classification invariants, branch behavior, graph framing, domain endpoints, limit-law semantics, composition direction, feedback language, and serialization.

Run automated browser and mobile checks with:

```bash
node browser-tests.mjs
```

This dependency-free runner uses an installed Chrome or Edge browser through the DevTools protocol. It checks true 390px layout geometry, horizontal overflow, composition stacking, shared limit-law axes, mobile keyboard suppression, immediate Show Me animation, assisted-credit persistence, desktop columns, and a nonblank rendered screenshot. If no supported browser is installed, it reports a skip.

Open `tests.html` through the local server for lightweight in-browser smoke tests.

### File structure

- `index.html` - application shell and controls
- `styles.css` - responsive layout and SVG styling
- `core.mjs` - exact arithmetic and the finite-point semantic generator
- `advanced.mjs` - family orchestration, limits at infinity, limit laws, composition, presets, grading, and feedback
- `app.mjs` - rendering, animation, interaction, storage, adaptive practice, and progress UI
- `tests.mjs` - Node semantic and invariant tests
- `browser-tests.mjs` - automated desktop/mobile browser regressions
- `tests.html` - browser smoke tests

### Still deferred

- Instructor-created fixed problem sets and assignments
- Importing or synchronizing progress across devices
- A full nonvisual parallel exercise mode
- Account-based storage or a server backend

</details>
