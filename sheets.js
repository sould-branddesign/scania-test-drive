/* ============================================================
   SCANIA · TEST DRIVE — Google Sheets sync
   Sends evaluation data to a Google Apps Script web app.
   Buffers submissions in localStorage when offline and
   retries automatically when connectivity is restored.
   ============================================================ */
(function () {
  'use strict';

  const QUEUE_KEY    = 'scania_sheets_queue_v1';
  const CFG_KEY      = 'scania_sheets_url_v1';
  const DEFAULT_URL  = 'https://script.google.com/macros/s/AKfycbzsdw59lQK78KnXcqRZZbon-JH0ZoJqrGvLfdtVI6RLl7zzBtnxU9AUBsOp56B9Vlgu/exec';

  function getUrl()  { return localStorage.getItem(CFG_KEY) || DEFAULT_URL; }
  function setUrl(u) { localStorage.setItem(CFG_KEY, u.trim()); }

  function loadQueue()  { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
  function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

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

  /* Fetch all submitted evaluations from Sheets (for Results view) */
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
     the data still reaches the sheet. */
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

  /* Try to flush all queued submissions; stops on first error */
  async function flushQueue() {
    const url = getUrl();
    if (!url) return;
    const queue = loadQueue();
    if (!queue.length) return;
    const remaining = [...queue];
    while (remaining.length) {
      try {
        await postSubmission(url, remaining[0]);
        remaining.shift();
        saveQueue(remaining);
      } catch {
        break;
      }
    }
  }

  /* Submit a new evaluation — try immediately, queue on failure */
  async function submit(submission) {
    const url = getUrl();
    if (!url) return { status: 'no-url' };
    try {
      await postSubmission(url, submission);
      return { status: 'sent' };
    } catch {
      const queue = loadQueue();
      queue.push(submission);
      saveQueue(queue);
      return { status: 'queued' };
    }
  }

  /* Retry queue when the tab regains connectivity */
  window.addEventListener('online', () => flushQueue());

  /* Also attempt a flush on load (catches submissions from previous sessions) */
  flushQueue();

  window.STDSheets = { submit, getUrl, setUrl, flushQueue, loadQueue, fetchAll };
})();
