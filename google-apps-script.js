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
 * DAGLIG KONTROLL: en tyst, automatisk kontroll av precis de tre sakerna
 * som gått fel förut — ett svar registrerat två gånger, dubbla
 * kolumnrubriker, eller backup-arket som halkat efter — mejlas till
 * ALERT_EMAIL nedan bara om den faktiskt hittar något (en ren dag ger
 * inget mejl alls). Kräver EN engångskörning för att sätta igång:
 * 6. Välj "setupDailyHealthCheckTrigger" i funktionslistan högst upp i
 *    Apps Script-redigeraren och klicka Kör. Google ber om ett nytt
 *    behörighetsgodkännande (för att få skicka e-post) — godkänn det.
 *    Behöver bara göras en gång, inte om igen vid varje ny distribution.
 * 7. LÄGESMEJL varje morgon kl 08:00 om gårdagen (inskick, fordon, tider
 *    och om allt fungerar): välj "previewDailySummary" och klicka Kör för
 *    ett testmejl, och därefter "setupDailySummaryTrigger" en gång för att
 *    slå på det. Eventdagarna (2–27 november 2026, vardagar) står redan i
 *    SUMMARY_EVENT_DAYS längre ner, så en helt tyst eventdag ger en varning.
 * 8. SÄKERHETSKOPIOR AV FRÅGORNA sparas automatiskt (dolda ark "Config-backup …")
 *    varje gång någon sparar i admin — inget att slå på. Backa: kör
 *    listConfigBackups, sedan restoreConfigBackup (se kommentaren vid dem).
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

/* Vart den dagliga kontrollen (längst ner i filen) mejlar om den hittar
   något fel. Byt genom att ändra här och göra en ny distribution — kräver
   INTE att setupDailyHealthCheckTrigger körs om. */
const ALERT_EMAIL = 'kajsa@sould.se';

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
   Raw-arket är det med säkerhet samma inskick, inte en ny besökare.

   Låst med LockService: flera tablets (eller klientens egna omförsök av
   samma inskick, se sheets.js) kan trigga doPost nästan samtidigt, och
   Apps Script garanterar inte att sådana körningar seriellas åt sig
   själva. Utan lås kan två körningar läsa samma rubrikrad innan någon av
   dem hunnit skriva, lägga till sina egna nya kolumner var för sig och
   sedan skriva varsin rad utifrån sin egen, redan inaktuella uppfattning
   om kolumnordningen — samma sorts krock som den borttagna
   kolumn-städningen orsakade, fast den här gången i själva
   kolumn-tilläggs-steget istället. Låset gör att bara en körning i taget
   får läsa+skriva rubrikraden och lägga till en rad, så nästa körning
   alltid ser resultatet av den föregående. */
function writeSubmission(ss, sheetName, headers, row, raw) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    writeSubmissionLocked(ss, sheetName, headers, row, raw);
  } finally {
    lock.releaseLock();
  }
}

function writeSubmissionLocked(ss, sheetName, headers, row, raw) {
  const rawSheetName = 'Raw — ' + sheetName;

  /* Fast, cache-backed duplicate check, ahead of the Raw-sheet scan below.
     A kiosk tablet on a slow connection can leave sheets.js's own POST
     hanging past its 20s "give Sheets time to catch up" grace window —
     the client then resubmits via reconcile() while the first POST is
     still in flight, so two executions can legitimately both reach this
     lock-protected function for the SAME submission, one right after the
     other. The lock already makes them run one-at-a-time — the actual gap
     this closes is that SpreadsheetApp reads aren't guaranteed to reflect
     another execution's just-committed write immediately (Sheets' own
     propagation, independent of the script lock), so the second
     execution's scan of the Raw sheet could still miss a row the first
     one finished writing moments earlier. CacheService is Google's
     purpose-built layer for exactly this — sharing short-lived state
     across script executions with much tighter read-after-write latency
     than the Spreadsheet itself — so it catches the race the sheet scan
     sometimes doesn't. Kept as a fast-path alongside the scan, not a
     replacement: the cache entry expires after 6h (its own maximum) and a
     fresh container has none yet, so the Raw sheet remains the durable,
     authoritative record either way.

     Keyed by spreadsheet ID as well as sheet name + timestamp — this
     function runs once for the main spreadsheet and once for the backup
     one (see doPost), and without ss.getId() in the key, the main
     write's cache entry made the backup write's check think it had
     already run and skip it entirely, silently breaking the mirror. */
  const cache = CacheService.getScriptCache();
  const cacheKey = 'dedupe:' + ss.getId() + ':' + sheetName + ':' + (raw && raw.timestamp);
  if (raw && raw.timestamp && cache.get(cacheKey)) return;

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

  /* 1. Spara rådata som JSON i separat Raw-ark per formulär — written
     FIRST, before the readable sheet below. These are two separate,
     non-atomic appendRow calls; if execution is interrupted between them
     (an Apps Script timeout, a transient Sheets error), whichever one
     happened second never runs. The idempotency check above only looks
     at the Raw sheet, so Raw has to be the one that lands first: that
     way an interrupted run leaves a Raw row with no readable row (a gap
     repairAllReadableSheets can fill in later), and a retry correctly
     sees the Raw row and skips — instead of the readable sheet silently
     getting a duplicate while Raw stayed at one row, which is what the
     old write-readable-then-raw order let happen (exactly how the
     Test Drive sheet ended up with the same submission twice). */
  if (raw) {
    let rawSheet = ss.getSheetByName(rawSheetName);
    if (!rawSheet) rawSheet = ss.insertSheet(rawSheetName);
    /* Checking "does the sheet have a header row" (lastRow === 0) rather
       than "did we just create the sheet" — if someone manually clears
       every row (including the header) while leaving the tab itself in
       place, the old !rawSheet check alone never re-added the header, so
       the next submission's JSON landed in row 1 — exactly where
       action=data's reader (which always starts at row 2, skipping what
       it assumes is the header) would never look. Not a lost submission,
       just an invisible one. */
    if (rawSheet.getLastRow() === 0) {
      rawSheet.getRange(1, 1).setValue('JSON').setFontWeight('bold');
      rawSheet.setFrozenRows(1);
    }
    rawSheet.appendRow([JSON.stringify(raw)]);
  }

  /* 2. Skriv läsbar rad till rätt ark (Test Drive / Cab Assessment) */
  let sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  const lastCol = sheet.getLastColumn();
  const lastRow = sheet.getLastRow();
  /* .map(String) matters: a bare-number code like "6" (a single-metric
     category's code has no letter suffix — see assignCodes in core.js)
     gets auto-parsed into the actual number 6 by Sheets' default cell
     formatting once written below, even though it was set as the string
     "6". Left uncoerced, existingHeaders.includes(h) then compares that
     number against the always-string codes in `headers`, never matches,
     and appends a fresh duplicate "6" column on every subsequent
     submission — which is exactly the column duplication seen in
     production for every single-digit-coded category. */
  let existingHeaders = (lastRow >= 1 && lastCol >= 1)
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String)
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
     intact in the Raw sheet (written earlier above), which this never touches — only this
     human-readable view lost them. */
  headers.forEach((h) => {
    if (!existingHeaders.includes(h)) {
      existingHeaders.push(h);
      const col = existingHeaders.length;
      const cell = sheet.getRange(1, col);
      /* Plain-text format BEFORE setValue — otherwise a bare-number code
         like "6" gets auto-parsed into the number 6 by Sheets' default
         formatting, which is the root cause of the duplicate-column bug
         the .map(String) above now also guards against on the read side. */
      cell.setNumberFormat('@').setValue(h).setFontWeight('bold').setBackground('#02102c').setFontColor('#ffffff');
    }
  });
  sheet.setFrozenRows(1);

  const dataRow = existingHeaders.map((h) => {
    const idx = headers.indexOf(h);
    return idx >= 0 ? row[idx] : '';
  });
  sheet.appendRow(dataRow);

  /* Mark this submission as handled for the fast-path check above —
     6 hours (CacheService's own ceiling) is far longer than any resubmit
     delay sheets.js would realistically produce, and the Raw-sheet scan
     still backstops it once the cache entry eventually expires. */
  if (raw && raw.timestamp) cache.put(cacheKey, '1', 21600);
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

    /* Spara en kopia av den GAMLA konfigurationen innan den skrivs över, så
       att en felaktig sparning går att backa. Får aldrig stoppa själva
       sparningen — därför eget try/catch. */
    try { snapshotConfig(ss, sheet); } catch (err) { Logger.log('snapshotConfig failed: ' + err.message); }

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

