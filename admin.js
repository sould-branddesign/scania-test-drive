/* ============================================================
   SCANIA · TEST DRIVE — admin page
   Staff-facing: results visualisation + question editor.
   Tabs switch between the two; data is shared via STD/localStorage.
   ============================================================ */
(function () {
  'use strict';
  const { $, h, esc, clamp, slug, BRANDS, state, save, seedDemo,
          vehicleCategoryScore, normaliseCategory,
          DEFAULT_QUESTIONS, DEFAULT_CAB_QUESTIONS, LANGS, QI18N } = window.STD;

  let view = 'results';   // 'results' | 'editor'
  let submissions = [];   // all submissions loaded from Sheets
  const _today = new Date(); let filterGroup = `${_today.getFullYear()}-${String(_today.getMonth()+1).padStart(2,'0')}-${String(_today.getDate()).padStart(2,'0')}`;   // default to today (local)
  let filterMarkets = new Set();  // empty = all markets
  let activeForm = new URLSearchParams(location.search).get('form') === 'cab' ? 'cab' : 'testdrive';
  const CAB_VEHICLE_KEY = 'scania-cab-vehicle';
  const toIso = (s) => { const d = new Date(s); if (isNaN(d)) return s; const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dy = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dy}`; };

  function activeQuestions() { return activeForm === 'cab' ? state.cabQuestions : state.questions; }
  function activeVehicles() { return activeForm === 'cab' ? state.cabVehicles : state.vehicles; }
  function evaluatedVehicles() {
    return activeVehicles().filter((v) => state.answers[v.id] && Object.keys(state.answers[v.id]).length);
  }
  function brandsPresent() {
    const set = new Set(evaluatedVehicles().map((v) => v.brand));
    return Object.keys(BRANDS).filter((b) => set.has(b));
  }
  /* Flat accent colour for text/icons (radar lines, scores, swatches) — brand.solid
     doubles as a gradient stop and can be near-black (e.g. DAF), so prefer brand.text
     when set rather than using solid directly for single-colour accents. */
  function brandAccent(brand) {
    const br = BRANDS[brand];
    return (br && (br.text || br.solid)) || '#fff';
  }
  function vehicleOverall(vehicleId) {
    const scores = activeQuestions().map((c) => vehicleCategoryScore(vehicleId, c)).filter((s) => s != null);
    if (!scores.length) return null;
    return scores.reduce((s, v) => s + v, 0) / scores.length;
  }
  function brandCategoryScore(brand, cat) {
    const vs = evaluatedVehicles().filter((v) => v.brand === brand)
      .map((v) => vehicleCategoryScore(v.id, cat)).filter((s) => s != null);
    if (!vs.length) return null;
    return vs.reduce((s, v) => s + v, 0) / vs.length;
  }
  function setFormTheme() {
    document.body.dataset.form = activeForm;
    const link = document.getElementById('openTestLink');
    if (!link) return;
    if (activeForm === 'cab') {
      const activeVehicleId = localStorage.getItem(CAB_VEHICLE_KEY) || '';
      const vehicle = state.cabVehicles.find((v) => v.id === activeVehicleId);
      const label = vehicle ? vehicle.name + ' cab assessment ↗' : 'Open cab assessment ↗';
      link.textContent = label;
      link.href = 'cab.html';
    } else {
      link.innerHTML = 'Open test drive ↗';
      link.href = 'index.html';
    }
  }
  function formSwitcher() {
    return h(`<div class="form-switcher">
      <button class="form-btn ${activeForm === 'testdrive' ? 'is-active' : ''}" data-form="testdrive">Test Drive</button>
      <button class="form-btn ${activeForm === 'cab' ? 'is-active' : ''}" data-form="cab">Cab Assessment</button>
    </div>`);
  }

  const app = $('#app');
  const LOGO_SVG = `<svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 169 28" fill="none" aria-label="Scania" role="img"><path d="M78.86 16.33H71.78L75.32 7.08L78.86 16.33ZM112 26.81H123.18V1.15H113.58V14.66L103.45 1.15H91.28V22.06L83.18 1.15H67.62L61.76 16.33H52.24C51.76 19.33 50.01 20.97 46.94 20.97C43.4 20.97 41.42 18.23 41.42 13.97C41.42 9.71 43.42 7.03 46.94 7.03C49.83 7.03 51.69 8.56 52.09 11.03H62.65V10.33C62.65 4.67 57.75 0 47.05 0C35.51 0 31.12 5.77 31.12 14C31.12 14.19 31.12 14.37 31.12 14.56C29.68 12.8 26.9 11.77 22.31 11.11L15.63 10.16C13.11 9.8 11.54 9.51 11.54 8.26C11.54 7.26 12.54 6.07 15.26 6.07C18.26 6.07 19.98 7.24 19.98 9.14H30.72V8.59C30.72 3.48 25.61 0.12 15.56 0.12C5.23 0.12 0.700001 3.88 0.700001 9.18C0.700001 13.31 3.4 15.72 9.76 16.59L17.32 17.65C20.02 18.02 20.9 18.57 20.9 19.7C20.9 21.16 19.51 21.96 16.4 21.96C12.9 21.96 11.29 20.46 11.29 18.38H0V18.97C0 24.66 5.37 27.97 15.93 27.97C25.68 27.97 31.34 25.82 32.27 20.37C34.22 25.05 38.81 28.01 47.05 28.01C53.3 28.01 56.81 26.31 58.91 23.74L57.72 26.84H67.72L69.18 23.1H81.46L82.88 26.79H100.88V12.03L112 26.81ZM154.73 16.33H147.64L151.18 7.06L154.73 16.33ZM168.98 26.79L159.08 1.15H143.48L135.41 22.06V1.15H125.58V26.79H143.58L145 23.1H157.27L158.7 26.79H168.98Z" fill="white"/></svg>`;
  const LOGO = LOGO_SVG;
  const BRAND_LOGO = LOGO_SVG.replace('class="logo"', 'class="slide__brand"');

  function go(v) { view = v; render(); syncNav(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  /* Compute state.answers from submissions filtered by formId and filterGroup (in-memory, not saved) */
  function applyFilter() {
    const formId = activeForm === 'cab' ? 'cab' : 'testdrive';
    const filtered = submissions.filter((s) => {
      const sForm = s.formId || 'testdrive';
      if (sForm !== formId) return false;
      if (filterGroup && toIso(s.group) !== toIso(filterGroup)) return false;
      if (filterMarkets.size && !filterMarkets.has(s.country)) return false;
      return true;
    });
    const sums = {}, counts = {};
    filtered.forEach(({ vehicleId, answers: a }) => {
      if (!vehicleId || !a) return;
      if (!sums[vehicleId]) { sums[vehicleId] = {}; counts[vehicleId] = {}; }
      Object.entries(a).forEach(([k, v]) => {
        if (v == null) return;
        sums[vehicleId][k] = (sums[vehicleId][k] || 0) + Number(v);
        counts[vehicleId][k] = (counts[vehicleId][k] || 0) + 1;
      });
    });
    state.answers = {};
    Object.keys(sums).forEach((vid) => {
      state.answers[vid] = {};
      Object.keys(sums[vid]).forEach((k) => { state.answers[vid][k] = sums[vid][k] / counts[vid][k]; });
    });
  }

  /* Load answers from Sheets and merge into state, then re-render */
  async function loadFromSheets() {
    if (!window.STDSheets) return null;
    const data = await window.STDSheets.fetchAll();
    if (!data || !data.evaluations) return null;
    submissions = data.evaluations.filter((e) => e.vehicleId);
    applyFilter();
    render();
    return submissions.length;
  }
  function syncNav() {
    document.querySelectorAll('.navlink[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === view));
  }
  function render() { app.innerHTML = ''; setFormTheme(); (view === 'editor' ? viewEditor : viewResults)(); }

  /* nav */
  document.addEventListener('click', (e) => {
    const fb = e.target.closest('[data-form]');
    if (fb && fb.dataset.form !== activeForm) { activeForm = fb.dataset.form; filterGroup = ''; filterMarkets.clear(); applyFilter(); setFormTheme(); render(); return; }
    const tab = e.target.closest('.navlink[data-tab]');
    if (tab) go(tab.dataset.tab);
  });

  /* ============================================================
     RESULTS — bar charts + radar
     ============================================================ */
  function viewResults() {
    const wrap = h('<div class="results"></div>');
    wrap.appendChild(formSwitcher());
    const evald = evaluatedVehicles();

    if (activeForm === 'cab') {
      wrap.appendChild(buildCabSetup());
    }

    wrap.appendChild(h(`<div class="results__head">
      <div>
        <h1>Evaluation Results</h1>
        <p>${evald.length} vehicle${evald.length === 1 ? '' : 's'} evaluated across ${activeQuestions().length} categories</p>
      </div>
      <div class="results__tools">
        <div class="group-setter" id="groupSetter"></div>
        <div class="results__actions">
          <button class="btn" data-act="present" ${evald.length ? '' : 'disabled style="opacity:.4;cursor:not-allowed"'}>▶ Present — ${filterGroup || 'All days'}</button>
          <button class="btn secondary" data-act="clear">Clear data</button>
        </div>
      </div>
    </div>`));

    buildGroupSetter(wrap.querySelector('#groupSetter'));

    // Group filter bar — always shown on results page
    const formId = activeForm === 'cab' ? 'cab' : 'testdrive';
    const groups = [...new Set(submissions.filter((s) => (s.formId || 'testdrive') === formId).map((s) => s.group).filter(Boolean))].sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ''), 10), nb = parseInt(b.replace(/\D/g, ''), 10);
      return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
    });
    const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };
    // Normalise all group values to ISO, deduplicate, sort chronologically
    const rawGroups = submissions.filter((s) => (s.formId || 'testdrive') === formId).map((s) => s.group).filter(Boolean);
    const isoGroups = [...new Set(rawGroups.map(toIso))].sort();
    // Build a map so filterGroup (stored as original value) can match any variant
    const isoToOriginal = {};
    rawGroups.forEach((g) => { const iso = toIso(g); if (!isoToOriginal[iso]) isoToOriginal[iso] = g; });
    const bar = h('<div class="filter-bar"></div>');
    bar.appendChild(h(`<span class="filter-bar__label">Date:</span>`));
    const activeIso = filterGroup ? toIso(filterGroup) : '';
    bar.appendChild(h(`<button class="filter-btn ${activeIso === '' ? 'is-active' : ''}" data-fg="">All days</button>`));
    isoGroups.forEach((iso) => {
      const orig = isoToOriginal[iso] || iso;
      bar.appendChild(h(`<button class="filter-btn ${activeIso === iso ? 'is-active' : ''}" data-fg="${esc(orig)}">${fmtDate(iso)}</button>`));
    });
    wrap.appendChild(bar);

    const markets = [...new Set(submissions.filter((s) => {
      if ((s.formId || 'testdrive') !== formId) return false;
      if (!s.country) return false;
      if (activeIso && toIso(s.group || '') !== activeIso) return false;
      return true;
    }).map((s) => s.country))].sort();
    const marketBar = h('<div class="filter-bar filter-bar--market"></div>');
    marketBar.appendChild(h(`<span class="filter-bar__label">Market:</span>`));
    marketBar.appendChild(h(`<button class="filter-btn ${filterMarkets.size === 0 ? 'is-active' : ''}" data-fm="">All markets</button>`));
    markets.forEach((m) => {
      marketBar.appendChild(h(`<button class="filter-btn ${filterMarkets.has(m) ? 'is-active' : ''}" data-fm="${esc(m)}">${esc(m)}</button>`));
    });
    wrap.appendChild(marketBar);

    if (!evald.length) {
      wrap.appendChild(h(`<div class="empty"><h2>No evaluations yet</h2><p>Run a ${activeForm === 'cab' ? 'Cab Assessment' : 'test-drive'} evaluation or load the demo data to see the comparison charts.</p></div>`));
    } else {
      wrap.appendChild(groupCard());
      const grid = h('<div class="cards-grid"></div>');
      const note = 'Models included: ' + evald.map((v) => `<nobr>${esc(v.name)}</nobr>`).join(', ');
      activeQuestions().forEach((cat) => grid.appendChild(barCard(cat, note)));
      wrap.appendChild(grid);
    }

    wrap.addEventListener('click', (e) => {
      const fg = e.target.closest('[data-fg]');
      if (fg) { filterGroup = fg.dataset.fg; filterMarkets = new Set([...filterMarkets].filter((m) => markets.includes(m))); applyFilter(); render(); return; }
      const fm = e.target.closest('[data-fm]');
      if (fm) {
        const m = fm.dataset.fm;
        if (m === '') filterMarkets.clear();
        else if (filterMarkets.has(m)) filterMarkets.delete(m);
        else filterMarkets.add(m);
        applyFilter(); render(); return;
      }
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'sheets-load') { loadFromSheets(); }
      if (a.dataset.act === 'clear') { submissions = submissions.filter((s) => (s.formId || 'testdrive') !== (activeForm === 'cab' ? 'cab' : 'testdrive')); filterGroup = ''; filterMarkets.clear(); state.answers = {}; if (activeForm !== 'cab') { state.vehicles = []; save(); } render(); toast('Data cleared'); }
      if (a.dataset.act === 'present') openDeck();
      if (a.dataset.act === 'sheets-load') {
        a.textContent = 'Loading…'; a.disabled = true;
        loadFromSheets().then((count) => {
          if (count == null) toast('Fel: kontrollera att Apps Script är uppdaterat');
          else if (count === 0) { toast('Inga nya svar i Sheets'); render(); }
          else toast(count + ' svar laddade från Sheets');
        });
      }
    });
    app.appendChild(wrap);
  }

  function buildCabSetup() {
    const active = localStorage.getItem(CAB_VEHICLE_KEY) || '';
    const panel = h(`<div class="cab-setup">
      <h3 class="cab-setup__title">iPad Setup — Cab Assessment</h3>
      <p class="cab-setup__sub">Choose which vehicle is shown on the <a href="cab.html" target="_blank">cab.html</a> iPad. The iPad updates automatically.</p>
      <div class="cab-setup__grid"></div>
    </div>`);
    const grid = $('.cab-setup__grid', panel);
    state.cabVehicles.forEach((v) => {
      const isActive = v.id === active;
      const br = BRANDS[v.brand] || BRANDS.scania;
      const bStyle = `--brand:${br.solid}${br.solidB ? ';--brand-b:' + br.solidB : ''}`;
      const row = h(`<div class="cab-setup__row ${isActive ? 'is-active' : ''}">
        <span class="vehicle" style="${bStyle}">${esc(v.name)}</span>
        <button class="btn ${isActive ? '' : 'secondary'} cab-setup__btn" data-cab-set="${esc(v.id)}">${isActive ? '✓ Active' : 'Set active'}</button>
      </div>`);
      grid.appendChild(row);
    });
    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cab-set]');
      if (!btn) return;
      const id = btn.dataset.cabSet;
      localStorage.setItem(CAB_VEHICLE_KEY, id);
      const vname = state.cabVehicles.find((v) => v.id === id)?.name || id;
      // refresh all rows
      panel.querySelectorAll('.cab-setup__row').forEach((row) => {
        const b = row.querySelector('[data-cab-set]');
        const rowId = b?.dataset.cabSet;
        const on = rowId === id;
        row.classList.toggle('is-active', on);
        if (b) { b.textContent = on ? '✓ Active' : 'Set active'; b.classList.toggle('secondary', !on); }
      });
      setFormTheme();
      toast('iPad set to: ' + vname);
    });
    return panel;
  }

  function buildGroupSetter(container) {
    if (!container) return;
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    if (state.group !== today) { state.group = today; save(); }
    container.appendChild(h(`<span class="group-setter__label">Today's date: <strong>${today}</strong></span>`));
  }

  function barCard(cat, note) {
    const bars = brandsPresent().map((b) => ({ brand: b, score: brandCategoryScore(b, cat) })).filter((x) => x.score != null);
    bars.sort((a, b) => b.score - a.score);
    const card = h(`<div class="card">
      <div class="card__head">
        <h2 class="card__title">${esc(cat.title)}</h2>
        <p class="card__note"></p>
      </div>
      <div class="bars"></div>
      <div class="bar-axis"><span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10</span></div>
    </div>`);
    $('.card__note', card).innerHTML = note;
    const barsEl = $('.bars', card);
    bars.forEach((bar, i) => {
      const br = BRANDS[bar.brand];
      const pct = clamp((bar.score / 10) * 100, 6, 100);
      const row = h(`<div class="bar-row">
        <div class="bar-track">
          <div class="bar-fill" data-brand="${bar.brand}" style="--a:${br.solid};--b:${br.solidB || br.solid};width:0%">
            <span class="bar-name">${esc(br.name)}</span>
          </div>
        </div>
        <span class="bar-score">${bar.score.toFixed(1)}</span>
      </div>`);
      barsEl.appendChild(row);
      requestAnimationFrame(() => setTimeout(() => { $('.bar-fill', row).style.width = pct + '%'; }, 60 + i * 90));
    });
    return card;
  }

  function groupCard() {
    const cats = activeQuestions();
    const brands = brandsPresent();
    const evald = evaluatedVehicles().slice().sort((a, b) => (vehicleOverall(b.id) || 0) - (vehicleOverall(a.id) || 0));
    const note = 'Models included: ' + evald.map((v) => v.name).join(', ');

    const card = h(`<div class="card" style="margin-bottom:22px">
      <div class="card__head">
        <h2 class="card__title">${filterGroup ? (d => `${d.getDate()} ${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]} ${d.getFullYear()}`)(new Date(filterGroup)) + ' Comparison' : 'Overall Comparison'}</h2>
      </div>
      <div class="group-card">
        <div class="group-list"></div>
        <div class="radar-wrap"></div>
      </div>
    </div>`);

    const list = $('.group-list', card);
    evald.forEach((v) => {
      const ov = vehicleOverall(v.id);
      list.appendChild(h(`<div class="group-row">
        <span class="vehicle" style="--brand:${BRANDS[v.brand].solid}${BRANDS[v.brand].solidB ? ';--brand-b:' + BRANDS[v.brand].solidB : ''}">${esc(v.name)}</span>
        <span class="group-row__score" style="color:${brandAccent(v.brand)}">${ov != null ? ov.toFixed(1) : '–'}</span>
      </div>`));
    });

    const axisLabels = cats.map((c) => c.title);
    const allSeries = brands.map((b) => ({ brand: b, values: cats.map((c) => brandCategoryScore(b, c)) }));
    const selected = new Set(brands);

    const radarWrap = $('.radar-wrap', card);
    const svgSlot = h('<div style="width:100%"></div>');
    const legend = h('<div class="radar-legend radar-legend--interactive"></div>');

    function refreshSvg() {
      svgSlot.innerHTML = '';
      const filtered = allSeries.filter((s) => selected.has(s.brand));
      svgSlot.appendChild(renderRadar(axisLabels, filtered));
    }

    brands.forEach((b) => {
      const br = BRANDS[b];
      const tag = h(`<span class="radar-tag is-on" style="--c:${brandAccent(b)}">
        <i class="radar-tag__swatch"></i>${esc(br.name)}
      </span>`);
      tag.addEventListener('click', () => {
        if (selected.has(b)) {
          // Don't allow deselecting the last one
          if (selected.size === 1) return;
          selected.delete(b);
          tag.classList.remove('is-on');
        } else {
          selected.add(b);
          tag.classList.add('is-on');
        }
        refreshSvg();
      });
      legend.appendChild(tag);
    });

    radarWrap.appendChild(svgSlot);
    radarWrap.appendChild(legend);
    refreshSvg();
    return card;
  }

  function renderRadar(axes, series) {
    const N = axes.length;
    const size = 440, cx = size / 2, cy = size / 2, R = size * 0.36;
    const padX = 130, padY = 36;
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${-padX} ${-padY} ${size + padX * 2} ${size + padY * 2}`);
    svg.setAttribute('width', '100%');
    svg.style.maxWidth = (size + padX * 2) + 'px';

    const ang = (i) => (-Math.PI / 2) + (i * 2 * Math.PI / N);
    const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
    const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

    [0.25, 0.5, 0.75, 1].forEach((f) => {
      const pts = Array.from({ length: N }, (_, i) => pt(i, R * f).join(',')).join(' ');
      svg.appendChild(mk('polygon', { points: pts, fill: f === 1 ? 'rgba(10,30,68,.25)' : 'none', stroke: '#1b3262', 'stroke-width': f === 1 ? 1.4 : 1 }));
    });
    axes.forEach((label, i) => {
      const [x, y] = pt(i, R);
      svg.appendChild(mk('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: '#1b3262', 'stroke-width': 1 }));
      const [lx, ly] = pt(i, R + 16);
      const anchor = Math.abs(lx - cx) < 8 ? 'middle' : (lx > cx ? 'start' : 'end');
      const lines = wrapLabel(label, 16);
      const txt = mk('text', { x: lx, y: ly, fill: '#aebfde', 'font-size': 13, 'font-weight': 700, 'text-anchor': anchor, 'dominant-baseline': 'middle' });
      lines.forEach((ln, li) => { const span = mk('tspan', { x: lx, dy: li === 0 ? `${-(lines.length - 1) * 0.55}em` : '1.1em' }); span.textContent = ln; txt.appendChild(span); });
      svg.appendChild(txt);
    });
    series.slice().sort((a, b) => avg(a.values) - avg(b.values)).forEach((s) => {
      const accent = brandAccent(s.brand);
      const pts = s.values.map((v, i) => pt(i, R * (clamp(v || 0, 0, 10) / 10)).join(',')).join(' ');
      const poly = mk('polygon', { points: pts, fill: accent, 'fill-opacity': 0.12, stroke: accent, 'stroke-width': 2.2, 'stroke-linejoin': 'round' });
      poly.style.filter = `drop-shadow(0 0 5px ${accent}aa)`;
      svg.appendChild(poly);
      s.values.forEach((v, i) => { const [x, y] = pt(i, R * (clamp(v || 0, 0, 10) / 10)); svg.appendChild(mk('circle', { cx: x, cy: y, r: 2.8, fill: accent })); });
    });

    const wrap = h('<div style="width:100%;display:flex;flex-direction:column;align-items:center"></div>');
    wrap.appendChild(svg);
    return wrap;
  }
  const avg = (arr) => { const v = arr.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : 0; };
  function wrapLabel(label, maxLen) {
    if (label.length <= maxLen) return [label];
    const words = label.split(' '); const lines = []; let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > maxLen && cur) { lines.push(cur); cur = w; }
      else cur = (cur + ' ' + w).trim();
      if (lines.length === 1 && cur.length > maxLen) break;
    }
    if (cur) lines.push(cur);
    if (lines.length > 2) { lines[1] = lines.slice(1).join(' '); lines.length = 2; if (lines[1].length > maxLen + 4) lines[1] = lines[1].slice(0, maxLen + 1) + '…'; }
    return lines;
  }

  /* ============================================================
     PRESENT — 16:9 results slideshow
     Cover → Group comparison → one slide per category.
     ============================================================ */
  let deck = null;

  function buildSlides() {
    const evald = evaluatedVehicles();
    if (!evald.length) return [];
    const slides = [{ make: slideCover }, { make: slideGroup }];
    activeQuestions().forEach((cat) => slides.push({ make: () => slideCategory(cat) }));
    slides.push({ make: slideSummary });
    return slides;
  }

  function slideCover() {
    const evald = evaluatedVehicles();
    return h(`<div class="slide slide--cover">
      ${LOGO}
      <div class="slide--cover__btm">
        <div class="slide--cover__eyebrow">Sales Force Boost | 2026</div>
        <h1 class="slide--cover__title">Evaluation<br>Results</h1>
        <div class="slide--cover__meta">${evald.length} vehicles · ${activeQuestions().length} categories · ${activeForm === 'cab' ? 'Cab Assessment' : 'Test Drive'}${filterGroup ? ' · ' + (d => `${d.getDate()} ${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]} ${d.getFullYear()}`)(new Date(filterGroup)) : ''}</div>
      </div>
    </div>`);
  }

  function slideGroup() {
    const cats = activeQuestions(), brands = brandsPresent();
    const evald = evaluatedVehicles().slice().sort((a, b) => (vehicleOverall(b.id) || 0) - (vehicleOverall(a.id) || 0));
    const el = h(`<div class="slide slide--group">
      <div class="slide__head">${BRAND_LOGO}<h2 class="slide__title">${filterGroup ? (d => `${d.getDate()} ${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]} ${d.getFullYear()}`)(new Date(filterGroup)) + ' Comparison' : 'Overall Comparison'}</h2></div>
      <div class="slide__body"><div class="slide__list"></div><div class="slide__radar"></div></div>
    </div>`);
    const list = $('.slide__list', el);
    evald.slice(0, 12).forEach((v) => {
      const ov = vehicleOverall(v.id);
      list.appendChild(h(`<div class="slide__listrow">
        <span class="slide__veh" style="--brand:${BRANDS[v.brand].solid}${BRANDS[v.brand].solidB ? ';--brand-b:' + BRANDS[v.brand].solidB : ''}">${esc(v.name)}</span>
        <span class="slide__score" style="color:${brandAccent(v.brand)}">${ov != null ? ov.toFixed(1) : '–'}</span>
      </div>`));
    });
    const series = brands.map((b) => ({ brand: b, values: cats.map((c) => brandCategoryScore(b, c)) }));
    $('.slide__radar', el).appendChild(renderRadar(cats.map((c) => c.title), series));
    return el;
  }

  function marketBrandCatScore(market, brand, cat) {
    const formId = activeForm === 'cab' ? 'cab' : 'testdrive';
    const relevant = submissions.filter((s) =>
      (s.formId || 'testdrive') === formId &&
      s.country === market &&
      (!filterGroup || toIso(s.group) === toIso(filterGroup))
    );
    const vids = (activeForm === 'cab' ? state.cabVehicles : state.vehicles)
      .filter((v) => v.brand === brand).map((v) => v.id);
    const vals = [];
    relevant.forEach(({ vehicleId, answers: a }) => {
      if (!vids.includes(vehicleId) || !a) return;
      cat.metrics.forEach((m) => { if (a[m.id] != null) vals.push(Number(a[m.id])); });
    });
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }

  function renderBars(barsData) {
    const wrap = document.createDocumentFragment();
    barsData.forEach(({ brand, score }) => {
      const br = BRANDS[brand];
      const pct = clamp((score / 10) * 100, 6, 100);
      const row = h(`<div class="bar-row">
        <div class="bar-track"><div class="bar-fill" data-w="${pct}" data-brand="${brand}" style="--a:${br.solid};--b:${br.solidB || br.solid};width:0%"><span class="bar-name">${esc(br.name)}</span></div></div>
        <span class="bar-score">${score.toFixed(1)}</span>
      </div>`);
      wrap.appendChild(row);
    });
    return wrap;
  }

  function slideCategory(cat) {
    const selectedMarkets = [...filterMarkets];

    // Split view when 2+ specific markets are selected — one bar set per selected market
    if (selectedMarkets.length >= 2) {
      const el = h(`<div class="slide slide--split-markets">
        <div class="slide__head">${BRAND_LOGO}<h2 class="slide__title">${esc(cat.title)}</h2></div>
        <div class="split-panels" style="grid-template-columns:repeat(${selectedMarkets.length},1fr)"></div>
      </div>`);
      const panels = $('.split-panels', el);
      selectedMarkets.forEach((market) => {
        const bars = brandsPresent().map((b) => ({ brand: b, score: marketBrandCatScore(market, b, cat) }))
          .filter((x) => x.score != null).sort((a, b) => b.score - a.score);
        const panel = h(`<div class="split-panel">
          <div class="split-panel__market">${esc(market)}</div>
          <div class="bars split-panel__bars"></div>
          <div class="scale-rule"></div>
          <div class="bar-axis"><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span></div>
        </div>`);
        $('.split-panel__bars', panel).appendChild(renderBars(bars));
        panels.appendChild(panel);
      });
      return el;
    }

    // Single panel — scoped to the one selected market, or aggregated across all markets
    const bars = selectedMarkets.length === 1
      ? brandsPresent().map((b) => ({ brand: b, score: marketBrandCatScore(selectedMarkets[0], b, cat) }))
        .filter((x) => x.score != null).sort((a, b) => b.score - a.score)
      : brandsPresent().map((b) => ({ brand: b, score: brandCategoryScore(b, cat) }))
        .filter((x) => x.score != null).sort((a, b) => b.score - a.score);
    const el = h(`<div class="slide">
      <div class="slide__head">${BRAND_LOGO}<h2 class="slide__title">${esc(cat.title)}</h2></div>
      <div class="bars slide__bars"></div>
      <div class="scale-rule"></div>
      <div class="bar-axis slide__axis"><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span></div>
    </div>`);
    $('.bars', el).appendChild(renderBars(bars));
    return el;
  }

  function slideMarkets() {
    const formId = activeForm === 'cab' ? 'cab' : 'testdrive';
    const cats = activeQuestions();
    const marketSubs = submissions.filter((s) => (s.formId || 'testdrive') === formId && s.country && (!filterGroup || toIso(s.group) === toIso(filterGroup)));
    const markets = [...new Set(marketSubs.map((s) => s.country))].sort();

    // Compute avg score per category per market
    function marketCatScore(market, cat) {
      const relevant = marketSubs.filter((s) => s.country === market);
      const vals = [];
      relevant.forEach(({ answers: a }) => {
        cat.metrics.forEach((m) => { if (a && a[m.id] != null) vals.push(Number(a[m.id])); });
      });
      return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    }
    function marketOverall(market) {
      const scores = cats.map((c) => marketCatScore(market, c)).filter((s) => s != null);
      return scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
    }

    const colCount = Math.min(markets.length, 3);
    const el = h(`<div class="slide slide--markets">
      <div class="slide__head">${BRAND_LOGO}<h2 class="slide__title">Market Comparison${filterGroup ? ' · ' + esc(filterGroup) : ''}</h2></div>
      <div class="market-cols" style="--cols:${colCount}"></div>
    </div>`);
    const cols = $('.market-cols', el);

    markets.slice(0, 3).forEach((market) => {
      const overall = marketOverall(market);
      const col = h(`<div class="market-col"></div>`);
      col.appendChild(h(`<div class="market-col__name">${esc(market)}</div>`));
      col.appendChild(h(`<div class="market-col__overall">${overall != null ? overall.toFixed(1) : '–'}<span class="market-col__of">/10</span></div>`));
      const list = h('<div class="market-col__cats"></div>');
      cats.forEach((cat) => {
        const score = marketCatScore(market, cat);
        const pct = score != null ? clamp((score / 10) * 100, 4, 100) : 0;
        list.appendChild(h(`<div class="market-cat-row">
          <div class="market-cat-row__label">${esc(cat.title)}</div>
          <div class="market-cat-row__track"><div class="market-cat-row__fill" style="width:${pct.toFixed(1)}%"></div></div>
          <div class="market-cat-row__score">${score != null ? score.toFixed(1) : '–'}</div>
        </div>`));
      });
      col.appendChild(list);
      cols.appendChild(col);
    });

    return el;
  }

  function slideSummary() {
    const evald = evaluatedVehicles().slice().sort((a, b) => (vehicleOverall(b.id) || 0) - (vehicleOverall(a.id) || 0));
    const winner = evald[0];

    const el = h(`<div class="slide slide--summary">
      ${BRAND_LOGO}
      <h2 class="slide__title" style="margin-top:10px">Summary</h2>
      <div class="summary__ranking"></div>
    </div>`);

    const ranking = $('.summary__ranking', el);
    const top3 = evald.slice(0, 3);
    const rest = evald.slice(3);
    const restTotal = rest.length;

    // Top 3 — stagger bottom-to-top (2nd place first, winner last)
    top3.forEach((v, i) => {
      const accent = brandAccent(v.brand);
      const vs = vehicleOverall(v.id);
      const isWinner = i === 0;
      const catScores = activeQuestions().map((c) => {
        const s = brandCategoryScore(v.brand, c);
        return `<span class="summary__cat"><span class="summary__cat-label">${esc(c.title)}</span><span class="summary__cat-score" style="color:${accent}">${s != null ? s.toFixed(1) : '–'}</span></span>`;
      }).join('');
      const row = h(`<div class="summary__row ${isWinner ? 'is-winner' : 'is-top3'}" style="--brand:${accent}">
        <span class="summary__rank">${i + 1}</span>
        <span class="summary__vname">${esc(v.name)}</span>
        <span class="summary__vscore" style="color:${accent}">${vs != null ? vs.toFixed(1) : '–'}</span>
        <div class="summary__cats">${catScores}</div>
      </div>`);
      // 3rd animates first, winner last
      const staggerIndex = top3.length - 1 - i;
      const baseDelay = isWinner ? 300 + (top3.length - 1) * 200 + 450 : 300 + staggerIndex * 200;
      row.style.opacity = '0';
      row.style.transform = isWinner ? 'scale(.92)' : 'translateY(8px)';
      ranking.appendChild(row);
      if (isWinner) {
        setTimeout(() => { row.classList.add('is-revealed'); }, baseDelay);
      } else {
        setTimeout(() => {
          row.style.transition = 'opacity .4s ease, transform .4s ease';
          row.style.opacity = '1';
          row.style.transform = 'translateY(0)';
        }, baseDelay);
      }
    });

    // Remaining vehicles — compact row that fades in after top 3
    if (restTotal > 0) {
      const restRow = h('<div class="summary__rest"></div>');
      rest.forEach((v, i) => {
        const accent = brandAccent(v.brand);
        const vs = vehicleOverall(v.id);
        restRow.appendChild(h(`<div class="summary__rest-item" style="--brand:${accent}">
          <span class="summary__rest-rank">${i + 4}</span>
          <span class="summary__rest-name">${esc(v.name)}</span>
          <span class="summary__rest-score" style="color:${accent}">${vs != null ? vs.toFixed(1) : '–'}</span>
        </div>`));
      });
      restRow.style.opacity = '0';
      ranking.appendChild(restRow);
      // Fade in after winner starts revealing (winner delay + 700ms into its animation)
      const winnerDelay = 300 + (top3.length - 1) * 200 + 450;
      setTimeout(() => {
        restRow.style.transition = 'opacity .5s ease';
        restRow.style.opacity = '1';
      }, winnerDelay + 1200);
    }

    return el;
  }

  function openDeck() {
    const slides = buildSlides();
    if (!slides.length) return;
    const el = h(`<div class="deck">
      <button class="deck__close" data-deck="close" title="Close (Esc)">✕</button>
      <div class="slide-stage-wrap"><div class="slide-stage"></div></div>
      <div class="deck__controls">
        <button class="deck__btn" data-deck="prev" title="Previous (←)">‹</button>
        <span class="deck__counter"></span>
        <button class="deck__btn" data-deck="next" title="Next (→)">›</button>
        <button class="deck__btn" data-deck="full" title="Fullscreen (F)">⛶</button>
      </div>
    </div>`);
    document.body.appendChild(el);
    deck = { slides, idx: 0, el };

    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-deck]'); if (!b) return;
      const a = b.dataset.deck;
      if (a === 'next') nav(1);
      else if (a === 'prev') nav(-1);
      else if (a === 'close') closeDeck();
      else if (a === 'full') toggleFull();
    });
    deck.onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); nav(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); nav(-1); }
      else if (e.key === 'Escape') closeDeck();
      else if (e.key === 'f' || e.key === 'F') toggleFull();
    };
    document.addEventListener('keydown', deck.onKey);
    deck.onResize = fitStage;
    window.addEventListener('resize', deck.onResize);

    /* Swipe support */
    let swipeX = null;
    el.addEventListener('touchstart', (e) => { swipeX = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (swipeX === null) return;
      const dx = e.changedTouches[0].clientX - swipeX;
      swipeX = null;
      if (Math.abs(dx) > 40) nav(dx < 0 ? 1 : -1);
    }, { passive: true });
    try { if (el.requestFullscreen) { const p = el.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } } catch (e) { /* ignore */ }
    renderDeck();
  }

  function closeDeck() {
    if (!deck) return;
    document.removeEventListener('keydown', deck.onKey);
    window.removeEventListener('resize', deck.onResize);
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* ignore */ }
    deck.el.remove();
    deck = null;
  }

  function nav(d) { if (!deck) return; const n = clamp(deck.idx + d, 0, deck.slides.length - 1); if (n !== deck.idx) { deck.idx = n; renderDeck(); } }

  function renderDeck() {
    const stage = $('.slide-stage', deck.el);
    stage.innerHTML = '';
    stage.appendChild(deck.slides[deck.idx].make());
    $('.deck__counter', deck.el).textContent = `${deck.idx + 1} / ${deck.slides.length}`;
    $('[data-deck="prev"]', deck.el).disabled = deck.idx === 0;
    $('[data-deck="next"]', deck.el).disabled = deck.idx === deck.slides.length - 1;
    fitStage();
    requestAnimationFrame(() => deck.el.querySelectorAll('.bar-fill[data-w]').forEach((b, i) => setTimeout(() => { b.style.width = b.dataset.w + '%'; }, 50 + i * 80)));
  }

  function fitStage() {
    if (!deck) return;
    const wrap = $('.slide-stage-wrap', deck.el);
    const s = Math.min((wrap.clientWidth - 48) / 1280, (wrap.clientHeight - 48) / 720);
    $('.slide-stage', deck.el).style.setProperty('--s', s > 0 ? s : 0.1);
  }

  function toggleFull() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (deck && deck.el.requestFullscreen) deck.el.requestFullscreen();
    } catch (e) { /* ignore */ }
  }

  /* ============================================================
     EDITOR — change questions
     ============================================================ */
  let editDraft = null;
  let editLang = 'en';        // 'en' = edit the English source; any other code = edit that language's translations
  let translationDraft = null;

  /* current effective text for a category in `lang` — admin override, else the baked-in translation, else null */
  function effectiveCatTranslation(lang, catId) {
    const override = state.translations[lang] && state.translations[lang][catId];
    const base = QI18N[lang] && QI18N[lang][catId];
    if (!override && !base) return null;
    const metricIds = new Set([
      ...(base && base.metrics ? Object.keys(base.metrics) : []),
      ...(override && override.metrics ? Object.keys(override.metrics) : []),
    ]);
    const metrics = {};
    metricIds.forEach((mid) => {
      const bm = base && base.metrics && base.metrics[mid];
      const om = override && override.metrics && override.metrics[mid];
      metrics[mid] = {
        label: (om && om.label) || (bm && bm.label) || '',
        min: (om && om.min) || (bm && bm.min) || '',
        max: (om && om.max) || (bm && bm.max) || '',
      };
    });
    return {
      title: (override && override.title) || (base && base.title) || '',
      instruction: (override && override.instruction) || (base && base.instruction) || '',
      metrics,
    };
  }
  function viewEditor() {
    editLang = 'en';
    editDraft = JSON.parse(JSON.stringify(activeForm === 'cab' ? state.cabQuestions : state.questions));
    translationDraft = null;
    const sheetsUrl = window.STDSheets ? window.STDSheets.getUrl() : '';
    const queueLen  = window.STDSheets ? window.STDSheets.loadQueue().length : 0;
    const wrap = h(`<div class="editor" style="padding-top:0">
      <div class="editor__head">
        <h1>Edit Questions</h1>
        <button class="btn secondary" data-act="reset">Reset to default</button>
      </div>
      <p class="editor__hint">Add, edit, reorder or remove the evaluation categories and their rating metrics. Each metric becomes a 0–10 slider in the test-drive flow. Changes are saved and used by the test page.</p>

      <div class="lang-edit-bar">
        <label for="editLangSelect">Editing text for</label>
        <select class="std-select" id="editLangSelect">
          <option value="en">English (source — add/remove/reorder here)</option>
          ${LANGS.filter((l) => l.code !== 'en').map((l) => `<option value="${esc(l.code)}">${esc(l.label)}</option>`).join('')}
        </select>
        <p class="lang-edit-bar__hint">Pick a language to translate the categories and metrics below. Leave a field empty to fall back to the English text. Categories, metrics and their order can only be changed in English — translations just override the wording.</p>
      </div>

      <div class="sheets-cfg">
        <h2 class="sheets-cfg__title">Google Sheets sync</h2>
        <p class="sheets-cfg__hint">Paste the URL from your deployed Google Apps Script web app. Each submitted evaluation is sent as rows (one per metric). Submissions are queued locally if offline and synced automatically when connectivity returns.</p>
        <div class="sheets-cfg__row">
          <input class="sheets-cfg__input" id="sheetsUrl" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(sheetsUrl)}" />
          <button class="btn" data-act="sheets-save">Save URL</button>
          ${queueLen ? `<button class="btn secondary" data-act="sheets-flush">Sync now (${queueLen} pending)</button>` : ''}
        </div>
        ${sheetsUrl ? '<p class="sheets-cfg__status" id="sheetsCfgStatus"></p>' : ''}
      </div>

      <div id="qlist"></div>
      <button class="btn add" data-act="add-cat">+ Add category</button>
      <div class="editor__foot">
        <button class="btn secondary" data-act="cancel">Cancel</button>
        <button class="btn" data-act="save">Save changes</button>
      </div>
    </div>`);
    wrap.insertBefore(formSwitcher(), wrap.firstChild);
    wrap.addEventListener('click', editorClick);
    wrap.addEventListener('input', editorInput);
    $('#editLangSelect', wrap).addEventListener('change', (e) => {
      editLang = e.target.value;
      if (editLang !== 'en') translationDraft = buildTranslationDraft(editLang);
      renderQList();
      updateEditorChrome();
    });
    app.appendChild(wrap);
    renderQList();
    updateEditorChrome();
  }

  function buildTranslationDraft(lang) {
    const draft = {};
    activeQuestions().forEach((cat) => {
      const eff = effectiveCatTranslation(lang, cat.id) || {};
      draft[cat.id] = { title: eff.title || '', instruction: eff.instruction || '', metrics: {} };
      cat.metrics.forEach((m) => {
        const em = (eff.metrics && eff.metrics[m.id]) || {};
        draft[cat.id].metrics[m.id] = { label: em.label || '', min: em.min || '', max: em.max || '' };
      });
    });
    return draft;
  }

  /* only keep fields that actually differ from the baked-in QI18N text, so untouched
     categories keep tracking future updates to the static translations instead of
     getting permanently pinned to whatever they happened to show when this was saved */
  function sparseTranslationOverride(lang, draft) {
    const sparse = {};
    activeQuestions().forEach((cat) => {
      const base = QI18N[lang] && QI18N[lang][cat.id];
      const d = draft[cat.id];
      const catOverride = {};
      if (d.title && d.title !== ((base && base.title) || '')) catOverride.title = d.title;
      if (d.instruction && d.instruction !== ((base && base.instruction) || '')) catOverride.instruction = d.instruction;
      const metricsOverride = {};
      cat.metrics.forEach((m) => {
        const bm = base && base.metrics && base.metrics[m.id];
        const dm = d.metrics[m.id];
        const mo = {};
        if (dm.label && dm.label !== ((bm && bm.label) || '')) mo.label = dm.label;
        if (dm.min && dm.min !== ((bm && bm.min) || '')) mo.min = dm.min;
        if (dm.max && dm.max !== ((bm && bm.max) || '')) mo.max = dm.max;
        if (Object.keys(mo).length) metricsOverride[m.id] = mo;
      });
      if (Object.keys(metricsOverride).length) catOverride.metrics = metricsOverride;
      if (Object.keys(catOverride).length) sparse[cat.id] = catOverride;
    });
    return sparse;
  }

  function updateEditorChrome() {
    const addCatBtn = document.querySelector('[data-act="add-cat"]');
    if (addCatBtn) addCatBtn.style.display = editLang === 'en' ? '' : 'none';
    const resetBtn = document.querySelector('[data-act="reset"]');
    if (resetBtn) resetBtn.textContent = editLang === 'en' ? 'Reset to default' : 'Clear translation';
  }

  function renderQList() {
    const list = $('#qlist'); list.innerHTML = '';
    if (editLang === 'en') renderQListEnglish(list); else renderQListTranslation(list);
  }

  function renderQListEnglish(list) {
    editDraft.forEach((cat, ci) => {
      const card = h(`<div class="qcard" data-ci="${ci}">
        <div class="qcard__bar">
          <div class="qcard__idx">${ci + 1}</div>
          <div class="spacer"></div>
          <button class="iconbtn" data-act="up" ${ci === 0 ? 'disabled' : ''} title="Move up">↑</button>
          <button class="iconbtn" data-act="down" ${ci === editDraft.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
          <button class="iconbtn danger" data-act="del-cat" ${editDraft.length === 1 ? 'disabled' : ''} title="Remove category">✕</button>
        </div>
        <div class="field"><label>Category title</label><input class="input" data-f="title" value="${esc(cat.title)}"></div>
        <div class="field"><label>Instruction</label><textarea class="textarea" data-f="instruction" rows="2">${esc(cat.instruction)}</textarea></div>
        <div class="metrics"></div>
        <button class="btn add" data-act="add-metric">+ Add metric</button>
      </div>`);
      const mEl = $('.metrics', card);
      cat.metrics.forEach((m, mi) => {
        mEl.appendChild(h(`<div class="metric-edit" data-mi="${mi}">
          <div class="metric-edit__grid">
            <div class="field" style="margin:0"><label>Metric label</label><input class="input" data-mf="label" value="${esc(m.label)}"></div>
            <div class="field" style="margin:0"><label>Left label</label><input class="input" data-mf="min" value="${esc(m.min)}"></div>
            <div class="field" style="margin:0"><label>Right label</label><input class="input" data-mf="max" value="${esc(m.max)}"></div>
            <button class="iconbtn danger" data-act="del-metric" ${cat.metrics.length === 1 ? 'disabled' : ''} title="Remove metric">✕</button>
          </div>
        </div>`));
      });
      list.appendChild(card);
    });
  }

  function renderQListTranslation(list) {
    activeQuestions().forEach((cat) => {
      const draft = translationDraft[cat.id];
      const card = h(`<div class="qcard" data-catid="${esc(cat.id)}">
        <div class="qcard__bar">
          <div class="qcard__catlabel">${esc(cat.title)}</div>
        </div>
        <div class="field"><label>Category title <span class="field__en">EN: ${esc(cat.title)}</span></label><input class="input" data-f="title" placeholder="${esc(cat.title)}" value="${esc(draft.title)}"></div>
        <div class="field"><label>Instruction <span class="field__en">EN: ${esc(cat.instruction)}</span></label><textarea class="textarea" data-f="instruction" rows="2" placeholder="${esc(cat.instruction)}">${esc(draft.instruction)}</textarea></div>
        <div class="metrics"></div>
      </div>`);
      const mEl = $('.metrics', card);
      cat.metrics.forEach((m) => {
        const md = draft.metrics[m.id];
        mEl.appendChild(h(`<div class="metric-edit" data-mid="${esc(m.id)}">
          <div class="metric-edit__grid">
            <div class="field" style="margin:0"><label>Metric label <span class="field__en">EN: ${esc(m.label)}</span></label><input class="input" data-mf="label" placeholder="${esc(m.label)}" value="${esc(md.label)}"></div>
            <div class="field" style="margin:0"><label>Left label <span class="field__en">EN: ${esc(m.min)}</span></label><input class="input" data-mf="min" placeholder="${esc(m.min)}" value="${esc(md.min)}"></div>
            <div class="field" style="margin:0"><label>Right label <span class="field__en">EN: ${esc(m.max)}</span></label><input class="input" data-mf="max" placeholder="${esc(m.max)}" value="${esc(md.max)}"></div>
          </div>
        </div>`));
      });
      list.appendChild(card);
    });
  }

  function editorInput(e) {
    const f = e.target.dataset.f, mf = e.target.dataset.mf;
    if (editLang === 'en') {
      const catEl = e.target.closest('[data-ci]'); if (!catEl) return;
      const ci = Number(catEl.dataset.ci);
      if (f) { editDraft[ci][f] = e.target.value; }
      else if (mf) { const mi = Number(e.target.closest('[data-mi]').dataset.mi); editDraft[ci].metrics[mi][mf] = e.target.value; }
    } else {
      const catEl = e.target.closest('[data-catid]'); if (!catEl) return;
      const catId = catEl.dataset.catid;
      if (f) { translationDraft[catId][f] = e.target.value; }
      else if (mf) { const mid = e.target.closest('[data-mid]').dataset.mid; translationDraft[catId].metrics[mid][mf] = e.target.value; }
    }
  }

  function editorClick(e) {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const act = btn.dataset.act;
    const catEl = btn.closest('[data-ci]');
    const ci = catEl ? Number(catEl.dataset.ci) : -1;
    switch (act) {
      case 'add-cat':
        editDraft.push({ id: slug('category-' + (editDraft.length + 1)) + '-' + (editDraft.length + 1), title: 'New category', instruction: '', metrics: [{ id: slug('metric'), label: 'New metric', min: 'Low', max: 'High', scale: 10 }] });
        renderQList(); break;
      case 'del-cat': if (editDraft.length > 1) { editDraft.splice(ci, 1); renderQList(); } break;
      case 'up': if (ci > 0) { [editDraft[ci - 1], editDraft[ci]] = [editDraft[ci], editDraft[ci - 1]]; renderQList(); } break;
      case 'down': if (ci < editDraft.length - 1) { [editDraft[ci + 1], editDraft[ci]] = [editDraft[ci], editDraft[ci + 1]]; renderQList(); } break;
      case 'add-metric': editDraft[ci].metrics.push({ id: slug('metric-' + Math.random()), label: 'New metric', min: 'Low', max: 'High', scale: 10 }); renderQList(); break;
      case 'del-metric': { const mi = Number(btn.closest('[data-mi]').dataset.mi); if (editDraft[ci].metrics.length > 1) { editDraft[ci].metrics.splice(mi, 1); renderQList(); } break; }
      case 'reset':
        if (editLang === 'en') {
          editDraft = JSON.parse(JSON.stringify(activeForm === 'cab' ? DEFAULT_CAB_QUESTIONS : DEFAULT_QUESTIONS));
          toast('Reset to default (not yet saved)');
        } else {
          translationDraft = {};
          activeQuestions().forEach((cat) => {
            translationDraft[cat.id] = { title: '', instruction: '', metrics: {} };
            cat.metrics.forEach((m) => { translationDraft[cat.id].metrics[m.id] = { label: '', min: '', max: '' }; });
          });
          toast('Cleared — will fall back to English (not yet saved)');
        }
        renderQList(); break;
      case 'cancel': go('results'); break;
      case 'save':
        if (editLang === 'en') {
          if (activeForm === 'cab') { state.cabQuestions = editDraft.map(normaliseCategory); save(); }
          else { window.ScaniaEval.setQuestions(editDraft); }
          toast('Questions saved'); go('results');
        } else {
          state.translations[editLang] = sparseTranslationOverride(editLang, translationDraft);
          save();
          toast('Translations saved for ' + ((LANGS.find((l) => l.code === editLang) || {}).label || editLang));
        }
        break;
      case 'sheets-save': {
        const url = $('#sheetsUrl') ? $('#sheetsUrl').value.trim() : '';
        if (window.STDSheets) window.STDSheets.setUrl(url);
        toast(url ? 'Webhook URL saved' : 'URL cleared');
        go('editor'); break;
      }
      case 'sheets-flush': {
        if (window.STDSheets) {
          const statusEl = $('#sheetsCfgStatus');
          if (statusEl) statusEl.textContent = 'Syncing…';
          window.STDSheets.flushQueue().then(() => {
            toast('Sync complete — ' + window.STDSheets.loadQueue().length + ' pending');
            go('editor');
          });
        }
        break;
      }
    }
  }

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(msg) {
    let el = $('.toast');
    if (!el) { el = h('<div class="toast"></div>'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /* reflect new submissions / edits coming from the test tab */
  window.addEventListener('storage', (e) => {
    if (e.key === window.STD.STORE_KEY) { window.STD.load(); if (view === 'results') render(); }
  });

  /* ---------- boot ---------- */
  window.STD.load();
  /* Restore any default vehicles that were accidentally removed */
  let repaired = false;
  window.STD.DEFAULT_VEHICLES.forEach((dv) => {
    if (!state.vehicles.find((v) => v.id === dv.id)) {
      state.vehicles.push(dv);
      repaired = true;
    }
  });
  if (repaired) save();
  syncNav();
  render();
  /* Auto-load from Sheets if URL is configured */
  if (window.STDSheets && window.STDSheets.getUrl()) loadFromSheets();
})();
