/* ============================================================
   SCANIA · CAB ASSESSMENT — kiosk page
   Flow: intro → language → vehicle hub → questions (per vehicle,
   same shape as the Test Drive page) → back to hub → … → once
   every vehicle is done, submit all of them at once → thank you.
   ============================================================ */
(function () {
  'use strict';
  const { $, h, esc, BRANDS, LANGS, COUNTRIES, t, tCat, state, save } = window.STD;

  function getActiveVehicle() {
    return state.cabVehicles.find((v) => v.id === ui.currentVehicle) || null;
  }

  /* computed fresh at submit time rather than read from state.group, which
     only refreshes when someone happens to open admin's Results tab on this
     specific device — a kiosk tablet that never does stays stuck on whatever
     day it first picked up, mislabeling every submission after that. */
  function todayLabel() { return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }

  let ui = { view: 'intro', currentVehicle: null, stepIndex: 0, draftsByVehicle: {}, completedVehicles: new Set() };

  /* the in-progress answers for whichever vehicle is currently being
     evaluated — created on first touch so switching between vehicles in
     the hub never mixes up or overwrites another vehicle's answers */
  function activeDraft() {
    if (!ui.draftsByVehicle[ui.currentVehicle]) ui.draftsByVehicle[ui.currentVehicle] = {};
    return ui.draftsByVehicle[ui.currentVehicle];
  }
  let noAnim = false;

  function enterFullscreen() {
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (!isStandalone) return;
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) { const p = el.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) {}
  }

  const LOGO = '<img class="logo" src="assets/scania-logo.svg" alt="Scania">';
  const ARROW_R = '<svg class="arrow" viewBox="0 0 40 12" fill="none"><path d="M0 6h36M30 1l6 5-6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ARROW_L = '<svg class="arrow" viewBox="0 0 40 12" fill="none"><path d="M40 6H4M10 1L4 6l6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const app = $('#app');

  function go(view, opts = {}) {
    ui.view = view;
    if (opts.step !== undefined) ui.stepIndex = opts.step;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function render() {
    const oldEl = app.firstElementChild;
    if (oldEl) oldEl.style.display = 'none';
    ({ intro: viewIntro, language: viewLanguage, vehicleHub: viewVehicleHub, question: viewQuestion, thanks: viewThanks }[ui.view] || viewIntro)();
    if (oldEl) oldEl.remove();
    const al = document.querySelector('.admin-link');
    if (al) al.style.display = ui.view === 'intro' ? '' : 'none';
    const rl = document.getElementById('restartBtn');
    if (rl) rl.style.display = (ui.view !== 'intro') ? 'block' : 'none';
    document.body.classList.toggle('is-intro', ui.view === 'intro');
  }

  /* ---------- intro / cover ---------- */
  function viewIntro() {
    const c = h(`<div class="cover" role="button" tabindex="0">
      ${LOGO}
      <div class="cover__bottom">
        <div class="cover__eyebrow">Sales Force Boost | 2026</div>
        <h1 class="cover__title">Cab<br>Assessment</h1>
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
    const langPicker = buildLangPicker();

    const countryLabel = h('<p class="screen__label">Market</p>');
    const countryPicker = buildMarketPicker();

    wrap.appendChild(langLabel);
    wrap.appendChild(langPicker);
    wrap.appendChild(countryLabel);
    wrap.appendChild(countryPicker);
    b.appendChild(wrap);
    s.appendChild(b);

    const canNext = () => state.lang && state.country;
    s.appendChild(foot({
      back: () => go('intro'),
      next: canNext() ? () => { save(); go('vehicleHub'); } : null,
    }));

    app.appendChild(s);
  }

  /* Custom dropdown standing in for a native <select> — only because a
     native <option> can't show the "AI-translated" icon next to a
     language's name (browsers render <option> as plain text, no
     markup). English and Swedish are excluded: those are translated by
     hand, not by AI. */
  const AI_TRANSLATED_ICON = 'assets/lang-ai.svg?v=2';
  function buildLangPicker() {
    const current = LANGS.find((l) => l.code === state.lang);
    const picker = h('<div class="lang-picker"></div>');
    const trigger = h(`<button type="button" class="std-select lang-picker__trigger">${esc(current ? current.label : '— Select language —')}</button>`);
    const list = h('<div class="lang-picker__list" hidden></div>');

    function closeList() { list.hidden = true; document.removeEventListener('click', onDocClick, true); }
    function onDocClick(e) { if (!picker.contains(e.target)) closeList(); }

    trigger.onclick = (e) => {
      e.stopPropagation();
      if (list.hidden) { list.hidden = false; document.addEventListener('click', onDocClick, true); }
      else closeList();
    };

    LANGS.forEach(({ code, label }) => {
      const showAi = code !== 'en' && code !== 'sv';
      const opt = h(`<button type="button" class="lang-picker__opt ${state.lang === code ? 'is-selected' : ''}">
        <span>${esc(label)}</span>
        ${showAi ? `<img class="lang-picker__ai" src="${AI_TRANSLATED_ICON}" alt="AI-translated" title="AI-translated">` : ''}
      </button>`);
      opt.onclick = () => {
        closeList();
        state.lang = code;
        save();
        noAnim = true; render(); noAnim = false;
      };
      list.appendChild(opt);
    });

    picker.appendChild(trigger);
    picker.appendChild(list);
    return picker;
  }

  /* Same custom-dropdown treatment as the language picker above, just for
     visual consistency — the market list has no icon to show, a native
     <select> would work here too. */
  function buildMarketPicker() {
    const picker = h('<div class="lang-picker"></div>');
    const trigger = h(`<button type="button" class="std-select lang-picker__trigger">${esc(state.country || '— Select market —')}</button>`);
    const list = h('<div class="lang-picker__list" hidden></div>');

    function closeList() { list.hidden = true; document.removeEventListener('click', onDocClick, true); }
    function onDocClick(e) { if (!picker.contains(e.target)) closeList(); }

    trigger.onclick = (e) => {
      e.stopPropagation();
      if (list.hidden) { list.hidden = false; document.addEventListener('click', onDocClick, true); }
      else closeList();
    };

    COUNTRIES.forEach((c) => {
      const opt = h(`<button type="button" class="lang-picker__opt ${state.country === c ? 'is-selected' : ''}"><span>${esc(c)}</span></button>`);
      opt.onclick = () => {
        closeList();
        state.country = c;
        save();
        noAnim = true; render(); noAnim = false;
      };
      list.appendChild(opt);
    });

    picker.appendChild(trigger);
    picker.appendChild(list);
    return picker;
  }

  /* ---------- vehicle hub ---------- */
  function viewVehicleHub() {
    const s = screen();
    s.appendChild(head());
    const b = body();
    b.appendChild(h(`<h1 class="screen__title">Welcome to the Cab Assessment.</h1>`));
    const vehicleSection = h('<div class="vehicle-section"></div>');
    vehicleSection.appendChild(h(`<p class="screen__label">Assess every vehicle — tap one to start:</p>`));
    const grid = h('<div class="vgrid"></div>');
    state.cabVehicles.forEach((v) => {
      const done = ui.completedVehicles.has(v.id);
      const br = BRANDS[v.brand];
      const bStyle = `--brand:${br.solid}${br.solidB ? ';--brand-b:' + br.solidB : ''}`;
      const el = h(`<button class="vehicle ${done ? 'is-selected' : ''}" data-brand="${v.brand}" style="${bStyle}">${done ? '✓ ' : ''}${esc(v.name)}</button>`);
      el.onclick = () => { ui.currentVehicle = v.id; go('question', { step: 0 }); };
      grid.appendChild(el);
    });
    vehicleSection.appendChild(grid);
    b.appendChild(vehicleSection);
    s.appendChild(b);

    const allDone = state.cabVehicles.every((v) => ui.completedVehicles.has(v.id));
    s.appendChild(foot({
      back: () => go('language'),
      next: allDone ? () => confirmSubmit(submitAllEvaluations) : null,
      nextLabel: allDone ? t().submit : false,
    }));
    app.appendChild(s);
  }

  /* ---------- category icons (question step) ---------- */
  const CAT_ICONS = {
    boarding: 'assets/icons/boarding-exiting.svg?v=3',
    ergonomics: 'assets/icons/ergonomics-reachability.svg?v=6',
    fit_finish: 'assets/icons/fit-finish.svg?v=7',
    safety: 'assets/icons/safety-visibility.svg?v=6',
  };

    /* ---------- question step ---------- */
  function viewQuestion() {
    const vehicle = getActiveVehicle();
    const brand = vehicle ? BRANDS[vehicle.brand] : BRANDS.scania;
    const cat = tCat(state.cabQuestions[ui.stepIndex]);
    const s = screen();

    const hd = head();
    const chipStyle = `--chip:${brand.solid}${brand.solidB ? ';--chip-b:' + brand.solidB : ''}`;
    hd.querySelector('.screen__head-right').appendChild(h(`<span class="vehicle-chip" data-brand="${vehicle ? vehicle.brand : ''}" style="${chipStyle}">${esc(vehicle ? vehicle.name : '')}</span>`));
    s.appendChild(hd);

    const total = state.cabQuestions.length;
    const step = h(`<div class="stepper" style="--step:${brand.text || brand.solid}"></div>`);
    for (let i = 0; i < total; i++) {
      const cls = i < ui.stepIndex ? 'is-done' : i === ui.stepIndex ? 'is-current' : '';
      step.appendChild(h(`<div class="stepper__dot ${cls}"></div>`));
      if (i < total - 1) step.appendChild(h(`<div class="stepper__line ${i < ui.stepIndex ? 'is-done' : ''}"></div>`));
    }
    s.appendChild(step);

    const b = body();
    const questionIcon = CAT_ICONS[cat.id];
    const qHead = h('<div class="question-head question-head--cab"></div>');
    if (questionIcon) qHead.appendChild(h(`<img class="question-icon" src="${questionIcon}" alt="" aria-hidden="true">`));
    const qText = h('<div class="question-head__text"></div>');
    qText.appendChild(h(`<h1 class="screen__title">${esc(cat.title)}</h1>`));
    if (cat.instruction) qText.appendChild(h(`<p class="screen__sub">${esc(cat.instruction)}</p>`));
    qHead.appendChild(qText);
    b.appendChild(qHead);

    const draft = activeDraft();
    const wrap = h('<div class="question-metrics-cab"></div>');
    cat.metrics.forEach((m) => {
      const val = draft[m.id] != null ? draft[m.id] : 0;
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
      input.oninput = () => { draft[m.id] = Number(input.value); valEl.textContent = `${input.value}/${scale}`; paint(); };
      paint();
      wrap.appendChild(metric);
    });
    b.appendChild(wrap);
    s.appendChild(b);

    const isLast = ui.stepIndex === total - 1;
    s.appendChild(foot({
      back: () => ui.stepIndex === 0 ? go('vehicleHub') : go('question', { step: ui.stepIndex - 1 }),
      next: isLast ? () => { ui.completedVehicles.add(ui.currentVehicle); go('vehicleHub'); } : () => go('question', { step: ui.stepIndex + 1 }),
      nextLabel: isLast ? (t().done || 'Done') : t().next,
    }));
    app.appendChild(s);
  }

  function confirmSubmit(onConfirm) {
    const overlay = h('<div class="confirm-overlay"></div>');
    const box = h(`<div class="confirm-box">
      <p class="confirm-box__title">${esc(t().confirmTitle)}</p>
      <p class="confirm-box__msg">${esc(t().confirmMsg)}</p>
      <div class="confirm-box__btns">
        <button class="btn-cancel">${esc(t().back)}</button>
        <button class="btn-confirm">${esc(t().submit)}</button>
      </div>
    </div>`);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    box.querySelector('.btn-cancel').onclick = () => overlay.remove();
    const confirmBtn = box.querySelector('.btn-confirm');
    confirmBtn.onclick = () => {
      /* A fast double-tap on a touchscreen can fire two click events before
         the first one's overlay.remove() takes effect, which would call
         onConfirm() (submitEvaluation) twice and post two separate, genuinely
         distinct submissions (each with its own fresh timestamp) — the
         backend's duplicate check can't catch that since they aren't the
         same submission. Guard against it here, as the very first thing
         the handler does. */
      if (confirmBtn.disabled) return;
      confirmBtn.disabled = true;
      overlay.remove();
      onConfirm();
    };
  }

  /* Submits every completed vehicle's evaluation as its own row, in one
     go once the whole hub is checked off. Each gets its own timestamp
     offset by index (rather than calling new Date() fresh each time) so
     two submissions built back-to-back in this loop can never land on
     the exact same millisecond — that timestamp is the backend's
     idempotency key (see writeSubmission in google-apps-script.js), and
     a collision there would make it treat a real second vehicle's
     submission as a duplicate resend of the first and silently drop it. */
  function submitAllEvaluations() {
    if (window.STDSheets) {
      const baseTime = Date.now();
      let i = 0;
      state.cabVehicles.forEach((v) => {
        if (!ui.completedVehicles.has(v.id)) return;
        window.STDSheets.submit({
          timestamp: new Date(baseTime + i).toISOString(),
          lang: state.lang,
          country: state.country || '',
          group: todayLabel(),
          formId: 'cab',
          vehicleId: v.id,
          vehicleName: v.name,
          vehicleBrand: v.brand,
          questions: state.cabQuestions,
          answers: ui.draftsByVehicle[v.id] || {},
        });
        i++;
      });
    }
    go('thanks');
  }

  /* ---------- thank you ---------- */
  function viewThanks() {
    const s = screen('thanks');
    s.appendChild(head());
    const wrap = h(`<div class="thanks__wrap">
      <h1 class="thanks__title">${t().thanks}</h1>
      <p class="thanks__msg">Your Cab Assessment ratings for all vehicles have been submitted.</p>
      <div class="thanks__btns">
        <button class="pill" data-act="next">Done</button>
      </div>
    </div>`);
    $('[data-act="next"]', wrap).onclick = () => {
      ui.currentVehicle = null; ui.draftsByVehicle = {}; ui.completedVehicles = new Set();
      go('intro');
    };
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

  window.addEventListener('storage', (e) => {
    if (e.key === window.STD.STORE_KEY) {
      window.STD.load();
      if (ui.view === 'intro' || ui.view === 'language') render();
    }
  });

  /* same, but for a config edit pulled in from another device via Sheets — see sheets.js */
  window.STD.onQuestionsChanged = () => {
    if (ui.view === 'intro' || ui.view === 'language') render();
  };

  /* Auto-reload after 30 min of idle on intro screen */
  let lastActive = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (ui.view === 'intro' && Date.now() - lastActive > 30 * 60 * 1000) {
        location.reload();
      }
      lastActive = Date.now();
    } else {
      lastActive = Date.now();
    }
  });

  const restartBtn = document.getElementById('restartBtn');
  if (restartBtn) {
    restartBtn.onclick = () => {
      ui.currentVehicle = null; ui.draftsByVehicle = {}; ui.completedVehicles = new Set();
      state.lang = 'en'; state.country = ''; save();
      noAnim = true; go('intro'); noAnim = false;
    };
  }

  window.STD.load();
  render();
})();