/* ---- Säkerhetskopior av frågekonfigurationen ----
   Varje gång configen sparas från admin sparas först en kopia av den
   FÖRRA versionen som ett dolt ark "Config-backup <datum> <tid>". Den
   senaste CONFIG_BACKUPS_KEEP kopiorna behålls, äldre tas bort. En kopia
   som är identisk med den senaste hoppas över. Så går det att backa om
   någon sparar fel frågor — även inom samma dag.

   Backa: kör listConfigBackups (visar namnen i körningsloggen), och därefter
   restoreConfigBackup. Den återställer den NYASTE kopian — alltså läget före
   den senaste sparningen — eller den du skriver in i RESTORE_CONFIG_BACKUP_NAME
   (exakt arknamn, t.ex. 'Config-backup 2026-11-03 101500'). Själva
   återställningen sparar också en kopia av läget just före, så den går att
   ångra. Plattorna plockar upp den återställda versionen inom ungefär en
   minut. De dolda arken syns under Visa → Dolda ark. */
const CONFIG_BACKUP_PREFIX = 'Config-backup ';
const CONFIG_BACKUPS_KEEP = 20;
const RESTORE_CONFIG_BACKUP_NAME = '';

function readConfigJsonFromSheet(sheet) {
  const chunkCount = Number(sheet.getRange(2, 2).getValue()) || 0;
  if (chunkCount <= 0) return '';
  return sheet.getRange(3, 2, chunkCount, 1).getValues().map((r) => String(r[0])).join('');
}

function listConfigBackupSheets(ss) {
  return ss.getSheets().filter((s) => s.getName().indexOf(CONFIG_BACKUP_PREFIX) === 0)
    .sort((a, b) => (a.getName() < b.getName() ? -1 : 1));          // äldst först
}

function snapshotConfig(ss, configSheet) {
  if (!configSheet || configSheet.getLastRow() < 3) return;         // inget att spara än
  const json = readConfigJsonFromSheet(configSheet);
  if (!json) return;
  const backups = listConfigBackupSheets(ss);
  if (backups.length && readConfigJsonFromSheet(backups[backups.length - 1]) === json) return;   // oförändrad

  const stamp = Utilities.formatDate(new Date(), 'Europe/Stockholm', 'yyyy-MM-dd HHmmss');
  const copy = configSheet.copyTo(ss);
  copy.setName(CONFIG_BACKUP_PREFIX + stamp);
  copy.hideSheet();
  const all = listConfigBackupSheets(ss);
  for (let i = 0; i < all.length - CONFIG_BACKUPS_KEEP; i++) ss.deleteSheet(all[i]);
}

function listConfigBackups() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const list = listConfigBackupSheets(ss);
  if (!list.length) { Logger.log('Inga säkerhetskopior av konfigurationen än.'); return; }
  list.slice().reverse().forEach((s, i) => {
    Logger.log((i === 0 ? '(nyaste) ' : '') + s.getName() + ' — config sparad ' + s.getRange(1, 2).getValue());
  });
}

