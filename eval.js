/* ============================================================
   SCANIA · SESSION EVALUATION — separate form for the first
   evaluation group. Six slides: one per session (relevance and
   quality, 1–6) and a final one for optional comments, then a
   thank-you. Not linked from anywhere else in the app.

   Answers go to their own Google Sheet through its own Apps Script
   (see "Utvärderingsformulär/eval-apps-script.js"), not the main
   evaluation sheet — EVAL_URL is that script's web-app address.
   ============================================================ */
(function () {
  'use strict';
  const { $, h, esc, BRANDS, T } = window.STD;

  /* Web-app address of the evaluation form's own Apps Script (see above), and
     the key it checks — must match EVAL_KEY there. Same idea as sheets.js:
     a bot/opportunist filter, not a real secret. */
  const EVAL_URL = 'https://script.google.com/macros/s/AKfycbwcywzcFf2ROmYkRUHe6Az2302vj4JfQMOnJVwQDnYvKpKmsfLSC7MWVslVWj8YNggS/exec';
  const EVAL_KEY = '65cd24f88fab99c4e8e3a0fb4a6f7a82382b4c14';

  const PENDING_KEY = 'scania_eval_pending_v1';
  const RECONCILE_GRACE_MS = 20000;
  const RECONCILE_INTERVAL_MS = 120000;

  const tx = T.en;   // English only — never follows a language picked in the other apps on this device
  const brand = BRANDS.scania;
  const accent = brand.text || brand.solid;

  const SESSIONS = [
    { id: 'opening',     title: 'Opening session' },
    { id: 'interactive', title: 'Interactive session' },
    { id: 'testdrive',   title: 'Test Drive' },
    { id: 'competitor',  title: 'Competitor comparison' },
    { id: 'bev',         title: 'BEV Session at the demo center' },
  ];
  const METRICS = [
    /* head = the fixed column name in the sheet */
    { id: 'relevance', label: 'Relevance', head: 'Relevance', min: 'Not relevant', max: 'Highly relevant' },
    { id: 'quality',   label: 'Quality',   head: 'Quality',   min: 'Poor',         max: 'Excellent' },
  ];
  const SCALE_MIN = 1, SCALE_MAX = 6;   // 1 = lowest … 6 = highest
  const TOTAL = SESSIONS.length + 1;   // + the comments slide

  let ui = { view: 'question', step: 0, answers: {}, comment: '' };
  let noAnim = false;

  const LOGO = '<img class="logo" src="assets/scania-logo.svg" alt="Scania">';
  const ARROW_R = '<svg class="arrow" viewBox="0 0 40 12" fill="none"><path d="M0 6h36M30 1l6 5-6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ARROW_L = '<svg class="arrow" viewBox="0 0 40 12" fill="none"><path d="M40 6H4M10 1L4 6l6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const app = $('#app');

  function go(view, step) {
    ui.view = view;
    if (step !== undefined) ui.step = step;
    const old = app.firstElementChild;
    if (old) old.style.display = 'none';
    (view === 'thanks' ? viewThanks : viewQuestion)();
    if (old) old.remove();
    window.scrollTo({ top: 0 });
  }

  function screen(extra = '') { return h(`<section class="screen ${extra}"></section>`); }
  function body() { const b = h('<div class="screen__body"></div>'); if (noAnim) b.style.animation = 'none'; return b; }
  function head() {
    const hd = h(`<div class="screen__head"><div class="screen__head-left">${LOGO}</div><div class="screen__head-right"></div></div>`);
    return hd;
  }
  function foot({ back, next, nextLabel }) {
    const f = h('<div class="screen__foot"></div>');
    if (back) { const b = h(`<button class="linkbtn">${ARROW_L}${esc(tx.back)}</button>`); b.onclick = back; f.appendChild(b); }
    else f.appendChild(h('<span></span>'));
    const n = h(`<button class="linkbtn is-next">${esc(nextLabel)}${ARROW_R}</button>`); n.onclick = next; f.appendChild(n);
    return f;
  }

  function viewQuestion() {
    const s = screen();
    s.appendChild(head());

    const step = h(`<div class="stepper" style="--step:${accent}"></div>`);
    for (let i = 0; i < TOTAL; i++) {
      const cls = i < ui.step ? 'is-done' : i === ui.step ? 'is-current' : '';
      step.appendChild(h(`<div class="stepper__dot ${cls}"></div>`));
      if (i < TOTAL - 1) step.appendChild(h(`<div class="stepper__line ${i < ui.step ? 'is-done' : ''}"></div>`));
    }
    s.appendChild(step);

    const b = body();
    const isComments = ui.step === SESSIONS.length;
    const session = SESSIONS[ui.step];
    b.appendChild(h(`<div class="question-head question-head--cab"><h1 class="screen__title">${esc(isComments ? 'Comments' : session.title)}</h1></div>`));

    if (isComments) {
      const wrap = h('<div class="question-metrics-cab eval-comment"><textarea class="textarea" id="evalComment" rows="5" maxlength="1000" aria-label="Comments" placeholder="Anything else you would like to share? (optional)"></textarea></div>');
      const ta = $('textarea', wrap);
      ta.value = ui.comment;
      ta.oninput = () => { ui.comment = ta.value; };
      b.appendChild(wrap);
    } else {
      const draft = ui.answers[session.id] || (ui.answers[session.id] = {});
      const wrap = h('<div class="question-metrics-cab"></div>');
      METRICS.forEach((m) => {
        const metric = h(`<div class="metric">
          <div class="metric__top">
            <span class="metric__label">${esc(m.label)}</span>
            <span class="metric__value" style="color:${accent}">${draft[m.id] != null ? draft[m.id] : '–'}/${SCALE_MAX}</span>
          </div>
          <div class="eval-scale" role="radiogroup" aria-label="${esc(session.title + ' – ' + m.label)}" style="--track:${accent}"></div>
          <div class="metric__ends"><span>${esc(m.min)}</span><span>${esc(m.max)}</span></div>
        </div>`);
        const scale = $('.eval-scale', metric);
        const valEl = $('.metric__value', metric);
        for (let n = SCALE_MIN; n <= SCALE_MAX; n++) {
          const btn = h(`<button type="button" class="eval-scale__opt${draft[m.id] === n ? ' is-selected' : ''}" role="radio" aria-checked="${draft[m.id] === n}">${n}</button>`);
          btn.onclick = () => {
            draft[m.id] = n;
            valEl.textContent = `${n}/${SCALE_MAX}`;
            scale.querySelectorAll('.eval-scale__opt').forEach((o, i) => { const on = SCALE_MIN + i === n; o.classList.toggle('is-selected', on); o.setAttribute('aria-checked', String(on)); });
          };
          scale.appendChild(btn);
        }
        wrap.appendChild(metric);
      });
      b.appendChild(wrap);
    }
    s.appendChild(b);

    s.appendChild(foot({
      back: ui.step === 0 ? null : () => go('question', ui.step - 1),
      next: isComments ? () => confirmSubmit(submitEvaluation) : () => go('question', ui.step + 1),
      nextLabel: isComments ? tx.submit : tx.next,
    }));
    app.appendChild(s);
  }

  function confirmSubmit(onConfirm) {
    const overlay = h('<div class="confirm-overlay"></div>');
    const box = h(`<div class="confirm-box">
      <p class="confirm-box__title">${esc(tx.confirmTitle)}</p>
      <p class="confirm-box__msg">${esc(tx.confirmMsg)}</p>
      <div class="confirm-box__btns">
        <button class="btn-cancel">${esc(tx.back)}</button>
        <button class="btn-confirm">${esc(tx.submit)}</button>
      </div>
    </div>`);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    box.querySelector('.btn-cancel').onclick = () => overlay.remove();
    const confirmBtn = box.querySelector('.btn-confirm');
    confirmBtn.onclick = () => {
      if (confirmBtn.disabled) return;   // a fast double-tap must not post twice
      confirmBtn.disabled = true;
      overlay.remove();
      onConfirm();
    };
  }

  function viewThanks() {
    const s = screen('thanks');
    s.appendChild(head());
    const wrap = h(`<div class="thanks__wrap">
      <h1 class="thanks__title">${esc(tx.thanks)}</h1>
      <p class="thanks__msg">Your evaluation has been submitted.</p>
      <div class="thanks__btns"><button class="pill" data-act="next">${esc(tx.done)}</button></div>
    </div>`);
    $('[data-act="next"]', wrap).onclick = reset;
    const b = body();
    b.appendChild(wrap);
    s.appendChild(b);
    app.appendChild(s);
  }

  function reset() {
    ui = { view: 'question', step: 0, answers: {}, comment: '' };
    noAnim = true; go('question', 0); noAnim = false;
  }

  /* ---------- sending ---------- */
  /* One flat row per submission: a time, every score, the comment, and the
     submission's own ID (its ISO timestamp, which is what the backend uses
     to recognise a resend). Headers travel with it so the sheet builds its own. */
  function buildPayload(sub) {
    const headers = ['Submitted'];
    const row = [sub.timestamp];
    SESSIONS.forEach((se) => METRICS.forEach((m) => {
      headers.push(se.title + ' — ' + m.head);
      const v = sub.answers[se.id] && sub.answers[se.id][m.id];
      row.push(v != null ? v : '');
    }));
    headers.push('Comments', 'Submission ID');
    row.push(sub.comment || '', sub.timestamp);
    return { headers, row, timestamp: sub.timestamp };
  }

  function loadPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; } }
  function savePending(p) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch {} }

  /* no-cors, same as sheets.js: the answer can't be read back, so each
     submission stays "pending" until reconcile() sees it in the sheet */
  async function post(sub) {
    const form = new URLSearchParams();
    form.append('data', JSON.stringify(buildPayload(sub)));
    form.append('key', EVAL_KEY);
    await fetch(EVAL_URL, { method: 'POST', mode: 'no-cors', body: form });
  }

  function submitEvaluation() {
    const sub = { timestamp: new Date().toISOString(), answers: ui.answers, comment: ui.comment.trim() };
    const pending = loadPending();
    pending.push({ at: Date.now(), submission: sub });
    savePending(pending);
    if (EVAL_URL) post(sub).catch(() => {}).then(() => reconcile());
    go('thanks');
  }

  let reconciling = false, confirmTimer = null;
  async function reconcile() {
    if (reconciling || !EVAL_URL) return;
    const pending = loadPending();
    if (!pending.length) return;
    if (!pending.some((p) => Date.now() - p.at > RECONCILE_GRACE_MS)) {
      if (!confirmTimer) confirmTimer = setTimeout(() => { confirmTimer = null; reconcile(); }, RECONCILE_GRACE_MS + 1000);
      return;
    }
    reconciling = true;
    let again = false;
    try {
      let remote = null;
      try { const res = await fetch(EVAL_URL + '?action=ids&_=' + Date.now(), { cache: 'no-store' }); if (res.ok) remote = await res.json(); } catch {}
      if (!remote || !remote.ok) { again = true; return; }
      const landed = new Set(remote.ids || []);
      const still = [];
      for (const p of pending) {
        if (Date.now() - p.at <= RECONCILE_GRACE_MS) { still.push(p); again = true; continue; }
        if (landed.has(p.submission.timestamp)) continue;
        try { await post(p.submission); } catch {}
        still.push({ at: Date.now(), submission: p.submission });
        again = true;
      }
      savePending(still);
    } finally {
      reconciling = false;
      if (again && !confirmTimer) confirmTimer = setTimeout(() => { confirmTimer = null; reconcile(); }, RECONCILE_GRACE_MS + 5000);
    }
  }
  window.addEventListener('online', reconcile);
  setInterval(reconcile, RECONCILE_INTERVAL_MS);

  window.STD.load(true);
  go('question', 0);
  reconcile();   // sends anything left over from an earlier visit
})();
