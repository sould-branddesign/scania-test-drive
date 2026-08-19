/* ============================================================
   SCANIA · TEST DRIVE — Google Sheets sync
   Sends evaluation data to a Google Apps Script web app.

   The POST uses mode:'no-cors' (required — Apps Script's 302
   redirect breaks a normal CORS preflight), which means the browser
   can never actually read back whether the write succeeded; fetch()
   resolves as soon as the request reaches the network regardless of
   what happened on the Apps Script side. So instead of trusting that
   resolution, every submission is kept in a local "pending" list
   until a reconciliation pass confirms — by reading the sheet back —
   that it actually landed, and resubmits anything that didn't.
   ============================================================ */
(function () {
  'use strict';

  const PENDING_KEY  = 'scania_sheets_pending_v1';   // [{ at, submission }] — unconfirmed submissions
  const QUEUE_KEY    = 'scania_sheets_queue_v1';      // legacy key, migrated into PENDING_KEY below
  const CFG_KEY      = 'scania_sheets_url_v1';
  const DEFAULT_URL  = 'https://script.google.com/macros/s/AKfycbzsdw59lQK78KnXcqRZZbon-JH0ZoJqrGvLfdtVI6RLl7zzBtnxU9AUBsOp56B9Vlgu/exec';

  const RECONCILE_GRACE_MS = 20000;      // let Sheets catch up before treating a submission as missing
  const RECONCILE_INTERVAL_MS = 120000;  // periodic safety-net check while the kiosk sits idle

  function getUrl()  { return localStorage.getItem(CFG_KEY) || DEFAULT_URL; }
  function setUrl(u) { localStorage.setItem(CFG_KEY, u.trim()); }

  function loadPending()  { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; } }
  function savePending(p) { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); }

  /* one-time migration from the old fail-only queue, so nothing
     already waiting gets dropped by this update */
  (function migrateLegacyQueue() {
    let legacy;
    try { legacy = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { legacy = []; }
    if (legacy.length) {
      const pending = loadPending();
      legacy.forEach((submission) => pending.push({ at: 0, submission })); // at:0 → immediately due
      savePending(pending);
    }
    localStorage.removeItem(QUEUE_KEY);
  })();

  /* Build headers, one data row, and raw JSON for read-back */
  function buildPayload(submission) {
    const { timestamp, lang, country, group, formId, vehicleId, vehicleName, vehicleBrand, questions, answers } = submission;
    const headers = ['Timestamp', 'Group', 'Language', 'Country', 'Form', 'Vehicle', 'Brand'];
    const row     = [timestamp,   group || '', lang, country || '', formId || 'testdrive', vehicleName, vehicleBrand];
    questions.forEach((cat) => {
      cat.metrics.forEach((m) => {
        headers.push(cat.title + ' — ' + m.label);
        row.push(answers[m.id] != null ? answers[m.id] : '');
      });
    });
    const sheetName = (formId === 'cab') ? 'Cab Assessment' : 'Test Drive';
    return { headers, row, sheetName, raw: { timestamp, group: group || '', country: country || '', formId: formId || 'testdrive', vehicleId, vehicleName, vehicleBrand, answers } };
  }

  /* Fetch all submitted evaluations from Sheets (for Results view + reconciliation) */
  async function fetchAll() {
    const url = getUrl();
    if (!url) return null;
    try {
      const res = await fetch(url + '?action=data', { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /* POST a single submission to the Apps Script endpoint.
     Uses no-cors because Apps Script redirects via 302 which
     breaks normal CORS preflight. The response is opaque but
     the data still reaches the sheet — see the module comment
     above for why this alone can't be trusted as confirmation. */
  async function postSubmission(url, submission) {
    const payload = buildPayload(submission);
    /* Send as form data — JSON body is lost in Apps Script's 302 redirect
       but URLSearchParams survives it intact. */
    const form = new URLSearchParams();
    form.append('data', JSON.stringify(payload));
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      body: form,
    });
  }

  /* Submit a new evaluation. Optimistically posts it, but — because
     no-cors hides real success/failure — always parks it in the
     pending list too; reconcile() is what actually confirms it. */
  async function submit(submission) {
    const url = getUrl();
    if (!url) return { status: 'no-url' };
    const pending = loadPending();
    pending.push({ at: Date.now(), submission });
    savePending(pending);
    try {
      await postSubmission(url, submission);
    } catch {
      /* offline or blocked — stays pending, reconcile() retries it later */
    }
    reconcile();   // opportunistic — will no-op until the grace period passes
    return { status: 'pending' };
  }

  let reconciling = false;

  /* Compare locally pending submissions against what's actually in the
     sheet; drop anything confirmed there, resubmit anything that isn't.
     Skips items still inside the grace window (Sheets read-after-write
     can lag a submission by a few seconds) and bails out entirely if
     the sheet can't be read right now, rather than guessing and
     resubmitting things that may have simply not been checkable yet. */
  async function reconcile() {
    if (reconciling) return;
    const url = getUrl();
    if (!url) return;
    const pending = loadPending();
    if (!pending.length) return;
    if (!pending.some((p) => Date.now() - p.at > RECONCILE_GRACE_MS)) return;

    reconciling = true;
    try {
      const remote = await fetchAll();
      if (!remote || !remote.ok) return; // can't verify right now — leave pending as-is, try again later

      const landed = new Set((remote.evaluations || []).map((e) => e.timestamp));
      const stillPending = [];
      for (const p of pending) {
        if (Date.now() - p.at <= RECONCILE_GRACE_MS) { stillPending.push(p); continue; }
        if (landed.has(p.submission.timestamp)) continue;   // confirmed — drop it
        try { await postSubmission(url, p.submission); } catch { /* still offline */ }
        stillPending.push({ at: Date.now(), submission: p.submission });   // reset the grace clock
      }
      savePending(stillPending);
    } finally {
      reconciling = false;
    }
  }

  window.addEventListener('online', () => reconcile());
  setInterval(reconcile, RECONCILE_INTERVAL_MS);
  reconcile();   // catches submissions left pending from a previous session

  window.STDSheets = {
    submit, getUrl, setUrl, fetchAll,
    flushQueue: reconcile,     // kept for admin.js
    loadQueue: loadPending,    // kept for admin.js's "N pending" display
  };
})();