function restoreConfigBackup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const list = listConfigBackupSheets(ss);
  if (!list.length) { Logger.log('Det finns inga säkerhetskopior att återställa.'); return; }
  const target = RESTORE_CONFIG_BACKUP_NAME
    ? list.filter((s) => s.getName() === RESTORE_CONFIG_BACKUP_NAME)[0]
    : list[list.length - 1];
  if (!target) { Logger.log('Hittar ingen kopia som heter "' + RESTORE_CONFIG_BACKUP_NAME + '". Kör listConfigBackups för namnen.'); return; }
  const json = readConfigJsonFromSheet(target);
  if (!json) { Logger.log('Kopian "' + target.getName() + '" är tom — avbryter.'); return; }
  try { JSON.parse(json); } catch (err) { Logger.log('Kopian "' + target.getName() + '" innehåller ingen giltig konfiguration — avbryter.'); return; }
  const result = saveConfig(json);          // sparar först en kopia av nuvarande läge, skriver sedan den valda
  Logger.log('Återställde konfigurationen från "' + target.getName() + '". ' + result.getContent());
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

   KÄND BEGRÄNSNING: kolumnen "Language" återskapas bara för rader som
   skickats in efter att språket började sparas i Raw-arkets JSON (5 okt
   2026). Äldre rader har inget språk i Raw och blir tomma efter en
   reparation.
   Svar på frågor som sedan tagits bort ur den aktuella konfigurationen
   visas inte längre här (kolumnerna byggs efter DAGENS frågor) — men
   finns fortfarande kvar orört i Raw-arkets JSON. */
function repairAllReadableSheets() {
  repairReadableSheet('Test Drive');
  repairReadableSheet('Cab Assessment');
}

/* Samma ombyggnad för BACKUP-arket (BACKUP_SHEET_ID). Behövs efter att
   frågornas kolumnkoder numrerats om i admin (knappen "Renumber Sheets
   columns"): både huvudarket och backupen ska då byggas om från sina
   Raw-ark, så rubrikerna stämmer med den nya ordningen. Konfigurationen
   (kolumnkoderna) läses fortfarande från huvudarkets Config-ark.
   Körs manuellt, precis som repairAllReadableSheets — inte nåbar utifrån. */
function repairBackupReadableSheets() {
  if (!BACKUP_SHEET_ID) {
    Logger.log('Inget BACKUP_SHEET_ID konfigurerat — inget att reparera.');
    return;
  }
  let backupSs;
  try {
    backupSs = SpreadsheetApp.openById(BACKUP_SHEET_ID);
  } catch (err) {
    Logger.log('Kan inte öppna backup-arket: ' + err.message);
    return;
  }
  repairReadableSheet('Test Drive', backupSs);
  repairReadableSheet('Cab Assessment', backupSs);
}

function repairReadableSheet(sheetName, targetSs) {
  const ss = targetSs || SpreadsheetApp.getActiveSpreadsheet();
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
      entry.lang || '', // saknas på rader skickade före den 5 okt 2026 (språket lades då till i Raw)
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

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  /* Plain-text format BEFORE setValues — same reason as in
     writeSubmissionLocked: a bare-number code like "6" would otherwise be
     auto-parsed into the number 6 by Sheets' default formatting, which is
     the root cause this whole repair is cleaning up after. */
  headerRange.setNumberFormat('@').setValues([headers])
    .setFontWeight('bold').setBackground('#02102c').setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  if (outRows.length) {
    sheet.getRange(2, 1, outRows.length, headers.length).setValues(outRows);
  }

  Logger.log('Reparerade ' + sheetName + ': ' + outRows.length + ' rader, ' + headers.length + ' kolumner.');
}

/* ---- Engångsreparation: fyll i luckor i backup-arket ----

   Används om sendHealthCheckEmail (se nedan) rapporterar att backupen
   halkat efter huvudarket — letar upp varje svar som finns i huvudarkets
   Raw-ark men saknas i backupens, och skriver in dem i backupen (både
   Raw-arket och den läsbara fliken) genom att återanvända samma
   writeSubmission-funktion som ett vanligt inskick går igenom, så
   kolumnhantering, låsning och tidszons-konvertering blir exakt likadan.

   Rör aldrig huvudarket, bara backupen — säker att köra när som helst,
   även medan nya svar fortsätter komma in, eftersom den bara LÄGGER TILL
   rader den inte redan hittar i backupens Raw-ark (matchat på timestamp).

   KÄND BEGRÄNSNING: samma som repairReadableSheet ovan — kolumnen
   "Language" finns bara för rader skickade efter 5 okt 2026.

   Körs manuellt: välj "backfillBackup" i funktionslistan högst upp i
   Apps Script-redigeraren och klicka Kör. Inte nåbar via doGet/doPost,
   med avsikt — samma anledning som repairAllReadableSheets. */
