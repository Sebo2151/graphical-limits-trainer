# Graphical Limits Trainer — first prototype

A dependency-free Calculus I practice app for reading function values, one-sided limits, two-sided limits, continuity, and discontinuity types from graphs.

## Run it

The app uses JavaScript modules, so serve the folder rather than opening `index.html` directly:

```bash
cd graphical-limits-trainer
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

The same folder can be published directly with GitHub Pages.

### Test on a phone without deploying

Your phone and computer must be on the same Wi-Fi network. On Windows:

```powershell
cd graphical-limits-trainer
py -m http.server 8000 --bind 0.0.0.0
```

Run `ipconfig` and find the computer's IPv4 address on that Wi-Fi network, for example `192.168.1.24`. On the phone, open:

```text
http://192.168.1.24:8000/
```

Allow Python through Windows Firewall if prompted. Browser developer tools can simulate the phone layout, but a real phone is still needed to test the on-screen keyboard and vibration behavior.

## Included in this draft

- Exact rational grading for integers, decimals, and fractions
- Dedicated `DNE`, `+∞`, and `−∞` controls
- Continuous, removable, jump, infinite, mixed, and oscillatory scenes
- Function-value, one-sided, two-sided, continuity, and classification questions
- Targeted feedback for common misconceptions
- A “Show me” SVG animation after two incorrect attempts; it plays twice automatically, then stops on the conclusion with pause and replay controls
- Staged left, right, and simultaneous animation for two-sided limits, continuity, and classification, ending on the function value where that matters
- Unbounded branches are traced without a y-axis readout, and oscillatory branches leave a trail showing the values never settle
- A graph window whose offset varies, so locating the tested x-value stays part of the exercise
- Secondary discontinuities and coordinate-swap distractors away from the point being tested
- Mobile keypad and optional vibration feedback
- Reduced-motion setting
- Seeded, shareable problems; copied links preserve the mathematical options
- An editable seed field in the options menu
- Device-local progress by skill and exportable progress data
- Development diagnostics with `?debug=1`

## Tests

Run semantic generator tests with:

```bash
node tests.mjs
```

Open `tests.html` through the local server for browser smoke tests.

The Node test suite samples 7,500 generated problems across all three difficulty levels and checks exact arithmetic, deterministic generation, classification invariants, and branch behavior.

It also covers the wording and framing decisions that are easy to regress silently:

- explanations never describe `DNE` or `±∞` as a value the graph approaches, and a continuity failure always names which of the three conditions fails
- wrong-answer feedback never cites a requirement the student's own graph already satisfies, which would read as agreement with the wrong answer
- the graph window is not centred on the tested x-value in every problem
- distractor holes sit at readable heights and exactly on the curve they puncture
- an unbounded two-sided limit is stated as `+∞` or `−∞` rather than `DNE`, and rejecting `DNE` explains why

Behavior that lives in the DOM layer, such as the animation suppressing the y-axis readout on an unbounded branch, is guarded by source checks in `testInterfaceRegressions` rather than executed.

## Deliberately deferred

- Limits as `x → ±∞`
- Two graphed functions and limit-law questions
- Composition questions
- Adaptive weak-area problem selection
- Instructor-created assignments or synchronized accounts
- A full nonvisual alternative representation of each graph

## File structure

- `index.html` — application shell
- `styles.css` — responsive layout and SVG styling
- `core.mjs` — exact arithmetic, semantic scene generator, questions, grading, and feedback
- `app.mjs` — rendering, animation, interaction, storage, and progress UI
- `tests.mjs` — Node semantic tests
- `tests.html` — browser smoke tests
