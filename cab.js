/* ============================================================
   SCANIA · CAB ASSESSMENT — kiosk page
   Fixed vehicle (set by admin via localStorage).
   Flow: intro → language → questions → thank you.
   ============================================================ */
(function () {
  'use strict';
  const { $, h, esc, BRANDS, LANGS, COUNTRIES, t, tCat, state, save } = window.STD;

  const CAB_VEHICLE_KEY = 'scania-cab-vehicle';


  function getActiveVehicle() {
    const id = localStorage.getItem(CAB_VEHICLE_KEY);
    return id ? state.cabVehicles.find((v) => v.id === id) || null : null;
  }

  let ui = { view: 'intro', stepIndex: 0, draft: {}, completedCats: new Set() };
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
    if (autoRestartTimer) { clearInterval(autoRestartTimer); autoRestartTimer = null; }
    ui.view = view;
    if (opts.step !== undefined) ui.stepIndex = opts.step;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const BRAND_GLOW = {
    scania:   ['rgba(7,169,158,.65)',   'rgba(1,152,195,.55)',   'rgba(7,169,158,.45)'],
    volvo:    ['rgba(103,46,157,.65)',  'rgba(237,178,215,.50)', 'rgba(150,50,200,.35)'],
    man:      ['rgba(230,110,20,.60)',  'rgba(60,80,200,.38)',   'rgba(230,110,20,.40)'],
    mercedes: ['rgba(190,190,190,.55)', 'rgba(120,120,120,.45)', 'rgba(20,20,20,.55)'],
  };

  function applyGlow() {
    const glow = document.querySelector('.bg-glow');
    if (!glow) return;
    if (ui.view !== 'intro') {
      glow.style.background = 'none';
      glow.style.filter = 'none';
      return;
    }
    const vehicle = getActiveVehicle();
    const cfg = vehicle && BRAND_GLOW[vehicle.brand];
    const c1 = cfg ? cfg[0] : 'rgba(200,40,140,.50)';
    const c2 = cfg ? cfg[1] : 'rgba(240,80,180,.38)';
    const c3 = cfg ? cfg[2] : 'rgba(180,20,120,.28)';
    if (glow.style.getPropertyValue('--glow-c1') === c1 && glow.style.filter !== 'none') return;
    glow.style.setProperty('--glow-c1', c1);
    glow.style.setProperty('--glow-c2', c2);
    glow.style.setProperty('--glow-c3', c3);
    glow.style.background = [
      'radial-gradient(circle 55vmin at var(--gx1) var(--gy1),var(--glow-c1) 30%,transparent 70%)',
      'radial-gradient(circle 50vmin at var(--gx2) var(--gy2),var(--glow-c2) 30%,transparent 70%)',
      'radial-gradient(circle 52vmin at var(--gx3) var(--gy3),var(--glow-c3) 30%,transparent 70%)',
    ].join(',');
    glow.style.filter = 'blur(35px)';
  }

  function render() {
    const oldEl = app.firstElementChild;
    if (oldEl) oldEl.style.display = 'none';
    const vehicle = getActiveVehicle();
    document.body.dataset.cabVehicle = ui.view === 'intro' && vehicle ? vehicle.id : '';
    if (!vehicle) { viewUnconfigured(); if (oldEl) oldEl.remove(); return; }
    ({ intro: viewIntro, language: viewLanguage, hub: viewHub, question: viewQuestion, thanks: viewThanks }[ui.view] || viewIntro)();
    if (oldEl) oldEl.remove();
    const al = document.querySelector('.admin-link');
    if (al) al.style.display = ui.view === 'intro' ? '' : 'none';
    const rl = document.getElementById('restartBtn');
    if (rl) rl.style.display = (ui.view !== 'intro') ? 'block' : 'none';
    document.body.classList.toggle('is-intro', ui.view === 'intro');
    applyGlow();
  }

  /* ---------- not configured ---------- */
  function viewUnconfigured() {
    app.appendChild(h(`<div class="cover">
      ${LOGO}
      <div class="cover__bottom">
        <div class="cover__eyebrow">Sales Force Boost | 2026</div>
        <h1 class="cover__title" style="font-size:clamp(28px,4vw,52px)">No vehicle<br>configured</h1>
        <span class="cover__cta" style="opacity:.5">Set a vehicle from the admin page</span>
      </div>
    </div>`));
  }

  /* ---------- intro / cover ---------- */
  function viewIntro() {
    const vehicle = getActiveVehicle();
    const brand = vehicle ? BRANDS[vehicle.brand] : BRANDS.scania;
    const bStyle = vehicle ? `--chip:${brand.solid}${brand.solidB ? ';--chip-b:' + brand.solidB : ''}` : '';
    const c = h(`<div class="cover" role="button" tabindex="0">
      ${LOGO}
      <div class="cover__bottom">
        <div class="cover__eyebrow">Sales Force Boost | 2026</div>
        <h1 class="cover__title">Cab<br>Assessment</h1>
        <div class="cover__chip-row">
          <span class="vehicle-chip" data-brand="${vehicle ? vehicle.brand : ''}" style="${bStyle}">${esc(vehicle ? vehicle.name : '')}</span>
          <span class="cover__cta">${t().tap} ${ARROW_R}</span>
        </div>
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
        go('hub');
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

  /* ---------- category hub ---------- */
  const CAT_ICONS = {
    boarding: 'assets/icons/boarding-exiting.svg?v=2',
    ergonomics: 'assets/icons/ergonomics-reachability.svg?v=5',
    fit_finish: 'assets/icons/fit-finish.svg?v=6',
    safety: 'assets/icons/safety-visibility.svg?v=5',
  };

  function viewHub() {
    const vehicle = getActiveVehicle();
    const brand = vehicle ? BRANDS[vehicle.brand] : BRANDS.scania;
    const chipStyle = `--chip:${brand.solid}${brand.solidB ? ';--chip-b:' + brand.solidB : ''}`;
    const s = screen();
    const hd = head();
    hd.appendChild(h(`<span class="vehicle-chip" data-brand="${vehicle ? vehicle.brand : ''}" style="${chipStyle}">${esc(vehicle ? vehicle.name : '')}</span>`));
    s.appendChild(hd);
    const b = body();
    b.appendChild(h(`<h1 class="screen__title">${t().selectCategory || 'Select a category'}</h1>`));

    const grid = h('<div class="cat-hub"></div>');
    state.cabQuestions.forEach((q, i) => {
      const cat = tCat(q);
      const done = ui.completedCats.has(i);
      const icon = CAT_ICONS[q.id];
      const tile = h(`<div class="cat-tile ${done ? 'is-done' : ''}" role="button" tabindex="0">
        <div class="cat-tile__check">✓</div>
        ${icon ? `<img class="cat-tile__icon" src="${icon}" alt="" aria-hidden="true">` : ''}
        <div class="cat-tile__name">${esc(cat.title)}</div>
      </div>`);
      const open = () => go('question', { step: i });
      tile.addEventListener('click', open);
      tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(); });
      grid.appendChild(tile);
    });
    b.appendChild(grid);
    s.appendChild(b);

    const allDone = state.cabQuestions.every((_, i) => ui.completedCats.has(i));
    s.appendChild(foot({
      back: () => go('language'),
      next: allDone ? () => confirmSubmit(submitEvaluation) : null,
      nextLabel: allDone ? t().submit : false,
    }));
    app.appendChild(s);
  }

    /* ---------- question step ---------- */
  function viewQuestion() {
    const vehicle = getActiveVehicle();
    const brand = vehicle ? BRANDS[vehicle.brand] : BRANDS.scania;
    const cat = tCat(state.cabQuestions[ui.stepIndex]);
    const s = screen();

    const hd = head();
    const chipStyle = `--chip:${brand.solid}${brand.solidB ? ';--chip-b:' + brand.solidB : ''}`;
    hd.appendChild(h(`<span class="vehicle-chip" data-brand="${vehicle ? vehicle.brand : ''}" style="${chipStyle}">${esc(vehicle ? vehicle.name : '')}</span>`));
    s.appendChild(hd);

    const b = body();
    const questionIcon = CAT_ICONS[cat.id];
    const qHead = h('<div class="question-head question-head--cab"></div>');
    if (questionIcon) qHead.appendChild(h(`<img class="question-icon" src="${questionIcon}" alt="" aria-hidden="true">`));
    const qText = h('<div class="question-head__text"></div>');
    qText.appendChild(h(`<h1 class="screen__title">${esc(cat.title)}</h1>`));
    if (cat.instruction) qText.appendChild(h(`<p class="screen__sub">${esc(cat.instruction)}</p>`));
    qHead.appendChild(qText);
    b.appendChild(qHead);

    const wrap = h('<div class="question-metrics-cab"></div>');
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

    s.appendChild(foot({
      back: () => go('hub'),
      next: () => { ui.completedCats.add(ui.stepIndex); go('hub'); },
      nextLabel: t().done || 'Done',
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
    const vehicle = getActiveVehicle();
    if (!vehicle) return;
    if (window.STDSheets) {
      window.STDSheets.submit({
        timestamp: new Date().toISOString(),
        lang: state.lang,
        country: state.country || '',
        group: state.group || '',
        formId: 'cab',
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        vehicleBrand: vehicle.brand,
        questions: state.cabQuestions,
        answers: ui.draft,
      });
    }
    go('thanks');
  }

  /* ---------- thank you ---------- */
  let autoRestartTimer = null;

  function viewThanks() {
    const vehicle = getActiveVehicle();
    const s = screen('thanks');
    s.appendChild(head());
    const wrap = h(`<div class="thanks__wrap">
      <h1 class="thanks__title">${t().thanks}</h1>
      <p class="thanks__msg">${esc(t().submitted(vehicle ? vehicle.name : ''))}</p>
      <p class="thanks__countdown" id="thanksCountdown"></p>
    </div>`);
    const b = body();
    b.appendChild(wrap);
    s.appendChild(b);
    app.appendChild(s);

    let remaining = 10;
    const countdownEl = document.getElementById('thanksCountdown');
    const tick = () => { if (countdownEl) countdownEl.textContent = t().restarting(remaining); };
    tick();
    autoRestartTimer = setInterval(() => {
      remaining--;
      tick();
      if (remaining <= 0) {
        clearInterval(autoRestartTimer);
        ui.draft = {}; ui.completedCats = new Set(); go('intro');
      }
    }, 1000);
  }

  /* ---------- shared bits ---------- */
  function screen(extra = '') { return h(`<section class="screen ${extra}"></section>`); }
  function body() { const b = h('<div class="screen__body"></div>'); if (noAnim) b.style.animation = 'none'; return b; }
  function head() { return h(`<div class="screen__head">${LOGO}</div>`); }
  function foot({ back, next, nextLabel } = {}) {
    const f = h('<div class="screen__foot"></div>');
    if (back) { const b = h(`<button class="linkbtn">${ARROW_L}${esc(t().back)}</button>`); b.onclick = back; f.appendChild(b); }
    else f.appendChild(h('<span></span>'));
    if (next) { const n = h(`<button class="linkbtn is-next">${esc(nextLabel || t().next)}${ARROW_R}</button>`); n.onclick = next; f.appendChild(n); }
    else if (nextLabel !== false) f.appendChild(h(`<button class="linkbtn is-next" disabled>${esc(nextLabel || t().next)}${ARROW_R}</button>`));
    return f;
  }

  window.addEventListener('storage', (e) => {
    if (e.key === window.STD.STORE_KEY || e.key === CAB_VEHICLE_KEY) {
      window.STD.load();
      if (ui.view === 'intro' || ui.view === 'language') render();
    }
  });

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
      ui.draft = {}; ui.completedCats = new Set(); state.lang = 'en'; state.country = ''; save();
      noAnim = true; go('intro'); noAnim = false;
    };
  }

  window.STD.load();
  render();
})();