function backfillBackup() {
  if (!BACKUP_SHEET_ID) {
    Logger.log('Inget BACKUP_SHEET_ID konfigurerat — inget att fylla i.');
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let backupSs;
  try {
    backupSs = SpreadsheetApp.openById(BACKUP_SHEET_ID);
  } catch (err) {
    Logger.log('Kan inte öppna backup-arket: ' + err.message);
    return;
  }
  backfillSheetIntoBackup(ss, backupSs, 'Test Drive');
  backfillSheetIntoBackup(ss, backupSs, 'Cab Assessment');
}

function backfillSheetIntoBackup(ss, backupSs, sheetName) {
  const rawSheetName = 'Raw — ' + sheetName;
  const rawSheet = ss.getSheetByName(rawSheetName);
  if (!rawSheet || rawSheet.getLastRow() <= 1) {
    Logger.log('Inget att fylla i för ' + sheetName + ' — inget Raw-ark eller inga rader i huvudarket.');
    return;
  }

  const backupTimestamps = {};
  getRawTimestamps(backupSs, sheetName).forEach((ts) => { backupTimestamps[ts] = true; });

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
  let filled = 0;
  rawRows.forEach((r) => {
    let entry;
    try { entry = JSON.parse(r[0]); } catch (err) { return; }
    if (!entry || !entry.timestamp || backupTimestamps[entry.timestamp]) return;

    const row = [
      entry.timestamp,
      entry.group || '',
      entry.lang || '', // saknas på rader skickade före den 5 okt 2026 (språket lades då till i Raw)
      entry.country || '',
      entry.formId || '',
      entry.vehicleName || '',
      entry.vehicleBrand || '',
    ];
    metricIds.forEach((id) => {
      const val = entry.answers ? entry.answers[id] : undefined;
      row.push(val != null ? val : '');
    });

    /* writeSubmissionLocked's fast-path dedupe cache (see there) can still
       hold a "already written" entry for this exact timestamp from the
       ORIGINAL submission that mirrored successfully the first time —
       harmless days later once it's long expired, but a manual test that
       deletes a backup row minutes after submitting it will still hit the
       live cache entry, which makes the write below silently no-op even
       though we've just confirmed (via backupTimestamps above) that the
       row is genuinely gone. Clear it first — we already know this entry
       is missing, so there's nothing for the cache to protect against here. */
    CacheService.getScriptCache().remove('dedupe:' + backupSs.getId() + ':' + sheetName + ':' + entry.timestamp);

    writeSubmission(backupSs, sheetName, headers, row, entry);
    filled++;
  });

  Logger.log('Fyllde i ' + filled + ' saknade rader i backupen för ' + sheetName + '.');
}

/* ---- Engångs: arkivera och töm testdata inför det riktiga eventet ----

   Kopierar först varje resultatflik till en egen "Arkiv <datum> <tid> …"-flik
   och tömmer sedan originalet på alla rader utom rubrikraden — i BÅDE
   huvudarket och backup-arket. Det som arkiveras är de fyra flikarna
   Test Drive, Cab Assessment, Raw — Test Drive och Raw — Cab Assessment.
   Config-arket (frågorna) och Frågekoder rörs inte. En arkivflik skapas
   alltid först och kontrolleras (samma antal rader, samma första och sista
   rad) innan originalet töms — blir kopian inte identisk töms inget, och
   inget raderas någonsin, så det går alltid att klistra tillbaka.
   Arkivflikarna läses inte av appen (den letar efter exakta flik-namn),
   så de påverkar varken resultatvyn eller daglig kontroll.

   OBS innan du kör: se till att ingen platta visar "unsent"-märket på
   startskärmen. En platta som fortfarande väntar på att få skicka ett
   gammalt inskick skickar det igen så fort fliken är tom.

   Körs manuellt: välj "countTestData" först för att bara se vad som finns
   (ändrar ingenting, resultatet står under Körningslogg), därefter
   "archiveAndClearTestData". Inte nåbar via doGet/doPost, med avsikt —
   samma anledning som repairAllReadableSheets. */
const RESULT_SHEET_NAMES = ['Test Drive', 'Cab Assessment', 'Raw — Test Drive', 'Raw — Cab Assessment'];

function countTestData() {
  const targets = [['huvudarket', SpreadsheetApp.getActiveSpreadsheet()]];
  if (BACKUP_SHEET_ID) {
    try { targets.push(['backup-arket', SpreadsheetApp.openById(BACKUP_SHEET_ID)]); }
    catch (err) { Logger.log('Kan inte öppna backup-arket: ' + err.message); }
  }
  targets.forEach((t) => {
    RESULT_SHEET_NAMES.forEach((name) => {
      const sheet = t[1].getSheetByName(name);
      Logger.log(t[0] + ' · ' + name + ': ' + (sheet ? Math.max(sheet.getLastRow() - 1, 0) + ' rader' : 'finns inte'));
    });
  });
}

function archiveAndClearTestData() {
  const stamp = Utilities.formatDate(new Date(), 'Europe/Stockholm', 'yyyy-MM-dd HHmm');
  archiveAndClearIn(SpreadsheetApp.getActiveSpreadsheet(), 'huvudarket', stamp);
  if (!BACKUP_SHEET_ID) return;
  try {
    archiveAndClearIn(SpreadsheetApp.openById(BACKUP_SHEET_ID), 'backup-arket', stamp);
  } catch (err) {
    Logger.log('Kan inte öppna backup-arket: ' + err.message);
  }
}

function archiveAndClearIn(ss, label, stamp) {
  RESULT_SHEET_NAMES.forEach((name) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) { Logger.log(label + ' · ' + name + ': finns inte — hoppar över.'); return; }
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= 1) { Logger.log(label + ' · ' + name + ': redan tom.'); return; }

    const archive = sheet.copyTo(ss);
    let archiveName = 'Arkiv ' + stamp + ' ' + name;
    for (let n = 2; ss.getSheetByName(archiveName); n++) archiveName = 'Arkiv ' + stamp + ' ' + name + ' (' + n + ')';
    archive.setName(archiveName);
    archive.setTabColor('#888888');

    const same = archive.getLastRow() === lastRow
      && archive.getLastColumn() === lastCol
      && JSON.stringify(archive.getRange(2, 1, 1, lastCol).getValues()) === JSON.stringify(sheet.getRange(2, 1, 1, lastCol).getValues())
      && JSON.stringify(archive.getRange(lastRow, 1, 1, lastCol).getValues()) === JSON.stringify(sheet.getRange(lastRow, 1, 1, lastCol).getValues());
    if (!same) {
      Logger.log(label + ' · ' + name + ': arkivkopian blev inte identisk — INGET tömdes. Kontrollera fliken "' + archiveName + '".');
      return;
    }
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    Logger.log(label + ' · ' + name + ': ' + (lastRow - 1) + ' rader arkiverade i "' + archiveName + '" och tömda.');
  });
}

