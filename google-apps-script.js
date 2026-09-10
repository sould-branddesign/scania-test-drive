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
 *
 * BACKUP: varje inskickat svar speglas även till ett andra kalkylark om
 * BACKUP_SHEET_ID nedan är ifyllt — klistra in ID:t från backup-arkets
 * webbadress (…/spreadsheets/d/DEN HÄR DELEN/edit). Kontot som kör
 * distributionen ("Kör som: Mig") måste ha redigeringsåtkomst till det
 * arket. Lämna tomt för att inte spegla alls. Detta gäller bara faktiska
 * inskickade svar — inte frågekonfigurationen (saveConfig). Om spegling
 * misslyckas (t.ex. fel ID, indraget delning) påverkas inte det vanliga
 * inskicket — appen ser fortfarande ett lyckat resultat.
 */
const BACKUP_SHEET_ID = ''; // t.ex. '1AbC-defGHijklmnoPQRstuVWxyz0123456789abcdefg'

/* ---- doPost: ta emot en inskickad utvärdering, eller en delad frågekonfiguration ---- */
function doPost(e) {
  if (e.parameter.config) return saveConfig(e.parameter.config);

  try {
    const data    = JSON.parse(e.parameter.data);
    const headers = data.headers   || [];
    const row     = data.row       || [];
    const raw     = data.raw       || null;
    const sheetName = data.sheetName || 'Test Drive';

    writeSubmission(SpreadsheetApp.getActiveSpreadsheet(), sheetName, headers, row, raw);

    if (BACKUP_SHEET_ID) {
      try {
        writeSubmission(SpreadsheetApp.openById(BACKUP_SHEET_ID), sheetName, headers, row, raw);
      } catch (backupErr) {
        Logger.log('Backup write failed: ' + backupErr.message);
      }
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

/* Skriv en inskickad utvärdering (läsbar rad + rådata-JSON) till ett givet
   kalkylark — används för både huvudarket och, om konfigurerat, backupen. */
function writeSubmission(ss, sheetName, headers, row, raw) {
  const rawSheetName = 'Raw — ' + sheetName;

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
}

/* ---- delad frågekonfiguration (frågor, fordon, översättningar, ikoner) ----
   Lagras i ett eget "Config"-ark så alla enheter som kör appen kan
   läsa samma version, istället för att var och en bara har sin egen
   lokala kopia i localStorage. Frågornas körbane-ikoner kan nu vara
   inbäddade bilder (data-URI), så JSON-strängen kan bli större än en
   enda cell tillåter (~50 000 tecken) — delas därför upp i bitar över
   flera celler i kolumn B och sätts ihop igen vid läsning. ---- */
const CONFIG_SHEET_NAME = 'Config';
const CONFIG_CHUNK_SIZE = 45000; // säkert under Sheets ~50 000 tecken/cell

function saveConfig(json) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG_SHEET_NAME) || ss.insertSheet(CONFIG_SHEET_NAME);
    const updatedAt = new Date().toISOString();

    const chunks = [];
    for (let i = 0; i < json.length; i += CONFIG_CHUNK_SIZE) chunks.push(json.slice(i, i + CONFIG_CHUNK_SIZE));
    if (!chunks.length) chunks.push('');

    /* rensa bort ev. fler bitar än vi behöver denna gång */
    const lastRow = sheet.getLastRow();
    if (lastRow > 2) sheet.getRange(3, 1, lastRow - 2, 2).clearContent();

    sheet.getRange(1, 1, 2, 2).setValues([
      ['updatedAt', updatedAt],
      ['chunks', chunks.length],
    ]);
    sheet.getRange(3, 1, chunks.length, 2).setValues(chunks.map((c, i) => ['json' + i, c]));

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, updatedAt }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function readConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) return { updatedAt: null, config: null };
  const updatedAt = sheet.getRange(1, 2).getValue();
  const chunkCount = Number(sheet.getRange(2, 2).getValue()) || 0;
  let json = '';
  if (chunkCount > 0) {
    const rows = sheet.getRange(3, 2, chunkCount, 1).getValues();
    json = rows.map((r) => String(r[0])).join('');
  }
  let config = null;
  try { config = json ? JSON.parse(json) : null; } catch (e) { config = null; }
  return { updatedAt: updatedAt ? String(updatedAt) : null, config };
}

/* ---- doGet: returnera all rådata (och den delade konfigurationen) till admin-sidan/enheterna ---- */
function doGet(e) {
  const action = e && e.parameter && e.parameter.action;

  if (action === 'config') {
    try {
      const result = readConfig();
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, updatedAt: result.updatedAt, config: result.config }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

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
