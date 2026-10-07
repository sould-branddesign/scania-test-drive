/* ============================================================
   SCANIA · TEST DRIVE — shared core
   Data model, state, persistence, scoring and the public API.
   Loaded by BOTH the test page (index.html) and the admin page
   (admin.html); exposes everything on window.STD.
   ============================================================ */
(function () {
  'use strict';

  const STORE_KEY = 'scania_testdrive_v1';
  const $ = (sel, el = document) => el.querySelector(sel);
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const hashStr = (s) => { let hsh = 2166136261; for (let i = 0; i < s.length; i++) { hsh ^= s.charCodeAt(i); hsh = Math.imul(hsh, 16777619); } return hsh >>> 0; };
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('id-' + Math.abs(hashStr(s + Math.random())) % 99999); }

  /* ---------- brands (colour identity from Figma) ---------- */
  const BRANDS = {
    scania:   { name: 'Scania',   a: 'var(--scania-a)', b: 'var(--scania-b)', solid: '#07A99E', solidB: '#0198C3', text: '#01B2D3' },
    volvo:    { name: 'Volvo',    a: 'var(--volvo-a)',  b: 'var(--volvo-b)',  solid: '#62299B', solidB: '#EFB4D8', text: '#EFB4D8' },
    daf:      { name: 'DAF',      a: 'var(--daf-a)',    b: 'var(--daf-b)',    solid: '#7C2D10', solidB: '#FF8000', text: '#FF8000' },
    mercedes: { name: 'Mercedes', a: 'var(--merc-a)',   b: 'var(--merc-b)',   solid: '#C2C2C2', solidB: '#3A3A3A' },
    man:      { name: 'MAN',      a: 'var(--man-a)',    b: 'var(--man-b)',    solid: '#E75F30', solidB: '#363CA5' },
  };
  const brandOf = (name) => {
    const n = name.toLowerCase();
    if (n.startsWith('scania')) return 'scania';
    if (n.startsWith('volvo')) return 'volvo';
    if (n.startsWith('daf')) return 'daf';
    if (n.startsWith('mercedes')) return 'mercedes';
    if (n.startsWith('man')) return 'man';
    return 'scania';
  };

  /* ---------- default vehicles (from the "choose vehicle" screen) ---------- */
  /* Listed as (Scania, competitor) pairs so the 2-column vehicle grid
     naturally puts every Scania in the left column and every competitor
     in the right one (CSS grid fills left-to-right, row by row — see
     .vgrid). "Scania 40S A4X2NB" is the same spec run against two
     different competitors (Mercedes eActros and the Volvo FH electric),
     so it's deliberately listed twice, once beside each — both list
     entries end up with the identical id (derived from the name below),
     so answers submitted from either tile land under the same vehicle
     in the results, exactly as if it were one button. */
  const DEFAULT_VEHICLES = [
    'Scania 40S A4X2NB', 'Mercedes eActros 600 LS 4x2',
    'Scania 500R A6X2/4NB', 'Volvo FH Aero 510 4x2',
    'Scania 460R A4X2NA', 'MAN TGX 18.480 BLS Euro 6e',
    'Scania 560S A4X2NB', 'DAF XG+ 480 FT 4x2 E6e',
    'Scania 33R A4X2NB', 'Volvo FH electric 4x2',
    'Scania 500R A4x2LB', 'Mercedes Actros 1851 LS 4x2 E6',
  ].map((name) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, brand: brandOf(name) }));

  /* ---------- default questions (the 5 evaluation steps) ---------- */
  const DEFAULT_QUESTIONS = [
    {
      id: 'cab', title: 'Cab Evaluation & Gear Shifting',
      instruction: 'Stop-start on the uphill section, then accelerate. Evaluate the gearbox and cab behaviour.',
      metrics: [
        { id: 'cab_assessment', label: 'Cab assessment', min: 'Poor', max: 'Very good', scale: 10 },
        { id: 'gear_shift', label: 'Gear shift response', min: 'Unreliable', max: 'Very reliable', scale: 10 },
      ],
    },
    {
      id: 'aux', title: 'Auxiliary Braking',
      instruction: 'Auxiliary brake on the downhill section. Evaluate ease of use and control confidence.',
      metrics: [
        { id: 'ease_handling', label: 'Ease of handling', min: 'Very difficult', max: 'Very easy', scale: 10 },
      ],
    },
    {
      id: 'steering', title: 'Steering & Handling',
      instruction: 'One-hand line follow then cone slalom. Evaluate steering precision and chassis stability.',
      metrics: [
        { id: 'steering_precision', label: 'Steering precision', min: 'Imprecise', max: 'Very precise', scale: 10 },
        { id: 'chassis_stability', label: 'Chassis stability', min: 'Unstable', max: 'Very stable', scale: 10 },
      ],
    },
    {
      id: 'parking', title: 'Parking & Precision Maneuver',
      instruction: 'Maneuver mode back to parking. Evaluate precision, reversing ease, and docking control.',
      metrics: [
        { id: 'precision_maneuver', label: 'Precision — maneuver mode', min: 'Imprecise', max: 'Very precise', scale: 10 },
        { id: 'reversing_docking', label: 'Ease of reversing & docking', min: 'Very difficult', max: 'Very easy', scale: 10 },
      ],
    },
    {
      id: 'overall', title: 'Overall Driving Experience',
      instruction: 'Having completed all tasks, give your overall impression of driving this vehicle.',
      metrics: [
        { id: 'overall_exp', label: 'Overall Driving Experience', min: 'Poor', max: 'Premium', scale: 10 },
      ],
    },
  ];

  /* [name, id?] — the id is permanent (answers are stored under it), so a
     renamed vehicle keeps its original id. */
  const DEFAULT_CAB_VEHICLES = [
    ['Scania CR20H'], ['Volvo FH Aero'], ['MAN TGX'], ['Mercedes Actros ProCabin', 'mercedes-actros'],
  ].map(([name, id]) => ({ id: id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, brand: brandOf(name) }));

  const DEFAULT_CAB_QUESTIONS = [
    { id: 'boarding', title: 'Cab Entry', instruction: "Enter the cab from the driver's side, with the second person carrying the tablet. Climb in and settle into position — tablet holder on the bed, first person in the passenger seat.", metrics: [
      { id: 'boarding_ease', label: 'Ease of boarding', min: 'Very difficult', max: 'Very easy', scale: 10 },
      { id: 'door_interference', label: 'Door interference while climbing in', min: 'Very interfering', max: 'No interference', scale: 10 },
    ] },
    { id: 'cross_cab_access', title: 'Cross Cab Access', instruction: "Move from the driver's seat to the bed and passenger seat, noting interference from the steering wheel, centre console, engine tunnel and front upper storage.", metrics: [
      { id: 'cross_cab_access_ease', label: 'Cross cab access', min: 'Much interfering', max: 'Undramatic', scale: 10 },
    ] },
    { id: 'ergonomics', title: 'Driver ergonomics - seat & steering wheel', instruction: "Adjust the driver's seat to your preferred position relative to the brake and accelerator pedals — longitudinal position, height and backrest. Release the steering wheel lock and find the best available position. Check whether you need to readjust the seat afterwards to get a comfortable arm and hand position.", metrics: [
      { id: 'adjustability', label: 'Adjustability', min: 'Limiting', max: 'Easy to find my preference', scale: 10 },
      { id: 'ergonomics_overall', label: 'Ergonomics', min: 'Poor', max: 'Very good', scale: 10 },
    ] },
    { id: 'ergonomics_driving', title: 'Driver ergonomics – When driving', instruction: "While driving, find and reach the cruise control, climate control and sunblinds. Position your phone to charge, and try pulling a water bottle from the fridge without taking your eyes off the road.", metrics: [
      { id: 'intuitive_reach', label: 'Intuitive and easy to find', min: 'Difficult/messy', max: 'Easy and good clusters', scale: 10 },
    ] },
    { id: 'fit_finish', title: 'Living – Practicalities and fit & finish', instruction: "On the passenger seat, get ready to eat a meal with a fork and knife — check where you'd naturally place the plate, and whether there's room for your legs. On the bed, get into a comfortable reading position with the light on, and turn on the digital mirrors to check your surroundings. Assess fit and finish against R&D's guidance.", metrics: [
      { id: 'living_comfort', label: 'Living comfort', min: 'Restricted', max: 'Well thought through', scale: 10 },
      { id: 'overall_finish', label: 'Fit and finish', min: 'Poor', max: 'Premium', scale: 10 },
    ] },
    { id: 'safety', title: 'Safe driving – Direct vision', instruction: "From the driver's seat, note what colour you can see on the pillar in front and on the sign behind the A-pillars.", metrics: [
      { id: 'direct_vision', label: 'How much were you able to see', min: 'Red', max: 'Green', scale: 10 },
    ] },
    { id: 'cab_exit', title: 'Cab exit', instruction: "Open the door and exit the cab backing out. Note whether you can see the top step from your seat.", metrics: [
      { id: 'cab_entry_exit', label: 'Cab entry and exit', min: 'Unsafe', max: 'Natural and effortless', scale: 10 },
    ] },
  ];

  /* ---------- i18n for UI chrome (test page) ---------- */
  /* English and Swedish first — the two that are hand-translated, not
     AI (see the "AI-translated" icon in the language picker, which
     skips exactly these two) — everything else follows alphabetically. */
  const LANGS = [
    { code: 'en', label: 'English' },
    { code: 'sv', label: 'Swedish / Svenska' },
    { code: 'bg', label: 'Bulgarian / Български' },
    { code: 'cs', label: 'Czech / Čeština' },
    { code: 'da', label: 'Danish / Dansk' },
    { code: 'nl', label: 'Dutch / Nederlands' },
    { code: 'et', label: 'Estonian / Eesti' },
    { code: 'fi', label: 'Finnish / Suomi' },
    { code: 'fr', label: 'French / Français' },
    { code: 'hu', label: 'Hungarian / Magyar' },
    { code: 'it', label: 'Italian / Italiano' },
    { code: 'lv', label: 'Latvian / Latviešu' },
    { code: 'lt', label: 'Lithuanian / Lietuvių' },
    { code: 'no', label: 'Norwegian / Norsk' },
    { code: 'pl', label: 'Polish / Polski' },
    { code: 'pt', label: 'Portuguese / Português' },
    { code: 'ro', label: 'Romanian / Română' },
    { code: 'sr', label: 'Serbian / Српски' },
    { code: 'sk', label: 'Slovak / Slovenčina' },
    { code: 'sl', label: 'Slovenian / Slovenščina' },
    { code: 'es', label: 'Spanish / Español' },
    { code: 'uk', label: 'Ukrainian / Українська' },
  ];

  const COUNTRIES = [
    'Belgium','Bulgaria','Czech Republic','Denmark','Estonia','Finland',
    'France','Hungary','Ireland','Israel','Italy',
    'Latvia','Lithuania','Luxembourg',
    'Norway','Poland','Portugal','Romania',
    'Serbia','Slovakia','Slovenia','Spain','Sweden','Switzerland',
    'Turkey','Ukraine','United Kingdom',
  ];
  const T = {
    en: { chooseLanguage: 'Choose language', welcome: 'Welcome to the evaluation of your test drive.', chooseVehicle: 'Choose your vehicle:', next: 'Next', back: 'Back', submit: 'Submit', confirmTitle: 'Are you sure?', confirmMsg: 'Once submitted you cannot go back and change your answers.', done: 'Done', selectCategory: 'Select a category', thanks: 'Thank you!', submitted: (v) => `Your ratings for ${v} have been submitted.`, nextCar: 'Next truck', startOver: 'Start over', tap: 'Tap to start', restarting: (n) => `Restarting in ${n}s` , cabWelcome: "Welcome to the Cab Assessment.", cabAssess: "Assess every vehicle — tap one to start:", cabThanksMsg: "Your Cab Assessment ratings for all vehicles have been submitted.", idleTitle: "Are you still there?", idleMsg: "Back to the start screen in {n} s unless you continue.", idleContinue: "Continue" },
    sq: { chooseLanguage: 'Zgjidhni gjuhën', welcome: 'Mirë se vini në vlerësimin e test drive-it tuaj.', chooseVehicle: 'Zgjidhni automjetin tuaj:', next: 'Tjetër', back: 'Mbrapa', submit: 'Dërgo', confirmTitle: 'Jeni i sigurt?', confirmMsg: 'Pasi të dërgohet, nuk mund të ktheheni pas dhe të ndryshoni përgjigjet tuaja.', thanks: 'Faleminderit!', submitted: (v) => `Vlerësimet tuaja për ${v} janë dërguar.`, nextCar: 'Kamioni tjetër', startOver: 'Fillo përsëri', tap: 'Prekni për të filluar', restarting: (n) => `Rifillimi në ${n}s` },
    be: { chooseLanguage: 'Выберыце мову', welcome: 'Сардэчна запрашаем на ацэнку вашага тэст-драйву.', chooseVehicle: 'Выберыце вашу машыну:', next: 'Далей', back: 'Назад', submit: 'Адправіць', confirmTitle: 'Вы ўпэўнены?', confirmMsg: 'Пасля адпраўкі вы не зможаце вярнуцца і змяніць свае адказы.', thanks: 'Дзякуй!', submitted: (v) => `Вашы ацэнкі для ${v} адпраўлены.`, nextCar: 'Наступны аўтамабіль', startOver: 'Пачаць спачатку', tap: 'Націсніце для пачатку', restarting: (n) => `Перазапуск праз ${n}с` },
    bs: { chooseLanguage: 'Odaberite jezik', welcome: 'Dobrodošli u ocjenu vašeg test vožnje.', chooseVehicle: 'Odaberite vaše vozilo:', next: 'Dalje', back: 'Nazad', submit: 'Pošalji', confirmTitle: 'Jeste li sigurni?', confirmMsg: 'Nakon slanja nećete moći da se vratite i promijenite svoje odgovore.', thanks: 'Hvala!', submitted: (v) => `Vaše ocjene za ${v} su poslane.`, nextCar: 'Sljedeći kamion', startOver: 'Počni iznova', tap: 'Dodirnite za početak', restarting: (n) => `Pokretanje za ${n}s` },
    bg: { chooseLanguage: 'Изберете език', welcome: "Добре дошли в оценката на вашия тест-драйв.", chooseVehicle: 'Изберете вашето превозно средство:', next: 'Напред', back: 'Назад', submit: 'Изпрати', confirmTitle: 'Сигурни ли сте?', confirmMsg: 'След изпращане не можете да се върнете и да промените отговорите си.', done: 'Готово', selectCategory: 'Изберете категория', thanks: 'Благодаря!', submitted: (v) => `Вашите оценки за ${v} бяха изпратени.`, nextCar: 'Следващ камион', startOver: 'Започнете отначало', tap: 'Докоснете за начало', restarting: (n) => `Рестартиране след ${n}с`, cabWelcome: "Добре дошли в оценката на кабините.", cabAssess: "Оценете всяко превозно средство — докоснете едно, за да започнете:", cabThanksMsg: "Вашите оценки на кабините за всички превозни средства са изпратени.", idleTitle: "Все още ли сте тук?", idleMsg: "След {n} с ще се върнете към началния екран, ако не продължите.", idleContinue: "Продължи" },
    ca: { chooseLanguage: "Trieu l'idioma", welcome: "Benvingut a l'avaluació del vostre test drive.", chooseVehicle: 'Trieu el vostre vehicle:', next: 'Següent', back: 'Enrere', submit: 'Enviar', confirmTitle: "N'esteu segur?", confirmMsg: 'Un cop enviat, no podreu tornar enrere i canviar les vostres respostes.', thanks: 'Gràcies!', submitted: (v) => `Les vostres valoracions per ${v} han estat enviades.`, nextCar: 'Camió següent', startOver: 'Tornar a començar', tap: 'Toqueu per començar', restarting: (n) => `Reinici en ${n}s` },
    hr: { chooseLanguage: 'Odaberite jezik', welcome: 'Dobrodošli u ocjenu vašeg probnog vožnje.', chooseVehicle: 'Odaberite svoje vozilo:', next: 'Dalje', back: 'Natrag', submit: 'Pošalji', confirmTitle: 'Jeste li sigurni?', confirmMsg: 'Nakon slanja nećete se moći vratiti i promijeniti svoje odgovore.', thanks: 'Hvala!', submitted: (v) => `Vaše ocjene za ${v} su poslane.`, nextCar: 'Sljedeći kamion', startOver: 'Počni iznova', tap: 'Dodirnite za početak', restarting: (n) => `Pokretanje za ${n}s` },
    cs: { chooseLanguage: 'Vyberte jazyk', welcome: 'Vítejte v hodnocení vaší zkušební jízdy.', chooseVehicle: 'Vyberte si vozidlo:', next: 'Další', back: 'Zpět', submit: 'Odeslat', confirmTitle: 'Jste si jisti?', confirmMsg: 'Po odeslání se nebudete moci vrátit a změnit své odpovědi.', done: 'Hotovo', selectCategory: 'Vyberte kategorii', thanks: 'Děkujeme!', submitted: (v) => `Vaše hodnocení pro ${v} bylo odesláno.`, nextCar: 'Další kamion', startOver: 'Začít znovu', tap: 'Klepnutím zahájíte', restarting: (n) => `Restartování za ${n}s`, cabWelcome: "Vítejte v hodnocení kabin.", cabAssess: "Ohodnoťte každé vozidlo — klepnutím na jedno začněte:", cabThanksMsg: "Vaše hodnocení kabin pro všechna vozidla byla odeslána.", idleTitle: "Jste tu ještě?", idleMsg: "Za {n} s se vrátíme na úvodní obrazovku, pokud nepokračujete.", idleContinue: "Pokračovat" },
    da: { chooseLanguage: 'Vælg sprog', welcome: 'Velkommen til evalueringen af din prøvekørsel.', chooseVehicle: 'Vælg dit køretøj:', next: 'Næste', back: 'Tilbage', submit: 'Indsend', confirmTitle: 'Er du sikker?', confirmMsg: 'Når du har indsendt, kan du ikke gå tilbage og ændre dine svar.', done: 'Færdig', selectCategory: 'Vælg en kategori', thanks: 'Tak!', submitted: (v) => `Dine vurderinger for ${v} er indsendt.`, nextCar: 'Næste lastbil', startOver: 'Start forfra', tap: 'Tryk for at starte', restarting: (n) => `Genstarter om ${n}s`, cabWelcome: "Velkommen til førerhusvurderingen.", cabAssess: "Vurder hvert køretøj — tryk på et for at starte:", cabThanksMsg: "Dine førerhusvurderinger for alle køretøjer er indsendt.", idleTitle: "Er du der stadig?", idleMsg: "Tilbage til startskærmen om {n} s, medmindre du fortsætter.", idleContinue: "Fortsæt" },
    nl: { chooseLanguage: 'Kies taal', welcome: 'Welkom bij de evaluatie van uw proefrit.', chooseVehicle: 'Kies uw voertuig:', next: 'Volgende', back: 'Terug', submit: 'Verzenden', confirmTitle: 'Weet u het zeker?', confirmMsg: 'Na het verzenden kunt u niet meer terug om uw antwoorden te wijzigen.', done: 'Klaar', selectCategory: 'Selecteer een categorie', thanks: 'Bedankt!', submitted: (v) => `Uw beoordelingen voor ${v} zijn ingediend.`, nextCar: 'Volgende vrachtwagen', startOver: 'Opnieuw beginnen', tap: 'Tik om te starten', restarting: (n) => `Opnieuw starten over ${n}s`, cabWelcome: "Welkom bij de cabinebeoordeling.", cabAssess: "Beoordeel elk voertuig — tik op een voertuig om te beginnen:", cabThanksMsg: "Uw cabinebeoordelingen voor alle voertuigen zijn ingediend.", idleTitle: "Bent u er nog?", idleMsg: "Over {n} s terug naar het startscherm, tenzij u doorgaat.", idleContinue: "Doorgaan" },
    et: { chooseLanguage: 'Valige keel', welcome: 'Tere tulemast oma proovisõidu hindamisele.', chooseVehicle: 'Valige oma sõiduk:', next: 'Järgmine', back: 'Tagasi', submit: 'Esita', confirmTitle: 'Kas olete kindel?', confirmMsg: 'Pärast esitamist ei saa te enam tagasi minna ja oma vastuseid muuta.', done: 'Valmis', selectCategory: 'Valige kategooria', thanks: 'Tänan!', submitted: (v) => `Teie hinnangud ${v} jaoks on esitatud.`, nextCar: "Järgmine veok", startOver: 'Alusta uuesti', tap: 'Puudutage alustamiseks', restarting: (n) => `Taaskäivitamine ${n}s pärast`, cabWelcome: "Tere tulemast kabiinide hindamisele.", cabAssess: "Hinnake iga sõidukit — alustamiseks puudutage ühte:", cabThanksMsg: "Teie kabiinihinnangud kõigi sõidukite kohta on esitatud.", idleTitle: "Kas olete veel siin?", idleMsg: "Naasete {n} s pärast avakuvale, kui te ei jätka.", idleContinue: "Jätka" },
    fi: { chooseLanguage: 'Valitse kieli', welcome: 'Tervetuloa koeajosi arviointiin.', chooseVehicle: 'Valitse ajoneuvosi:', next: 'Seuraava', back: 'Takaisin', submit: 'Lähetä', confirmTitle: 'Oletko varma?', confirmMsg: 'Lähettämisen jälkeen et voi enää palata takaisin ja muuttaa vastauksiasi.', done: 'Valmis', selectCategory: 'Valitse kategoria', thanks: 'Kiitos!', submitted: (v) => `Arviosi kohteesta ${v} on lähetetty.`, nextCar: 'Seuraava kuorma-auto', startOver: 'Aloita alusta', tap: 'Napauta aloittaaksesi', restarting: (n) => `Käynnistetään uudelleen ${n}s kuluttua`, cabWelcome: "Tervetuloa ohjaamoarviointiin.", cabAssess: "Arvioi jokainen ajoneuvo — aloita napauttamalla yhtä:", cabThanksMsg: "Ohjaamoarviosi kaikista ajoneuvoista on lähetetty.", idleTitle: "Oletko vielä siellä?", idleMsg: "Palataan aloitusnäyttöön {n} s kuluttua, ellet jatka.", idleContinue: "Jatka" },
    fr: { chooseLanguage: 'Choisir la langue', welcome: "Bienvenue dans l'évaluation de votre essai.", chooseVehicle: 'Choisissez votre véhicule :', next: 'Suivant', back: 'Retour', submit: 'Envoyer', confirmTitle: 'Êtes-vous sûr ?', confirmMsg: 'Une fois envoyé, vous ne pourrez plus revenir en arrière pour modifier vos réponses.', done: 'Terminé', selectCategory: 'Sélectionnez une catégorie', thanks: 'Merci !', submitted: (v) => `Vos évaluations pour ${v} ont été envoyées.`, nextCar: 'Autre véhicule', startOver: 'Recommencer', tap: 'Appuyez pour commencer', restarting: (n) => `Redémarrage dans ${n}s` , cabWelcome: "Bienvenue dans l'évaluation des cabines.", cabAssess: "Évaluez chaque véhicule — touchez-en un pour commencer :", cabThanksMsg: "Vos évaluations de cabine pour tous les véhicules ont été envoyées.", idleTitle: "Vous êtes toujours là ?", idleMsg: "Retour à l'écran de démarrage dans {n} s si vous ne continuez pas.", idleContinue: "Continuer" },
    de: { chooseLanguage: 'Sprache wählen', welcome: 'Willkommen zur Bewertung Ihrer Probefahrt.', chooseVehicle: 'Wählen Sie Ihr Fahrzeug:', next: 'Weiter', back: 'Zurück', submit: 'Absenden', confirmTitle: 'Sind Sie sicher?', confirmMsg: 'Nach dem Absenden können Sie nicht mehr zurückgehen und Ihre Antworten ändern.', thanks: 'Danke!', submitted: (v) => `Ihre Bewertungen für ${v} wurden übermittelt.`, nextCar: 'Nächster LKW', startOver: 'Neu starten', tap: 'Tippen zum Starten', restarting: (n) => `Neustart in ${n}s` },
    el: { chooseLanguage: 'Επιλέξτε γλώσσα', welcome: 'Καλώς ήρθατε στην αξιολόγηση της δοκιμαστικής σας οδήγησης.', chooseVehicle: 'Επιλέξτε το όχημά σας:', next: 'Επόμενο', back: 'Πίσω', submit: 'Υποβολή', confirmTitle: 'Είστε σίγουροι;', confirmMsg: 'Μόλις υποβληθεί, δεν μπορείτε να επιστρέψετε και να αλλάξετε τις απαντήσεις σας.', thanks: 'Ευχαριστώ!', submitted: (v) => `Οι αξιολογήσεις σας για ${v} υποβλήθηκαν.`, nextCar: 'Επόμενο φορτηγό', startOver: 'Ξεκινήστε από την αρχή', tap: 'Πατήστε για έναρξη', restarting: (n) => `Επανεκκίνηση σε ${n}s` },
    hu: { chooseLanguage: 'Válasszon nyelvet', welcome: 'Üdvözöljük a tesztvezetés értékelésén.', chooseVehicle: 'Válassza ki járművét:', next: 'Következő', back: 'Vissza', submit: 'Küldés', confirmTitle: 'Biztos benne?', confirmMsg: 'Elküldés után már nem térhet vissza a válaszok módosításához.', done: 'Kész', selectCategory: 'Válasszon kategóriát', thanks: 'Köszönöm!', submitted: (v) => `A ${v} értékelése elküldve.`, nextCar: "Következő teherautó", startOver: 'Kezdje újra', tap: 'Érintse az indításhoz', restarting: (n) => `Újraindítás ${n}s múlva`, cabWelcome: "Üdvözöljük a kabinértékelésen.", cabAssess: "Értékeljen minden járművet — az induláshoz érintse meg valamelyiket:", cabThanksMsg: "A kabinértékelések az összes járműre elküldve.", idleTitle: "Még itt van?", idleMsg: "{n} mp múlva visszatér a kezdőképernyőre, ha nem folytatja.", idleContinue: "Folytatás" },
    is: { chooseLanguage: 'Veldu tungumál', welcome: 'Velkomin í mat á prufuakstri þínum.', chooseVehicle: 'Veldu ökutæki þitt:', next: 'Næst', back: 'Til baka', submit: 'Senda', confirmTitle: 'Ertu viss?', confirmMsg: 'Eftir að hafa sent inn geturðu ekki farið til baka og breytt svörum þínum.', done: 'Lokið', selectCategory: 'Veldu flokk', thanks: 'Takk!', submitted: (v) => `Einkunnir þínar fyrir ${v} hafa verið sendar.`, nextCar: 'Næsti vörubíll', startOver: 'Byrja aftur', tap: 'Snertu til að byrja', restarting: (n) => `Endurræsing eftir ${n}s` },
    it: { chooseLanguage: 'Scegli la lingua', welcome: 'Benvenuto nella valutazione del tuo test drive.', chooseVehicle: 'Scegli il tuo veicolo:', next: 'Avanti', back: 'Indietro', submit: 'Invia', confirmTitle: 'Sei sicuro?', confirmMsg: 'Una volta inviato non potrai tornare indietro e modificare le tue risposte.', done: 'Fatto', selectCategory: 'Seleziona una categoria', thanks: 'Grazie!', submitted: (v) => `Le tue valutazioni per ${v} sono state inviate.`, nextCar: 'Prossimo camion', startOver: 'Ricomincia', tap: 'Tocca per iniziare', restarting: (n) => `Riavvio tra ${n}s`, cabWelcome: "Benvenuto nella valutazione delle cabine.", cabAssess: "Valuta ogni veicolo — tocca un veicolo per iniziare:", cabThanksMsg: "Le tue valutazioni delle cabine per tutti i veicoli sono state inviate.", idleTitle: "Sei ancora lì?", idleMsg: "Tra {n} s si tornerà alla schermata iniziale se non continui.", idleContinue: "Continua" },
    lv: { chooseLanguage: 'Izvēlieties valodu', welcome: 'Laipni lūdzam jūsu izmēģinājuma brauciena novērtējumā.', chooseVehicle: 'Izvēlieties savu transportlīdzekli:', next: 'Tālāk', back: 'Atpakaļ', submit: 'Iesniegt', confirmTitle: 'Vai esat pārliecināts?', confirmMsg: 'Pēc iesniegšanas jūs nevarēsiet atgriezties un mainīt savas atbildes.', done: 'Gatavs', selectCategory: 'Izvēlieties kategoriju', thanks: 'Paldies!', submitted: (v) => `Jūsu vērtējumi par ${v} ir iesniegti.`, nextCar: "Nākamā kravas automašīna", startOver: 'Sākt no jauna', tap: 'Pieskarieties, lai sāktu', restarting: (n) => `Atsāknēšana pēc ${n}s`, cabWelcome: "Laipni lūdzam kabīņu novērtējumā.", cabAssess: "Novērtējiet katru transportlīdzekli — lai sāktu, pieskarieties vienam:", cabThanksMsg: "Jūsu kabīņu novērtējumi visiem transportlīdzekļiem ir iesniegti.", idleTitle: "Vai joprojām esat šeit?", idleMsg: "Pēc {n} s tiks atvērts sākuma ekrāns, ja nepaturpināsiet.", idleContinue: "Turpināt" },
    lt: { chooseLanguage: 'Pasirinkite kalbą', welcome: 'Sveiki atvykę į jūsų bandomojo važiavimo vertinimą.', chooseVehicle: 'Pasirinkite savo transporto priemonę:', next: 'Kitas', back: 'Atgal', submit: 'Pateikti', confirmTitle: 'Ar esate tikri?', confirmMsg: 'Po pateikimo negalėsite grįžti atgal ir pakeisti savo atsakymų.', done: 'Atlikta', selectCategory: 'Pasirinkite kategoriją', thanks: 'Ačiū!', submitted: (v) => `Jūsų įvertinimai dėl ${v} buvo pateikti.`, nextCar: 'Kitas sunkvežimis', startOver: 'Pradėti iš naujo', tap: 'Palieskite, kad pradėtumėte', restarting: (n) => `Paleidžiama iš naujo po ${n}s`, cabWelcome: "Sveiki atvykę į kabinų vertinimą.", cabAssess: "Įvertinkite kiekvieną transporto priemonę — norėdami pradėti, palieskite vieną:", cabThanksMsg: "Jūsų kabinų vertinimai visoms transporto priemonėms pateikti.", idleTitle: "Ar vis dar esate čia?", idleMsg: "Po {n} s grįšite į pradžios ekraną, jei nepratęsite.", idleContinue: "Tęsti" },
    lb: { chooseLanguage: 'Sprooch wiele', welcome: 'Wëllkomm bei der Evaluatioun vun Ärer Testfaart.', chooseVehicle: 'Wielt Äert Gefier:', next: 'Weider', back: 'Zréck', submit: 'Schécken', confirmTitle: 'Sidd Dir sécher?', confirmMsg: 'No der Ofschéckung kënnt Dir net méi zréck a är Äntwerte änneren.', thanks: 'Merci!', submitted: (v) => `Är Bewäertunge fir ${v} goufen ofgeschéckt.`, nextCar: 'Nächste LKW', startOver: 'Nei ufänken', tap: 'Tippt fir unzefänken', restarting: (n) => `Neistarten an ${n}s` },
    mk: { chooseLanguage: 'Изберете јазик', welcome: 'Добредојдовте на евалуацијата на вашата тест вожња.', chooseVehicle: 'Изберете го вашето возило:', next: 'Следно', back: 'Назад', submit: 'Испрати', confirmTitle: 'Дали сте сигурни?', confirmMsg: 'Откако ќе испратите, нема да можете да се вратите и да ги промените вашите одговори.', thanks: 'Благодарам!', submitted: (v) => `Вашите оцени за ${v} се испратени.`, nextCar: 'Следен камион', startOver: 'Почни одново', tap: 'Допрете за почеток', restarting: (n) => `Рестартирање за ${n}s` },
    mt: { chooseLanguage: 'Agħżel il-lingwa', welcome: 'Merħba fl-evalwazzjoni tat-test drive tiegħek.', chooseVehicle: 'Agħżel il-vettura tiegħek:', next: 'Li jmiss', back: 'Lura', submit: 'Ibgħat', confirmTitle: 'Int ċert?', confirmMsg: "Ladarba tibgħat, ma tistax terġa' lura biex tibdel it-tweġibiet tiegħek.", thanks: 'Grazzi!', submitted: (v) => `Il-klassifikazzjonijiet tiegħek għal ${v} ġew mibgħuta.`, nextCar: 'It-trakk li jmiss', startOver: 'Ibda mill-ġdid', tap: 'Agħfas biex tibda', restarting: (n) => `Jerġa jibda f'${n}s` },
    no: { chooseLanguage: 'Velg språk', welcome: 'Velkommen til evalueringen av din prøvekjøring.', chooseVehicle: 'Velg ditt kjøretøy:', next: 'Neste', back: 'Tilbake', submit: 'Send inn', confirmTitle: 'Er du sikker?', confirmMsg: 'Når du har sendt inn, kan du ikke gå tilbake og endre svarene dine.', done: 'Ferdig', selectCategory: 'Velg en kategori', thanks: 'Takk!', submitted: (v) => `Dine vurderinger for ${v} er sendt inn.`, nextCar: 'Neste lastebil', startOver: 'Start på nytt', tap: 'Trykk for å starte', restarting: (n) => `Starter på nytt om ${n}s`, cabWelcome: "Velkommen til førerhusvurderingen.", cabAssess: "Vurder hvert kjøretøy — trykk på ett for å starte:", cabThanksMsg: "Dine førerhusvurderinger for alle kjøretøy er sendt inn.", idleTitle: "Er du der fortsatt?", idleMsg: "Tilbake til startskjermen om {n} s, med mindre du fortsetter.", idleContinue: "Fortsett" },
    pl: { chooseLanguage: 'Wybierz język', welcome: 'Witamy w ocenie jazdy próbnej.', chooseVehicle: 'Wybierz swój pojazd:', next: 'Dalej', back: 'Wstecz', submit: 'Wyślij', confirmTitle: 'Czy na pewno?', confirmMsg: "Po wysłaniu nie będzie można wrócić i zmienić odpowiedzi.", done: 'Gotowe', selectCategory: 'Wybierz kategorię', thanks: 'Dziękujemy!', submitted: (v) => `Twoje oceny dla ${v} zostały przesłane.`, nextCar: 'Następna ciężarówka', startOver: 'Zacznij od nowa', tap: 'Dotknij, aby rozpocząć', restarting: (n) => `Ponowne uruchomienie za ${n}s`, cabWelcome: "Witamy w ocenie kabin.", cabAssess: "Proszę ocenić każdy pojazd — aby zacząć, proszę dotknąć jednego:", cabThanksMsg: "Oceny kabin dla wszystkich pojazdów zostały przesłane.", idleTitle: "Czy kontynuować?", idleMsg: "Za {n} s nastąpi powrót do ekranu startowego, jeśli nie zostanie wybrane „Kontynuuj”.", idleContinue: "Kontynuuj" },
    pt: { chooseLanguage: 'Escolha o idioma', welcome: 'Bem-vindo à avaliação do seu test drive.', chooseVehicle: 'Escolha o seu veículo:', next: 'Seguinte', back: 'Voltar', submit: 'Enviar', confirmTitle: 'Tem a certeza?', confirmMsg: 'Depois de enviar não poderá voltar atrás e alterar as suas respostas.', done: 'Concluído', selectCategory: 'Selecione uma categoria', thanks: 'Obrigado!', submitted: (v) => `As suas avaliações de ${v} foram enviadas.`, nextCar: 'Outro veículo', startOver: 'Recomeçar', tap: 'Toque para começar', restarting: (n) => `A reiniciar em ${n}s` , cabWelcome: "Bem-vindo à avaliação das cabines.", cabAssess: "Avalie todos os veículos — toque num deles para começar:", cabThanksMsg: "As suas avaliações de cabine para todos os veículos foram enviadas.", idleTitle: "Ainda está aí?", idleMsg: "Regresso ao ecrã inicial dentro de {n} s, a menos que continue.", idleContinue: "Continuar" },
    ro: { chooseLanguage: 'Alegeți limba', welcome: 'Bun venit la evaluarea test drive-ului dvs.', chooseVehicle: 'Alegeți vehiculul dvs.:', next: 'Următorul', back: 'Înapoi', submit: "Trimiteți", confirmTitle: 'Sunteți sigur?', confirmMsg: 'După trimitere nu vă veți putea întoarce pentru a modifica răspunsurile.', done: 'Finalizat', selectCategory: 'Selectați o categorie', thanks: 'Mulțumesc!', submitted: (v) => `Evaluările dvs. pentru ${v} au fost trimise.`, nextCar: 'Camionul următor', startOver: 'Începeți din nou', tap: 'Atingeți pentru a începe', restarting: (n) => `Repornire în ${n}s`, cabWelcome: "Bun venit la evaluarea cabinelor.", cabAssess: "Evaluați fiecare vehicul — atingeți unul pentru a începe:", cabThanksMsg: "Evaluările dvs. ale cabinelor pentru toate vehiculele au fost trimise.", idleTitle: "Mai sunteți aici?", idleMsg: "Revenire la ecranul de start în {n} s, dacă nu continuați.", idleContinue: "Continuă" },
    ru: { chooseLanguage: 'Выберите язык', welcome: 'Добро пожаловать на оценку вашего тест-драйва.', chooseVehicle: 'Выберите ваш автомобиль:', next: 'Далее', back: 'Назад', submit: 'Отправить', confirmTitle: 'Вы уверены?', confirmMsg: 'После отправки вы не сможете вернуться и изменить свои ответы.', thanks: 'Спасибо!', submitted: (v) => `Ваши оценки для ${v} были отправлены.`, nextCar: 'Следующий грузовик', startOver: 'Начать заново', tap: 'Нажмите для начала', restarting: (n) => `Перезапуск через ${n}с` },
    sr: { chooseLanguage: "Изаберите језик", welcome: "Добродошли у оцену ваше пробне вожње.", chooseVehicle: "Изаберите ваше возило:", next: "Даље", back: "Назад", submit: "Пошаљи", confirmTitle: "Да ли сте сигурни?", confirmMsg: "Након слања нећете моћи да се вратите и промените своје одговоре.", done: "Готово", selectCategory: "Изаберите категорију", thanks: "Хвала!", submitted: (v) => `Vaše ocene za ${v} su poslate.`, nextCar: "Следећи камион", startOver: "Почни изнова", tap: "Додирните за почетак", restarting: (n) => `Pokretanje za ${n}s`, cabWelcome: "Добродошли у оцењивање кабина.", cabAssess: "Оцените свако возило — додирните једно да бисте почели:", cabThanksMsg: "Ваше оцене кабина за сва возила су послате.", idleTitle: "Да ли сте још ту?", idleMsg: "За {n} с враћање на почетни екран, ако не наставите.", idleContinue: "Настави" },
    sk: { chooseLanguage: 'Vyberte jazyk', welcome: 'Vitajte v hodnotení vašej skúšobnej jazdy.', chooseVehicle: 'Vyberte si vozidlo:', next: 'Ďalej', back: 'Späť', submit: 'Odoslať', confirmTitle: 'Ste si istí?', confirmMsg: 'Po odoslaní sa nebudete môcť vrátiť a zmeniť svoje odpovede.', done: 'Hotovo', selectCategory: 'Vyberte kategóriu', thanks: 'Ďakujeme!', submitted: (v) => `Vaše hodnotenia pre ${v} boli odoslané.`, nextCar: 'Ďalší kamión', startOver: 'Začať odznova', tap: 'Klepnite pre spustenie', restarting: (n) => `Reštartovanie za ${n}s`, cabWelcome: "Vitajte v hodnotení kabín.", cabAssess: "Ohodnoťte každé vozidlo — klepnutím na jedno začnite:", cabThanksMsg: "Vaše hodnotenia kabín pre všetky vozidlá boli odoslané.", idleTitle: "Ste tu ešte?", idleMsg: "Za {n} s sa vrátime na úvodnú obrazovku, ak nepokračujete.", idleContinue: "Pokračovať" },
    sl: { chooseLanguage: 'Izberite jezik', welcome: 'Dobrodošli pri ocenjevanju vaše preizkusne vožnje.', chooseVehicle: 'Izberite svoje vozilo:', next: 'Naprej', back: 'Nazaj', submit: "Oddaj", confirmTitle: 'Ali ste prepričani?', confirmMsg: 'Po oddaji se ne boste mogli vrniti in spremeniti svojih odgovorov.', done: 'Končano', selectCategory: 'Izberite kategorijo', thanks: 'Hvala!', submitted: (v) => `Vaše ocene za ${v} so bile poslane.`, nextCar: 'Naslednji tovornjak', startOver: 'Začni znova', tap: 'Dotaknite se za začetek', restarting: (n) => `Ponovni zagon čez ${n} s`, cabWelcome: "Dobrodošli pri ocenjevanju kabin.", cabAssess: "Ocenite vsako vozilo — za začetek se dotaknite enega:", cabThanksMsg: "Vaše ocene kabin za vsa vozila so bile oddane.", idleTitle: "Ste še tam?", idleMsg: "Čez {n} s se vrnemo na začetni zaslon, če ne nadaljujete.", idleContinue: "Nadaljuj" },
    es: { chooseLanguage: 'Elige idioma', welcome: 'Bienvenido a la evaluación de tu prueba de conducción.', chooseVehicle: 'Elige tu vehículo:', next: 'Siguiente', back: 'Atrás', submit: 'Enviar', confirmTitle: '¿Estás seguro?', confirmMsg: 'Una vez enviado no podrás volver atrás para cambiar tus respuestas.', done: 'Listo', selectCategory: 'Selecciona una categoría', thanks: '¡Gracias!', submitted: (v) => `Tus valoraciones de ${v} se han enviado.`, nextCar: 'Otro camión', startOver: 'Reiniciar', tap: 'Toca para empezar', restarting: (n) => `Reiniciando en ${n}s` , cabWelcome: "Bienvenido a la evaluación de cabinas.", cabAssess: "Evalúa todos los vehículos — toca uno para empezar:", cabThanksMsg: "Tus valoraciones de cabina de todos los vehículos se han enviado.", idleTitle: "¿Sigues ahí?", idleMsg: "Volverás a la pantalla de inicio en {n} s si no continúas.", idleContinue: "Continuar" },
    sv: { chooseLanguage: 'Välj språk', welcome: 'Välkommen till utvärderingen av din provkörning.', chooseVehicle: 'Välj ditt fordon:', next: 'Nästa', back: 'Tillbaka', submit: 'Skicka', confirmTitle: 'Är du säker?', confirmMsg: 'När du skickat in kan du inte gå tillbaka och ändra dina svar.', done: 'Klar', selectCategory: 'Välj en kategori', thanks: 'Tack!', submitted: (v) => `Dina betyg för ${v} har skickats.`, nextCar: 'Nästa lastbil', startOver: 'Börja om', tap: 'Tryck för att börja', restarting: (n) => `Startar om om ${n}s`, cabWelcome: "Välkommen till hyttutvärderingen.", cabAssess: "Utvärdera varje fordon — tryck på ett för att börja:", cabThanksMsg: "Dina hyttutvärderingar för alla fordon har skickats.", idleTitle: "Är du kvar?", idleMsg: "Tillbaka till startskärmen om {n} s om du inte fortsätter.", idleContinue: "Fortsätt" },
    tr: { chooseLanguage: 'Dil seçin', welcome: 'Test sürüşü değerlendirmenize hoş geldiniz.', chooseVehicle: 'Aracınızı seçin:', next: 'İleri', back: 'Geri', submit: 'Gönder', confirmTitle: 'Emin misiniz?', confirmMsg: 'Gönderildikten sonra geri dönüp cevaplarınızı değiştiremezsiniz.', thanks: 'Teşekkürler!', submitted: (v) => `${v} için puanlarınız gönderildi.`, nextCar: 'Sonraki kamyon', startOver: 'Yeniden başla', tap: 'Başlamak için dokunun', restarting: (n) => `${n}s içinde yeniden başlatılıyor` },
    uk: { chooseLanguage: 'Виберіть мову', welcome: "Ласкаво просимо до оцінки Вашого тест-драйву.", chooseVehicle: "Виберіть Ваш транспортний засіб:", next: 'Далі', back: 'Назад', submit: 'Надіслати', confirmTitle: 'Ви впевнені?', confirmMsg: "Після надсилання Ви не зможете повернутися і змінити свої відповіді.", done: 'Готово', selectCategory: 'Виберіть категорію', thanks: 'Дякуємо!', submitted: (v) => `Ваші оцінки для ${v} було надіслано.`, nextCar: 'Наступна вантажівка', startOver: 'Почати знову', tap: 'Торкніться для початку', restarting: (n) => `Перезапуск через ${n}с`, cabWelcome: "Ласкаво просимо до оцінки кабін.", cabAssess: "Оцініть кожен транспортний засіб — торкніться одного, щоб почати:", cabThanksMsg: "Ваші оцінки кабін для всіх транспортних засобів надіслано.", idleTitle: "Ви ще тут?", idleMsg: "Через {n} с повернення на початковий екран, якщо Ви не продовжите.", idleContinue: "Продовжити" },
    cy: { chooseLanguage: 'Dewiswch iaith', welcome: 'Croeso i werthusiad eich gyriad prawf.', chooseVehicle: 'Dewiswch eich cerbyd:', next: 'Nesaf', back: 'Yn ôl', submit: 'Cyflwyno', confirmTitle: "Ydych chi'n siŵr?", confirmMsg: 'Ar ôl cyflwyno ni allwch fynd yn ôl a newid eich atebion.', thanks: 'Diolch!', submitted: (v) => `Mae eich sgoriau ar gyfer ${v} wedi eu cyflwyno.`, nextCar: 'Lori nesaf', startOver: 'Dechrau eto', tap: 'Tapiwch i ddechrau', restarting: (n) => `Ailgychwyn mewn ${n}s` },
  };
  const t = () => T[state.lang] || T.en;

  /* ---------- i18n for question content ---------- */
  const QI18N = {
    es: {
      "cab": {"title": "Evaluación de la cabina y el chasis", "instruction": "Realiza un arranque en pendiente desde parado en el tramo de subida.", "metrics": {"cab_assessment": {"label": "Confort de la cabina y la suspensión", "min": "Malo", "max": "Muy bueno"}, "gear_shift": {"label": "Estabilidad de la cabina y el chasis", "min": "Muy inestable", "max": "Muy estable"}}},
      "steering": {"title": "Manejo y estabilidad", "instruction": "Dirección con una mano en el tramo de obras y giros rápidos en el circuito de eslalon. Evalúa la precisión y el control de la dirección.", "metrics": {"steering_precision": {"label": "Precisión y control de la dirección", "min": "Exigente", "max": "Sin esfuerzo"}}},
      "parking": {"title": "Suspensión", "instruction": "Evalúa el confort del chasis y de la cabina al pasar por encima del obstáculo.", "metrics": {"precision_maneuver": {"label": "Confort general", "min": "Muy acusado", "max": "Apenas se nota"}}},
      "category-6-6": {"title": "Cambio de marchas y potencia", "instruction": "Acelera desde baja velocidad. Evalúa el cambio de marchas y la potencia.", "metrics": {"metric": {"label": "Calidad del cambio de marchas", "min": "Brusco", "max": "Suave"}, "metric-0-7084909693441334": {"label": "Potencia", "min": "Aceleración lenta y decreciente", "max": "Aceleración potente y continua"}}},
      "category-7-7": {"title": "Maniobras", "instruction": "Evalúa el aparcamiento de precisión. Para camiones Scania con el modo de maniobra activado.", "metrics": {"manoeuvring_ease": {"label": "Facilidad de manejo", "min": "Impreciso", "max": "Precisión milimétrica"}}},
      "overall": {"title": "Experiencia de conducción global", "instruction": "Una vez completadas todas las tareas, da tu impresión general de conducir este vehículo.", "metrics": {"overall_exp": {"label": "Experiencia de conducción global", "min": "Poco convincente", "max": "Premium"}}},
      "boarding": {"title": "Acceso a la cabina - Lado del conductor", "instruction": "Los tres delegados suben a la cabina por el lado del conductor. \nUno se sienta en el asiento del acompañante, otro en la litera con el iPad y otro en el asiento del conductor.", "metrics": {"boarding_ease": {"label": "Facilidad de acceso", "min": "Muy difícil", "max": "Muy fácil"}, "door_interference": {"label": "Interferencia de la puerta al subir", "min": "Mucha interferencia", "max": "Sin interferencia"}, "metric-0-5584803900479581": {"label": "Facilidad para sentarse en el asiento del conductor", "min": "Muy difícil", "max": "Muy fácil"}}},
      "cross_cab_access": {"title": "Desplazamiento por la cabina", "instruction": "¿Cómo de fácil fue moverse por la cabina? Evalúa el desplazamiento desde el asiento del conductor hasta el asiento del acompañante y la litera. Ten en cuenta aspectos como la interferencia del volante, la consola central, el túnel del motor y los compartimentos portaobjetos superiores delanteros.", "metrics": {"cross_cab_access_ease": {"label": "Desplazamiento por la cabina", "min": "Mucha interferencia", "max": "Sin problemas"}}},
      "ergonomics": {"title": "Ergonomía del conductor - asiento y volante", "instruction": "Intenta encontrar el mayor número posible de posiciones en el volante en las que te resulte cómodo agarrar el volante o apoyar las manos y los codos.", "metrics": {"adjustability": {"label": "Capacidad de ajuste", "min": "Limitada", "max": "Fácil encontrar mi posición ideal"}, "ergonomics_overall": {"label": "¿Cuántas posiciones cómodas para las manos has encontrado?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ergonomía del conductor – Al conducir", "instruction": "Mientras conduces, localiza los botones de las funciones de seguridad activa, el control de crucero y la climatización. Fíjate en dónde están colocados: ¿es intuitivo encontrarlos y alcanzarlos?", "metrics": {"intuitive_reach": {"label": "Intuitivo y fácil de encontrar", "min": "Difícil/desordenado", "max": "Fácil y bien agrupado"}}},
      "fit_finish": {"title": "Habitabilidad – Aspectos prácticos", "instruction": "Desde el asiento del acompañante, levántate para abrir el microondas. Saca el plato y simula una comida sentado a la mesa. Evalúa la comodidad y el espacio para las piernas. \nDesde la litera, busca una posición cómoda para leer.", "metrics": {"living_comfort": {"label": "Comodidad para vivir a bordo", "min": "Limitada", "max": "Muy bien pensada"}}},
      "category-8-8": {"title": "Ajuste y acabado", "instruction": "Echa un vistazo a tu alrededor y evalúa el aspecto y el tacto del interior. Ten en cuenta aspectos como los componentes, el acabado de los materiales textiles y la solidez.", "metrics": {"metric-0-480407108384477": {"label": "Ajuste y acabado", "min": "Deficiente", "max": "Alto"}}},
      "safety": {"title": "Conducción segura – Visión directa", "instruction": "Pide al acompañante que baje del camión, camine a lo largo de la línea amarilla y se detenga en las marcas. \nEvalúa la visión directa desde el asiento del conductor.", "metrics": {"direct_vision": {"label": "Visión directa", "min": "Mala", "max": "Muy buena"}}},
      "cab_exit": {"title": "Salida de la cabina", "instruction": "Abre la puerta y baja de espaldas. \n¿Puedes ver el peldaño superior desde tu asiento? Evalúa lo fácil que es pasar de estar sentado a bajar.", "metrics": {"cab_entry_exit": {"label": "Acceso y salida de la cabina", "min": "Inseguro", "max": "Natural y sin esfuerzo"}}},
    },
    fr: {
      "cab": {"title": "Évaluation de la cabine et du châssis", "instruction": "Effectuez un démarrage en côte, à l'arrêt, sur la section en montée.", "metrics": {"cab_assessment": {"label": "Confort de la cabine et de la suspension", "min": "Médiocre", "max": "Très bon"}, "gear_shift": {"label": "Stabilité de la cabine et du châssis", "min": "Très instable", "max": "Très stable"}}},
      "steering": {"title": "Maniabilité et stabilité", "instruction": "Conduite à une main dans la zone de travaux, puis virages rapides sur le parcours de slalom. Évaluez la précision et le contrôle de la direction.", "metrics": {"steering_precision": {"label": "Précision et contrôle de la direction", "min": "Exigeant", "max": "Sans effort"}}},
      "parking": {"title": "Suspension", "instruction": "Évaluez le confort du châssis et de la cabine en franchissant l'obstacle.", "metrics": {"precision_maneuver": {"label": "Confort général", "min": "Très brutal", "max": "À peine perceptible"}}},
      "category-6-6": {"title": "Passage des vitesses et puissance", "instruction": "Accélérez à basse vitesse. Évaluez le passage des vitesses et la puissance.", "metrics": {"metric": {"label": "Qualité du passage des vitesses", "min": "Brusque", "max": "Fluide"}, "metric-0-7084909693441334": {"label": "Puissance", "min": "Accélération lente et qui faiblit", "max": "Accélération puissante et continue"}}},
      "category-7-7": {"title": "Manœuvres", "instruction": "Évaluez le stationnement de précision. Pour les camions Scania avec le mode manœuvre activé.", "metrics": {"manoeuvring_ease": {"label": "Facilité de maniement", "min": "Imprécis", "max": "Précision millimétrique"}}},
      "overall": {"title": "Expérience de conduite globale", "instruction": "Une fois toutes les tâches accomplies, donnez votre impression générale de conduite de ce véhicule.", "metrics": {"overall_exp": {"label": "Expérience de conduite globale", "min": "Décevante", "max": "Premium"}}},
      "boarding": {"title": "Accès à la cabine - Côté conducteur", "instruction": "Les trois délégués montent dans la cabine par le côté conducteur. \nL'un s'assoit sur le siège passager, un autre sur la couchette avec l'iPad et le troisième sur le siège conducteur.", "metrics": {"boarding_ease": {"label": "Facilité d'accès", "min": "Très difficile", "max": "Très facile"}, "door_interference": {"label": "Gêne de la porte en montant", "min": "Très gênante", "max": "Aucune gêne"}, "metric-0-5584803900479581": {"label": "Facilité pour s'installer sur le siège conducteur", "min": "Très difficile", "max": "Très facile"}}},
      "cross_cab_access": {"title": "Déplacement dans la cabine", "instruction": "Était-il facile de se déplacer dans la cabine ? Évaluez le déplacement du siège conducteur au siège passager et à la couchette. Tenez compte de la gêne causée par le volant, la console centrale, le tunnel moteur et le rangement supérieur avant.", "metrics": {"cross_cab_access_ease": {"label": "Déplacement dans la cabine", "min": "Très gênant", "max": "Sans difficulté"}}},
      "ergonomics": {"title": "Ergonomie du conducteur - siège et volant", "instruction": "Essayez de trouver le plus grand nombre possible de positions sur le volant où il est confortable de tenir ou de poser les mains et les coudes.", "metrics": {"adjustability": {"label": "Possibilités de réglage", "min": "Limitées", "max": "Facile de trouver ma position"}, "ergonomics_overall": {"label": "Combien de positions de mains confortables avez-vous trouvées ?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ergonomie du conducteur – En conduisant", "instruction": "Pendant la conduite, repérez les boutons des fonctions de sécurité active, du régulateur de vitesse et de la climatisation. Concentrez-vous sur leur emplacement : est-il intuitif de les trouver et de les atteindre ?", "metrics": {"intuitive_reach": {"label": "Intuitif et facile à trouver", "min": "Difficile/désordonné", "max": "Facile et bien regroupé"}}},
      "fit_finish": {"title": "Vie à bord – Aspects pratiques", "instruction": "Depuis le siège passager, levez-vous pour ouvrir le micro-ondes. Sortez l'assiette et simulez un repas assis à la table. Évaluez le confort et l'espace pour les jambes. \nDepuis la couchette, trouvez une position de lecture confortable.", "metrics": {"living_comfort": {"label": "Confort de vie à bord", "min": "Limité", "max": "Bien pensé"}}},
      "category-8-8": {"title": "Assemblage et finition", "instruction": "Jetez un coup d'œil autour de vous et évaluez l'aspect et le toucher de l'intérieur. Tenez compte, par exemple, des composants, de la finition des textiles et de la solidité.", "metrics": {"metric-0-480407108384477": {"label": "Qualité d'assemblage et de finition", "min": "Médiocre", "max": "Élevée"}}},
      "safety": {"title": "Conduite sûre – Vision directe", "instruction": "Demandez au passager de descendre du camion, de marcher le long de la ligne jaune et de s'arrêter aux repères. \nÉvaluez la vision directe depuis le siège conducteur.", "metrics": {"direct_vision": {"label": "Vision directe", "min": "Mauvaise", "max": "Très bonne"}}},
      "cab_exit": {"title": "Sortie de la cabine", "instruction": "Ouvrez la porte et descendez en tournant le dos vers l'extérieur. \nVoyez-vous la marche supérieure depuis votre siège ? Évaluez la facilité à passer de la position assise à la sortie.", "metrics": {"cab_entry_exit": {"label": "Accès et sortie de la cabine", "min": "Peu sûr", "max": "Naturel et sans effort"}}},
    },
    pt: {
      "cab": {"title": "Avaliação da cabine e do chassis", "instruction": "Arranque em subida, a partir de parado, no troço em subida.", "metrics": {"cab_assessment": {"label": "Conforto da cabine e da suspensão", "min": "Fraco", "max": "Muito bom"}, "gear_shift": {"label": "Estabilidade da cabine e do chassis", "min": "Muito instável", "max": "Muito estável"}}},
      "steering": {"title": "Manobrabilidade e estabilidade", "instruction": "Condução com uma mão na zona de obras e curvas rápidas no percurso de slalom. Avalie a precisão e o controlo da direção.", "metrics": {"steering_precision": {"label": "Precisão e controlo da direção", "min": "Exigente", "max": "Sem esforço"}}},
      "parking": {"title": "Suspensão", "instruction": "Avalie o conforto do chassis e da cabine ao passar sobre o obstáculo.", "metrics": {"precision_maneuver": {"label": "Conforto geral", "min": "Muito acentuado", "max": "Quase impercetível"}}},
      "category-6-6": {"title": "Passagem de mudanças e potência", "instruction": "Acelere a baixa velocidade. Avalie a passagem de mudanças e a potência.", "metrics": {"metric": {"label": "Qualidade da passagem de mudanças", "min": "Brusco", "max": "Suave"}, "metric-0-7084909693441334": {"label": "Potência", "min": "Aceleração lenta e decrescente", "max": "Aceleração potente e contínua"}}},
      "category-7-7": {"title": "Manobras", "instruction": "Avalie o estacionamento de precisão. Para camiões Scania com o modo de manobra ativo.", "metrics": {"manoeuvring_ease": {"label": "Facilidade de manobra", "min": "Impreciso", "max": "Precisão milimétrica"}}},
      "overall": {"title": "Experiência de condução geral", "instruction": "Depois de concluídas todas as tarefas, dê a sua impressão geral sobre a condução deste veículo.", "metrics": {"overall_exp": {"label": "Experiência de condução geral", "min": "Pouco convincente", "max": "Premium"}}},
      "boarding": {"title": "Entrada na cabine - Lado do condutor", "instruction": "Os três delegados entram na cabine pelo lado do condutor. \nUm senta-se no banco do passageiro, outro na cama com o iPad e outro no banco do condutor.", "metrics": {"boarding_ease": {"label": "Facilidade de entrada", "min": "Muito difícil", "max": "Muito fácil"}, "door_interference": {"label": "Interferência da porta ao subir", "min": "Muita interferência", "max": "Sem interferência"}, "metric-0-5584803900479581": {"label": "Facilidade em sentar-se no banco do condutor", "min": "Muito difícil", "max": "Muito fácil"}}},
      "cross_cab_access": {"title": "Circulação na cabine", "instruction": "Foi fácil deslocar-se na cabine? Avalie o movimento do banco do condutor para o banco do passageiro e para a cama. Tenha em conta aspetos como a interferência do volante, da consola central, do túnel do motor e da arrumação superior dianteira.", "metrics": {"cross_cab_access_ease": {"label": "Circulação na cabine", "min": "Muita interferência", "max": "Sem problemas"}}},
      "ergonomics": {"title": "Ergonomia do condutor - banco e volante", "instruction": "Tente encontrar o maior número possível de posições no volante em que se sinta confortável a segurar ou a apoiar as mãos e os cotovelos.", "metrics": {"adjustability": {"label": "Capacidade de ajuste", "min": "Limitada", "max": "Fácil de encontrar a minha posição ideal"}, "ergonomics_overall": {"label": "Quantas posições confortáveis para as mãos conseguiu encontrar?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ergonomia do condutor – Durante a condução", "instruction": "Durante a condução, localize os botões das funções de segurança ativa, do controlo de velocidade de cruzeiro e da climatização. Concentre-se na sua localização: é intuitivo encontrá-los e alcançá-los?", "metrics": {"intuitive_reach": {"label": "Intuitivo e fácil de encontrar", "min": "Difícil/desorganizado", "max": "Fácil e bem agrupado"}}},
      "fit_finish": {"title": "Habitabilidade – Aspetos práticos", "instruction": "A partir do banco do passageiro, levante-se para abrir o micro-ondas. Retire o prato e simule uma refeição sentado à mesa. Avalie o conforto e o espaço para as pernas. \nA partir da cama, encontre uma posição confortável para ler.", "metrics": {"living_comfort": {"label": "Habitabilidade", "min": "Limitada", "max": "Bem pensada"}}},
      "category-8-8": {"title": "Ajuste e acabamento", "instruction": "Dê uma vista de olhos à sua volta e avalie o aspeto e o toque do interior. Tenha em conta aspetos como os componentes, o acabamento dos materiais têxteis e a solidez.", "metrics": {"metric-0-480407108384477": {"label": "Ajuste e acabamento", "min": "Fraco", "max": "Elevado"}}},
      "safety": {"title": "Condução segura – Visão direta", "instruction": "Peça ao passageiro que saia do camião, caminhe ao longo da linha amarela e pare nas marcas. \nAvalie a visão direta a partir do banco do condutor.", "metrics": {"direct_vision": {"label": "Visão direta", "min": "Fraca", "max": "Muito boa"}}},
      "cab_exit": {"title": "Saída da cabine", "instruction": "Abra a porta e saia de costas. \nConsegue ver o degrau superior a partir do seu banco? Avalie a facilidade de passar da posição sentada para a saída.", "metrics": {"cab_entry_exit": {"label": "Entrada e saída da cabine", "min": "Pouco seguro", "max": "Natural e sem esforço"}}},
    },
    sv: {
      "cab": {"title": "Utvärdering av hytt och chassi", "instruction": "Starta från stillastående i uppförsbacken.", "metrics": {"cab_assessment": {"label": "Komfort i hytt och fjädring", "min": "Dålig", "max": "Mycket bra"}, "gear_shift": {"label": "Stabilitet i hytt och chassi", "min": "Mycket instabil", "max": "Mycket stabil"}}},
      "steering": {"title": "Köregenskaper och stabilitet", "instruction": "Kör med en hand genom vägarbetet och i snabba svängar på slalombanan. Utvärdera styrningens precision och kontroll.", "metrics": {"steering_precision": {"label": "Styrningens precision och kontroll", "min": "Krävande", "max": "Utan ansträngning"}}},
      "parking": {"title": "Fjädring", "instruction": "Utvärdera chassits och hyttens komfort när du kör över hindret.", "metrics": {"precision_maneuver": {"label": "Övergripande komfort", "min": "Mycket påtaglig", "max": "Knappt märkbar"}}},
      "category-6-6": {"title": "Växling och prestanda", "instruction": "Accelerera från låg hastighet. Utvärdera växlingen och kraften.", "metrics": {"metric": {"label": "Växlingskvalitet", "min": "Ryckig", "max": "Mjuk"}, "metric-0-7084909693441334": {"label": "Kraft", "min": "Långsam och avtagande acceleration", "max": "Kraftfull och jämn acceleration"}}},
      "category-7-7": {"title": "Manövrering", "instruction": "Utvärdera precisionsparkering. För Scania-lastbilar med manöverläget aktivt.", "metrics": {"manoeuvring_ease": {"label": "Manövrerbarhet", "min": "Oprecis", "max": "Millimeterprecis"}}},
      "overall": {"title": "Övergripande körupplevelse", "instruction": "Efter att ha slutfört alla uppgifter, ge ditt samlade intryck av att köra det här fordonet.", "metrics": {"overall_exp": {"label": "Övergripande körupplevelse", "min": "Föga imponerande", "max": "Premium"}}},
      "boarding": {"title": "Att kliva in i hytten - Förarsidan", "instruction": "Alla tre delegater kliver in i hytten från förarsidan. \nEn sitter i passagerarsätet, en på kojen med iPaden och en i förarsätet.", "metrics": {"boarding_ease": {"label": "Hur lätt det är att kliva in", "min": "Mycket svårt", "max": "Mycket lätt"}, "door_interference": {"label": "Hur mycket dörren är i vägen när du kliver in", "min": "Mycket i vägen", "max": "Inte i vägen"}, "metric-0-5584803900479581": {"label": "Hur lätt det är att sätta sig i förarsätet", "min": "Mycket svårt", "max": "Mycket lätt"}}},
      "cross_cab_access": {"title": "Förflyttning i hytten", "instruction": "Hur lätt var det att röra sig i hytten? Utvärdera förflyttningen från förarsätet till passagerarsätet och kojen. Ta hänsyn till hinder som ratt, mittkonsol, motortunnel och det främre övre förvaringsutrymmet.", "metrics": {"cross_cab_access_ease": {"label": "Förflyttning i hytten", "min": "Mycket krångligt", "max": "Helt problemfritt"}}},
      "ergonomics": {"title": "Förarergonomi - säte och ratt", "instruction": "Försök hitta så många lägen som möjligt på ratten där det känns bekvämt att hålla eller vila händerna och armbågarna.", "metrics": {"adjustability": {"label": "Justerbarhet", "min": "Begränsande", "max": "Lätt att hitta mitt läge"}, "ergonomics_overall": {"label": "Hur många bekväma handlägen hittade du?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Förarergonomi – Under körning", "instruction": "Leta under körning upp knapparna för aktiva säkerhetsfunktioner, farthållare och klimatanläggning. Fokusera på var de sitter: är det intuitivt att hitta och nå dem?", "metrics": {"intuitive_reach": {"label": "Intuitivt och lätt att hitta", "min": "Svårt/rörigt", "max": "Lätt och väl grupperat"}}},
      "fit_finish": {"title": "Boende i hytten – Praktiskt", "instruction": "Res dig från passagerarsätet och öppna mikrovågsugnen. Ta ut tallriken och simulera en måltid sittande vid bordet. Utvärdera komfort och benutrymme. \nHitta ett bekvämt läge för att läsa i kojen.", "metrics": {"living_comfort": {"label": "Boendekomfort", "min": "Begränsad", "max": "Väl genomtänkt"}}},
      "category-8-8": {"title": "Passform och finish", "instruction": "Titta dig omkring och utvärdera hur interiören ser ut och känns. Ta hänsyn till exempelvis komponenter, textilernas finish och robusthet.", "metrics": {"metric-0-480407108384477": {"label": "Passform och finish", "min": "Dålig", "max": "Hög"}}},
      "safety": {"title": "Säker körning – Direkt sikt", "instruction": "Låt passageraren kliva ut ur lastbilen, gå längs den gula linjen och stanna vid markeringarna. \nUtvärdera den direkta sikten från förarsätet.", "metrics": {"direct_vision": {"label": "Direkt sikt", "min": "Dålig", "max": "Mycket bra"}}},
      "cab_exit": {"title": "Utstigning ur hytten", "instruction": "Öppna dörren och kliv ut med ryggen utåt. \nKan du se det översta trappsteget från ditt säte? Utvärdera hur lätt det är att ta sig från sittande till utstigning.", "metrics": {"cab_entry_exit": {"label": "In- och utstigning", "min": "Otryggt", "max": "Naturligt och enkelt"}}},
    },
    bg: {
      "cab": {"title": "Оценка на кабината и шасито", "instruction": "Тръгнете от място по нагорнището.", "metrics": {"cab_assessment": {"label": "Комфорт на кабината и окачването", "min": "Лош", "max": "Много добър"}, "gear_shift": {"label": "Стабилност на кабината и шасито", "min": "Много нестабилна", "max": "Много надеждна"}}},
      "steering": {"title": "Управляемост и стабилност", "instruction": "Управление с една ръка през участъка с пътни работи и бързи завои по слалом трасето. Оценете точността и контрола на управлението.", "metrics": {"steering_precision": {"label": "Точност и контрол на управлението", "min": "Изискващо", "max": "Без усилие"}}},
      "parking": {"title": "Окачване", "instruction": "Оценете комфорта на шасито и кабината при преминаване през препятствието.", "metrics": {"precision_maneuver": {"label": "Общ комфорт", "min": "Много усетно", "max": "Едва забележимо"}}},
      "category-6-6": {"title": "Смяна на предавките и динамика", "instruction": "Ускорете от ниска скорост. Оценете смяната на предавките и мощността.", "metrics": {"metric": {"label": "Качество на смяната на предавките", "min": "Резка", "max": "Плавна"}, "metric-0-7084909693441334": {"label": "Мощност", "min": "Бавно и затихващо ускорение", "max": "Мощно и непрекъснато ускорение"}}},
      "category-7-7": {"title": "Маневриране", "instruction": "Оценете прецизното паркиране. За камиони Scania с активен режим на маневриране.", "metrics": {"manoeuvring_ease": {"label": "Лекота на маневриране", "min": "Неточно", "max": "Точно до милиметър"}}},
      "overall": {"title": "Общо впечатление от шофирането", "instruction": "След като изпълните всички задачи, дайте общото си впечатление от управлението на това превозно средство.", "metrics": {"overall_exp": {"label": "Общо впечатление от шофирането", "min": "Разочароващо", "max": "Премиум"}}},
      "boarding": {"title": "Качване в кабината - Страна на водача", "instruction": "И тримата делегати се качват в кабината откъм страната на водача. \nЕдин седи на седалката на пътника, един на спалното място с iPad, а един на седалката на водача.", "metrics": {"boarding_ease": {"label": "Лекота на качване", "min": "Много трудно", "max": "Много лесно"}, "door_interference": {"label": "Вратата пречи при качване", "min": "Много пречи", "max": "Не пречи"}, "metric-0-5584803900479581": {"label": "Лекота на сядане на седалката на водача", "min": "Много трудно", "max": "Много лесно"}}},
      "cross_cab_access": {"title": "Придвижване в кабината", "instruction": "Беше ли лесно да се придвижвате в кабината? Оценете преминаването от седалката на водача към седалката на пътника и спалното място. Вземете предвид препятствия като волана, централната конзола, тунела на двигателя и предното горно място за съхранение.", "metrics": {"cross_cab_access_ease": {"label": "Придвижване в кабината", "min": "Много затруднено", "max": "Без затруднения"}}},
      "ergonomics": {"title": "Ергономия на водача - седалка и волан", "instruction": "Опитайте се да намерите колкото се може повече позиции на волана, в които е удобно да държите ръцете си или да опирате ръцете и лактите си.", "metrics": {"adjustability": {"label": "Регулиране", "min": "Ограничено", "max": "Лесно намирам позицията си"}, "ergonomics_overall": {"label": "Колко удобни позиции за ръцете намерихте?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ергономия на водача – По време на шофиране", "instruction": "По време на шофиране намерете бутоните за активните функции за безопасност, круиз контрола и климатичната система. Обърнете внимание къде са разположени: интуитивно ли е да ги намерите и достигнете?", "metrics": {"intuitive_reach": {"label": "Интуитивно и лесно за намиране", "min": "Трудно/разхвърляно", "max": "Лесно и добре групирано"}}},
      "fit_finish": {"title": "Живот в кабината – Практичност", "instruction": "От седалката на пътника станете и отворете микровълновата печка. Извадете чинията и симулирайте хранене на масата в седнало положение. Оценете комфорта и пространството за краката. \nОт спалното място намерете удобна поза за четене.", "metrics": {"living_comfort": {"label": "Комфорт при живот в кабината", "min": "Ограничен", "max": "Добре обмислен"}}},
      "category-8-8": {"title": "Качество на изработката и обработката", "instruction": "Огледайте се и оценете външния вид и усещането на интериора. Вземете предвид например компонентите, обработката на текстила и здравината.", "metrics": {"metric-0-480407108384477": {"label": "Качество на изработката и обработката", "min": "Ниско", "max": "Високо"}}},
      "safety": {"title": "Безопасно шофиране – Пряка видимост", "instruction": "Помолете пътника да слезе от камиона, да върви по жълтата линия и да спре при маркировките. \nОценете преката видимост от седалката на водача.", "metrics": {"direct_vision": {"label": "Пряка видимост", "min": "Лоша", "max": "Много добра"}}},
      "cab_exit": {"title": "Слизане от кабината", "instruction": "Отворете вратата и слезте с гръб навън. \nВиждате ли най-горното стъпало от седалката си? Оценете колко лесно е да преминете от седнало положение към слизане.", "metrics": {"cab_entry_exit": {"label": "Качване и слизане от кабината", "min": "Небезопасно", "max": "Естествено и без усилие"}}},
    },
    cs: {
      "cab": {"title": "Hodnocení kabiny a podvozku", "instruction": "Rozjezd z místa na stoupání.", "metrics": {"cab_assessment": {"label": "Pohodlí kabiny a odpružení", "min": "Špatné", "max": "Velmi dobré"}, "gear_shift": {"label": "Stabilita kabiny a podvozku", "min": "Velmi nestabilní", "max": "Velmi spolehlivá"}}},
      "steering": {"title": "Ovladatelnost a stabilita", "instruction": "Řízení jednou rukou v úseku se silničními pracemi a rychlé zatáčky na slalomové dráze. Posuďte přesnost a ovladatelnost řízení.", "metrics": {"steering_precision": {"label": "Přesnost a ovladatelnost řízení", "min": "Náročné", "max": "Bez námahy"}}},
      "parking": {"title": "Odpružení", "instruction": "Posuďte komfort podvozku a kabiny při přejezdu překážky.", "metrics": {"precision_maneuver": {"label": "Celkový komfort", "min": "Velmi znatelné", "max": "Sotva patrné"}}},
      "category-6-6": {"title": "Řazení a výkon", "instruction": "Zrychlete z nízké rychlosti. Posuďte řazení a výkon.", "metrics": {"metric": {"label": "Kvalita řazení", "min": "Trhavé", "max": "Plynulé"}, "metric-0-7084909693441334": {"label": "Výkon", "min": "Pomalé a slábnoucí zrychlení", "max": "Silné a plynulé zrychlení"}}},
      "category-7-7": {"title": "Manévrování", "instruction": "Posuďte přesnost parkování. Pro nákladní vozy Scania s aktivním manévrovacím režimem.", "metrics": {"manoeuvring_ease": {"label": "Snadnost manévrování", "min": "Nepřesné", "max": "Přesné na milimetry"}}},
      "overall": {"title": "Celkový dojem z jízdy", "instruction": "Po dokončení všech úkolů uveďte svůj celkový dojem z jízdy s tímto vozidlem.", "metrics": {"overall_exp": {"label": "Celkový dojem z jízdy", "min": "Nepůsobivý", "max": "Prémiový"}}},
      "boarding": {"title": "Nástup do kabiny - Strana řidiče", "instruction": "Všichni tři delegáti nastupují do kabiny ze strany řidiče. \nJeden sedí na sedadle spolujezdce, jeden na lůžku s iPadem a jeden na sedadle řidiče.", "metrics": {"boarding_ease": {"label": "Snadnost nástupu", "min": "Velmi obtížný", "max": "Velmi snadný"}, "door_interference": {"label": "Překážení dveří při nástupu", "min": "Velmi překážejí", "max": "Nepřekážejí"}, "metric-0-5584803900479581": {"label": "Snadnost usednutí na sedadlo řidiče", "min": "Velmi obtížné", "max": "Velmi snadné"}}},
      "cross_cab_access": {"title": "Pohyb v kabině", "instruction": "Bylo snadné pohybovat se v kabině? Posuďte přesun ze sedadla řidiče na sedadlo spolujezdce a na lůžko. Zohledněte překážky, jako je volant, středová konzole, motorový tunel a přední horní úložný prostor.", "metrics": {"cross_cab_access_ease": {"label": "Pohyb v kabině", "min": "Velmi omezený", "max": "Bez potíží"}}},
      "ergonomics": {"title": "Ergonomie řidiče - sedadlo a volant", "instruction": "Zkuste najít co nejvíce poloh na volantu, ve kterých je pohodlné držet nebo opřít ruce a lokty.", "metrics": {"adjustability": {"label": "Nastavitelnost", "min": "Omezující", "max": "Snadno najdu svou polohu"}, "ergonomics_overall": {"label": "Kolik pohodlných poloh rukou jste našli?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ergonomie řidiče – Při jízdě", "instruction": "Během jízdy vyhledejte tlačítka aktivních bezpečnostních funkcí, tempomatu a klimatizace. Všímejte si, kde se nacházejí: dají se intuitivně najít a snadno na ně dosáhnout?", "metrics": {"intuitive_reach": {"label": "Intuitivní a snadno dostupné", "min": "Obtížné/nepřehledné", "max": "Snadné a dobře seskupené"}}},
      "fit_finish": {"title": "Bydlení – Praktičnost", "instruction": "Ze sedadla spolujezdce vstaňte a otevřete mikrovlnnou troubu. Vyjměte talíř a nasimulujte jídlo vsedě u stolu. Posuďte pohodlí a prostor pro nohy. \nZ lůžka najděte pohodlnou polohu pro čtení.", "metrics": {"living_comfort": {"label": "Komfort bydlení", "min": "Omezený", "max": "Promyšlený"}}},
      "category-8-8": {"title": "Provedení a zpracování", "instruction": "Rozhlédněte se a posuďte vzhled a dojem z interiéru. Zohledněte například komponenty, zpracování textilií a pevnost.", "metrics": {"metric-0-480407108384477": {"label": "Provedení a zpracování", "min": "Špatné", "max": "Vysoké"}}},
      "safety": {"title": "Bezpečná jízda – Přímý výhled", "instruction": "Nechte spolujezdce vystoupit z vozu, jít podél žluté čáry a zastavit u značek. \nPosuďte přímý výhled ze sedadla řidiče.", "metrics": {"direct_vision": {"label": "Přímý výhled", "min": "Špatný", "max": "Velmi dobrý"}}},
      "cab_exit": {"title": "Výstup z kabiny", "instruction": "Otevřete dveře a vystupte zády ven. \nVidíte ze svého sedadla nejvyšší schod? Posuďte, jak snadné je přejít z polohy vsedě k výstupu.", "metrics": {"cab_entry_exit": {"label": "Nástup do kabiny a výstup z ní", "min": "Nebezpečný", "max": "Přirozený a bez námahy"}}},
    },
    da: {
      "cab": {"title": "Vurdering af førerhus og chassis", "instruction": "Start fra stilstand på stigningen.", "metrics": {"cab_assessment": {"label": "Komfort i førerhus og affjedring", "min": "Dårlig", "max": "Meget god"}, "gear_shift": {"label": "Stabilitet i førerhus og chassis", "min": "Meget ustabil", "max": "Meget pålidelig"}}},
      "steering": {"title": "Køreegenskaber og stabilitet", "instruction": "Kørsel med én hånd gennem vejarbejdet og hurtige sving på slalombanen. Vurder styrepræcision og kontrol.", "metrics": {"steering_precision": {"label": "Styrepræcision og kontrol", "min": "Krævende", "max": "Ubesværet"}}},
      "parking": {"title": "Affjedring", "instruction": "Vurder komforten i chassis og førerhus, når du kører over forhindringen.", "metrics": {"precision_maneuver": {"label": "Samlet komfort", "min": "Meget mærkbar", "max": "Næsten umærkelig"}}},
      "category-6-6": {"title": "Gearskift og ydeevne", "instruction": "Accelerer fra lav hastighed. Vurder gearskift og kraft.", "metrics": {"metric": {"label": "Gearskiftets kvalitet", "min": "Rykkende", "max": "Jævnt"}, "metric-0-7084909693441334": {"label": "Kraft", "min": "Langsom og aftagende acceleration", "max": "Kraftig og jævn acceleration"}}},
      "category-7-7": {"title": "Manøvrering", "instruction": "Vurder præcisionsparkering. Til Scania-lastbiler med aktiv manøvretilstand.", "metrics": {"manoeuvring_ease": {"label": "Let at manøvrere", "min": "Upræcis", "max": "Millimeterpræcis"}}},
      "overall": {"title": "Samlet køreoplevelse", "instruction": "Når du har gennemført alle opgaver, kan du give dit samlede indtryk af at køre dette køretøj.", "metrics": {"overall_exp": {"label": "Samlet køreoplevelse", "min": "Skuffende", "max": "Premium"}}},
      "boarding": {"title": "Indstigning i førerhuset - Førersiden", "instruction": "Alle tre delegerede stiger op i førerhuset fra førersiden. \nÉn sidder på passagersædet, én på køjen med iPad'en, og én på førersædet.", "metrics": {"boarding_ease": {"label": "Let at stige ind", "min": "Meget svært", "max": "Meget let"}, "door_interference": {"label": "Gene fra døren ved indstigning", "min": "Meget generende", "max": "Ingen gene"}, "metric-0-5584803900479581": {"label": "Let at sætte sig på førersædet", "min": "Meget svært", "max": "Meget let"}}},
      "cross_cab_access": {"title": "Bevægelse i førerhuset", "instruction": "Var det let at bevæge sig rundt i førerhuset? Vurder bevægelsen fra førersædet til passagersædet og køjen. Tag højde for gener fra rat, midterkonsol, motortunnel og det øverste opbevaringsrum foran.", "metrics": {"cross_cab_access_ease": {"label": "Bevægelse i førerhuset", "min": "Meget generende", "max": "Uden besvær"}}},
      "ergonomics": {"title": "Førerergonomi - sæde og rat", "instruction": "Prøv at finde så mange positioner på rattet som muligt, hvor det er behageligt at holde eller hvile hænder og albuer.", "metrics": {"adjustability": {"label": "Justerbarhed", "min": "Begrænsende", "max": "Let at finde min position"}, "ergonomics_overall": {"label": "Hvor mange behagelige håndpositioner kunne du finde?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Førerergonomi – Under kørsel", "instruction": "Find under kørslen knapperne til aktive sikkerhedsfunktioner, fartpilot og klimaanlæg. Læg mærke til, hvor de sidder: er det intuitivt at finde og række ud efter dem?", "metrics": {"intuitive_reach": {"label": "Intuitivt og let at finde", "min": "Svært/rodet", "max": "Let og godt grupperet"}}},
      "fit_finish": {"title": "Ophold i førerhuset – Praktiske forhold", "instruction": "Rejs dig fra passagersædet og åbn mikroovnen. Tag tallerkenen ud og simuler et måltid ved bordet. Vurder komfort og benplads. \nFind en behagelig læseposition i køjen.", "metrics": {"living_comfort": {"label": "Opholdskomfort", "min": "Begrænset", "max": "Gennemtænkt"}}},
      "category-8-8": {"title": "Pasform og finish", "instruction": "Se dig omkring og vurder indretningens udseende og fornemmelse. Tag fx højde for komponenter, stoffernes finish og robusthed.", "metrics": {"metric-0-480407108384477": {"label": "Pasform og finish", "min": "Dårlig", "max": "Høj"}}},
      "safety": {"title": "Sikker kørsel – Direkte udsyn", "instruction": "Lad passageren stige ud af lastbilen, gå langs den gule linje og stoppe ved markeringerne. \nVurder det direkte udsyn fra førersædet.", "metrics": {"direct_vision": {"label": "Direkte udsyn", "min": "Dårligt", "max": "Meget godt"}}},
      "cab_exit": {"title": "Udstigning fra førerhuset", "instruction": "Åbn døren og stig ud med ryggen udad. \nKan du se det øverste trin fra dit sæde? Vurder, hvor let det er at komme fra siddende stilling til at stige ud.", "metrics": {"cab_entry_exit": {"label": "Indstigning og udstigning", "min": "Utryg", "max": "Naturlig og ubesværet"}}},
    },
    nl: {
      "cab": {"title": "Beoordeling van cabine en chassis", "instruction": "Optrekken vanuit stilstand op het hellende gedeelte.", "metrics": {"cab_assessment": {"label": "Comfort van cabine en vering", "min": "Slecht", "max": "Zeer goed"}, "gear_shift": {"label": "Stabiliteit van cabine en chassis", "min": "Zeer onstabiel", "max": "Zeer betrouwbaar"}}},
      "steering": {"title": "Rijgedrag en stabiliteit", "instruction": "Eenhandig sturen door de wegwerkzaamheden en snelle bochten op het slalomparcours. Beoordeel de stuurnauwkeurigheid en de controle.", "metrics": {"steering_precision": {"label": "Stuurnauwkeurigheid en controle", "min": "Veeleisend", "max": "Moeiteloos"}}},
      "parking": {"title": "Vering", "instruction": "Beoordeel het comfort van chassis en cabine bij het rijden over het obstakel.", "metrics": {"precision_maneuver": {"label": "Algemeen comfort", "min": "Zeer voelbaar", "max": "Nauwelijks merkbaar"}}},
      "category-6-6": {"title": "Schakelen en vermogen", "instruction": "Trek op vanaf lage snelheid. Beoordeel het schakelen en het vermogen.", "metrics": {"metric": {"label": "Schakelgedrag", "min": "Schokkerig", "max": "Soepel"}, "metric-0-7084909693441334": {"label": "Vermogen", "min": "Trage, wegvallende acceleratie", "max": "Krachtige, continue acceleratie"}}},
      "category-7-7": {"title": "Manoeuvreren", "instruction": "Beoordeel de nauwkeurigheid bij het parkeren. Voor Scania-trucks met actieve manoeuvreermodus.", "metrics": {"manoeuvring_ease": {"label": "Gemak van manoeuvreren", "min": "Onnauwkeurig", "max": "Millimeternauwkeurig"}}},
      "overall": {"title": "Algemene rijervaring", "instruction": "Geef na het voltooien van alle taken uw algemene indruk van het rijden met dit voertuig.", "metrics": {"overall_exp": {"label": "Algemene rijervaring", "min": "Weinig indrukwekkend", "max": "Premium"}}},
      "boarding": {"title": "Instappen in de cabine - Bestuurderszijde", "instruction": "Alle drie de afgevaardigden stappen aan de bestuurderszijde in de cabine. \nÉén zit op de bijrijdersstoel, één op de slaapplaats met de iPad en één op de bestuurdersstoel.", "metrics": {"boarding_ease": {"label": "Gemak van instappen", "min": "Zeer moeilijk", "max": "Zeer gemakkelijk"}, "door_interference": {"label": "Hinder van de deur tijdens het instappen", "min": "Zeer hinderlijk", "max": "Geen hinder"}, "metric-0-5584803900479581": {"label": "Gemak van plaatsnemen op de bestuurdersstoel", "min": "Zeer moeilijk", "max": "Zeer gemakkelijk"}}},
      "cross_cab_access": {"title": "Doorstappen in de cabine", "instruction": "Hoe gemakkelijk kon u zich door de cabine verplaatsen? Beoordeel de verplaatsing van de bestuurdersstoel naar de bijrijdersstoel en de slaapplaats. Houd rekening met hinder door het stuurwiel, de middenconsole, de motortunnel en de bovenste opbergruimte voorin.", "metrics": {"cross_cab_access_ease": {"label": "Doorstappen in de cabine", "min": "Zeer hinderlijk", "max": "Zonder moeite"}}},
      "ergonomics": {"title": "Ergonomie van de bestuurder - stoel en stuurwiel", "instruction": "Probeer zoveel mogelijk posities op het stuurwiel te vinden waar u uw handen comfortabel kunt vasthouden of uw handen en ellebogen kunt laten rusten.", "metrics": {"adjustability": {"label": "Verstelbaarheid", "min": "Beperkend", "max": "Eenvoudig naar voorkeur in te stellen"}, "ergonomics_overall": {"label": "Hoeveel comfortabele handposities kon u vinden?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ergonomie van de bestuurder – Tijdens het rijden", "instruction": "Zoek tijdens het rijden de knoppen voor actieve veiligheidsfuncties, cruisecontrol en klimaatregeling. Let op waar ze zitten: is het intuïtief om ze te vinden en te bereiken?", "metrics": {"intuitive_reach": {"label": "Intuïtief en gemakkelijk te vinden", "min": "Moeilijk/rommelig", "max": "Gemakkelijk en goed gegroepeerd"}}},
      "fit_finish": {"title": "Wonen – Praktische aspecten", "instruction": "Sta vanaf de bijrijdersstoel op om de magnetron te openen. Pak het bord eruit en simuleer een maaltijd aan tafel. Beoordeel comfort en beenruimte. \nZoek in het bed een comfortabele leespositie.", "metrics": {"living_comfort": {"label": "Leefcomfort", "min": "Beperkt", "max": "Goed doordacht"}}},
      "category-8-8": {"title": "Passing en afwerking", "instruction": "Kijk rond en beoordeel de uitstraling en het aanvoelen van het interieur. Denk aan onderdelen, de afwerking van de bekleding en de stevigheid.", "metrics": {"metric-0-480407108384477": {"label": "Passing en afwerking", "min": "Slecht", "max": "Hoog"}}},
      "safety": {"title": "Veilig rijden – Direct zicht", "instruction": "Laat de passagier uit de truck stappen, langs de gele lijn lopen en bij de markeringen stoppen. \nBeoordeel het directe zicht vanaf de bestuurdersstoel.", "metrics": {"direct_vision": {"label": "Direct zicht", "min": "Slecht", "max": "Zeer goed"}}},
      "cab_exit": {"title": "Uitstappen uit de cabine", "instruction": "Open de deur en stap uit met uw rug naar buiten gekeerd. \nKunt u de bovenste trede vanaf uw stoel zien? Beoordeel hoe gemakkelijk het is om vanuit zittende positie uit te stappen.", "metrics": {"cab_entry_exit": {"label": "In- en uitstappen", "min": "Onveilig", "max": "Natuurlijk en moeiteloos"}}},
    },
    et: {
      "cab": {"title": "Kabiini ja šassii hindamine", "instruction": "Alustage paigalt tõusul.", "metrics": {"cab_assessment": {"label": "Kabiini ja vedrustuse mugavus", "min": "Halb", "max": "Väga hea"}, "gear_shift": {"label": "Kabiini ja šassii stabiilsus", "min": "Väga ebastabiilne", "max": "Väga usaldusväärne"}}},
      "steering": {"title": "Juhitavus ja stabiilsus", "instruction": "Sõit ühe käega läbi teetööde ala ja kiired pöörded slaalomirajal. Hinnake rooli täpsust ja kontrolli.", "metrics": {"steering_precision": {"label": "Rooli täpsus ja kontroll", "min": "Nõudlik", "max": "Vaevatu"}}},
      "parking": {"title": "Vedrustus", "instruction": "Hinnake šassii ja kabiini mugavust takistusest ülesõidul.", "metrics": {"precision_maneuver": {"label": "Üldine mugavus", "min": "Väga tuntav", "max": "Vaevu märgatav"}}},
      "category-6-6": {"title": "Käiguvahetus ja jõudlus", "instruction": "Kiirendage väiksemalt kiiruselt. Hinnake käiguvahetust ja võimsust.", "metrics": {"metric": {"label": "Käiguvahetuse kvaliteet", "min": "Järsk", "max": "Sujuv"}, "metric-0-7084909693441334": {"label": "Võimsus", "min": "Aeglane ja nõrgenev kiirendus", "max": "Võimas ja pidev kiirendus"}}},
      "category-7-7": {"title": "Manööverdamine", "instruction": "Hinnake täppisparkimist. Scania veokitele, mille manööverdusrežiim on aktiivne.", "metrics": {"manoeuvring_ease": {"label": "Manööverdamise lihtsus", "min": "Ebatäpne", "max": "Millimeetrine täpsus"}}},
      "overall": {"title": "Üldine sõidukogemus", "instruction": "Pärast kõigi ülesannete täitmist andke oma üldmulje selle sõiduki juhtimisest.", "metrics": {"overall_exp": {"label": "Üldine sõidukogemus", "min": "Pettumust valmistav", "max": "Premium"}}},
      "boarding": {"title": "Kabiini sisenemine - Juhi pool", "instruction": "Kõik kolm delegaati ronivad kabiini juhi poolt. \nÜks istub kaassõitja istmel, üks magamisalal iPadiga ja üks juhiistmel.", "metrics": {"boarding_ease": {"label": "Sisenemise lihtsus", "min": "Väga raske", "max": "Väga lihtne"}, "door_interference": {"label": "Ukse segav mõju sisenemisel", "min": "Väga segav", "max": "Ei sega"}, "metric-0-5584803900479581": {"label": "Juhiistmele istumise lihtsus", "min": "Väga raske", "max": "Väga lihtne"}}},
      "cross_cab_access": {"title": "Liikumine kabiinis", "instruction": "Kas kabiinis oli lihtne liikuda? Hinnake liikumist juhiistmelt kaassõitja istmele ja magamisalale. Arvestage takistusi, nagu rool, keskkonsool, mootoritunnel ja eesmine ülemine hoiukoht.", "metrics": {"cross_cab_access_ease": {"label": "Liikumine kabiinis", "min": "Väga takistatud", "max": "Raskusteta"}}},
      "ergonomics": {"title": "Juhi ergonoomika - iste ja rool", "instruction": "Proovige leida roolil võimalikult palju asendeid, kus on mugav käsi hoida ning käsi ja küünarnukke toetada.", "metrics": {"adjustability": {"label": "Reguleeritavus", "min": "Piirav", "max": "Lihtne oma asend leida"}, "ergonomics_overall": {"label": "Mitu mugavat käeasendit te leidsite?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Juhi ergonoomika – Sõidu ajal", "instruction": "Leidke sõidu ajal aktiivsete ohutusfunktsioonide, püsikiirusehoidja ja kliimaseadme nupud. Pöörake tähelepanu nende asukohale: kas neid on intuitiivne leida ja kätte saada?", "metrics": {"intuitive_reach": {"label": "Intuitiivne ja lihtne leida", "min": "Raske/korrastamata", "max": "Lihtne ja hästi grupeeritud"}}},
      "fit_finish": {"title": "Elamine – Praktilisus", "instruction": "Tõuske kaassõitja istmelt ja avage mikrolaineahi. Võtke taldrik välja ja simuleerige einet laua taga istudes. Hinnake mugavust ja jalaruumi. \nLeidke magamisalalt mugav lugemisasend.", "metrics": {"living_comfort": {"label": "Elamismugavus", "min": "Piiratud", "max": "Hästi läbimõeldud"}}},
      "category-8-8": {"title": "Töö- ja viimistluskvaliteet", "instruction": "Vaadake ringi ja hinnake kabiini sisemuse välimust ja tunnetust. Arvestage näiteks komponente, tekstiilide viimistlust ja vastupidavust.", "metrics": {"metric-0-480407108384477": {"label": "Töö- ja viimistluskvaliteet", "min": "Kehv", "max": "Kõrge"}}},
      "safety": {"title": "Ohutu sõit – Otsene nähtavus", "instruction": "Laske kaassõitjal veokist välja astuda, kõndida mööda kollast joont ja peatuda märgistuste juures. \nHinnake otsest nähtavust juhiistmelt.", "metrics": {"direct_vision": {"label": "Otsene nähtavus", "min": "Halb", "max": "Väga hea"}}},
      "cab_exit": {"title": "Kabiinist väljumine", "instruction": "Avage uks ja ronige kabiinist alla seljaga väljapoole. \nKas näete oma istmelt ülemist astet? Hinnake, kui lihtne on istumisasendist väljuda.", "metrics": {"cab_entry_exit": {"label": "Kabiini sisenemine ja väljumine", "min": "Ebaturvaline", "max": "Loomulik ja vaevatu"}}},
    },
    fi: {
      "cab": {"title": "Ohjaamon ja alustan arviointi", "instruction": "Lähde liikkeelle paikaltaan ylämäkiosuudella.", "metrics": {"cab_assessment": {"label": "Ohjaamon ja jousituksen mukavuus", "min": "Huono", "max": "Erittäin hyvä"}, "gear_shift": {"label": "Ohjaamon ja alustan vakaus", "min": "Erittäin epävakaa", "max": "Erittäin luotettava"}}},
      "steering": {"title": "Ajettavuus ja vakaus", "instruction": "Ohjaus yhdellä kädellä tietyömaa-alueen läpi ja nopeat käännökset slalomradalla. Arvioi ohjauksen tarkkuutta ja hallintaa.", "metrics": {"steering_precision": {"label": "Ohjauksen tarkkuus ja hallinta", "min": "Vaativa", "max": "Vaivaton"}}},
      "parking": {"title": "Jousitus", "instruction": "Arvioi alustan ja ohjaamon mukavuutta ajettaessa esteen yli.", "metrics": {"precision_maneuver": {"label": "Yleinen mukavuus", "min": "Hyvin tuntuva", "max": "Tuskin huomattava"}}},
      "category-6-6": {"title": "Vaihteenvaihto ja suorituskyky", "instruction": "Kiihdytä alhaisesta nopeudesta. Arvioi vaihteenvaihtoa ja tehoa.", "metrics": {"metric": {"label": "Vaihteenvaihdon laatu", "min": "Nykivä", "max": "Pehmeä"}, "metric-0-7084909693441334": {"label": "Teho", "min": "Hidas ja hiipuva kiihtyvyys", "max": "Voimakas ja tasainen kiihtyvyys"}}},
      "category-7-7": {"title": "Manööverit", "instruction": "Arvioi tarkkuuspysäköintiä. Scania-kuorma-autoille, joissa manööveritila on käytössä.", "metrics": {"manoeuvring_ease": {"label": "Ohjailtavuuden helppous", "min": "Epätarkka", "max": "Millimetrin tarkkuus"}}},
      "overall": {"title": "Kokonaisajokokemus", "instruction": "Kun olet suorittanut kaikki tehtävät, kerro yleisvaikutelmasi tämän ajoneuvon ajamisesta.", "metrics": {"overall_exp": {"label": "Kokonaisajokokemus", "min": "Mitäänsanomaton", "max": "Premium"}}},
      "boarding": {"title": "Ohjaamoon nousu - Kuljettajan puoli", "instruction": "Kaikki kolme edustajaa nousevat ohjaamoon kuljettajan puolelta. \nYksi istuu apukuljettajan istuimella, yksi makuupaikalla iPadin kanssa ja yksi kuljettajan istuimella.", "metrics": {"boarding_ease": {"label": "Nousun helppous", "min": "Erittäin vaikea", "max": "Erittäin helppo"}, "door_interference": {"label": "Oven haitta noustessa", "min": "Erittäin haittaava", "max": "Ei haittaa"}, "metric-0-5584803900479581": {"label": "Kuljettajan istuimelle istuutumisen helppous", "min": "Erittäin vaikea", "max": "Erittäin helppo"}}},
      "cross_cab_access": {"title": "Liikkuminen ohjaamossa", "instruction": "Oliko ohjaamossa helppo liikkua? Arvioi siirtyminen kuljettajan istuimelta apukuljettajan istuimelle ja makuupaikalle. Huomioi esimerkiksi ohjauspyörän, keskikonsolin, moottoritunnelin ja etuosan ylemmän säilytystilan aiheuttamat haitat.", "metrics": {"cross_cab_access_ease": {"label": "Liikkuminen ohjaamossa", "min": "Erittäin hankalaa", "max": "Vaivatonta"}}},
      "ergonomics": {"title": "Kuljettajan ergonomia - istuin ja ohjauspyörä", "instruction": "Yritä löytää ohjauspyörältä mahdollisimman monta asentoa, joissa käsien pitäminen tai käsien ja kyynärpäiden lepuuttaminen tuntuu mukavalta.", "metrics": {"adjustability": {"label": "Säädettävyys", "min": "Rajoittava", "max": "Helppo löytää oma asento"}, "ergonomics_overall": {"label": "Montako mukavaa käsiasentoa löysit?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Kuljettajan ergonomia – Ajon aikana", "instruction": "Etsi ajon aikana aktiivisten turvatoimintojen, vakionopeudensäätimen ja ilmastoinnin painikkeet. Kiinnitä huomiota niiden sijaintiin: onko niitä intuitiivista löytää ja tavoittaa?", "metrics": {"intuitive_reach": {"label": "Intuitiivinen ja helppo löytää", "min": "Vaikea/sekava", "max": "Helppo ja hyvin ryhmitelty"}}},
      "fit_finish": {"title": "Asuminen – Käytännöllisyys", "instruction": "Nouse apukuljettajan istuimelta ja avaa mikroaaltouuni. Ota lautanen esiin ja simuloi ateriaa pöydän ääressä istuen. Arvioi mukavuutta ja jalkatilaa. \nEtsi makuupaikalta mukava lukuasento.", "metrics": {"living_comfort": {"label": "Asumismukavuus", "min": "Rajoittunut", "max": "Hyvin suunniteltu"}}},
      "category-8-8": {"title": "Viimeistely ja kokoonpanon laatu", "instruction": "Katso ympärillesi ja arvioi sisätilojen ulkonäköä ja tuntumaa. Huomioi esimerkiksi osat, kankaiden viimeistely ja tukevuus.", "metrics": {"metric-0-480407108384477": {"label": "Viimeistely ja kokoonpanon laatu", "min": "Heikko", "max": "Korkea"}}},
      "safety": {"title": "Turvallinen ajo – Suora näkyvyys", "instruction": "Pyydä matkustajaa nousemaan ulos kuorma-autosta, kävelemään keltaista viivaa pitkin ja pysähtymään merkintöjen kohdalla. \nArvioi suoraa näkyvyyttä kuljettajan istuimelta.", "metrics": {"direct_vision": {"label": "Suora näkyvyys", "min": "Huono", "max": "Erittäin hyvä"}}},
      "cab_exit": {"title": "Ohjaamosta poistuminen", "instruction": "Avaa ovi ja poistu selkä ulospäin. \nNäetkö ylimmän askelman istuimeltasi? Arvioi, kuinka helppoa on siirtyä istuma-asennosta ulos.", "metrics": {"cab_entry_exit": {"label": "Ohjaamoon nousu ja sieltä poistuminen", "min": "Turvaton", "max": "Luonnollinen ja vaivaton"}}},
    },
    hu: {
      "cab": {"title": "Kabin és alváz értékelése", "instruction": "Induljon el állóhelyzetből az emelkedőn.", "metrics": {"cab_assessment": {"label": "Kabin- és felfüggesztéskomfort", "min": "Gyenge", "max": "Nagyon jó"}, "gear_shift": {"label": "Kabin és alváz stabilitása", "min": "Nagyon instabil", "max": "Nagyon megbízható"}}},
      "steering": {"title": "Kezelhetőség és stabilitás", "instruction": "Egykezes kormányzás az útépítési szakaszon és gyors kanyarok a szlalompályán. Értékelje a kormányzás pontosságát és irányíthatóságát.", "metrics": {"steering_precision": {"label": "Kormányzás pontossága és irányíthatósága", "min": "Fárasztó", "max": "Erőfeszítés nélküli"}}},
      "parking": {"title": "Felfüggesztés", "instruction": "Értékelje az alváz és a kabin komfortját az akadályon való áthajtáskor.", "metrics": {"precision_maneuver": {"label": "Általános komfort", "min": "Nagyon érezhető", "max": "Alig észrevehető"}}},
      "category-6-6": {"title": "Váltás és teljesítmény", "instruction": "Gyorsítson alacsony sebességről. Értékelje a váltást és a teljesítményt.", "metrics": {"metric": {"label": "Váltás minősége", "min": "Rántós", "max": "Sima"}, "metric-0-7084909693441334": {"label": "Teljesítmény", "min": "Lassú, elhaló gyorsulás", "max": "Erőteljes, folyamatos gyorsulás"}}},
      "category-7-7": {"title": "Manőverezés", "instruction": "Értékelje a pontos beparkolást. Aktív manőverező móddal rendelkező Scania teherautókhoz.", "metrics": {"manoeuvring_ease": {"label": "Manőverezés könnyűsége", "min": "Pontatlan", "max": "Milliméterpontos"}}},
      "overall": {"title": "Összesített vezetési élmény", "instruction": "Az összes feladat elvégzése után adja meg általános benyomását a jármű vezetéséről.", "metrics": {"overall_exp": {"label": "Összesített vezetési élmény", "min": "Csalódást keltő", "max": "Prémium"}}},
      "boarding": {"title": "Beszállás a kabinba - Vezetőoldal", "instruction": "Mindhárom küldött a vezetőoldalon száll be a kabinba. \nEgyikük az utasülésen ül, másikuk az iPaddel a fekvőhelyen, a harmadik pedig a vezetőülésen.", "metrics": {"boarding_ease": {"label": "Beszállás könnyűsége", "min": "Nagyon nehéz", "max": "Nagyon könnyű"}, "door_interference": {"label": "Az ajtó akadályozása beszálláskor", "min": "Nagyon akadályozó", "max": "Nem akadályoz"}, "metric-0-5584803900479581": {"label": "A vezetőülésbe való beülés könnyűsége", "min": "Nagyon nehéz", "max": "Nagyon könnyű"}}},
      "cross_cab_access": {"title": "Mozgás a kabinban", "instruction": "Könnyű volt mozogni a kabinban? Értékelje az átjutást a vezetőülésről az utasülésre és a fekvőhelyre. Vegye figyelembe a kormánykerék, a középkonzol, a motorborítás és az elülső felső tároló okozta akadályokat.", "metrics": {"cross_cab_access_ease": {"label": "Mozgás a kabinban", "min": "Nagyon akadályozott", "max": "Nehézség nélküli"}}},
      "ergonomics": {"title": "Vezetői ergonómia - ülés és kormány", "instruction": "Próbáljon minél több olyan helyzetet találni a kormányon, ahol kényelmes tartani vagy pihentetni a kezét és a könyökét.", "metrics": {"adjustability": {"label": "Állíthatóság", "min": "Korlátozó", "max": "Könnyen a kedvemre állítható"}, "ergonomics_overall": {"label": "Hány kényelmes kéztartást talált?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Vezetői ergonómia – Vezetés közben", "instruction": "Vezetés közben keresse meg az aktív biztonsági funkciók, a tempomat és a klíma gombjait. Figyelje meg, hol helyezkednek el: intuitív megtalálni és elérni őket?", "metrics": {"intuitive_reach": {"label": "Intuitív és könnyen megtalálható", "min": "Nehéz/rendezetlen", "max": "Könnyű és jól csoportosított"}}},
      "fit_finish": {"title": "Kabinélet – Praktikusság", "instruction": "Az utasülésről álljon fel, és nyissa ki a mikrohullámú sütőt. Vegye ki a tányért, és szimulálja az étkezést ülve az asztalnál. Értékelje a kényelmet és a lábteret. \nA fekvőhelyről keressen kényelmes olvasási testhelyzetet.", "metrics": {"living_comfort": {"label": "Lakókomfort", "min": "Korlátozott", "max": "Jól átgondolt"}}},
      "category-8-8": {"title": "Illesztések és kidolgozottság", "instruction": "Nézzen körül, és értékelje a belső tér megjelenését és érzetét. Vegye figyelembe például az alkatrészeket, a textilanyagok megmunkálását és a robusztusságot.", "metrics": {"metric-0-480407108384477": {"label": "Illesztések és kidolgozottság", "min": "Gyenge", "max": "Kiváló"}}},
      "safety": {"title": "Biztonságos vezetés – Közvetlen kilátás", "instruction": "Kérje meg az utast, hogy szálljon ki a teherautóból, sétáljon végig a sárga vonal mentén, és álljon meg a jelöléseknél. \nÉrtékelje a közvetlen kilátást a vezetőülésből.", "metrics": {"direct_vision": {"label": "Közvetlen kilátás", "min": "Gyenge", "max": "Nagyon jó"}}},
      "cab_exit": {"title": "Kiszállás a kabinból", "instruction": "Nyissa ki az ajtót, és hátrafelé, a kabin felé fordulva szálljon ki. \nLátja a legfelső lépcsőfokot az ülésből? Értékelje, mennyire könnyű az átmenet az ülő helyzetből a kiszállásba.", "metrics": {"cab_entry_exit": {"label": "Be- és kiszállás", "min": "Nem biztonságos", "max": "Természetes és erőfeszítés nélküli"}}},
    },
    is: {
      cab:      { title: 'Mat á stýrishúsi og gírskiptingu', instruction: 'Stopp-start í brekku upp, síðan hraða. Meta gírkassann og hegðun stýrishússins.', metrics: { cab_assessment: { label: 'Mat á stýrishúsi', min: 'Lélegt', max: 'Mjög gott' }, gear_shift: { label: 'Viðbrögð gírskiptingar', min: 'Óáreiðanlegt', max: 'Mjög áreiðanlegt' } } },
      aux:      { title: 'Hjálparbremsa', instruction: 'Hjálparbremsa í brekku niður. Meta notendavænleika og öryggi í stjórnun.', metrics: { ease_handling: { label: 'Auðveld stjórnun', min: 'Mjög erfitt', max: 'Mjög auðvelt' } } },
      steering: { title: 'Stýring og aksturseiginleikar', instruction: 'Línueftirfylgni með einni hendi, síðan keiluslalom. Meta stýrisnákvæmni og stöðugleika undirvagns.', metrics: { steering_precision: { label: 'Stýrisnákvæmni', min: 'Ónákvæmt', max: 'Mjög nákvæmt' }, chassis_stability: { label: 'Stöðugleiki undirvagns', min: 'Óstöðugt', max: 'Mjög stöðugt' } } },
      parking:  { title: 'Bílastæði og nákvæmnisakstur', instruction: 'Hreyfistilling til bílastæðis. Meta nákvæmni, auðveldni í bakkgír og stjórn við tengingu.', metrics: { precision_maneuver: { label: 'Nákvæmni — hreyfistilling', min: 'Ónákvæmt', max: 'Mjög nákvæmt' }, reversing_docking: { label: 'Auðveldni í bakkgír og tengingu', min: 'Mjög erfitt', max: 'Mjög auðvelt' } } },
      overall:  { title: 'Heildarupplifun af akstri', instruction: 'Eftir að hafa lokið öllum verkefnum, gefið heildarálit ykkar á akstri þessa farartækis.', metrics: { overall_exp: { label: 'Heildarupplifun af akstri', min: 'Lélegt', max: 'Hágæða' } } },
      boarding:   { title: 'Að fara inn og út', instruction: 'Klífið inn í og út úr stýrishúsinu. Meta sýnileika efsta þreps ofan frá og heildarauðveldni við að fara inn og út.', metrics: { boarding_ease: { label: 'Auðveldni við að fara inn og út', min: 'Mjög erfitt', max: 'Mjög auðvelt' } } },
      ergonomics: { title: 'Vinnuvistfræði og aðgengi', instruction: 'Sitjandi í ökumannsstöðu: metið aðgengi að helstu stjórntækjum, upplýsingaskjá og rökréttri flokkun aðgerða.', metrics: { ergonomics_overall: { label: 'Heildarvinnuvistfræðilegt álit', min: 'Lélegt', max: 'Mjög gott' }, info_display: { label: 'Upplýsingaskjár', min: 'Lélegt', max: 'Mjög gott' } } },
      fit_finish: { title: 'Frágangur og gæði', instruction: 'Metið gæði efnis, litasamræmi milli yfirborða og samræmi í bilum milli platna.', metrics: { overall_finish: { label: 'Heildarfrágangur', min: 'Lélegt', max: 'Hágæða' } } },
      safety:     { title: 'Öryggi og bein sýn', instruction: 'Metið beint sjónsvið. Leikmunir eru staðsettir á merktum gólfstöðum — skráið hverjir eru sýnilegir frá ökumannssæti.', metrics: { direct_vision: { label: 'Bein sýn — að framan og til hliðar', min: 'Mjög takmörkuð', max: 'Frábær' }, mirror_visibility: { label: 'Sýnileiki hliðarspegla', min: 'Hindraður', max: 'Skýr' } } },
    },
    it: {
      "cab": {"title": "Valutazione di cabina e telaio", "instruction": "Partenza da fermo sul tratto in salita.", "metrics": {"cab_assessment": {"label": "Comfort della cabina e delle sospensioni", "min": "Scarso", "max": "Ottimo"}, "gear_shift": {"label": "Stabilità di cabina e telaio", "min": "Molto instabile", "max": "Molto stabile"}}},
      "steering": {"title": "Maneggevolezza e stabilità", "instruction": "Guida con una sola mano nella zona lavori e curve rapide nel percorso a slalom. Valuta la precisione e il controllo dello sterzo.", "metrics": {"steering_precision": {"label": "Precisione e controllo dello sterzo", "min": "Impegnativo", "max": "Senza sforzo"}}},
      "parking": {"title": "Sospensioni", "instruction": "Valuta il comfort di telaio e cabina nel superare l'ostacolo.", "metrics": {"precision_maneuver": {"label": "Comfort generale", "min": "Molto marcato", "max": "Appena percepibile"}}},
      "category-6-6": {"title": "Cambio marcia e potenza", "instruction": "Accelera a bassa velocità. Valuta il cambio marcia e la potenza.", "metrics": {"metric": {"label": "Qualità del cambio marcia", "min": "Brusco", "max": "Fluido"}, "metric-0-7084909693441334": {"label": "Potenza", "min": "Accelerazione lenta e in calo", "max": "Accelerazione potente e continua"}}},
      "category-7-7": {"title": "Manovre", "instruction": "Valuta il parcheggio di precisione. Per i camion Scania con la modalità manovra attiva.", "metrics": {"manoeuvring_ease": {"label": "Facilità di manovra", "min": "Impreciso", "max": "Precisione millimetrica"}}},
      "overall": {"title": "Esperienza di guida complessiva", "instruction": "Dopo aver completato tutti i compiti, esprimi la tua impressione generale sulla guida di questo veicolo.", "metrics": {"overall_exp": {"label": "Esperienza di guida complessiva", "min": "Deludente", "max": "Premium"}}},
      "boarding": {"title": "Accesso alla cabina - Lato guida", "instruction": "Tutti e tre i delegati salgono in cabina dal lato guida. \nUno si siede sul sedile del passeggero, uno sulla cuccetta con l'iPad e uno sul sedile di guida.", "metrics": {"boarding_ease": {"label": "Facilità di accesso", "min": "Molto difficile", "max": "Molto facile"}, "door_interference": {"label": "Intralcio della porta durante la salita", "min": "Molto intralciante", "max": "Nessun intralcio"}, "metric-0-5584803900479581": {"label": "Facilità nel sedersi al posto di guida", "min": "Molto difficile", "max": "Molto facile"}}},
      "cross_cab_access": {"title": "Spostamento in cabina", "instruction": "È stato facile muoversi in cabina? Valuta lo spostamento dal sedile di guida al sedile del passeggero e alla cuccetta. Considera ostacoli come volante, console centrale, tunnel motore e vano portaoggetti superiore anteriore.", "metrics": {"cross_cab_access_ease": {"label": "Spostamento in cabina", "min": "Molto ostacolato", "max": "Senza difficoltà"}}},
      "ergonomics": {"title": "Ergonomia del conducente - sedile e volante", "instruction": "Cerca di trovare il maggior numero possibile di posizioni sul volante in cui sia comodo tenere o appoggiare le mani e i gomiti.", "metrics": {"adjustability": {"label": "Regolabilità", "min": "Limitata", "max": "Facile trovare la mia posizione"}, "ergonomics_overall": {"label": "Quante posizioni comode per le mani hai trovato?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ergonomia del conducente – Durante la guida", "instruction": "Durante la guida, individua i pulsanti delle funzioni di sicurezza attiva, del cruise control e del climatizzatore. Concentrati su dove si trovano: è intuitivo trovarli e raggiungerli?", "metrics": {"intuitive_reach": {"label": "Intuitivo e facile da trovare", "min": "Difficile/confuso", "max": "Facile e ben raggruppato"}}},
      "fit_finish": {"title": "Vivibilità – Aspetti pratici", "instruction": "Dal sedile del passeggero, alzati per aprire il microonde. Prendi il piatto e simula un pasto seduto al tavolo. Valuta comfort e spazio per le gambe. \nDalla cuccetta, trova una posizione comoda per leggere.", "metrics": {"living_comfort": {"label": "Comfort abitativo", "min": "Limitato", "max": "Ben progettato"}}},
      "category-8-8": {"title": "Assemblaggio e finiture", "instruction": "Dai un'occhiata intorno e valuta l'aspetto e la qualità percepita degli interni. Considera ad esempio componenti, finitura dei tessuti e solidità.", "metrics": {"metric-0-480407108384477": {"label": "Qualità di assemblaggio e finiture", "min": "Scadente", "max": "Elevata"}}},
      "safety": {"title": "Guida sicura – Visibilità diretta", "instruction": "Fai scendere il passeggero dal camion e fallo camminare lungo la linea gialla, fermandosi in corrispondenza dei segni. \nValuta la visibilità diretta dal sedile di guida.", "metrics": {"direct_vision": {"label": "Visibilità diretta", "min": "Scarsa", "max": "Molto buona"}}},
      "cab_exit": {"title": "Uscita dalla cabina", "instruction": "Apri la porta e scendi dando le spalle all'esterno. \nRiesci a vedere il gradino superiore dal tuo sedile? Valuta quanto è facile passare dalla posizione seduta alla discesa.", "metrics": {"cab_entry_exit": {"label": "Accesso e uscita dalla cabina", "min": "Poco sicuro", "max": "Naturale e senza sforzo"}}},
    },
    lt: {
      "cab": {"title": "Kabinos ir važiuoklės vertinimas", "instruction": "Pajudėkite iš vietos įkalnėje.", "metrics": {"cab_assessment": {"label": "Kabinos ir pakabos komfortas", "min": "Prastas", "max": "Labai geras"}, "gear_shift": {"label": "Kabinos ir važiuoklės stabilumas", "min": "Labai nestabilus", "max": "Labai patikimas"}}},
      "steering": {"title": "Valdymas ir stabilumas", "instruction": "Vairavimas viena ranka per kelio darbų ruožą ir greiti posūkiai slalomo trasoje. Įvertinkite vairo tikslumą ir kontrolę.", "metrics": {"steering_precision": {"label": "Vairo tikslumas ir kontrolė", "min": "Sudėtingas", "max": "Be pastangų"}}},
      "parking": {"title": "Pakaba", "instruction": "Įvertinkite važiuoklės ir kabinos komfortą pervažiuojant kliūtį.", "metrics": {"precision_maneuver": {"label": "Bendras komfortas", "min": "Labai juntama", "max": "Vos juntama"}}},
      "category-6-6": {"title": "Pavarų perjungimas ir našumas", "instruction": "Pagreitinkite iš mažo greičio. Įvertinkite pavarų perjungimą ir galią.", "metrics": {"metric": {"label": "Pavarų perjungimo kokybė", "min": "Staigus", "max": "Sklandus"}, "metric-0-7084909693441334": {"label": "Galia", "min": "Lėtas ir silpstantis pagreitis", "max": "Galingas ir tolygus pagreitis"}}},
      "category-7-7": {"title": "Manevravimas", "instruction": "Įvertinkite tikslų parkavimą. Scania sunkvežimiams su aktyviu manevravimo režimu.", "metrics": {"manoeuvring_ease": {"label": "Manevravimo lengvumas", "min": "Netikslus", "max": "Milimetrų tikslumas"}}},
      "overall": {"title": "Bendra vairavimo patirtis", "instruction": "Atlikę visas užduotis, pateikite bendrą įspūdį apie šios transporto priemonės vairavimą.", "metrics": {"overall_exp": {"label": "Bendra vairavimo patirtis", "min": "Nuviliantis", "max": "Aukščiausios klasės"}}},
      "boarding": {"title": "Įlipimas į kabiną - Vairuotojo pusė", "instruction": "Visi trys delegatai lipa į kabiną iš vairuotojo pusės. \nVienas sėdi keleivio sėdynėje, vienas ant gulto su iPad, o vienas vairuotojo sėdynėje.", "metrics": {"boarding_ease": {"label": "Įlipimo lengvumas", "min": "Labai sunkus", "max": "Labai lengvas"}, "door_interference": {"label": "Durų trukdymas įlipant", "min": "Labai trukdo", "max": "Netrukdo"}, "metric-0-5584803900479581": {"label": "Atsisėdimo į vairuotojo sėdynę lengvumas", "min": "Labai sunkus", "max": "Labai lengvas"}}},
      "cross_cab_access": {"title": "Judėjimas kabinoje", "instruction": "Ar buvo lengva judėti kabinoje? Įvertinkite perėjimą nuo vairuotojo sėdynės prie keleivio sėdynės ir gulto. Atsižvelkite į kliūtis, pavyzdžiui, vairą, centrinę konsolę, variklio tunelį ir priekinę viršutinę daiktadėžę.", "metrics": {"cross_cab_access_ease": {"label": "Judėjimas kabinoje", "min": "Labai sunkus", "max": "Be sunkumų"}}},
      "ergonomics": {"title": "Vairuotojo ergonomika - sėdynė ir vairas", "instruction": "Pabandykite rasti kuo daugiau padėčių ant vairo, kuriose patogu laikyti ar pasirėmti rankas ir alkūnes.", "metrics": {"adjustability": {"label": "Reguliavimas", "min": "Ribojantis", "max": "Lengva rasti savo padėtį"}, "ergonomics_overall": {"label": "Kiek patogių rankų padėčių radote?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Vairuotojo ergonomika – Važiuojant", "instruction": "Važiuodami suraskite aktyvių saugos funkcijų, kruizo kontrolės ir klimato kontrolės mygtukus. Atkreipkite dėmesį į jų išdėstymą: ar intuityvu juos rasti ir pasiekti?", "metrics": {"intuitive_reach": {"label": "Intuityvu ir lengva rasti", "min": "Sunku/netvarkinga", "max": "Lengva ir gerai sugrupuota"}}},
      "fit_finish": {"title": "Gyvenimas kabinoje – Praktiškumas", "instruction": "Atsistokite nuo keleivio sėdynės ir atidarykite mikrobangų krosnelę. Išimkite lėkštę ir imituokite valgymą sėdint prie stalo. Įvertinkite komfortą ir vietą kojoms. \nNuo gulto suraskite patogią skaitymo padėtį.", "metrics": {"living_comfort": {"label": "Gyvenimo kabinoje komfortas", "min": "Ribotas", "max": "Gerai apgalvotas"}}},
      "category-8-8": {"title": "Surinkimo ir apdailos kokybė", "instruction": "Apsidairykite ir įvertinkite salono išvaizdą bei pojūtį. Atsižvelkite, pavyzdžiui, į komponentus, tekstilės apdailą ir tvirtumą.", "metrics": {"metric-0-480407108384477": {"label": "Surinkimo ir apdailos kokybė", "min": "Prasta", "max": "Aukšta"}}},
      "safety": {"title": "Saugus vairavimas – Tiesioginis matomumas", "instruction": "Paprašykite keleivio išlipti iš sunkvežimio, paeiti palei geltoną liniją ir sustoti ties žymėmis. \nĮvertinkite tiesioginį matomumą iš vairuotojo sėdynės.", "metrics": {"direct_vision": {"label": "Tiesioginis matomumas", "min": "Prastas", "max": "Labai geras"}}},
      "cab_exit": {"title": "Išlipimas iš kabinos", "instruction": "Atidarykite duris ir išlipkite nugara į išorę. \nAr matote viršutinį laiptelį iš savo sėdynės? Įvertinkite, kaip lengva pereiti iš sėdimos padėties į išlipimą.", "metrics": {"cab_entry_exit": {"label": "Įlipimas ir išlipimas", "min": "Nesaugus", "max": "Natūralus ir be pastangų"}}},
    },
    lv: {
      "cab": {"title": "Kabīnes un šasijas novērtējums", "instruction": "Sāciet kustību no vietas kāpumā.", "metrics": {"cab_assessment": {"label": "Kabīnes un balstiekārtas komforts", "min": "Slikts", "max": "Ļoti labs"}, "gear_shift": {"label": "Kabīnes un šasijas stabilitāte", "min": "Ļoti nestabila", "max": "Ļoti uzticama"}}},
      "steering": {"title": "Vadāmība un stabilitāte", "instruction": "Braukšana ar vienu roku cauri ceļa darbu zonai un strauji pagriezieni slaloma trasē. Novērtējiet stūres precizitāti un kontroli.", "metrics": {"steering_precision": {"label": "Stūres precizitāte un kontrole", "min": "Prasīga", "max": "Bez piepūles"}}},
      "parking": {"title": "Balstiekārta", "instruction": "Novērtējiet šasijas un kabīnes komfortu, braucot pāri šķērslim.", "metrics": {"precision_maneuver": {"label": "Kopējais komforts", "min": "Ļoti jūtams", "max": "Gandrīz nemanāms"}}},
      "category-6-6": {"title": "Pārnesumu pārslēgšana un jauda", "instruction": "Paātriniet no zema ātruma. Novērtējiet pārnesumu pārslēgšanu un jaudu.", "metrics": {"metric": {"label": "Pārnesumu pārslēgšanas kvalitāte", "min": "Raustīga", "max": "Vienmērīga"}, "metric-0-7084909693441334": {"label": "Jauda", "min": "Lēna un norimstoša paātrināšanās", "max": "Spēcīga un nepārtraukta paātrināšanās"}}},
      "category-7-7": {"title": "Manevrēšana", "instruction": "Novērtējiet precīzo novietošanu stāvvietā. Scania kravas automašīnām ar aktīvu manevrēšanas režīmu.", "metrics": {"manoeuvring_ease": {"label": "Manevrēšanas vieglums", "min": "Neprecīza", "max": "Milimetru precizitāte"}}},
      "overall": {"title": "Kopējā braukšanas pieredze", "instruction": "Pēc visu uzdevumu izpildes sniedziet savu kopējo iespaidu par šī transportlīdzekļa vadīšanu.", "metrics": {"overall_exp": {"label": "Kopējā braukšanas pieredze", "min": "Vilšanos radoša", "max": "Premium"}}},
      "boarding": {"title": "Iekāpšana kabīnē - Vadītāja puse", "instruction": "Visi trīs delegāti kāpj kabīnē no vadītāja puses. \nViens sēž pasažiera sēdeklī, viens uz guļvietas ar iPad un viens vadītāja sēdeklī.", "metrics": {"boarding_ease": {"label": "Iekāpšanas vieglums", "min": "Ļoti grūti", "max": "Ļoti viegli"}, "door_interference": {"label": "Durvju traucējums iekāpjot", "min": "Ļoti traucē", "max": "Netraucē"}, "metric-0-5584803900479581": {"label": "Iesēšanās vadītāja sēdeklī", "min": "Ļoti grūta", "max": "Ļoti viegla"}}},
      "cross_cab_access": {"title": "Pārvietošanās kabīnē", "instruction": "Vai kabīnē bija viegli pārvietoties? Novērtējiet pārvietošanos no vadītāja sēdekļa uz pasažiera sēdekli un guļvietu. Ņemiet vērā šķēršļus, piemēram, stūri, centrālo konsoli, motora tuneli un priekšējo augšējo glabāšanas nodalījumu.", "metrics": {"cross_cab_access_ease": {"label": "Pārvietošanās kabīnē", "min": "Ļoti traucēta", "max": "Bez grūtībām"}}},
      "ergonomics": {"title": "Vadītāja ergonomika - sēdeklis un stūre", "instruction": "Mēģiniet atrast pēc iespējas vairāk pozīciju uz stūres, kurās ir ērti turēt vai balstīt rokas un elkoņus.", "metrics": {"adjustability": {"label": "Regulējamība", "min": "Ierobežojoša", "max": "Viegli atrast savu pozīciju"}, "ergonomics_overall": {"label": "Cik ērtas roku pozīcijas jūs atradāt?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Vadītāja ergonomika – Braukšanas laikā", "instruction": "Braukšanas laikā atrodiet aktīvo drošības funkciju, kruīza kontroles un klimata kontroles pogas. Pievērsiet uzmanību to izvietojumam: vai tās ir intuitīvi atrast un aizsniegt?", "metrics": {"intuitive_reach": {"label": "Intuitīvi un viegli atrast", "min": "Grūti/nekārtīgi", "max": "Viegli un labi sagrupētas"}}},
      "fit_finish": {"title": "Uzturēšanās kabīnē – Praktiskums", "instruction": "No pasažiera sēdekļa piecelieties un atveriet mikroviļņu krāsni. Izņemiet šķīvi un simulējiet maltīti, sēžot pie galda. Novērtējiet komfortu un vietu kājām. \nNo guļvietas atrodiet ērtu lasīšanas pozu.", "metrics": {"living_comfort": {"label": "Uzturēšanās komforts", "min": "Ierobežots", "max": "Labi pārdomāts"}}},
      "category-8-8": {"title": "Montāža un apdare", "instruction": "Paskatieties apkārt un novērtējiet kabīnes interjera izskatu un sajūtu. Ņemiet vērā, piemēram, komponentus, tekstilmateriālu apdari un masīvumu.", "metrics": {"metric-0-480407108384477": {"label": "Montāžas un apdares kvalitāte", "min": "Zema", "max": "Augsta"}}},
      "safety": {"title": "Droša braukšana – Tiešā redzamība", "instruction": "Lūdziet pasažierim izkāpt no kravas automašīnas, iet gar dzelteno līniju un apstāties pie atzīmēm. \nNovērtējiet tiešo redzamību no vadītāja sēdekļa.", "metrics": {"direct_vision": {"label": "Tiešā redzamība", "min": "Slikta", "max": "Ļoti laba"}}},
      "cab_exit": {"title": "Izkāpšana no kabīnes", "instruction": "Atveriet durvis un izkāpiet ar muguru uz āru. \nVai jūs redzat augšējo kāpienu no sava sēdekļa? Novērtējiet, cik viegli ir pāriet no sēdus pozīcijas uz izkāpšanu.", "metrics": {"cab_entry_exit": {"label": "Iekāpšana un izkāpšana", "min": "Nedroša", "max": "Dabiska un bez piepūles"}}},
    },
    no: {
      "cab": {"title": "Vurdering av førerhus og chassis", "instruction": "Start fra stillstand i oppoverbakken.", "metrics": {"cab_assessment": {"label": "Komfort i førerhus og fjæring", "min": "Dårlig", "max": "Veldig god"}, "gear_shift": {"label": "Stabilitet i førerhus og chassis", "min": "Veldig ustabil", "max": "Veldig pålitelig"}}},
      "steering": {"title": "Kjøreegenskaper og stabilitet", "instruction": "Kjøring med én hånd gjennom veiarbeidet og raske svinger i slalombanen. Vurder styrenøyaktighet og kontroll.", "metrics": {"steering_precision": {"label": "Styrenøyaktighet og kontroll", "min": "Krevende", "max": "Uanstrengt"}}},
      "parking": {"title": "Fjæring", "instruction": "Vurder komforten i chassis og førerhus når du kjører over hindringen.", "metrics": {"precision_maneuver": {"label": "Generell komfort", "min": "Veldig merkbar", "max": "Knapt merkbar"}}},
      "category-6-6": {"title": "Girskifte og ytelse", "instruction": "Akselerer fra lav hastighet. Vurder girskifte og kraft.", "metrics": {"metric": {"label": "Girskiftekvalitet", "min": "Rykkete", "max": "Mykt"}, "metric-0-7084909693441334": {"label": "Kraft", "min": "Langsom og avtagende akselerasjon", "max": "Kraftig og jevn akselerasjon"}}},
      "category-7-7": {"title": "Manøvrering", "instruction": "Vurder presisjonsparkering. For Scania-lastebiler med aktiv manøvermodus.", "metrics": {"manoeuvring_ease": {"label": "Enkel å manøvrere", "min": "Upresis", "max": "Millimeternøyaktig"}}},
      "overall": {"title": "Samlet kjøreopplevelse", "instruction": "Når du har fullført alle oppgavene, gi ditt samlede inntrykk av å kjøre dette kjøretøyet.", "metrics": {"overall_exp": {"label": "Samlet kjøreopplevelse", "min": "Skuffende", "max": "Premium"}}},
      "boarding": {"title": "Innstigning i førerhuset - Førersiden", "instruction": "Alle tre delegatene stiger inn i førerhuset fra førersiden. \nÉn sitter i passasjersetet, én på køyen med iPaden og én i førersetet.", "metrics": {"boarding_ease": {"label": "Enkel å komme inn", "min": "Veldig vanskelig", "max": "Veldig enkel"}, "door_interference": {"label": "Hinder fra døren ved innstigning", "min": "Veldig hindrende", "max": "Ingen hinder"}, "metric-0-5584803900479581": {"label": "Enkel å sette seg i førersetet", "min": "Veldig vanskelig", "max": "Veldig enkel"}}},
      "cross_cab_access": {"title": "Bevegelse i førerhuset", "instruction": "Var det enkelt å bevege seg i førerhuset? Vurder bevegelsen fra førersetet til passasjersetet og køyen. Ta hensyn til hindringer som rattet, midtkonsollen, motortunnelen og det øvre oppbevaringsrommet foran.", "metrics": {"cross_cab_access_ease": {"label": "Bevegelse i førerhuset", "min": "Veldig hindrende", "max": "Uten problemer"}}},
      "ergonomics": {"title": "Førerergonomi - sete og ratt", "instruction": "Prøv å finne så mange posisjoner som mulig på rattet der det er behagelig å holde eller hvile hendene og albuene.", "metrics": {"adjustability": {"label": "Justerbarhet", "min": "Begrensende", "max": "Lett å finne min posisjon"}, "ergonomics_overall": {"label": "Hvor mange behagelige håndposisjoner fant du?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Førerergonomi – Under kjøring", "instruction": "Finn knappene for aktive sikkerhetsfunksjoner, fartsholder og klimaanlegg mens du kjører. Legg merke til hvor de er plassert: er det intuitivt å finne og nå dem?", "metrics": {"intuitive_reach": {"label": "Intuitivt og lett å finne", "min": "Vanskelig/rotete", "max": "Enkelt og godt gruppert"}}},
      "fit_finish": {"title": "Opphold i førerhuset – Praktisk", "instruction": "Reis deg fra passasjersetet og åpne mikrobølgeovnen. Ta ut tallerkenen og simuler et måltid sittende ved bordet. Vurder komfort og benplass. \nFinn en behagelig leseposisjon i køyen.", "metrics": {"living_comfort": {"label": "Oppholdskomfort", "min": "Begrenset", "max": "Gjennomtenkt"}}},
      "category-8-8": {"title": "Passform og finish", "instruction": "Se deg rundt og vurder utseende og følelse i interiøret. Ta for eksempel hensyn til komponenter, finish på tekstilene og robusthet.", "metrics": {"metric-0-480407108384477": {"label": "Passform og finish", "min": "Dårlig", "max": "Høy"}}},
      "safety": {"title": "Trygg kjøring – Direkte sikt", "instruction": "La passasjeren gå ut av lastebilen, gå langs den gule linjen og stoppe ved markeringene. \nVurder den direkte sikten fra førersetet.", "metrics": {"direct_vision": {"label": "Direkte sikt", "min": "Dårlig", "max": "Veldig god"}}},
      "cab_exit": {"title": "Utgang fra førerhuset", "instruction": "Åpne døren og gå ut med ryggen først. \nKan du se det øverste trinnet fra setet ditt? Vurder hvor enkelt det er å gå fra sittende til utstigning.", "metrics": {"cab_entry_exit": {"label": "Inn- og utstigning", "min": "Utrygt", "max": "Naturlig og uanstrengt"}}},
    },
    pl: {
      "cab": {"title": "Ocena kabiny i podwozia", "instruction": "Ruszanie z miejsca na wzniesieniu.", "metrics": {"cab_assessment": {"label": "Komfort kabiny i zawieszenia", "min": "Słaby", "max": "Bardzo dobry"}, "gear_shift": {"label": "Stabilność kabiny i podwozia", "min": "Bardzo niestabilna", "max": "Bardzo niezawodna"}}},
      "steering": {"title": "Prowadzenie i stabilność", "instruction": "Kierowanie jedną ręką w strefie robót drogowych i szybkie zakręty na torze slalomowym. Proszę ocenić precyzję i kontrolę układu kierowniczego.", "metrics": {"steering_precision": {"label": "Precyzja i kontrola układu kierowniczego", "min": "Wymagające", "max": "Bez wysiłku"}}},
      "parking": {"title": "Zawieszenie", "instruction": "Proszę ocenić komfort podwozia i kabiny podczas przejazdu przez przeszkodę.", "metrics": {"precision_maneuver": {"label": "Komfort ogólny", "min": "Bardzo odczuwalne", "max": "Ledwo zauważalne"}}},
      "category-6-6": {"title": "Zmiana biegów i osiągi", "instruction": "Proszę przyspieszyć z niskiej prędkości i ocenić zmianę biegów oraz moc.", "metrics": {"metric": {"label": "Jakość zmiany biegów", "min": "Szarpana", "max": "Płynna"}, "metric-0-7084909693441334": {"label": "Moc", "min": "Powolne, słabnące przyspieszenie", "max": "Mocne i ciągłe przyspieszenie"}}},
      "category-7-7": {"title": "Manewrowanie", "instruction": "Proszę ocenić precyzję parkowania. Dotyczy ciężarówek Scania z aktywnym trybem manewrowania.", "metrics": {"manoeuvring_ease": {"label": "Łatwość manewrowania", "min": "Nieprecyzyjne", "max": "Dokładność do milimetra"}}},
      "overall": {"title": "Ogólne wrażenia z jazdy", "instruction": "Po wykonaniu wszystkich zadań proszę podać swoje ogólne wrażenie z jazdy tym pojazdem.", "metrics": {"overall_exp": {"label": "Ogólne wrażenia z jazdy", "min": "Nieprzekonujące", "max": "Klasa premium"}}},
      "boarding": {"title": "Wsiadanie do kabiny - Strona kierowcy", "instruction": "Wszyscy trzej delegaci wsiadają do kabiny od strony kierowcy. \nJeden siada na fotelu pasażera, jeden na leżance z iPadem, a jeden na fotelu kierowcy.", "metrics": {"boarding_ease": {"label": "Łatwość wsiadania", "min": "Bardzo trudne", "max": "Bardzo łatwe"}, "door_interference": {"label": "Czy drzwi przeszkadzają przy wsiadaniu?", "min": "Bardzo przeszkadzają", "max": "Nie przeszkadzają"}, "metric-0-5584803900479581": {"label": "Łatwość zajęcia miejsca na fotelu kierowcy", "min": "Bardzo trudne", "max": "Bardzo łatwe"}}},
      "cross_cab_access": {"title": "Przemieszczanie się po kabinie", "instruction": "Czy łatwo było poruszać się po kabinie? Proszę ocenić przejście z fotela kierowcy na fotel pasażera i na leżankę. Proszę uwzględnić przeszkody, takie jak kierownica, konsola środkowa, tunel silnika i przedni górny schowek.", "metrics": {"cross_cab_access_ease": {"label": "Przemieszczanie się po kabinie", "min": "Bardzo utrudnione", "max": "Bez trudności"}}},
      "ergonomics": {"title": "Ergonomia kierowcy - fotel i kierownica", "instruction": "Proszę spróbować znaleźć jak najwięcej pozycji na kierownicy, w których wygodnie jest trzymać dłonie lub opierać ręce i łokcie.", "metrics": {"adjustability": {"label": "Regulacja", "min": "Ograniczająca", "max": "Łatwo znaleźć moją pozycję"}, "ergonomics_overall": {"label": "Ile wygodnych pozycji dłoni udało się znaleźć?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ergonomia kierowcy – Podczas jazdy", "instruction": "Podczas jazdy proszę znaleźć przyciski funkcji bezpieczeństwa aktywnego, tempomatu i klimatyzacji. Proszę zwrócić uwagę na ich rozmieszczenie: czy łatwo je znaleźć i do nich sięgnąć?", "metrics": {"intuitive_reach": {"label": "Intuicyjne i łatwe do znalezienia", "min": "Trudne/chaotyczne", "max": "Łatwe i dobrze zgrupowane"}}},
      "fit_finish": {"title": "Przestrzeń mieszkalna – Praktyczność", "instruction": "Z fotela pasażera proszę wstać i otworzyć kuchenkę mikrofalową. Proszę wyjąć talerz i zasymulować posiłek przy stole. Proszę ocenić komfort i miejsce na nogi. \nZ leżanki proszę znaleźć wygodną pozycję do czytania.", "metrics": {"living_comfort": {"label": "Komfort mieszkalny", "min": "Ograniczony", "max": "Dobrze przemyślany"}}},
      "category-8-8": {"title": "Spasowanie i wykończenie", "instruction": "Proszę rozejrzeć się i ocenić wygląd oraz wrażenia z wnętrza. Proszę wziąć pod uwagę np. elementy, wykończenie tkanin i solidność.", "metrics": {"metric-0-480407108384477": {"label": "Spasowanie i wykończenie", "min": "Słabe", "max": "Wysokie"}}},
      "safety": {"title": "Bezpieczna jazda – Widoczność bezpośrednia", "instruction": "Pasażer powinien wysiąść z ciężarówki, przejść wzdłuż żółtej linii i zatrzymać się przy oznaczeniach. \nProszę ocenić widoczność bezpośrednią z fotela kierowcy.", "metrics": {"direct_vision": {"label": "Widoczność bezpośrednia", "min": "Słaba", "max": "Bardzo dobra"}}},
      "cab_exit": {"title": "Wysiadanie z kabiny", "instruction": "Proszę otworzyć drzwi i wysiąść tyłem, plecami na zewnątrz. \nCzy ze swojego fotela widać najwyższy stopień? Proszę ocenić, jak łatwo jest przejść z pozycji siedzącej do wysiadania.", "metrics": {"cab_entry_exit": {"label": "Wejście i wyjście z kabiny", "min": "Niebezpieczne", "max": "Naturalne i bez wysiłku"}}},
    },
    ro: {
      "cab": {"title": "Evaluarea cabinei și a șasiului", "instruction": "Porniți din staționare pe porțiunea în urcare.", "metrics": {"cab_assessment": {"label": "Confortul cabinei și al suspensiei", "min": "Slab", "max": "Foarte bun"}, "gear_shift": {"label": "Stabilitatea cabinei și a șasiului", "min": "Foarte instabilă", "max": "Foarte fiabilă"}}},
      "steering": {"title": "Manevrabilitate și stabilitate", "instruction": "Conducere cu o singură mână prin zona de lucrări și viraje rapide pe traseul de slalom. Evaluați precizia și controlul direcției.", "metrics": {"steering_precision": {"label": "Precizia și controlul direcției", "min": "Solicitant", "max": "Fără efort"}}},
      "parking": {"title": "Suspensie", "instruction": "Evaluați confortul șasiului și al cabinei la trecerea peste obstacol.", "metrics": {"precision_maneuver": {"label": "Confort general", "min": "Foarte accentuat", "max": "Abia sesizabil"}}},
      "category-6-6": {"title": "Schimbarea vitezelor și performanță", "instruction": "Accelerați de la viteză mică. Evaluați schimbarea vitezelor și puterea.", "metrics": {"metric": {"label": "Calitatea schimbării vitezelor", "min": "Bruscă", "max": "Fluidă"}, "metric-0-7084909693441334": {"label": "Putere", "min": "Accelerare lentă și în scădere", "max": "Accelerare puternică și continuă"}}},
      "category-7-7": {"title": "Manevrare", "instruction": "Evaluați parcarea cu precizie. Pentru camioanele Scania cu modul de manevrare activ.", "metrics": {"manoeuvring_ease": {"label": "Ușurința manevrării", "min": "Imprecisă", "max": "Precizie milimetrică"}}},
      "overall": {"title": "Experiența generală de condus", "instruction": "După finalizarea tuturor sarcinilor, oferiți impresia dvs. generală despre conducerea acestui vehicul.", "metrics": {"overall_exp": {"label": "Experiența generală de condus", "min": "Dezamăgitoare", "max": "Premium"}}},
      "boarding": {"title": "Urcarea în cabină - Partea șoferului", "instruction": "Toți cei trei delegați urcă în cabină pe partea șoferului. \nUnul stă pe scaunul pasagerului, unul pe cușetă cu iPad-ul și unul pe scaunul șoferului.", "metrics": {"boarding_ease": {"label": "Ușurința urcării", "min": "Foarte dificilă", "max": "Foarte ușoară"}, "door_interference": {"label": "Deranjul cauzat de ușă la urcare", "min": "Foarte deranjant", "max": "Fără deranj"}, "metric-0-5584803900479581": {"label": "Ușurința așezării pe scaunul șoferului", "min": "Foarte dificilă", "max": "Foarte ușoară"}}},
      "cross_cab_access": {"title": "Deplasarea prin cabină", "instruction": "A fost ușor să vă deplasați prin cabină? Evaluați trecerea de la scaunul șoferului la scaunul pasagerului și la cușetă. Luați în considerare obstacole precum volanul, consola centrală, tunelul motorului și spațiul de depozitare superior din față.", "metrics": {"cross_cab_access_ease": {"label": "Deplasarea prin cabină", "min": "Foarte îngreunată", "max": "Fără dificultate"}}},
      "ergonomics": {"title": "Ergonomia șoferului - scaun și volan", "instruction": "Încercați să găsiți cât mai multe poziții pe volan în care este confortabil să țineți sau să sprijiniți mâinile și coatele.", "metrics": {"adjustability": {"label": "Reglabilitate", "min": "Limitată", "max": "Se reglează ușor după preferință"}, "ergonomics_overall": {"label": "Câte poziții confortabile pentru mâini ați găsit?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ergonomia șoferului – În timpul condusului", "instruction": "În timpul condusului, localizați butoanele pentru funcțiile active de siguranță, tempomat și climatizare. Observați unde sunt amplasate: este intuitiv să le găsiți și să le aveți la îndemână?", "metrics": {"intuitive_reach": {"label": "Intuitiv și ușor de găsit", "min": "Dificil/dezordonat", "max": "Ușor și bine grupat"}}},
      "fit_finish": {"title": "Viața în cabină – Aspecte practice", "instruction": "De pe scaunul pasagerului, ridicați-vă și deschideți cuptorul cu microunde. Scoateți farfuria și simulați o masă, stând la masă. Evaluați confortul și spațiul pentru picioare. \nDe pe cușetă, găsiți o poziție confortabilă pentru citit.", "metrics": {"living_comfort": {"label": "Confort de locuit", "min": "Restrâns", "max": "Bine gândit"}}},
      "category-8-8": {"title": "Îmbinări și finisaje", "instruction": "Priviți în jur și evaluați aspectul și senzația interiorului. Luați în considerare, de exemplu, componentele, finisajul textilelor și soliditatea.", "metrics": {"metric-0-480407108384477": {"label": "Îmbinări și finisaje", "min": "Slabe", "max": "Excelente"}}},
      "safety": {"title": "Condus în siguranță – Vizibilitate directă", "instruction": "Rugați pasagerul să coboare din camion, apoi să meargă de-a lungul liniei galbene și să se oprească la marcaje. \nEvaluați vizibilitatea directă de pe scaunul șoferului.", "metrics": {"direct_vision": {"label": "Vizibilitate directă", "min": "Slabă", "max": "Foarte bună"}}},
      "cab_exit": {"title": "Coborârea din cabină", "instruction": "Deschideți ușa și coborâți cu spatele, cu fața spre cabină. \nVedeți treapta superioară de pe scaun? Evaluați cât de ușor este să treceți din poziția așezat la coborâre.", "metrics": {"cab_entry_exit": {"label": "Urcare și coborâre", "min": "Nesigură", "max": "Naturală și fără efort"}}},
    },
    sk: {
      "cab": {"title": "Hodnotenie kabíny a podvozku", "instruction": "Rozjazd z miesta na stúpaní.", "metrics": {"cab_assessment": {"label": "Pohodlie kabíny a odpruženia", "min": "Slabé", "max": "Veľmi dobré"}, "gear_shift": {"label": "Stabilita kabíny a podvozku", "min": "Veľmi nestabilná", "max": "Veľmi spoľahlivá"}}},
      "steering": {"title": "Ovládateľnosť a stabilita", "instruction": "Riadenie jednou rukou cez úsek s cestnými prácami a rýchle zákruty na slalomovej dráhe. Posúďte presnosť a ovládateľnosť riadenia.", "metrics": {"steering_precision": {"label": "Presnosť a ovládateľnosť riadenia", "min": "Náročné", "max": "Bez námahy"}}},
      "parking": {"title": "Odpruženie", "instruction": "Posúďte komfort podvozku a kabíny pri prejazde cez prekážku.", "metrics": {"precision_maneuver": {"label": "Celkový komfort", "min": "Veľmi citeľné", "max": "Sotva badateľné"}}},
      "category-6-6": {"title": "Radenie a výkon", "instruction": "Zrýchlite z nízkej rýchlosti. Posúďte radenie a výkon.", "metrics": {"metric": {"label": "Kvalita radenia", "min": "Trhavé", "max": "Plynulé"}, "metric-0-7084909693441334": {"label": "Výkon", "min": "Pomalé a slabnúce zrýchlenie", "max": "Silné a plynulé zrýchlenie"}}},
      "category-7-7": {"title": "Manévrovanie", "instruction": "Posúďte presnosť parkovania. Pre nákladné vozidlá Scania s aktívnym manévrovacím režimom.", "metrics": {"manoeuvring_ease": {"label": "Ľahkosť manévrovania", "min": "Nepresné", "max": "Presné na milimetre"}}},
      "overall": {"title": "Celkový dojem z jazdy", "instruction": "Po dokončení všetkých úloh uveďte svoj celkový dojem z jazdy s týmto vozidlom.", "metrics": {"overall_exp": {"label": "Celkový dojem z jazdy", "min": "Nepôsobivý", "max": "Prémiový"}}},
      "boarding": {"title": "Nastupovanie do kabíny - Strana vodiča", "instruction": "Všetci traja delegáti nastupujú do kabíny zo strany vodiča. \nJeden sedí na sedadle spolujazdca, jeden na lôžku s iPadom a jeden na sedadle vodiča.", "metrics": {"boarding_ease": {"label": "Ľahkosť nastupovania", "min": "Veľmi ťažké", "max": "Veľmi ľahké"}, "door_interference": {"label": "Dvere pri nastupovaní", "min": "Veľmi prekážajú", "max": "Neprekážajú"}, "metric-0-5584803900479581": {"label": "Ľahkosť usadenia sa na sedadle vodiča", "min": "Veľmi ťažké", "max": "Veľmi ľahké"}}},
      "cross_cab_access": {"title": "Pohyb v kabíne", "instruction": "Bolo ľahké pohybovať sa v kabíne? Posúďte presun zo sedadla vodiča na sedadlo spolujazdca a na lôžko. Zohľadnite prekážky, ako sú volant, stredová konzola, motorový tunel a predný horný úložný priestor.", "metrics": {"cross_cab_access_ease": {"label": "Pohyb v kabíne", "min": "Veľmi obmedzený", "max": "Bez ťažkostí"}}},
      "ergonomics": {"title": "Ergonómia vodiča - sedadlo a volant", "instruction": "Skúste nájsť čo najviac polôh na volante, v ktorých je pohodlné držať alebo opierať ruky a lakte.", "metrics": {"adjustability": {"label": "Nastaviteľnosť", "min": "Obmedzujúca", "max": "Ľahko nájdem svoju polohu"}, "ergonomics_overall": {"label": "Koľko pohodlných polôh rúk ste našli?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ergonómia vodiča – Počas jazdy", "instruction": "Počas jazdy vyhľadajte tlačidlá aktívnych bezpečnostných funkcií, tempomatu a klimatizácie. Všímajte si, kde sa nachádzajú: je ľahké ich intuitívne nájsť a dočiahnuť na ne?", "metrics": {"intuitive_reach": {"label": "Intuitívne a ľahko dostupné", "min": "Ťažké/neprehľadné", "max": "Ľahké a dobre zoskupené"}}},
      "fit_finish": {"title": "Bývanie – Praktickosť", "instruction": "Zo sedadla spolujazdca vstaňte a otvorte mikrovlnnú rúru. Vyberte tanier a nasimulujte jedlo v sede pri stole. Posúďte pohodlie a priestor pre nohy. \nZ lôžka nájdite pohodlnú polohu na čítanie.", "metrics": {"living_comfort": {"label": "Komfort bývania", "min": "Obmedzený", "max": "Premyslený"}}},
      "category-8-8": {"title": "Spracovanie a kvalita vyhotovenia", "instruction": "Obzrite sa okolo seba a posúďte vzhľad a pocit z interiéru. Zohľadnite napríklad komponenty, spracovanie textílií a pevnosť.", "metrics": {"metric-0-480407108384477": {"label": "Spracovanie a kvalita vyhotovenia", "min": "Slabé", "max": "Vysoké"}}},
      "safety": {"title": "Bezpečná jazda – Priamy výhľad", "instruction": "Nechajte spolujazdca vystúpiť z vozidla, prejsť pozdĺž žltej čiary a zastaviť pri značkách. \nPosúďte priamy výhľad zo sedadla vodiča.", "metrics": {"direct_vision": {"label": "Priamy výhľad", "min": "Zlý", "max": "Veľmi dobrý"}}},
      "cab_exit": {"title": "Výstup z kabíny", "instruction": "Otvorte dvere a vystúpte chrbtom von. \nVidíte zo svojho sedadla najvyšší schod? Posúďte, aké ľahké je prejsť zo sedu k výstupu.", "metrics": {"cab_entry_exit": {"label": "Nástup do kabíny a výstup z nej", "min": "Nebezpečné", "max": "Prirodzené a bez námahy"}}},
    },
    sl: {
      "cab": {"title": "Ocena kabine in podvozja", "instruction": "Speljite z mesta v klancu.", "metrics": {"cab_assessment": {"label": "Udobje kabine in vzmetenja", "min": "Slabo", "max": "Zelo dobro"}, "gear_shift": {"label": "Stabilnost kabine in podvozja", "min": "Zelo nestabilna", "max": "Zelo zanesljiva"}}},
      "steering": {"title": "Vodljivost in stabilnost", "instruction": "Vožnja z eno roko skozi območje cestnih del in hitri zavoji na slalomski progi. Ocenite natančnost in nadzor krmiljenja.", "metrics": {"steering_precision": {"label": "Natančnost in nadzor krmiljenja", "min": "Zahtevno", "max": "Brez napora"}}},
      "parking": {"title": "Vzmetenje", "instruction": "Ocenite udobje podvozja in kabine pri vožnji čez oviro.", "metrics": {"precision_maneuver": {"label": "Splošno udobje", "min": "Zelo občutno", "max": "Komaj opazno"}}},
      "category-6-6": {"title": "Prestavljanje in zmogljivost", "instruction": "Pospešite z nizke hitrosti. Ocenite prestavljanje in moč.", "metrics": {"metric": {"label": "Kakovost prestavljanja", "min": "Sunkovito", "max": "Gladko"}, "metric-0-7084909693441334": {"label": "Moč", "min": "Počasen in pojemajoč pospešek", "max": "Močan in enakomeren pospešek"}}},
      "category-7-7": {"title": "Manevriranje", "instruction": "Ocenite natančnost parkiranja. Za tovornjake Scania z aktivnim načinom manevriranja.", "metrics": {"manoeuvring_ease": {"label": "Enostavnost manevriranja", "min": "Nenatančno", "max": "Milimetrska natančnost"}}},
      "overall": {"title": "Splošna vozniška izkušnja", "instruction": "Ko opravite vse naloge, podajte splošen vtis o vožnji s tem vozilom.", "metrics": {"overall_exp": {"label": "Splošna vozniška izkušnja", "min": "Neprepričljiva", "max": "Vrhunska"}}},
      "boarding": {"title": "Vstop v kabino - Voznikova stran", "instruction": "Vsi trije delegati vstopijo v kabino z voznikove strani. \nEden sedi na sovoznikovem sedežu, eden na ležišču z iPadom, eden pa na voznikovem sedežu.", "metrics": {"boarding_ease": {"label": "Enostavnost vstopa", "min": "Zelo težko", "max": "Zelo lahko"}, "door_interference": {"label": "Vrata pri vstopu", "min": "Zelo ovirajo", "max": "Ne ovirajo"}, "metric-0-5584803900479581": {"label": "Enostavnost sedanja na voznikov sedež", "min": "Zelo težko", "max": "Zelo lahko"}}},
      "cross_cab_access": {"title": "Premikanje po kabini", "instruction": "Ali je bilo premikanje po kabini lahko? Ocenite prehod z voznikovega sedeža na sovoznikov sedež in ležišče. Upoštevajte ovire, kot so volan, srednja konzola, motorni tunel in sprednji zgornji odlagalni prostor.", "metrics": {"cross_cab_access_ease": {"label": "Premikanje po kabini", "min": "Zelo oteženo", "max": "Brez težav"}}},
      "ergonomics": {"title": "Ergonomija voznika - sedež in volan", "instruction": "Poskusite najti čim več položajev na volanu, v katerih je udobno držati roke ali opirati roke in komolce.", "metrics": {"adjustability": {"label": "Nastavljivost", "min": "Omejujoča", "max": "Enostavno najdem svoj položaj"}, "ergonomics_overall": {"label": "Koliko udobnih položajev rok ste našli?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ergonomija voznika – Med vožnjo", "instruction": "Med vožnjo poiščite gumbe za aktivne varnostne funkcije, tempomat in klimatsko napravo. Bodite pozorni na to, kje so nameščeni: ali jih je intuitivno najti in doseči?", "metrics": {"intuitive_reach": {"label": "Intuitivno in lahko dosegljivo", "min": "Težko/neurejeno", "max": "Lahko in dobro razporejeno"}}},
      "fit_finish": {"title": "Bivanje – Praktičnost", "instruction": "S sovoznikovega sedeža vstanite in odprite mikrovalovno pečico. Vzemite krožnik in simulirajte obrok za mizo v sedečem položaju. Ocenite udobje in prostor za noge. \nNa ležišču poiščite udoben položaj za branje.", "metrics": {"living_comfort": {"label": "Udobje bivanja", "min": "Omejeno", "max": "Dobro premišljeno"}}},
      "category-8-8": {"title": "Izdelava in zaključna obdelava", "instruction": "Poglejte okoli sebe in ocenite videz in občutek notranjosti. Upoštevajte na primer komponente, obdelavo tekstila in trdnost.", "metrics": {"metric-0-480407108384477": {"label": "Izdelava in zaključna obdelava", "min": "Slaba", "max": "Visoka"}}},
      "safety": {"title": "Varna vožnja – Neposredna vidljivost", "instruction": "Naj sovoznik izstopi iz tovornjaka, hodi ob rumeni črti in se ustavi pri oznakah. \nOcenite neposredno vidljivost z voznikovega sedeža.", "metrics": {"direct_vision": {"label": "Neposredna vidljivost", "min": "Slaba", "max": "Zelo dobra"}}},
      "cab_exit": {"title": "Izstop iz kabine", "instruction": "Odprite vrata in izstopite s hrbtom navzven. \nAli s svojega sedeža vidite zgornjo stopnico? Ocenite, kako lahko je preiti iz sedečega položaja v izstop.", "metrics": {"cab_entry_exit": {"label": "Vstop v kabino in izstop iz nje", "min": "Nevaren", "max": "Naraven in brez napora"}}},
    },
    sr: {
      "cab": {"title": "Оцена кабине и шасије", "instruction": "Крените са места на успону.", "metrics": {"cab_assessment": {"label": "Удобност кабине и вешања", "min": "Лоша", "max": "Врло добра"}, "gear_shift": {"label": "Стабилност кабине и шасије", "min": "Врло нестабилна", "max": "Врло поуздана"}}},
      "steering": {"title": "Управљивост и стабилност", "instruction": "Вожња једном руком кроз зону радова на путу и брзи заокрети на слалом стази. Оцените прецизност и контролу управљања.", "metrics": {"steering_precision": {"label": "Прецизност и контрола управљања", "min": "Захтевно", "max": "Без напора"}}},
      "parking": {"title": "Вешање", "instruction": "Оцените удобност шасије и кабине при преласку преко препреке.", "metrics": {"precision_maneuver": {"label": "Општа удобност", "min": "Врло приметно", "max": "Једва приметно"}}},
      "category-6-6": {"title": "Мењање брзина и перформансе", "instruction": "Убрзајте са мале брзине. Оцените мењање брзина и снагу.", "metrics": {"metric": {"label": "Квалитет мењања брзина", "min": "Грубо", "max": "Глатко"}, "metric-0-7084909693441334": {"label": "Снага", "min": "Споро и слабеће убрзање", "max": "Снажно и непрекидно убрзање"}}},
      "category-7-7": {"title": "Маневрисање", "instruction": "Оцените прецизно паркирање. За Scania камионе са активним режимом маневрисања.", "metrics": {"manoeuvring_ease": {"label": "Лакоћа маневрисања", "min": "Неприцизно", "max": "Прецизно до милиметра"}}},
      "overall": {"title": "Општи утисак о вожњи", "instruction": "Након завршетка свих задатака, дајте свој општи утисак о вожњи овог возила.", "metrics": {"overall_exp": {"label": "Општи утисак о вожњи", "min": "Разочаравајуће", "max": "Премијум"}}},
      "boarding": {"title": "Улазак у кабину - Страна возача", "instruction": "Сва три делегата улазе у кабину са стране возача. \nЈедан седи на седишту сувозача, један на лежају са iPad-ом, а један на седишту возача.", "metrics": {"boarding_ease": {"label": "Лакоћа уласка", "min": "Врло тешко", "max": "Врло лако"}, "door_interference": {"label": "Врата сметају при уласку", "min": "Врло сметају", "max": "Не сметају"}, "metric-0-5584803900479581": {"label": "Лакоћа седања на седиште возача", "min": "Врло тешко", "max": "Врло лако"}}},
      "cross_cab_access": {"title": "Кретање кроз кабину", "instruction": "Да ли је било лако кретати се кроз кабину? Оцените прелазак са седишта возача на седиште сувозача и на лежај. Узмите у обзир препреке као што су волан, централна конзола, тунел мотора и предњи горњи простор за одлагање.", "metrics": {"cross_cab_access_ease": {"label": "Кретање кроз кабину", "min": "Врло отежано", "max": "Без потешкоћа"}}},
      "ergonomics": {"title": "Ергономија возача - седиште и волан", "instruction": "Покушајте да пронађете што више положаја на волану у којима је удобно држати руке или ослонити руке и лактове.", "metrics": {"adjustability": {"label": "Подешавање", "min": "Ограничавајуће", "max": "Лако налазим свој положај"}, "ergonomics_overall": {"label": "Колико удобних положаја за руке сте пронашли?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ергономија возача – Током вожње", "instruction": "Током вожње пронађите дугмад за активне безбедносне функције, темпомат и климатизацију. Обратите пажњу на то где се налазе: да ли је интуитивно пронаћи их и дохватити?", "metrics": {"intuitive_reach": {"label": "Интуитивно и лако за проналажење", "min": "Тешко/неуредно", "max": "Лако и добро груписано"}}},
      "fit_finish": {"title": "Живот у кабини – Практичност", "instruction": "Са седишта сувозача устаните и отворите микроталасну рерну. Извадите тањир и симулирајте оброк за столом у седећем положају. Оцените удобност и простор за ноге. \nСа лежаја пронађите удобан положај за читање.", "metrics": {"living_comfort": {"label": "Удобност боравка", "min": "Ограничена", "max": "Добро осмишљена"}}},
      "category-8-8": {"title": "Квалитет израде и завршне обраде", "instruction": "Погледајте око себе и оцените изглед и осећај ентеријера. Узмите у обзир, на пример, компоненте, обраду текстила и чврстину.", "metrics": {"metric-0-480407108384477": {"label": "Квалитет израде и завршне обраде", "min": "Низак", "max": "Висок"}}},
      "safety": {"title": "Безбедна вожња – Директна видљивост", "instruction": "Замолите путника да изађе из камиона, прође дуж жуте линије и стане код ознака. \nОцените директну видљивост са седишта возача.", "metrics": {"direct_vision": {"label": "Директна видљивост", "min": "Лоша", "max": "Врло добра"}}},
      "cab_exit": {"title": "Излазак из кабине", "instruction": "Отворите врата и изађите леђима окренутим напоље. \nДа ли са свог седишта видите највиши степеник? Оцените колико је лако прећи из седећег положаја у излазак.", "metrics": {"cab_entry_exit": {"label": "Улазак и излазак из кабине", "min": "Несигурно", "max": "Природно и без напора"}}},
    },
    uk: {
      "cab": {"title": "Оцінка кабіни та шасі", "instruction": "Рушайте з місця на підйомі.", "metrics": {"cab_assessment": {"label": "Комфорт кабіни та підвіски", "min": "Поганий", "max": "Дуже хороший"}, "gear_shift": {"label": "Стабільність кабіни та шасі", "min": "Дуже нестабільна", "max": "Дуже надійна"}}},
      "steering": {"title": "Керованість і стабільність", "instruction": "Керування однією рукою через ділянку дорожніх робіт і швидкі повороти на слаломній трасі. Оцініть точність і контроль керування.", "metrics": {"steering_precision": {"label": "Точність і контроль керування", "min": "Вимогливе", "max": "Без зусиль"}}},
      "parking": {"title": "Підвіска", "instruction": "Оцініть комфорт шасі та кабіни під час проїзду через перешкоду.", "metrics": {"precision_maneuver": {"label": "Загальний комфорт", "min": "Дуже відчутно", "max": "Ледь помітно"}}},
      "category-6-6": {"title": "Перемикання передач і динаміка", "instruction": "Прискорюйтеся з низької швидкості. Оцініть перемикання передач і потужність.", "metrics": {"metric": {"label": "Якість перемикання передач", "min": "Ривкова", "max": "Плавна"}, "metric-0-7084909693441334": {"label": "Потужність", "min": "Повільне й згасаюче прискорення", "max": "Потужне й безперервне прискорення"}}},
      "category-7-7": {"title": "Маневрування", "instruction": "Оцініть точне паркування. Для вантажівок Scania з активним режимом маневрування.", "metrics": {"manoeuvring_ease": {"label": "Легкість маневрування", "min": "Неточно", "max": "Точно до міліметра"}}},
      "overall": {"title": "Загальне враження від водіння", "instruction": "Після виконання всіх завдань поділіться загальним враженням від водіння цього транспортного засобу.", "metrics": {"overall_exp": {"label": "Загальне враження від водіння", "min": "Розчаровує", "max": "Преміум"}}},
      "boarding": {"title": "Вхід у кабіну - З боку водія", "instruction": "Усі троє делегатів заходять у кабіну з боку водія. \nОдин сидить на сидінні пасажира, один на спальному місці з iPad, а один на сидінні водія.", "metrics": {"boarding_ease": {"label": "Легкість входу в кабіну", "min": "Дуже важко", "max": "Дуже легко"}, "door_interference": {"label": "Двері заважають під час входу", "min": "Дуже заважають", "max": "Не заважають"}, "metric-0-5584803900479581": {"label": "Легкість посадки на сидіння водія", "min": "Дуже важко", "max": "Дуже легко"}}},
      "cross_cab_access": {"title": "Пересування кабіною", "instruction": "Чи було легко пересуватися кабіною? Оцініть перехід із сидіння водія на сидіння пасажира та спальне місце. Врахуйте перешкоди, як-от кермо, центральна консоль, моторний тунель і переднє верхнє відділення для речей.", "metrics": {"cross_cab_access_ease": {"label": "Пересування кабіною", "min": "Дуже утруднене", "max": "Без труднощів"}}},
      "ergonomics": {"title": "Ергономіка водія - сидіння та кермо", "instruction": "Спробуйте знайти якомога більше положень на кермі, у яких зручно тримати руки або спирати руки й лікті.", "metrics": {"adjustability": {"label": "Регулювання", "min": "Обмежене", "max": "Легко знайти своє положення"}, "ergonomics_overall": {"label": "Скільки зручних положень рук Ви знайшли?", "min": "0", "max": "10"}}},
      "ergonomics_driving": {"title": "Ергономіка водія – Під час руху", "instruction": "Під час руху знайдіть кнопки активних функцій безпеки, круїз-контролю та клімат-контролю. Зверніть увагу на їх розташування: чи інтуїтивно їх знайти й дотягнутися?", "metrics": {"intuitive_reach": {"label": "Інтуїтивно та легко знайти", "min": "Важко/безладно", "max": "Легко й добре згруповано"}}},
      "fit_finish": {"title": "Життя в кабіні – Практичність", "instruction": "З сидіння пасажира встаньте та відкрийте мікрохвильову піч. Дістаньте тарілку й імітуйте прийом їжі за столом сидячи. Оцініть комфорт і простір для ніг. \nЗі спального місця знайдіть зручну позу для читання.", "metrics": {"living_comfort": {"label": "Комфорт перебування в кабіні", "min": "Обмежений", "max": "Продуманий"}}},
      "category-8-8": {"title": "Якість збірки та оздоблення", "instruction": "Огляньтеся навколо й оцініть вигляд і відчуття від салону. Врахуйте, наприклад, компоненти, оздоблення тканин і міцність.", "metrics": {"metric-0-480407108384477": {"label": "Якість збірки та оздоблення", "min": "Погана", "max": "Висока"}}},
      "safety": {"title": "Безпечне водіння – Пряма видимість", "instruction": "Попросіть пасажира вийти з вантажівки, пройти вздовж жовтої лінії та зупинитися біля позначок. \nОцініть пряму видимість із сидіння водія.", "metrics": {"direct_vision": {"label": "Пряма видимість", "min": "Погана", "max": "Дуже хороша"}}},
      "cab_exit": {"title": "Вихід із кабіни", "instruction": "Відчиніть двері та виходьте спиною назовні. \nЧи бачите Ви найвищу сходинку зі свого сидіння? Оцініть, наскільки легко перейти з положення сидячи до виходу.", "metrics": {"cab_entry_exit": {"label": "Вхід і вихід із кабіни", "min": "Небезпечно", "max": "Природно й без зусиль"}}},
    },
  };
  /* ---------- is a translation still in step with the English? ----------
     Built-in translations (QI18N) are keyed by category id, so editing the
     English text silently leaves them describing the old wording. To make
     that visible, every checked translation carries a fingerprint of the
     English it was written against (QI18N_SRC for the built-in ones, `_src`
     on an admin override); admin compares it with the English as it is now.
     Typo fixes in the English do count as a change on purpose — it is cheap
     to look at a translation and press "Mark as up to date". */
  function srcHash(cat) {
    const n = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
    const s = JSON.stringify([n(cat.title), n(cat.instruction), (cat.metrics || []).map((m) => [m.id, n(m.label), n(m.min), n(m.max)])]);
    let hsh = 5381;
    for (let i = 0; i < s.length; i++) hsh = ((hsh * 33) ^ s.charCodeAt(i)) >>> 0;
    return hsh.toString(36);
  }
  /* French, Portuguese, Spanish, Italian, Dutch and Polish were checked against
     the English as it stood on 2026-10-05; these are fingerprints of that
     English (srcHash). Other languages have no fingerprint → 'unverified'. */
  const QI18N_SRC = {};
  QI18N_SRC.fr = QI18N_SRC.pt = QI18N_SRC.es = QI18N_SRC.it = QI18N_SRC.nl = QI18N_SRC.pl = QI18N_SRC.da = QI18N_SRC.no = QI18N_SRC.fi = QI18N_SRC.cs = QI18N_SRC.hu = QI18N_SRC.ro = QI18N_SRC.et = QI18N_SRC.lv = QI18N_SRC.lt = QI18N_SRC.sk = QI18N_SRC.sl = QI18N_SRC.uk = QI18N_SRC.bg = QI18N_SRC.sr = QI18N_SRC.sv = {
    "cab": "1e23avy",
    "steering": "127w8tu",
    "parking": "1swr08n",
    "category-6-6": "i4tozv",
    "category-7-7": "ylgqol",
    "overall": "1vih4xe",
    "boarding": "1gggs5x",
    "cross_cab_access": "12ndffm",
    "ergonomics": "1y15wsa",
    "ergonomics_driving": "1fjezk2",
    "fit_finish": "q8kuqk",
    "category-8-8": "hleptf",
    "safety": "xqru2e",
    "cab_exit": "1j7684h"
  };
  /* 'ok' · 'stale' (English changed since) · 'unverified' (a translation
     exists but was never checked against the current English) · 'missing' */
  function translationStatus(lang, cat) {
    if (!lang || lang === 'en') return 'ok';
    const override = state.translations[lang] && state.translations[lang][cat.id];
    const base = QI18N[lang] && QI18N[lang][cat.id];
    const cur = srcHash(cat);
    if (override && override._src) return override._src === cur ? 'ok' : 'stale';
    const fp = QI18N_SRC[lang] && QI18N_SRC[lang][cat.id];
    if (base && fp) return fp === cur ? 'ok' : 'stale';
    if (base || (override && (override.title || override.instruction || override.metrics))) return 'unverified';
    return 'missing';
  }

  const tCat = (cat) => {
    const lang = state.lang;
    const base = QI18N[lang] && QI18N[lang][cat.id];
    const override = state.translations[lang] && state.translations[lang][cat.id];
    if (!base && !override) return cat;
    return {
      ...cat,
      title: (override && override.title) || (base && base.title) || cat.title,
      instruction: (override && override.instruction) || (base && base.instruction) || cat.instruction,
      metrics: cat.metrics.map((m) => {
        const bm = base && base.metrics && base.metrics[m.id];
        const om = override && override.metrics && override.metrics[m.id];
        if (!bm && !om) return m;
        return {
          ...m,
          label: (om && om.label) || (bm && bm.label) || m.label,
          min: (om && om.min) || (bm && bm.min) || m.min,
          max: (om && om.max) || (bm && bm.max) || m.max,
        };
      }),
    };
  };

  /* ---------- shared data state ---------- */
  const state = {
    lang: 'en',
    country: '',
    group: '',     // active session/group name set by admin
    questions: DEFAULT_QUESTIONS,
    vehicles: DEFAULT_VEHICLES,
    answers: {},   // { vehicleId: { metricId: value } }
    cabQuestions: DEFAULT_CAB_QUESTIONS,
    cabVehicles: DEFAULT_CAB_VEHICLES,
    cabAnswers: {},
    translations: {},   // admin-edited overrides: { [langCode]: { [catId]: { title, instruction, metrics: { [metricId]: { label, min, max } } } } }
  };

  /* ---------- persistence ---------- */
  function save() {
    const { lang, country, group, questions, vehicles, answers, cabQuestions, cabVehicles, cabAnswers, translations } = state;
    localStorage.setItem(STORE_KEY, JSON.stringify({ lang, country, group, questions, vehicles, answers, cabQuestions, cabVehicles, cabAnswers, translations }));
  }
  function load(isFreshBoot) {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) { seedDemo(); return; }
      const d = JSON.parse(raw);
      /* Only a genuine fresh boot (the very first load() call this page
         load) resets language/market to English/unpicked, regardless of
         what the last visitor had set — a kiosk reload (or simply someone
         new walking up after the tablet went idle) should never greet the
         next person in whoever-was-last's language or with their market
         already selected.

         load() is ALSO called reactively on a 'storage' event, to pick up
         a config edit made from another open tab (e.g. admin) without a
         manual refresh — isFreshBoot is false there, and this leaves
         state.lang/state.country completely untouched, still whatever
         this tab's own visitor has already picked. Resetting them
         unconditionally here used to wipe out a selection mid-flow
         whenever any other same-origin tab's own sync timer happened to
         save() in the background — easy to trigger with several tabs
         open at once, as happened repeatedly while testing this app, but
         just as possible in practice with an admin tab open alongside a
         kiosk tab on the same browser. */
      if (isFreshBoot) {
        state.lang = 'en';
        state.country = '';
      }
      const today = new Date().toISOString().slice(0, 10);
      state.group = d.group || today;
      state.questions = normaliseQuestions((d.questions && d.questions.length) ? d.questions : DEFAULT_QUESTIONS);
      state.vehicles = (d.vehicles && d.vehicles.length) ? d.vehicles : DEFAULT_VEHICLES;
      state.answers = d.answers || {};
      state.cabQuestions = normaliseQuestions((d.cabQuestions && d.cabQuestions.length) ? d.cabQuestions : DEFAULT_CAB_QUESTIONS);
      state.cabVehicles = (d.cabVehicles && d.cabVehicles.length) ? d.cabVehicles : DEFAULT_CAB_VEHICLES;
      state.cabAnswers = d.cabAnswers || {};
      state.translations = d.translations || {};
      /* Only a real boot writes back (to persist any codes just backfilled
         onto pre-existing local data). A load that's merely reacting to a
         'storage' event from another tab must NOT: save() also writes this
         tab's own state.lang/state.country into the shared blob, and two
         tabs of the app almost always disagree on those (one visitor's
         pick vs the other's default), so each tab's write changed the
         blob, fired a storage event in the other tab, which re-loaded,
         re-wrote and fired one back — an endless ping-pong re-rendering
         both tabs hundreds of times a second. The visible result was a
         blank, unclickable page (every render restarts the fade-in from
         opacity 0) for as long as a second tab stayed open, e.g. the
         admin page next to a kiosk tab, even across reloads. */
      if (isFreshBoot) save();
    } catch (e) { seedDemo(); }
  }

  /* deterministic demo data so the results view looks alive on first run */
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function seedDemo() {
    const base = { scania: 8.8, mercedes: 8.0, volvo: 7.6, daf: 6.3, man: 5.7 };
    const ans = {};
    state.vehicles.forEach((v) => {
      ans[v.id] = {};
      state.questions.forEach((q) => q.metrics.forEach((m) => {
        const rnd = mulberry32(hashStr(v.id + m.id))();
        ans[v.id][m.id] = clamp(Math.round(base[v.brand] + (rnd * 4 - 2)), 0, 10);
      }));
    });
    state.answers = ans;
    save();
  }

  /* Overwrite the locally-editable config (questions/vehicles/translations)
     with a version pulled from the shared Sheets backend, so an edit made
     on one device's admin page reaches every other device running the
     app — see sheets.js's syncConfig() for when this gets called. */
  function getConfigBundle() {
    return {
      questions: state.questions,
      cabQuestions: state.cabQuestions,
      vehicles: state.vehicles,
      cabVehicles: state.cabVehicles,
      translations: state.translations,
    };
  }
  function applyRemoteConfig(cfg) {
    if (!cfg) return;
    if (Array.isArray(cfg.questions) && cfg.questions.length) state.questions = normaliseQuestions(cfg.questions);
    if (Array.isArray(cfg.cabQuestions) && cfg.cabQuestions.length) state.cabQuestions = normaliseQuestions(cfg.cabQuestions);
    if (Array.isArray(cfg.vehicles) && cfg.vehicles.length) state.vehicles = cfg.vehicles;
    if (Array.isArray(cfg.cabVehicles) && cfg.cabVehicles.length) state.cabVehicles = cfg.cabVehicles;
    if (cfg.translations && typeof cfg.translations === 'object') state.translations = cfg.translations;
    save();
    if (typeof STD.onQuestionsChanged === 'function') STD.onQuestionsChanged();
  }

  function normaliseCategory(c) {
    return {
      id: c.id || slug(c.title),
      code: c.code || '',   // permanent Sheets column code — see assignCodes below
      title: c.title || 'Untitled category',
      instruction: c.instruction || '',
      routeIcon: c.routeIcon || '',   // shown on the test-drive question screen; travels with the category, not its position
      metrics: (c.metrics || []).map((m) => ({
        id: m.id || slug(m.label),
        code: m.code || '',
        label: m.label || 'Untitled metric',
        min: m.min || 'Low', max: m.max || 'High',
        scale: m.scale || 10,
      })),
    };
  }

  /* Stämplar varje kategori och mätvärde med en permanent kod ("1", "2",
     "1a", "1b" …) EN gång, när den skapas — aldrig omräknad efteråt, även
     om frågan döps om eller listan sorteras om senare. Den koden, inte den
     fritt redigerbara titeln/labeln, är vad Sheets-kolumnen i
     google-apps-script.js matchar mot (se buildPayload i sheets.js) — så
     att döpa om en fråga i editorn aldrig mer skapar en ny kolumn i
     kalkylarket istället för att fortsätta fylla den gamla. En kategori med
     bara ett mätvärde får ingen bokstav (koden är bara kategorins nummer);
     flera mätvärden i samma kategori får "a", "b", … i tillägg. */
  function assignCodes(categories) {
    let maxCode = 0;
    categories.forEach((c) => {
      const n = parseInt(c.code, 10);
      if (Number.isFinite(n) && n > maxCode) maxCode = n;
    });
    categories.forEach((c) => { if (!c.code) { maxCode += 1; c.code = String(maxCode); } });
    categories.forEach((c) => {
      const metrics = c.metrics || [];
      if (metrics.length === 1) { if (!metrics[0].code) metrics[0].code = c.code; return; }
      const used = new Set();
      metrics.forEach((m) => {
        if (m.code && m.code.slice(0, c.code.length) === c.code) {
          const suffix = m.code.slice(c.code.length);
          if (/^[a-z]$/.test(suffix)) used.add(suffix);
        }
      });
      let li = 0;
      metrics.forEach((m) => {
        if (m.code) return;
        while (used.has(String.fromCharCode(97 + li))) li++;
        const letter = String.fromCharCode(97 + li);
        used.add(letter);
        m.code = c.code + letter;
      });
    });
    return categories;
  }

  function normaliseQuestions(list) {
    return assignCodes((list || []).map(normaliseCategory));
  }

  /* ---------- scoring ---------- */
  function vehicleCategoryScore(vehicleId, cat) {
    const a = state.answers[vehicleId]; if (!a) return null;
    const vals = cat.metrics.map((m) => a[m.id]).filter((v) => typeof v === 'number');
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }
  function vehicleOverall(vehicleId) {
    const scores = state.questions.map((c) => vehicleCategoryScore(vehicleId, c)).filter((s) => s != null);
    if (!scores.length) return null;
    return scores.reduce((s, v) => s + v, 0) / scores.length;
  }
  function evaluatedVehicles() { return state.vehicles.filter((v) => state.answers[v.id] && Object.keys(state.answers[v.id]).length); }
  function brandsPresent() {
    const set = new Set(evaluatedVehicles().map((v) => v.brand));
    return Object.keys(BRANDS).filter((b) => set.has(b));
  }
  function brandCategoryScore(brand, cat) {
    const vs = evaluatedVehicles().filter((v) => v.brand === brand)
      .map((v) => vehicleCategoryScore(v.id, cat)).filter((s) => s != null);
    if (!vs.length) return null;
    return vs.reduce((s, v) => s + v, 0) / vs.length;
  }
  function computeAll() {
    return {
      categories: state.questions.map((c) => ({
        title: c.title,
        bars: brandsPresent().map((b) => ({ brand: b, score: brandCategoryScore(b, c) })).filter((x) => x.score != null),
      })),
      vehicles: evaluatedVehicles().map((v) => ({ name: v.name, brand: v.brand, overall: vehicleOverall(v.id) })),
    };
  }

  /* ============================================================
     PUBLIC API — change the questions programmatically
     e.g.  ScaniaEval.setQuestions([...])  /  ScaniaEval.getQuestions()
     ============================================================ */
  /* ---------- idle guard ----------
     A visitor who walks away mid-flow would leave their language, market and
     half-finished answers on screen for the next person. After `promptMs`
     with no touch the app asks "Are you still there?" and, if nobody answers
     within `countdownMs`, calls `onTimeout` (the apps pass their own Restart
     handler, so it resets exactly like pressing RESTART). Time is measured
     from timestamps, so a throttled/dimmed tablet doesn't drift. */
  function startIdleGuard({ isActive, onTimeout, promptMs, countdownMs }) {
    let last = Date.now(), overlay = null, deadline = 0, msgEl = null;
    const tx = (k) => (t()[k] || T.en[k]);
    const touch = () => { if (!overlay) last = Date.now(); };
    ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, touch, true));
    function close() { if (overlay) { overlay.remove(); overlay = null; msgEl = null; } last = Date.now(); }
    function open() {
      deadline = Date.now() + countdownMs;
      overlay = h(`<div class="confirm-overlay" role="alertdialog"><div class="confirm-box">
        <p class="confirm-box__title">${esc(tx('idleTitle'))}</p>
        <p class="confirm-box__msg"></p>
        <div class="confirm-box__btns"><button class="btn-confirm">${esc(tx('idleContinue'))}</button></div>
      </div></div>`);
      msgEl = overlay.querySelector('.confirm-box__msg');
      overlay.querySelector('.btn-confirm').onclick = close;
      document.body.appendChild(overlay);
    }
    setInterval(() => {
      if (!isActive()) { if (overlay) close(); last = Date.now(); return; }
      if (!overlay) { if (Date.now() - last >= promptMs) open(); }
      if (overlay) {
        const left = Math.ceil((deadline - Date.now()) / 1000);
        if (left <= 0) { close(); onTimeout(); return; }
        msgEl.textContent = tx('idleMsg').replace('{n}', left);
      }
    }, 1000);
  }

  const STD = {
    STORE_KEY, $, h, esc, clamp, hashStr, slug,
    BRANDS, brandOf, startIdleGuard, srcHash, translationStatus, QI18N_SRC, DEFAULT_VEHICLES, DEFAULT_QUESTIONS, DEFAULT_CAB_VEHICLES, DEFAULT_CAB_QUESTIONS, LANGS, COUNTRIES, T, t, tCat, QI18N,
    state, save, load, seedDemo, normaliseCategory, normaliseQuestions, getConfigBundle, applyRemoteConfig,
    vehicleCategoryScore, vehicleOverall, evaluatedVehicles, brandsPresent, brandCategoryScore, computeAll,
    onQuestionsChanged: null,   // pages set this to re-render when questions change
  };
  /* Cab Assessment's per-category icons, by category id — used by cab.js and
     previewed read-only in the admin editor. */
  STD.CAB_ICONS = {
    boarding: 'assets/icons/cab-entry.svg?v=1',
    cross_cab_access: 'assets/icons/cross-cab-access.svg?v=1',
    ergonomics: 'assets/icons/driver-ergonomics-1.svg?v=2',
    ergonomics_driving: 'assets/icons/driver-ergonomics-2.svg?v=1',
    fit_finish: 'assets/icons/living.svg?v=1',
    'category-8-8': 'assets/icons/fit-and-finish.svg?v=1',
    safety: 'assets/icons/safe-driving.svg?v=1',
    cab_exit: 'assets/icons/cab-exit.svg?v=1',
  };
  window.STD = STD;

  /* Haptic feedback — short vibration on any interactive button tap */
  if ('vibrate' in navigator) {
    document.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('button, .pill, .vehicle, .linkbtn, [role="button"]');
      if (el && !el.disabled) navigator.vibrate(8);
    }, { passive: true });
  }

  /* Kiosk viewport height — 100dvh is meant to track the real visible
     viewport, but on some Android browsers it doesn't reliably recompute
     right after a JS-triggered fullscreen transition (only after a scroll
     gesture), so the app briefly renders sized for the wrong height —
     taller than the actual screen, with the outgoing intro's full-page
     pattern still visible underneath the incoming screen's own pattern
     until something else forces a relayout. Drive the height from a
     JS-measured custom property instead, refreshed on every event that can
     actually change it, so it never depends on the browser getting that
     recalculation right on its own. */
  (function () {
    if (!document.body.classList.contains('test')) return;
    function setVH() { document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px'); }
    setVH();
    /* The very first read, at parse time, can itself still land mid-settle
       on a cold app launch — re-check a few times just after, since a
       stale value here has no later event to correct it. */
    requestAnimationFrame(setVH);
    setTimeout(setVH, 300);
    setTimeout(setVH, 1000);
    window.addEventListener('load', setVH);
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', setVH);
    document.addEventListener('fullscreenchange', setVH);
    document.addEventListener('webkitfullscreenchange', setVH);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', setVH);
  })();

  /* Wake Lock — keep screen on while the app is in the foreground */
  (function () {
    if (!('wakeLock' in navigator)) return;
    var lock = null;
    function acquire() {
      navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {});
    }
    acquire();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') acquire();
    });
  })();

  /* Service worker + auto-update — kiosk tablets sit open for hours between
     reopens, so pushing a fix doesn't reach them until something reloads the
     page. Poll the SW for updates in the background; once a new version has
     taken over, apply it the next time the app is idle at the intro screen
     rather than mid-evaluation, so a driver never loses their answers. */
  (function () {
    if (!('serviceWorker' in navigator) || !document.body.classList.contains('test')) return;
    var updateReady = false;
    function maybeReload() {
      if (updateReady && document.body.classList.contains('is-intro')) location.reload();
    }
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      setInterval(function () { reg.update().catch(function () {}); }, 5 * 60 * 1000);
    }).catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      updateReady = true;
      maybeReload();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') maybeReload();
    });
    new MutationObserver(maybeReload).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  })();

  window.ScaniaEval = {
    getQuestions: () => JSON.parse(JSON.stringify(state.questions)),
    setQuestions(questions) {
      if (!Array.isArray(questions) || !questions.length) throw new Error('setQuestions expects a non-empty array');
      state.questions = normaliseQuestions(questions);
      save();
      if (typeof STD.onQuestionsChanged === 'function') STD.onQuestionsChanged();
      return window.ScaniaEval.getQuestions();
    },
    addQuestion(cat) { return window.ScaniaEval.setQuestions([...state.questions, cat]); },
    resetQuestions() { return window.ScaniaEval.setQuestions(DEFAULT_QUESTIONS); },
    getResults: () => computeAll(),
  };
})();