/* ---- Engångsstädning: ta bort exakta dubbletter ur ett Raw-ark ----

   Tar bort rader med EXAKT samma timestamp (millisekund-precision — en
   Cab Assessment-session med flera fordon ger flera rader inom samma
   SEKUND, men var och en har sin egen, millisekund-förskjutna timestamp,
   se submitAllEvaluations i cab.js, så de räknas aldrig som dubbletter
   här). Behåller den FÖRSTA kopian av varje timestamp, tar bort resten.
   Bygger sedan om den läsbara fliken automatiskt (samma som
   repairReadableSheet) så den stämmer med det städade Raw-arket.

   Rör bara huvudarket, precis som repairAllReadableSheets — kör
   backfillBackup separat efteråt om en dubblett redan hunnit spegla sig
   till backupen innan du städar här.

   Körs manuellt: välj "deduplicateAllRawSheets" i funktionslistan högst
   upp i Apps Script-redigeraren och klicka Kör. Inte nåbar via
   doGet/doPost, med avsikt — samma anledning som repairAllReadableSheets. */
function deduplicateAllRawSheets() {
  deduplicateRawSheet('Test Drive');
  deduplicateRawSheet('Cab Assessment');
}

function deduplicateRawSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheetName = 'Raw — ' + sheetName;
  const rawSheet = ss.getSheetByName(rawSheetName);
  if (!rawSheet || rawSheet.getLastRow() <= 1) {
    Logger.log('Inget att städa för ' + sheetName + ' — inget Raw-ark eller inga rader.');
    return;
  }

  const rows = rawSheet.getRange(2, 1, rawSheet.getLastRow() - 1, 1).getValues();
  const seen = {};
  const rowsToDelete = [];
  rows.forEach((r, i) => {
    let entry;
    try { entry = JSON.parse(r[0]); } catch (err) { return; }
    const ts = entry && entry.timestamp;
    if (!ts) return;
    if (seen[ts]) {
      rowsToDelete.push(2 + i); // +2: hoppa över rubrikraden, rows[] är 0-indexerad
    } else {
      seen[ts] = true;
    }
  });

  if (!rowsToDelete.length) {
    Logger.log('Inga dubbletter hittades i Raw-arket för ' + sheetName + '.');
    return;
  }

  /* radera nedifrån och upp så att resterande radindex inte förskjuts under tiden */
  rowsToDelete.sort((a, b) => b - a).forEach((rowIndex) => rawSheet.deleteRow(rowIndex));

  Logger.log('Tog bort ' + rowsToDelete.length + ' dubblettrad(er) ur Raw-arket för ' + sheetName + '. Bygger om den läsbara fliken…');
  repairReadableSheet(sheetName);
}

/* ---- Daglig kontroll: fångar precis de tre sakerna som gått fel förut ----

   1. Ett svar registrerat flera gånger (samma timestamp mer än en gång i
      ett Raw-ark, eller fler rader i den läsbara fliken än unika svar i
      Raw).
   2. Dubbla kolumnrubriker i en läsbar flik (samma kod två gånger i
      rubrikraden — det den gamla number-vs-string-buggen orsakade).
   3. Backup-arket som halkat efter huvudarket (ett svar finns i
      huvudarkets Raw men saknas i backupens).

   Läser igenom hela Raw-historiken varje gång — helt tillräckligt snabbt
   på den skala en kiosk-app genererar svar (dussintals till några hundra
   per dag), men värt att se över om volymen någon gång blir mycket större.

   Inte nåbar via doGet/doPost, med avsikt — samma anledning som
   repairAllReadableSheets: ingenting här ska kunna triggas utifrån. */
function runIntegrityCheck() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const issues = [];

  let backupSs = null;
  if (BACKUP_SHEET_ID) {
    try {
      backupSs = SpreadsheetApp.openById(BACKUP_SHEET_ID);
    } catch (err) {
      issues.push('Kan inte öppna backup-arket (kontrollera att det fortfarande finns och delar redigeringsåtkomst): ' + err.message);
    }
  }

  ['Test Drive', 'Cab Assessment'].forEach((sheetName) => {
    checkSheetIntegrity(ss, sheetName, '', issues);
    if (backupSs) {
      checkSheetIntegrity(backupSs, sheetName, 'Backup — ', issues);
      compareMainAndBackup(ss, backupSs, sheetName, issues);
    }
  });

  return { ok: issues.length === 0, issues, checkedAt: new Date().toISOString() };
}

/* Alla timestamps som faktiskt finns i ett givet Raw-ark — grunden för
   både dubblett- och backup-jämförelserna nedan. */
function getRawTimestamps(ss, sheetName) {
  const rawSheet = ss.getSheetByName('Raw — ' + sheetName);
  const timestamps = [];
  if (!rawSheet || rawSheet.getLastRow() <= 1) return timestamps;
  const rows = rawSheet.getRange(2, 1, rawSheet.getLastRow() - 1, 1).getValues();
  rows.forEach((r) => {
    try {
      const parsed = JSON.parse(r[0]);
      if (parsed && parsed.timestamp) timestamps.push(parsed.timestamp);
    } catch (err) { /* oläsbar rad — hoppa vidare */ }
  });
  return timestamps;
}

function checkSheetIntegrity(ss, sheetName, label, issues) {
  const name = label + sheetName;

  const timestamps = getRawTimestamps(ss, sheetName);
  const seen = {};
  timestamps.forEach((ts) => { seen[ts] = (seen[ts] || 0) + 1; });
  Object.keys(seen).forEach((ts) => {
    if (seen[ts] > 1) issues.push(name + ': "' + ts + '" finns ' + seen[ts] + ' gånger i Raw-arket (ska bara vara en).');
  });

  const distinctCount = Object.keys(seen).length;
  const readable = ss.getSheetByName(sheetName);
  const readableRows = readable ? Math.max(0, readable.getLastRow() - 1) : 0;
  if (distinctCount !== readableRows) {
    issues.push(name + ': Raw-arket har ' + distinctCount + ' unika svar men den läsbara fliken har ' + readableRows + ' rader (ska vara lika många).');
  }

  if (readable && readable.getLastRow() >= 1 && readable.getLastColumn() >= 1) {
    /* .map(String) — samma anledning som i writeSubmissionLocked: en
       kodad kolumn som bara är en siffra ("6") kan ha blivit ett tal
       istället för text, och en jämförelse utan detta skulle då missa en
       dubblett mellan en text- och en tal-version av samma kod. */
    const headers = readable.getRange(1, 1, 1, readable.getLastColumn()).getValues()[0].map(String);
    const headerSeen = {};
    headers.forEach((h) => { headerSeen[h] = (headerSeen[h] || 0) + 1; });
    Object.keys(headerSeen).forEach((h) => {
      if (headerSeen[h] > 1) issues.push(name + ': kolumnen "' + h + '" finns ' + headerSeen[h] + ' gånger i rubrikraden (ska bara vara en).');
    });
  }
}

