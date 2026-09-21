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
   också kunna blockera riktiga besökares inskick. 20/minut stoppar fortfarande
   en gissningsattack hårt (timmar för att beta av alla 10 000 koder) utan att
   trigga på helt normal användning — en missad knapptryckning, eller några
   personer som råkar testa koden inom samma minut vid ett event. */
const ADMIN_CHECK_MAX = 20;
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
   kalkylark — används för både huvudarket och, om konfigurerat, backupen.

   Körs idempotent: klienten kan inte läsa svaret på sin egen no-cors-POST
   (se sheets.js), så den håller varje inskick som "pending" tills den ser
   det i en senare läsning och skickar annars om det — vilket är rätt
   beteende om det verkligen inte kom fram, men skulle skriva en extra,
   identisk rad om det redan gjort det (t.ex. om läsningen råkade missa
   det inom tidsfönstret den letade). timestamp sätts en gång per inskick
   och skickas med oförändrat vid ett omskick, så den fungerar som ett
   naturligt inskicks-ID — hittas en rad med samma timestamp redan i
   Raw-arket är det med säkerhet samma inskick, inte en ny besökare. */
function writeSubmission(ss, sheetName, headers, row, raw) {
  const rawSheetName = 'Raw — ' + sheetName;

  if (raw && raw.timestamp && rawSheetHasTimestamp(ss, rawSheetName, raw.timestamp)) return;

  /* Convert Timestamp (UTC ISO, e.g. "2026-09-21T09:05:23.456Z") to
     Stockholm local time for display in the readable sheet — done here,
     on the submission's own headers/row pair, rather than by matching
     against the sheet's stored header text further down (which failed
     to actually convert anything last time — worth being defensive about
     that text ever drifting, rather than trusting it matches "Timestamp"
     exactly). raw.timestamp (used for the idempotency check above and
     stored in the Raw sheet) is untouched — this only rewrites `row`. */
  const tsIdx = headers.indexOf('Timestamp');
  if (tsIdx >= 0 && row[tsIdx]) {
    try {
      row = row.slice();
      row[tsIdx] = Utilities.formatDate(new Date(row[tsIdx]), 'Europe/Stockholm', "yyyy-MM-dd HH:mm:ss");
    } catch (err) { /* leave as-is if it doesn't parse as a date */ }
  }

  /* 1. Skriv läsbar rad till rätt ark (Test Drive / Cab Assessment) */
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  let existingHeaders = (lastRow >= 1 && lastCol >= 1)
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    : [];

  /* NOTE: this used to also delete columns not present in `headers`, on
     the assumption that headers always carries the complete current
     question set so anything else must be stale (a renamed/removed
     question). That assumption breaks under concurrent submissions from
     multiple tablets: two Apps Script executions can each read the same
     existingHeaders before either commits, and if anything at all differs
     between two devices' current header text (a config edit not yet
     synced everywhere, or just unlucky timing), each one's "prune what's
     not in MY headers" logic deletes columns the OTHER one just wrote to
     — which is exactly what happened during a multi-tablet test: most
     metric columns ended up empty for many rows, with several columns
     duplicated from being deleted and re-added more than once. Reverted
     to append-only. The dropped values were never actually lost — they're
     intact in the Raw sheet below, which this never touches — only this
     human-readable view lost them. */
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

/* Har en rad med exakt denna timestamp redan skrivits till Raw-arket?
   Läser hela kolumnen — helt tillräckligt snabbt på den skala en
   kiosk-app genererar inskick (dussintals till några hundra per dag). */
function rawSheetHasTimestamp(ss, rawSheetName, timestamp) {
  const rawSheet = ss.getSheetByName(rawSheetName);
  if (!rawSheet || rawSheet.getLastRow() <= 1) return false;
  const rows = rawSheet.getRange(2, 1, rawSheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < rows.length; i++) {
    try {
      const parsed = JSON.parse(rows[i][0]);
      if (parsed && parsed.timestamp === timestamp) return true;
    } catch (err) { /* oläsbar rad — inte en match, hoppa vidare */ }
  }
  return false;
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

    rebuildLegend(json);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, updatedAt }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* Läsbar förteckning kod → fråga, byggd om varje gång configen sparas.
   Test Drive/Cab Assessment-flikarnas kolumnrubriker är numera bara
   frågans permanenta kod ("1", "1a" …, se assignCodes i core.js) för att
   aldrig behöva ändras om en fråga döps om — den koden är därför inte
   självförklarande i sig, den här fliken är var den mänskliga texten
   hör hemma. Körs som ett eget, isolerat steg så att ett fel här aldrig
   får den faktiska konfigurationssparningen ovan att se ut att misslyckas. */
const LEGEND_SHEET_NAME = 'Frågekoder';

function rebuildLegend(json) {
  try {
    const config = JSON.parse(json);
    const rows = [];
    [['Test Drive', config.questions], ['Cab Assessment', config.cabQuestions]].forEach((pair) => {
      const formName = pair[0];
      (pair[1] || []).forEach((cat) => {
        (cat.metrics || []).forEach((m) => {
          rows.push([formName, cat.code || '', cat.title || '', m.code || '', m.label || '']);
        });
      });
    });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(LEGEND_SHEET_NAME) || ss.insertSheet(LEGEND_SHEET_NAME);
    sheet.clearContents();
    const headers = ['Formulär', 'Kategorikod', 'Kategori', 'Kolumnkod', 'Fråga'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#02102c').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  } catch (err) {
    Logger.log('rebuildLegend failed: ' + err.message);
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

/* ---- Engångsreparation: bygg om Test Drive/Cab Assessment-flikarna från
   Raw-arkens JSON ----

   Historiska rader kan sakna eller ha omkastade svar i kolumn H och
   framåt — kvarvarande skada från den nu borttagna kolumn-städningen
   (se NOTE i writeSubmission ovan), som redan är fixad men aldrig
   reparerade rader som redan hunnit skadas innan fixen låg live.
   Raw-arkets JSON har aldrig varit fel, så hela fliken kan byggas om
   från grunden utifrån den, i den kolumnordning dagens frågekonfiguration
   (Config-arket) anger — vilket samtidigt konverterar alla gamla
   UTC-tidsstämplar till svensk tid.

   Körs manuellt en gång: välj funktionen "repairAllReadableSheets" i
   listan högst upp i Apps Script-redigeraren och klicka Kör. Inte
   nåbar via doGet/doPost, med avsikt — en skrivning som raderar och
   bygger om en hel flik ska aldrig kunna triggas utifrån.

   KÄND BEGRÄNSNING: kolumnen "Language" kan inte återskapas — språket
   sparades aldrig i Raw-arkets JSON, bara i den läsbara raden vid
   själva inskicket, så den blir tom för alla rader efter en reparation.
   Svar på frågor som sedan tagits bort ur den aktuella konfigurationen
   visas inte längre här (kolumnerna byggs efter DAGENS frågor) — men
   finns fortfarande kvar orört i Raw-arkets JSON. */
function repairAllReadableSheets() {
  repairReadableSheet('Test Drive');
  repairReadableSheet('Cab Assessment');
}

function repairReadableSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheetName = 'Raw — ' + sheetName;
  const rawSheet = ss.getSheetByName(rawSheetName);
  if (!rawSheet || rawSheet.getLastRow() <= 1) {
    Logger.log('Inget att reparera för ' + sheetName + ' — inget Raw-ark eller inga rader.');
    return;
  }

  const config = readConfig().config || {};
  const categories = (sheetName === 'Cab Assessment') ? (config.cabQuestions || []) : (config.questions || []);

  const baseHeaders = ['Timestamp', 'Group', 'Language', 'Country', 'Form', 'Vehicle', 'Brand'];
  const metricHeaders = [];
  const metricIds = [];
  categories.forEach((cat) => {
    (cat.metrics || []).forEach((m) => {
      metricHeaders.push(m.code || (cat.title + ' — ' + m.label));
      metricIds.push(m.id);
    });
  });
  const headers = baseHeaders.concat(metricHeaders);

  const rawRows = rawSheet.getRange(2, 1, rawSheet.getLastRow() - 1, 1).getValues();
  const outRows = [];
  rawRows.forEach((r) => {
    let entry;
    try { entry = JSON.parse(r[0]); } catch (err) { entry = null; }
    if (!entry) return;

    let ts = entry.timestamp || '';
    if (ts) {
      try { ts = Utilities.formatDate(new Date(ts), 'Europe/Stockholm', "yyyy-MM-dd HH:mm:ss"); } catch (err) { /* behåll som den är */ }
    }

    const row = [
      ts,
      entry.group || '',
      '', // språket sparades aldrig i Raw — kan inte återskapas
      entry.country || '',
      entry.formId || '',
      entry.vehicleName || '',
      entry.vehicleBrand || '',
    ];
    metricIds.forEach((id) => {
      const val = entry.answers ? entry.answers[id] : undefined;
      row.push(val != null ? val : '');
    });
    outRows.push(row);
  });

  const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clearContents();

  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#02102c').setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  if (outRows.length) {
    sheet.getRange(2, 1, outRows.length, headers.length).setValues(outRows);
  }

  Logger.log('Reparerade ' + sheetName + ': ' + outRows.length + ' rader, ' + headers.length + ' kolumner.');
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

  /* Health-check — öppna URL:en i webbläsaren för att verifiera.
     "codeVersion" är bara en synlig markör för att kunna bekräfta utifrån
     (utan att behöva skicka in ett testsvar) att en ny distribution
     verkligen är den som faktiskt svarar — höj den varje gång koden
     ändras igen, om det behövs för felsökning. */
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'Scania Test Drive — Sheets sync', codeVersion: 'q-codes-1' }))
    .setMimeType(ContentService.MimeType.JSON);
}
