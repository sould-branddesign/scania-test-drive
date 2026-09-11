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
 *
 * ÅTKOMST: två separata hemligheter, ingen av dem hemlig i egentlig
 * mening (allt som skickas från en webbläsare går att läsa av), men båda
 * höjer ribban rejält jämfört med en helt öppen webhook:
 *   - WEBHOOK_KEY måste följa med varje skrivande anrop (både inskickade
 *     svar och frågekonfiguration). Ligger inbäddad i appens egen källkod
 *     (sheets.js) — stoppar någon som bara har eller gissar sig till
 *     webhook-adressen och försöker skicka data direkt dit, förbi appen.
 *   - ADMIN_PASSWORD är den kod som låser hela admin.html (adminpanelen
 *     visar ingenting förrän rätt kod skrivits in) och krävs därutöver för
 *     att spara frågekonfiguration. Skrivs in av personal, ligger ALDRIG i
 *     någon fil i repot — byt det direkt nedan innan första distributionen,
 *     och dela det bara muntligt/i en lösenordshanterare. En kort, fyrsiffrig
 *     kod är bekväm att skriva in på en platta men har bara 10 000 möjliga
 *     kombinationer — ADMIN_CHECK_MAX nedan begränsar därför separat och
 *     strängt hur många gissningsförsök som accepteras per minut.
 * Ändra båda värdena nedan och gör en ny distribution för att byta dem.
 */
const WEBHOOK_KEY = '89a632a3709ca303a0e36357db893769a525ed04';
const ADMIN_PASSWORD = '1891';

const BACKUP_SHEET_ID = '1nT1nk6i64WLbdtWQ5tBOoysdj3pAHGQJ4uix6V8W7y0';

const RATE_LIMIT_MAX = 60;          // max accepterade skrivningar per rullande fönster
const RATE_LIMIT_WINDOW_SEC = 60;

/* ADMIN_PASSWORD är en kort, fyrsiffrig kod — bekvämt att skriva in på en
   platta, men bara 10 000 möjliga kombinationer, alldeles för få för att stå
   emot ett skript som gissar snabbt. Den här strängare, separata gränsen
   gäller bara försök att just gissa koden (både doGet?action=checkAdmin och
   ett doPost-anrop med fel adminKey), oberoende av den vanliga
   skrivbegränsningen ovan — annars skulle någon som spammar gissningar
   också kunna blockera riktiga besökares inskick. */
const ADMIN_CHECK_MAX = 5;
const ADMIN_CHECK_WINDOW_SEC = 60;

function unauthorized(reason) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: reason }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Enkel hastighetsbegränsning via Apps Scripts inbyggda cache — räknar
   skrivande anrop i rullande minutfönster, delat över alla enheter. Skyddar
   mot ett skript som spammar in falska svar snabbt, inte mot enstaka
   missbruk (det stoppar WEBHOOK_KEY/ADMIN_PASSWORD ovan). */
function checkRateLimit() {
  return checkBucket('reqcount_', RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_SEC);
}

function checkAdminRateLimit() {
  return checkBucket('admincheck_', ADMIN_CHECK_MAX, ADMIN_CHECK_WINDOW_SEC);
}

function checkBucket(prefix, max, windowSec) {
  const cache = CacheService.getScriptCache();
  const bucket = prefix + Math.floor(Date.now() / (windowSec * 1000));
  const current = Number(cache.get(bucket)) || 0;
  if (current >= max) return false;
  cache.put(bucket, String(current + 1), windowSec + 5);
  return true;
}

/* ---- doPost: ta emot en inskickad utvärdering, eller en delad frågekonfiguration ---- */
function doPost(e) {
  if (!e || !e.parameter || e.parameter.key !== WEBHOOK_KEY) return unauthorized('unauthorized');
  if (!checkRateLimit()) return unauthorized('rate-limited');

  if (e.parameter.config) {
    if (!checkAdminRateLimit()) return unauthorized('rate-limited');
    if (e.parameter.adminKey !== ADMIN_PASSWORD) return unauthorized('unauthorized-admin');
    return saveConfig(e.parameter.config);
  }

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

  /* Lets the admin panel verify a password immediately (a real GET
     round-trip, not the blind no-cors POSTs used for writes) before
     attempting to save — rate-limited so it can't be used to brute-force
     ADMIN_PASSWORD by guessing. */
  if (action === 'checkAdmin') {
    if (!checkAdminRateLimit()) return unauthorized('rate-limited');
    const ok = !!(e && e.parameter && e.parameter.key === ADMIN_PASSWORD);
    return ContentService
      .createTextOutput(JSON.stringify({ ok }))
      .setMimeType(ContentService.MimeType.JSON);
  }

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