function compareMainAndBackup(ss, backupSs, sheetName, issues) {
  const mainSet = {};
  getRawTimestamps(ss, sheetName).forEach((ts) => { mainSet[ts] = true; });
  const backupSet = {};
  getRawTimestamps(backupSs, sheetName).forEach((ts) => { backupSet[ts] = true; });

  let missingFromBackup = 0;
  Object.keys(mainSet).forEach((ts) => { if (!backupSet[ts]) missingFromBackup++; });
  if (missingFromBackup > 0) {
    issues.push(sheetName + ': ' + missingFromBackup + ' svar finns i huvudarket men saknas i backup-arket (spegling har inte kommit ikapp eller har misslyckats).');
  }
}

/* Körs av den dagliga triggern (se setupDailyHealthCheckTrigger nedan).
   Tyst när allt är som det ska — mejlar bara när runIntegrityCheck
   faktiskt hittar något, eller om kontrollen själv kraschar (t.ex. ett
   fel i Sheets-strukturen som gör att den inte ens går att läsa). */
function sendHealthCheckEmail() {
  let result;
  try {
    result = runIntegrityCheck();
  } catch (err) {
    MailApp.sendEmail(ALERT_EMAIL,
      'Scania Test Drive — kontrollen kunde inte köras',
      'Den dagliga kontrollen av Google Sheets kraschade med felet:\n\n' + err.message +
      '\n\nNågon borde kolla att Sheets-strukturen (Raw-flikarna, Config-arket) ser ut som den ska.');
    return;
  }
  if (result.ok) return;

  const body = 'Den dagliga kontrollen av Google Sheets hittade ' + result.issues.length +
    (result.issues.length === 1 ? ' sak' : ' saker') + ' som inte stämmer:\n\n' +
    result.issues.map((i) => '• ' + i).join('\n') +
    '\n\nKontrollerat: ' + result.checkedAt;
  MailApp.sendEmail(
    ALERT_EMAIL,
    'Scania Test Drive — kolla Google Sheets (' + result.issues.length + (result.issues.length === 1 ? ' varning' : ' varningar') + ')',
    body
  );
}

/* Engångsinstallation — se steg 6 i filens topp-kommentar. Säker att köra
   om igen (t.ex. om du vill byta tid på dagen): rensar först bort en
   ev. tidigare trigger för samma funktion innan den sätter upp en ny, så
   det aldrig blir två dagliga mejl istället för ett. */
function setupDailyHealthCheckTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'sendHealthCheckEmail') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendHealthCheckEmail')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
}

/* ---- Dagligt lägesmejl: "fungerar allt som det ska?" ----

   Skickas varje morgon (se setupDailySummaryTrigger nedan) och handlar om
   GÅRDAGEN. Fokus är att allt fungerar och kommer in — inte på betygen:
     • hur många inskick som kom in, per formulär och per fordon
     • när det första och sista kom in, och det längsta uppehållet emellan
       (en platta som tystnat mitt på dagen syns här)
     • tecken på att något är fel: svar utan land eller språk, svar utan
       några värden alls, svar på frågor som inte längre finns i
       konfigurationen (en platta som kör en gammal version)
     • samma kontroll som hälsomejlet (dubbletter, backup, kolumner)
     • att den dagliga hälsokontrollen fortfarande är schemalagd
   Mejlet säger tydligt "allt fungerar" eller listar varningarna överst.

   Skickas bara om gårdagen hade minst ett inskick — ELLER om gårdagen står
   i SUMMARY_EVENT_DAYS nedan (då skickas det även om inget kom in, med en
   varning om att det var tyst en eventdag). Eventdagarna står som
   'ÅÅÅÅ-MM-DD' och är redan ifyllda (2–27 november, vardagar) — du blir varnad
   om en hel eventdag blir tyst.

   Testa utan att vänta: kör previewDailySummary i Apps Script-redigeraren —
   det skickar ett mejl för den senaste dagen som har inskick, med [TEST]
   i ämnet. Ändrar ingenting i Sheets. */
const SUMMARY_EVENT_DAYS = [   // eventet 2–27 november 2026, vardagar (ta bort en dag om ingen var på plats)
  '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
  '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13',
  '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
  '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27',
];
const SUMMARY_TZ = 'Europe/Stockholm';

/* Ren beräkning (rör inget i Sheets/Mejl) så att den går att testa med
   påhittade data. entries = tolkade Raw-rader, knownIds = {form: {id:true}}. */
