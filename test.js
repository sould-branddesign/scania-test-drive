/* ============================================================
   SCANIA · TEST DRIVE — test (kiosk) page
   The driver-facing evaluation flow only:
   intro → language → vehicle → 5 question steps → thank you.
   No results / editor here — that lives on admin.html.
   ============================================================ */
(function () {
  'use strict';
  const { $, h, esc, BRANDS, LANGS, COUNTRIES, t, tCat, state, save } = window.STD;

  const urlParams = new URLSearchParams(window.location.search);
  const CAB_MODE = urlParams.get('form') === 'cab';
  const FIXED_VEHICLE_ID = urlParams.get('vehicle') || '';

  const activeQuestions = () => CAB_MODE ? state.cabQuestions : state.questions;
  const activeVehicles = () => CAB_MODE ? state.cabVehicles : state.vehicles;

  /* local UI state (data lives in STD.state) */
  let ui = { view: 'intro', currentVehicle: null, stepIndex: 0, draft: {}, langChosen: false };
  let noAnim = false;   // true when a re-render is an in-screen update (selection) — skip the fade

  /* ask the browser for true fullscreen (iPad Safari / desktop); no-op where unsupported */
  function enterFullscreen() {
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (!isStandalone) return;
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) { const p = el.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) { /* ignore — CSS full-bleed still looks fullscreen */ }
  }

  const ROUTE_ICONS_V = 2;
  const ROUTE_ICONS = [
    `assets/route/route-1.svg?v=${ROUTE_ICONS_V}`,
    `assets/route/route-2.svg?v=${ROUTE_ICONS_V}`,
    `assets/route/route-3.svg?v=${ROUTE_ICONS_V}`,
    `assets/route/route-4.svg?v=${ROUTE_ICONS_V}`,
    `assets/route/route-5.svg?v=${ROUTE_ICONS_V}`,
  ];
  /* fetch all route icons into the browser cache right away, so none of them
     pop in late the first time a question screen using them is reached */
  ROUTE_ICONS.forEach((src) => { const img = new Image(); img.src = src; });

  const LOGO = '<img class="logo" src="assets/scania-logo.svg" alt="Scania">';
  const ARROW_R = '<svg class="arrow" viewBox="0 0 40 12" fill="none"><path d="M0 6h36M30 1l6 5-6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ARROW_L = '<svg class="arrow" viewBox="0 0 40 12" fill="none"><path d="M40 6H4M10 1L4 6l6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const app = $('#app');
  function go(view, opts = {}) {
    ui.view = view;
    if (opts.vehicle !== undefined) ui.currentVehicle = opts.vehicle;
    if (opts.step !== undefined) ui.stepIndex = opts.step;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function render() {
    const oldEl = app.firstElementChild;
    if (oldEl) oldEl.style.display = 'none';
    ({ intro: viewIntro, language: viewLanguage, vehicle: viewVehicle, question: viewQuestion, thanks: viewThanks }[ui.view] || viewIntro)();
    if (oldEl) oldEl.remove();
    const al = document.querySelector('.admin-link');
    if (al) al.style.display = ui.view === 'intro' ? '' : 'none';
    const rl = document.getElementById('restartBtn');
    if (rl) rl.style.display = (ui.view !== 'intro') ? 'block' : 'none';
    document.body.classList.toggle('is-intro', ui.view === 'intro');
  }

  const restartBtn = document.getElementById('restartBtn');
  if (restartBtn) {
    restartBtn.onclick = () => {
      ui.currentVehicle = null; ui.draft = {}; ui.langChosen = false; state.lang = 'en'; state.country = ''; save();
      noAnim = true; go('intro'); noAnim = false;
    };
  }

  /* ---------- intro / cover ---------- */
  function viewIntro() {
    const c = h(`<div class="cover" role="button" tabindex="0">
      ${LOGO}
      <div class="cover__bottom">
        <div class="cover__eyebrow">Sales Force Boost | 2026</div>
        <h1 class="cover__title">${CAB_MODE ? 'Cab<br>Assessment' : 'Test<br>Drive'}</h1>
        <span class="cover__cta">${t().tap} ${ARROW_R}</span>
      </div>
    </div>`);
    const start = () => { enterFullscreen(); go('language'); };
    c.addEventListener('click', start);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') start(); });
    app.appendChild(c);
  }

  /* ---------- language + country ---------- */
  function viewLanguage() {
    const s = screen();
    s.appendChild(head());
    const b = body();
    b.appendChild(h(`<h1 class="screen__title">Select your language &amp; market</h1>`));

    const wrap = h('<div class="lang-select-wrap"></div>');

    const langLabel = h('<p class="screen__label">Language</p>');
    const langSelect = h('<select class="std-select"></select>');
    langSelect.appendChild(h('<option value="">— Select language —</option>'));
    LANGS.forEach(({ code, label }) => {
      const opt = h(`<option value="${esc(code)}">${esc(label)}</option>`);
      if (state.lang === code) opt.selected = true;
      langSelect.appendChild(opt);
    });

    const countryLabel = h('<p class="screen__label">Market</p>');
    const countrySelect = h('<select class="std-select"></select>');
    countrySelect.appendChild(h('<option value="">— Select market —</option>'));
    COUNTRIES.forEach((c) => {
      const opt = h(`<option value="${esc(c)}">${esc(c)}</option>`);
      if (state.country === c) opt.selected = true;
      countrySelect.appendChild(opt);
    });

    wrap.appendChild(langLabel);
    wrap.appendChild(langSelect);
    wrap.appendChild(countryLabel);
    wrap.appendChild(countrySelect);
    b.appendChild(wrap);
    s.appendChild(b);

    const canNext = () => langSelect.value && countrySelect.value;
    s.appendChild(foot({
      back: () => go('intro'),
      next: canNext() ? () => {
        state.lang = langSelect.value;
        state.country = countrySelect.value;
        save();
        go('vehicle');
      } : null,
    }));

    [langSelect, countrySelect].forEach((sel) => {
      sel.onchange = () => {
        state.lang = langSelect.value || state.lang;
        state.country = countrySelect.value || state.country;
        noAnim = true; render(); noAnim = false;
      };
    });

    app.appendChild(s);
  }

  /* ---------- vehicle select ---------- */
  function viewVehicle() {
    const s = screen();
    s.appendChild(head());
    const b = body();
    b.appendChild(h(`<h1 class="screen__title">${t().welcome}</h1>`));
    const vehicleSection = h('<div class="vehicle-section"></div>');
    vehicleSection.appendChild(h(`<p class="screen__label">${t().chooseVehicle}</p>`));
    const grid = h('<div class="vgrid"></div>');
    state.vehicles.forEach((v) => {
      const sel = ui.currentVehicle === v.id;
      const b = BRANDS[v.brand];
      const bStyle = `--brand:${b.solid}${b.solidB ? ';--brand-b:' + b.solidB : ''}`;
      const el = h(`<button class="vehicle ${sel ? 'is-selected' : ''}" data-brand="${v.brand}" style="${bStyle}">${esc(v.name)}</button>`);
      el.onclick = () => { ui.currentVehicle = v.id; noAnim = true; render(); noAnim = false; };
      grid.appendChild(el);
    });
    vehicleSection.appendChild(grid);
    b.appendChild(vehicleSection);
    s.appendChild(b);
    s.appendChild(foot({
      back: () => go('intro'),
      next: ui.currentVehicle ? () => startEvaluation(ui.currentVehicle) : null,
    }));
    app.appendChild(s);
  }

  function startEvaluation(vehicleId) {
    ui.currentVehicle = vehicleId;
    ui.draft = {};
    go('question', { step: 0 });
  }

  /* ---------- a question step ---------- */
  function viewQuestion() {
    const cat = tCat(activeQuestions()[ui.stepIndex]);
    const vehicle = activeVehicles().find((v) => v.id === ui.currentVehicle);
    const brand = vehicle ? BRANDS[vehicle.brand] : BRANDS.scania;
    const s = screen();

    const hd = head();
    const chipStyle = `--chip:${brand.solid}${brand.solidB ? ';--chip-b:' + brand.solidB : ''}`;
    hd.querySelector('.screen__head-right').appendChild(h(`<span class="vehicle-chip" data-brand="${vehicle ? vehicle.brand : ''}" style="${chipStyle}">${esc(vehicle ? vehicle.name : '')}</span>`));
    s.appendChild(hd);

    const total = activeQuestions().length;
    const step = h(`<div class="stepper" style="--step:${brand.text || brand.solid}"></div>`);
    for (let i = 0; i < total; i++) {
      const cls = i < ui.stepIndex ? 'is-done' : i === ui.stepIndex ? 'is-current' : '';
      step.appendChild(h(`<div class="stepper__dot ${cls}"></div>`));
      if (i < total - 1) step.appendChild(h(`<div class="stepper__line ${i < ui.stepIndex ? 'is-done' : ''}"></div>`));
    }
    s.appendChild(step);

    const b = body();
    const routeIcon = ROUTE_ICONS[ui.stepIndex];
    const head2 = h('<div class="question-head"></div>');
    if (routeIcon) head2.appendChild(h(`<img class="route-icon" src="${routeIcon}" alt="" aria-hidden="true">`));
    const textCol = h('<div class="question-head__text"></div>');
    textCol.appendChild(h(`<h1 class="screen__title">${esc(cat.title)}</h1>`));
    if (cat.instruction) textCol.appendChild(h(`<p class="screen__sub">${esc(cat.instruction)}</p>`));
    head2.appendChild(textCol);
    b.appendChild(head2);

    const wrap = h('<div class="question-metrics"></div>');
    cat.metrics.forEach((m) => {
      const val = ui.draft[m.id] != null ? ui.draft[m.id] : 0;
      const scale = m.scale || 10;
      const metric = h(`<div class="metric">
        <div class="metric__top">
          <span class="metric__label">${esc(m.label)}</span>
          <span class="metric__value" style="color:${brand.text || brand.solid}">${val}/${scale}</span>
        </div>
        <input class="slider" type="range" min="0" max="${scale}" step="1" value="${val}" style="--track:${brand.text || brand.solid}">
        <div class="metric__ends"><span>${esc(m.min)}</span><span>${esc(m.max)}</span></div>
      </div>`);
      const input = $('.slider', metric);
      const valEl = $('.metric__value', metric);
      const paint = () => { const pct = (input.value / scale) * 100; input.style.background = `linear-gradient(90deg, ${brand.text || brand.solid} ${pct}%, var(--navy-700) ${pct}%)`; };
      input.oninput = () => { ui.draft[m.id] = Number(input.value); valEl.textContent = `${input.value}/${scale}`; paint(); };
      paint();
      wrap.appendChild(metric);
    });
    b.appendChild(wrap);
    s.appendChild(b);

    const isLast = ui.stepIndex === total - 1;
    s.appendChild(foot({
      back: () => ui.stepIndex === 0 ? (CAB_MODE ? go('intro') : go('vehicle')) : go('question', { step: ui.stepIndex - 1 }),
      next: isLast ? () => confirmSubmit(submitEvaluation) : () => go('question', { step: ui.stepIndex + 1 }),
      nextLabel: isLast ? t().submit : t().next,
    }));
    app.appendChild(s);
  }

  function confirmSubmit(onConfirm) {
    const overlay = h('<div class="confirm-overlay"></div>');
    const box = h(`<div class="confirm-box">
      <p class="confirm-box__title">Are you sure?</p>
      <p class="confirm-box__msg">Once submitted you cannot go back and change your answers.</p>
      <div class="confirm-box__btns">
        <button class="btn-cancel">Go back</button>
        <button class="btn-confirm">Submit</button>
      </div>
    </div>`);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    box.querySelector('.btn-cancel').onclick = () => overlay.remove();
    box.querySelector('.btn-confirm').onclick = () => { overlay.remove(); onConfirm(); };
  }

  function submitEvaluation() {
    if (CAB_MODE) state.cabAnswers[ui.currentVehicle] = Object.assign({}, ui.draft);
    else state.answers[ui.currentVehicle] = Object.assign({}, ui.draft);
    save();
    if (window.STDSheets) {
      const vehicle = activeVehicles().find((v) => v.id === ui.currentVehicle);
      window.STDSheets.submit({
        timestamp: new Date().toISOString(),
        lang: state.lang,
        country: state.country || '',
        group: state.group || '',
        formId: CAB_MODE ? 'cab' : 'testdrive',
        vehicleId: ui.currentVehicle,
        vehicleName: vehicle ? vehicle.name : ui.currentVehicle,
        vehicleBrand: vehicle ? vehicle.brand : '',
        questions: activeQuestions(),
        answers: ui.draft,
      });
    }
    go('thanks');
  }

  /* ---------- thank you ---------- */
  function viewThanks() {
    const vehicle = activeVehicles().find((v) => v.id === ui.currentVehicle);
    const s = screen('thanks');
    s.appendChild(head());
    const wrap = h(`<div class="thanks__wrap">
      <h1 class="thanks__title">${t().thanks}</h1>
      <p class="thanks__msg">${esc(t().submitted(vehicle ? vehicle.name : ''))}</p>
      <div class="thanks__btns">
        <button class="pill" data-act="next">${t().nextCar}</button>
      </div>
    </div>`);
    $('[data-act="next"]', wrap).onclick = () => { ui.currentVehicle = null; ui.draft = {}; CAB_MODE ? go('intro') : go('vehicle'); };
    const b = body();
    b.appendChild(wrap);
    s.appendChild(b);
    app.appendChild(s);
  }

  /* ---------- shared bits ---------- */
  function screen(extra = '') { return h(`<section class="screen ${extra}"></section>`); }
  function body() { const b = h('<div class="screen__body"></div>'); if (noAnim) b.style.animation = 'none'; return b; }
  function head() {
    const hd = h(`<div class="screen__head"><div class="screen__head-left">${LOGO}</div><div class="screen__head-right"></div></div>`);
    if (restartBtn) hd.querySelector('.screen__head-right').appendChild(restartBtn);
    return hd;
  }
  function foot({ back, next, nextLabel } = {}) {
    const f = h('<div class="screen__foot"></div>');
    if (back) { const b = h(`<button class="linkbtn">${ARROW_L}${esc(t().back)}</button>`); b.onclick = back; f.appendChild(b); }
    else f.appendChild(h('<span></span>'));
    if (next) { const n = h(`<button class="linkbtn is-next">${esc(nextLabel || t().next)}${ARROW_R}</button>`); n.onclick = next; f.appendChild(n); }
    else if (nextLabel !== false) f.appendChild(h(`<button class="linkbtn is-next" disabled>${esc(nextLabel || t().next)}${ARROW_R}</button>`));
    return f;
  }

  /* pick up question/vehicle edits made in the admin tab without a manual refresh */
  window.addEventListener('storage', (e) => {
    if (e.key === window.STD.STORE_KEY) { window.STD.load(); if (ui.view === 'intro' || ui.view === 'language' || ui.view === 'vehicle') render(); }
  });

  /* ---------- boot ---------- */
  window.STD.load();
  render();
})();
