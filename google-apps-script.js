/**
 * SCANIA TEST DRIVE — Google Apps Script
 *
 * 1. Öppna Google Sheets och skapa ett nytt ark.
 * 2. Klicka på Tillägg → Apps Script.
 * 3. Ersätt allt med den här koden och klicka Spara.
 * 4. Klicka Distribuera → Ny distribution → Webbapp.
 *    - Kör som: Mig
 *    - Vem har åtkomst: Alla
 * 5. Kopiera webbadressen och klistra in den i
 *    Admin → Edit questions → Google Sheets sync.
 *
 * OBS: när du uppdaterar koden måste du göra en ny distribution
 * (Distribuera → Hantera distributioner → redigera → ny version).
 */

/* ---- doPost: ta emot en inskickad utvärdering ---- */
function doPost(e) {
  try {
    const data    = JSON.parse(e.parameter.data);
    const headers = data.headers   || [];
    const row     = data.row       || [];
    const raw     = data.raw       || null;
    const sheetName = data.sheetName || 'Test Drive';
    const rawSheetName = 'Raw — ' + sheetName;

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    /* 1. Skriv läsbar rad till rätt ark (Test Drive / Cab Assessment) */
    let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

    const lastCol = sheet.getLastColumn();
    const lastRow = sheet.getLastRow();
    let existingHeaders = (lastRow >= 1 && lastCol >= 1)
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      : [];

    headers.forEach((h) => {
      if (!existingHeaders.includes(h)) {
        existingHeaders.push(h);
        const col = existingHeaders.length;
        const cell = sheet.getRange(1, col);
        cell.setValue(h).setFontWeight('bold').setBackground('#02102c').setFontColor('#ffffff');
      }
    });
    sheet.setFrozenRows(1);

    const dataRow = existingHeaders.map((h) => {
      const idx = headers.indexOf(h);
      return idx >= 0 ? row[idx] : '';
    });
    sheet.appendRow(dataRow);

    /* 2. Spara rådata som JSON i separat Raw-ark per formulär */
    if (raw) {
      let rawSheet = ss.getSheetByName(rawSheetName);
      if (!rawSheet) {
        rawSheet = ss.insertSheet(rawSheetName);
        rawSheet.getRange(1, 1).setValue('JSON').setFontWeight('bold');
        rawSheet.setFrozenRows(1);
      }
      rawSheet.appendRow([JSON.stringify(raw)]);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ---- doGet: returnera all rådata till admin-sidan ---- */
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  if (action === 'data') {
    try {
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const evals = [];

      /* Läs från båda Raw-arken */
      ['Raw — Test Drive', 'Raw — Cab Assessment'].forEach(function(name) {
        const rawSheet = ss.getSheetByName(name);
        if (!rawSheet || rawSheet.getLastRow() <= 1) return;
        const rows = rawSheet.getRange(2, 1, rawSheet.getLastRow() - 1, 1).getValues();
        rows.forEach(function(r) {
          try { if (r[0]) evals.push(JSON.parse(r[0])); } catch {}
        });
      });

      /* Bakåtkompatibilitet: läs gamla "Raw"-arket om det finns */
      const legacyRaw = ss.getSheetByName('Raw');
      if (legacyRaw && legacyRaw.getLastRow() > 1) {
        const rows = legacyRaw.getRange(2, 1, legacyRaw.getLastRow() - 1, 1).getValues();
        rows.forEach(function(r) {
          try { if (r[0]) evals.push(JSON.parse(r[0])); } catch {}
        });
      }

      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, evaluations: evals }))
        .setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  /* Health-check — öppna URL:en i webbläsaren för att verifiera */
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'Scania Test Drive — Sheets sync' }))
    .setMimeType(ContentService.MimeType.JSON);
}