function computeDailySummary(entries, day, knownIds, tz, fmt) {
  const dayOf = (e) => fmt(new Date(e.timestamp), tz, 'yyyy-MM-dd');
  const hhmm = (e) => fmt(new Date(e.timestamp), tz, 'HH:mm');
  const mine = entries.filter((e) => e && e.timestamp && dayOf(e) === day)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const perForm = {}, perVehicle = {};
  const warn = [];
  let noCountry = 0, noLang = 0, noAnswers = 0, unknownIds = 0;
  mine.forEach((e) => {
    const form = e.formId === 'cab' ? 'Cab Assessment' : 'Test Drive';
    perForm[form] = (perForm[form] || 0) + 1;
    perVehicle[form] = perVehicle[form] || {};
    const vname = e.vehicleName || '?';
    perVehicle[form][vname] = (perVehicle[form][vname] || 0) + 1;
    if (!e.country) noCountry++;
    if (!e.lang) noLang++;
    const keys = Object.keys(e.answers || {});
    if (!keys.length) noAnswers++;
    const known = knownIds[e.formId === 'cab' ? 'cab' : 'testdrive'] || {};
    if (keys.some((k) => known && Object.keys(known).length && !known[k])) unknownIds++;
  });

  let gap = null;
  const times = mine.map((e) => new Date(e.timestamp).getTime());
  for (let i = 1; i < times.length; i++) {
    const g = times[i] - times[i - 1];
    if (g > 5000 && (!gap || g > gap.ms)) gap = { ms: g, from: hhmm(mine[i - 1]), to: hhmm(mine[i]) };
  }

  if (noCountry) warn.push(noCountry + ' svar saknar marknad (land).');
  if (noLang) warn.push(noLang + ' svar saknar språk.');
  if (noAnswers) warn.push(noAnswers + ' svar innehåller inga värden alls.');
  if (unknownIds) warn.push(unknownIds + ' svar innehåller frågor som inte finns i den nuvarande konfigurationen — en platta kan köra en gammal version av appen (stäng och öppna appen på plattorna).');

  return {
    day, total: mine.length, perForm, perVehicle,
    first: mine.length ? hhmm(mine[0]) : null,
    last: mine.length ? hhmm(mine[mine.length - 1]) : null,
    longestGapMin: gap ? Math.round(gap.ms / 60000) : 0,
    longestGapSpan: gap ? gap.from + '–' + gap.to : null,
    warnings: warn,
  };
}

function summaryKnownIds() {
  const config = (readConfig().config) || {};
  const collect = (cats) => {
    const o = {};
    (cats || []).forEach((c) => (c.metrics || []).forEach((m) => { o[m.id] = true; }));
    return o;
  };
  return { testdrive: collect(config.questions), cab: collect(config.cabQuestions) };
}

function readAllRawEntries(ss) {
  const entries = [];
  ['Raw — Test Drive', 'Raw — Cab Assessment'].forEach((name) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() <= 1) return;
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().forEach((r) => {
      try { if (r[0]) entries.push(JSON.parse(r[0])); } catch (err) { /* hoppa över oläsbar rad */ }
    });
  });
  return entries;
}

