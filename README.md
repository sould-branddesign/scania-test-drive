# Scania · Test Drive Evaluation

A vehicle test-drive evaluation tool built from the Figma *Scania – Sales Force Boost 2026* design.
Pure HTML/CSS/vanilla JS, no build step. State persists to `localStorage`.

## Two pages

| Page | For | Contains |
|------|-----|----------|
| **`index.html`** | the test-driver (iPad kiosk) | only the evaluation flow — no way into results/editor. A discreet **Admin** link sits in the corner for staff. |
| **`admin.html`** | staff | **Results** (charts) and **Edit questions** tabs, plus an **Open test ↗** link. |

Both pages load the shared **`core.js`** (data model, state, scoring, persistence, public API) and
talk through the same `localStorage` key — so questions edited in admin appear in the test, and
submitted ratings appear in admin. Open tabs even sync live via the `storage` event.

`test.js` drives the test page; `admin.js` drives the admin page.

## Run

```
npx serve scania-test-drive -l 3480
```
Then open **`/index.html`** (the test) or **`/admin.html`** (admin). Launch profile
`scania-test-drive` is in `.claude/launch.json`.

## Flow (test page)

`Intro cover → Choose language → Choose vehicle → 5 evaluation steps → Submit → Thank you / Next car`

The five steps (sliders, 0–10) come straight from the design:
1. **Cab Evaluation & Gear Shifting** — Cab assessment · Gear shift response
2. **Auxiliary Braking** — Ease of handling
3. **Steering & Handling** — Steering precision · Chassis stability
4. **Parking & Precision Maneuver** — Precision · Ease of reversing & docking
5. **Overall Driving Experience**

Each brand has a colour identity (Scania = teal, Volvo = purple, DAF = green, Mercedes = red, MAN = orange)
used consistently across pills, sliders, bars and the radar.

## Changing the questions

Two ways:

### 1. In-app editor (admin page → `Edit questions` tab)
Add / edit / reorder / remove categories and their rating metrics (label + the two endpoint
captions). Saved to `localStorage`; the test flow and charts use it immediately.

### 2. Programmatic API — `window.ScaniaEval`
```js
ScaniaEval.getQuestions();          // current question set (deep copy)
ScaniaEval.setQuestions([ ... ]);   // replace the whole set
ScaniaEval.addQuestion({ title, instruction, metrics:[{label,min,max}] });
ScaniaEval.resetQuestions();        // back to the default Scania set
ScaniaEval.getResults();            // computed scores (per category + per vehicle)
```
A category looks like:
```js
{ id, title, instruction, metrics: [ { id, label, min, max, scale: 10 } ] }
```

## Results view (admin page)

`Results` tab:
- **Group Comparison** — a radar chart (one polygon per brand, axes = the evaluation categories)
  plus a ranked vehicle list with overall scores.
- **Per-category bar charts** — brand-coloured gradient bars with scores, sorted high→low.

Scores aggregate by brand (mean of that brand's evaluated vehicles). Demo data is seeded on first
run so the charts are populated; use **Clear data** / **Reload demo data** to manage it.

### Present mode (16:9 slideshow)
**▶ Present 16:9** opens a fullscreen 16:9 slide deck for showing results on a screen/projector:

1. **Cover** — Evaluation Results / Sales Force Boost 2026
2. **Group Comparison** — radar + ranked vehicle list
3. **One slide per category** — the brand bar chart

Slides render on a fixed 1280×720 stage scaled to fit the viewport (letterboxed), so they look
identical at any size. Navigate with the on-screen arrows, **← / →** (or space), jump to real browser
fullscreen with the ⛶ button or **F**, and exit with **Esc** or **✕**.

## iPad optimisation

The test page (`index.html`) is built as a hand-held, kiosk-style experience on iPad:

- **Fullscreen, not a card** — the flow fills the whole screen edge-to-edge (the cover is a full-bleed
  teal panel; the question screens sit directly on the background). Tapping the cover also requests
  true browser fullscreen where supported (iPad Safari / desktop), and added to the home screen it
  runs standalone.
- **Fade transitions** — moving between screens cross-fades (opacity only, no slide). Selecting a
  language or vehicle updates in place, so it doesn't re-trigger the transition.


- **Kiosk-sized screen** — on iPad-class viewports (≤1366px, portrait *and* landscape) the screen fills
  the display and adapts its height with `100dvh`, instead of a small floating card. Large desktops
  (>1366px) keep the original compact layout.
- **Touch targets** — on touch devices (`pointer: coarse`) slider thumbs grow to 32px, icon buttons to
  44px, and pills/buttons get larger padding. Dragging a slider never scrolls the page (`touch-action`).
- **No sticky hover** — hover styles are neutralised on touch (`hover: none`) and replaced with a press
  (`:active`) animation, so states don't get stuck after a tap.
- **Home-screen / fullscreen** — `apple-mobile-web-app-capable` + `viewport-fit=cover` + safe-area insets
  mean it runs edge-to-edge with the chrome hidden when added to the iPad home screen.
- Editor inputs use a ≥16px font so iOS doesn't zoom on focus; the page won't rubber-band
  (`overscroll-behavior`).