function summaryDayLabel(day) {
  const wd = ['söndag','måndag','tisdag','onsdag','torsdag','fredag','lördag'];
  const mo = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'];
  const d = new Date(day + 'T12:00:00Z');
  return wd[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + mo[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

function summaryEsc(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* Bygger både en enkel textversion och ett HTML-mejl: statusruta överst,
   sedan siffror, fordon och kontroller i små tabeller. */
function buildSummaryMail(s, extraWarnings, configUpdatedAt, isTest) {
  const contentWarnings = s.warnings;
  const warnings = contentWarnings.concat(extraWarnings);
  const ok = warnings.length === 0;
  const tag = isTest ? '[TEST] ' : '';
  const dayLabel = summaryDayLabel(s.day);
  const subject = tag + 'Scania-appen · ' + (ok ? 'Allt fungerar' : 'Kolla: ' + warnings.length + (warnings.length === 1 ? ' varning' : ' varningar')) +
    ' · ' + s.total + ' inskick (' + s.day + ')';

  const forms = Object.keys(s.perForm);
  const rows = [];                                  // [label, value]
  forms.forEach((f) => rows.push([f, String(s.perForm[f]) + (f === 'Cab Assessment' ? ' (räknas per fordon)' : '')]));
  if (s.total) {
    rows.push(['Första inskick', s.first]);
    rows.push(['Sista inskick', s.last]);
    if (s.longestGapMin) rows.push(['Längsta uppehåll', s.longestGapMin + ' min (' + s.longestGapSpan + ')']);
  }
  const checks = [
    [contentWarnings.length === 0, 'Svarens innehåll', 'Marknad, språk och värden finns, och frågorna är de aktuella.'],
    [extraWarnings.length === 0, 'Sheets och backup', 'Inga dubbletter, rubriker stämmer, backupen är ikapp.'],
  ];

  /* ---------- text ---------- */
  const t = [];
  t.push(ok ? '✓ ALLT FUNGERAR' : '⚠ KOLLA — ' + warnings.length + (warnings.length === 1 ? ' sak' : ' saker'));
  t.push(dayLabel);
  if (!ok) { t.push(''); warnings.forEach((w) => t.push('  ⚠ ' + w)); }
  t.push(''); t.push('INSKICK');
  t.push('  Totalt: ' + s.total);
  rows.forEach((r) => t.push('  ' + r[0] + ': ' + r[1]));
  forms.forEach((f) => {
    t.push(''); t.push(f.toUpperCase() + ' PER FORDON');
    Object.keys(s.perVehicle[f] || {}).sort().forEach((v) => t.push('  ' + v + ': ' + s.perVehicle[f][v]));
  });
  t.push(''); t.push('KONTROLLER');
  checks.forEach((c) => t.push('  ' + (c[0] ? '✓' : '⚠') + ' ' + c[1]));
  t.push(''); t.push('Frågorna senast sparade: ' + (configUpdatedAt || 'okänt'));

  /* ---------- html ---------- */
  const ink = '#16202e', dim = '#5b6573', line = '#e3e6ea';
  const accent = ok ? '#0e7c5a' : '#b3261e';
  const accentBg = ok ? '#e8f5ef' : '#fdecea';
  const td = 'padding:7px 0;border-bottom:1px solid ' + line + ';font-size:14px;';
  const h = (txt) => '<div style="margin:26px 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:' + dim + ';font-weight:600;">' + txt + '</div>';
  const kv = (list) => '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">' +
    list.map((r) => '<tr><td style="' + td + 'color:' + dim + ';">' + summaryEsc(r[0]) + '</td><td align="right" style="' + td + 'color:' + ink + ';font-weight:600;">' + summaryEsc(r[1]) + '</td></tr>').join('') + '</table>';

  let html = '<div style="background:#f4f5f7;padding:24px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:' + ink + ';">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px 28px 22px;">' +
    '<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:' + dim + ';font-weight:600;">' + (isTest ? 'TEST · ' : '') + 'Scania-appen · lägesrapport</div>' +
    '<div style="font-size:15px;color:' + dim + ';margin:2px 0 18px;">' + summaryEsc(dayLabel) + '</div>' +
    '<div style="background:' + accentBg + ';border-left:4px solid ' + accent + ';border-radius:6px;padding:14px 16px;">' +
    '<div style="font-size:20px;font-weight:700;color:' + accent + ';">' + (ok ? '✓ Allt fungerar' : '⚠ Kolla ' + warnings.length + (warnings.length === 1 ? ' sak' : ' saker')) + '</div>' +
    (ok ? '<div style="font-size:14px;color:' + ink + ';margin-top:4px;">' + s.total + ' inskick kom in och alla kontroller är gröna.</div>'
        : '<ul style="margin:10px 0 0;padding-left:18px;font-size:14px;line-height:1.5;color:' + ink + ';">' + warnings.map((w) => '<li style="margin-bottom:4px;">' + summaryEsc(w) + '</li>').join('') + '</ul>') +
    '</div>' +
    h('Inskick') + kv([['Totalt', String(s.total)]].concat(rows));
  forms.forEach((f) => {
    const vs = s.perVehicle[f] || {};
    html += h(f + ' per fordon') + kv(Object.keys(vs).sort().map((v) => [v, String(vs[v])]));
  });
  html += h('Kontroller') + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">' +
    checks.map((c) => '<tr><td width="28" valign="top" style="' + td + 'font-size:16px;color:' + (c[0] ? '#0e7c5a' : '#b3261e') + ';font-weight:700;">' + (c[0] ? '✓' : '⚠') + '</td>' +
      '<td style="' + td + '"><div style="font-weight:600;color:' + ink + ';">' + summaryEsc(c[1]) + '</div><div style="color:' + dim + ';font-size:13px;">' + summaryEsc(c[0] ? c[2] : 'Se varningarna överst.') + '</div></td></tr>').join('') + '</table>' +
    '<div style="margin-top:22px;font-size:12px;color:' + dim + ';">Frågorna senast sparade: ' + summaryEsc(configUpdatedAt || 'okänt') + '<br>Skickas automatiskt varje morgon kl 08:00.</div>' +
    '</div></div>';

  return { subject: subject, body: t.join('\n'), html: html };
}

function sendDailySummaryEmail(dayOverride, isTest) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let day;
    if (typeof dayOverride === 'string') day = dayOverride;
    else {
      const y = new Date(); y.setDate(y.getDate() - 1);
      day = Utilities.formatDate(y, SUMMARY_TZ, 'yyyy-MM-dd');
    }
    const entries = readAllRawEntries(ss);
    const s = computeDailySummary(entries, day, summaryKnownIds(), SUMMARY_TZ, Utilities.formatDate);

    const isEventDay = SUMMARY_EVENT_DAYS.indexOf(day) >= 0;
    if (!isTest && s.total === 0 && !isEventDay) return;       // vanlig dag utan inskick: inget mejl

    const extra = [];
    if (s.total === 0) extra.push('Inga inskick alls kom in ' + day + ', fast det var en eventdag — kolla plattorna och uppkopplingen.');
    const integrity = runIntegrityCheck();
    integrity.issues.forEach((i) => extra.push(i));
    const hasHealthTrigger = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'sendHealthCheckEmail');
    if (!hasHealthTrigger) extra.push('Den dagliga hälsokontrollen är inte schemalagd längre — kör setupDailyHealthCheckTrigger.');

    const cfgAt = readConfig().updatedAt;
    const cfgText = cfgAt ? Utilities.formatDate(new Date(cfgAt), SUMMARY_TZ, 'yyyy-MM-dd HH:mm') : null;
    const mail = buildSummaryMail(s, extra, cfgText, !!isTest);
    MailApp.sendEmail(ALERT_EMAIL, mail.subject, mail.body, { htmlBody: mail.html });
  } catch (err) {
    MailApp.sendEmail(ALERT_EMAIL, 'Scania-appen — lägesmejlet kunde inte skapas',
      'Det dagliga lägesmejlet kraschade med felet:\n\n' + err.message +
      '\n\nKolla att Sheets-strukturen (Raw-flikarna, Config-arket) ser ut som den ska.');
  }
}

/* Testmejl för den SENASTE dagen som har inskick (inte nödvändigtvis
   igår). Skickar alltid, ändrar ingenting. Kör den från redigeraren. */
function previewDailySummary() {
  const entries = readAllRawEntries(SpreadsheetApp.getActiveSpreadsheet());
  let latest = null;
  entries.forEach((e) => { if (e && e.timestamp && (!latest || e.timestamp > latest)) latest = e.timestamp; });
  const day = latest ? Utilities.formatDate(new Date(latest), SUMMARY_TZ, 'yyyy-MM-dd')
                     : Utilities.formatDate(new Date(), SUMMARY_TZ, 'yyyy-MM-dd');
  sendDailySummaryEmail(day, true);
}

/* Engångsinstallation, precis som setupDailyHealthCheckTrigger: kör den
   en gång för att få mejlet varje morgon kl 08:00. Säker att köra om
   (rensar en ev. tidigare trigger för samma funktion först). */
function setupDailySummaryTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'sendDailySummaryEmail') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailySummaryEmail')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();
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
    .createTextOutput(JSON.stringify({ ok: true, service: 'Scania Test Drive — Sheets sync', codeVersion: 'dedup-raw-1' }))
    .setMimeType(ContentService.MimeType.JSON);
}
