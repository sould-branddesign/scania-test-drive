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
  const DEFAULT_VEHICLES = [
    'Scania 606 40S', 'Mercedes eActros',
    'Scania 516 500R', 'Volvo FH Aero',
    'Scania 612 460R', 'MAN TGX',
    'Scania 610 560S', 'DAF XG+ 480',
    'Scania 601 33R', 'Volvo FH Electric',
    'Scania CS20H', 'Mercedes Actros',
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

  const DEFAULT_CAB_VEHICLES = [
    'Scania CR20H', 'Volvo FH Aero', 'MAN TGX', 'Mercedes Actros',
  ].map((name) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, brand: brandOf(name) }));

  const DEFAULT_CAB_QUESTIONS = [
    { id: 'boarding', title: 'Boarding & Exiting', instruction: 'Climb into and exit the cab. Assess the upper step visibility from above and overall ease of entry and exit.', metrics: [{ id: 'boarding_ease', label: 'Ease of boarding & exiting', min: 'Very difficult', max: 'Very easy', scale: 10 }] },
    { id: 'ergonomics', title: 'Ergonomics & Reachability', instruction: "Seated in driver's position: rate reachability of key controls, info display, and logical grouping of functions.", metrics: [{ id: 'ergonomics_overall', label: 'Overall ergonomics impression', min: 'Poor', max: 'Very good', scale: 10 }, { id: 'info_display', label: 'Info display', min: 'Poor', max: 'Very good', scale: 10 }] },
    { id: 'fit_finish', title: 'Fit & Finish', instruction: 'Evaluate material quality, color matching between surfaces, and consistency of panel gaps.', metrics: [{ id: 'overall_finish', label: 'Overall finish', min: 'Poor', max: 'Premium', scale: 10 }] },
    { id: 'safety', title: 'Safety & Direct Vision', instruction: "Assess direct field of vision. Props are placed at marked floor positions — note which are visible from the driver's seat.", metrics: [{ id: 'direct_vision', label: 'Direct vision — front & sides', min: 'Very limited', max: 'Excellent', scale: 10 }, { id: 'mirror_visibility', label: 'Side mirror visibility', min: 'Blocked', max: 'Clear', scale: 10 }] },
  ];

  /* ---------- i18n for UI chrome (test page) ---------- */
  const LANGS = [
    { code: 'bg', label: 'Bulgarian / Български' },
    { code: 'cs', label: 'Czech / Čeština' },
    { code: 'da', label: 'Danish / Dansk' },
    { code: 'nl', label: 'Dutch / Nederlands' },
    { code: 'en', label: 'English' },
    { code: 'et', label: 'Estonian / Eesti' },
    { code: 'fi', label: 'Finnish / Suomi' },
    { code: 'fr', label: 'French / Français' },
    { code: 'hu', label: 'Hungarian / Magyar' },
    { code: 'is', label: 'Icelandic / Íslenska' },
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
    { code: 'sv', label: 'Swedish / Svenska' },
    { code: 'uk', label: 'Ukrainian / Українська' },
  ];

  const COUNTRIES = [
    'Belgium','Bulgaria','Czech Republic','Denmark','Estonia','Finland',
    'France','Hungary','Iceland','Ireland','Israel','Italy',
    'Latvia','Lithuania','Luxembourg',
    'Norway','Poland','Portugal','Romania',
    'Serbia','Slovakia','Slovenia','Spain','Sweden','Switzerland',
    'Turkey','Ukraine','United Kingdom',
  ];
  const T = {
    en: { chooseLanguage: 'Choose language', welcome: 'Welcome to the evaluation of your test drive.', chooseVehicle: 'Choose your vehicle:', next: 'Next', back: 'Back', submit: 'Submit', done: 'Done', selectCategory: 'Select a category', thanks: 'Thank you!', submitted: (v) => `Your ratings for ${v} have been submitted.`, nextCar: 'Next truck', startOver: 'Start over', tap: 'Tap to start', restarting: (n) => `Restarting in ${n}s` },
    sq: { chooseLanguage: 'Zgjidhni gjuhën', welcome: 'Mirë se vini në vlerësimin e test drive-it tuaj.', chooseVehicle: 'Zgjidhni automjetin tuaj:', next: 'Tjetër', back: 'Mbrapa', submit: 'Dërgo', thanks: 'Faleminderit!', submitted: (v) => `Vlerësimet tuaja për ${v} janë dërguar.`, nextCar: 'Kamioni tjetër', startOver: 'Fillo përsëri', tap: 'Prekni për të filluar', restarting: (n) => `Rifillimi në ${n}s` },
    be: { chooseLanguage: 'Выберыце мову', welcome: 'Сардэчна запрашаем на ацэнку вашага тэст-драйву.', chooseVehicle: 'Выберыце вашу машыну:', next: 'Далей', back: 'Назад', submit: 'Адправіць', thanks: 'Дзякуй!', submitted: (v) => `Вашы ацэнкі для ${v} адпраўлены.`, nextCar: 'Наступны аўтамабіль', startOver: 'Пачаць спачатку', tap: 'Націсніце для пачатку', restarting: (n) => `Перазапуск праз ${n}с` },
    bs: { chooseLanguage: 'Odaberite jezik', welcome: 'Dobrodošli u ocjenu vašeg test vožnje.', chooseVehicle: 'Odaberite vaše vozilo:', next: 'Dalje', back: 'Nazad', submit: 'Pošalji', thanks: 'Hvala!', submitted: (v) => `Vaše ocjene za ${v} su poslane.`, nextCar: 'Sljedeći kamion', startOver: 'Počni iznova', tap: 'Dodirnite za početak', restarting: (n) => `Pokretanje za ${n}s` },
    bg: { chooseLanguage: 'Изберете език', welcome: 'Добре дошли в оценката на вашия тест драйв.', chooseVehicle: 'Изберете вашето превозно средство:', next: 'Напред', back: 'Назад', submit: 'Изпрати', done: 'Готово', selectCategory: 'Изберете категория', thanks: 'Благодаря!', submitted: (v) => `Вашите оценки за ${v} бяха изпратени.`, nextCar: 'Следващ камион', startOver: 'Започнете отначало', tap: 'Докоснете за начало', restarting: (n) => `Рестартиране след ${n}с` },
    ca: { chooseLanguage: "Trieu l'idioma", welcome: "Benvingut a l'avaluació del vostre test drive.", chooseVehicle: 'Trieu el vostre vehicle:', next: 'Següent', back: 'Enrere', submit: 'Enviar', thanks: 'Gràcies!', submitted: (v) => `Les vostres valoracions per ${v} han estat enviades.`, nextCar: 'Camió següent', startOver: 'Tornar a començar', tap: 'Toqueu per començar', restarting: (n) => `Reinici en ${n}s` },
    hr: { chooseLanguage: 'Odaberite jezik', welcome: 'Dobrodošli u ocjenu vašeg probnog vožnje.', chooseVehicle: 'Odaberite svoje vozilo:', next: 'Dalje', back: 'Natrag', submit: 'Pošalji', thanks: 'Hvala!', submitted: (v) => `Vaše ocjene za ${v} su poslane.`, nextCar: 'Sljedeći kamion', startOver: 'Počni iznova', tap: 'Dodirnite za početak', restarting: (n) => `Pokretanje za ${n}s` },
    cs: { chooseLanguage: 'Vyberte jazyk', welcome: 'Vítejte v hodnocení vaší zkušební jízdy.', chooseVehicle: 'Vyberte si vozidlo:', next: 'Další', back: 'Zpět', submit: 'Odeslat', done: 'Hotovo', selectCategory: 'Vyberte kategorii', thanks: 'Děkujeme!', submitted: (v) => `Vaše hodnocení pro ${v} bylo odesláno.`, nextCar: 'Další kamion', startOver: 'Začít znovu', tap: 'Klepnutím zahájíte', restarting: (n) => `Restartování za ${n}s` },
    da: { chooseLanguage: 'Vælg sprog', welcome: 'Velkommen til evalueringen af din prøvekørsel.', chooseVehicle: 'Vælg dit køretøj:', next: 'Næste', back: 'Tilbage', submit: 'Indsend', done: 'Færdig', selectCategory: 'Vælg en kategori', thanks: 'Tak!', submitted: (v) => `Dine vurderinger for ${v} er indsendt.`, nextCar: 'Næste lastbil', startOver: 'Start forfra', tap: 'Tryk for at starte', restarting: (n) => `Genstarter om ${n}s` },
    nl: { chooseLanguage: 'Kies taal', welcome: 'Welkom bij de evaluatie van uw proefrit.', chooseVehicle: 'Kies uw voertuig:', next: 'Volgende', back: 'Terug', submit: 'Verzenden', done: 'Klaar', selectCategory: 'Selecteer een categorie', thanks: 'Bedankt!', submitted: (v) => `Uw beoordelingen voor ${v} zijn ingediend.`, nextCar: 'Volgende vrachtwagen', startOver: 'Opnieuw beginnen', tap: 'Tik om te starten', restarting: (n) => `Opnieuw starten over ${n}s` },
    et: { chooseLanguage: 'Valige keel', welcome: 'Tere tulemast oma proovisõidu hindamisele.', chooseVehicle: 'Valige oma sõiduk:', next: 'Järgmine', back: 'Tagasi', submit: 'Esita', done: 'Valmis', selectCategory: 'Valige kategooria', thanks: 'Tänan!', submitted: (v) => `Teie hinnangud ${v} jaoks on esitatud.`, nextCar: 'Järgmine veoauto', startOver: 'Alusta uuesti', tap: 'Puudutage alustamiseks', restarting: (n) => `Taaskäivitamine ${n}s pärast` },
    fi: { chooseLanguage: 'Valitse kieli', welcome: 'Tervetuloa koeajosi arviointiin.', chooseVehicle: 'Valitse ajoneuvosi:', next: 'Seuraava', back: 'Takaisin', submit: 'Lähetä', done: 'Valmis', selectCategory: 'Valitse kategoria', thanks: 'Kiitos!', submitted: (v) => `Arviosi kohteesta ${v} on lähetetty.`, nextCar: 'Seuraava kuorma-auto', startOver: 'Aloita alusta', tap: 'Napauta aloittaaksesi', restarting: (n) => `Käynnistetään uudelleen ${n}s kuluttua` },
    fr: { chooseLanguage: 'Choisir la langue', welcome: "Bienvenue dans l'évaluation de votre essai.", chooseVehicle: 'Choisissez votre véhicule :', next: 'Suivant', back: 'Retour', submit: 'Envoyer', done: 'Terminé', selectCategory: 'Sélectionnez une catégorie', thanks: 'Merci !', submitted: (v) => `Vos évaluations pour ${v} ont été envoyées.`, nextCar: 'Autre véhicule', startOver: 'Recommencer', tap: 'Appuyez pour commencer', restarting: (n) => `Redémarrage dans ${n}s` },
    de: { chooseLanguage: 'Sprache wählen', welcome: 'Willkommen zur Bewertung Ihrer Probefahrt.', chooseVehicle: 'Wählen Sie Ihr Fahrzeug:', next: 'Weiter', back: 'Zurück', submit: 'Absenden', thanks: 'Danke!', submitted: (v) => `Ihre Bewertungen für ${v} wurden übermittelt.`, nextCar: 'Nächster LKW', startOver: 'Neu starten', tap: 'Tippen zum Starten', restarting: (n) => `Neustart in ${n}s` },
    el: { chooseLanguage: 'Επιλέξτε γλώσσα', welcome: 'Καλώς ήρθατε στην αξιολόγηση της δοκιμαστικής σας οδήγησης.', chooseVehicle: 'Επιλέξτε το όχημά σας:', next: 'Επόμενο', back: 'Πίσω', submit: 'Υποβολή', thanks: 'Ευχαριστώ!', submitted: (v) => `Οι αξιολογήσεις σας για ${v} υποβλήθηκαν.`, nextCar: 'Επόμενο φορτηγό', startOver: 'Ξεκινήστε από την αρχή', tap: 'Πατήστε για έναρξη', restarting: (n) => `Επανεκκίνηση σε ${n}s` },
    hu: { chooseLanguage: 'Válasszon nyelvet', welcome: 'Üdvözöljük a tesztvezetés értékelésén.', chooseVehicle: 'Válassza ki járművét:', next: 'Következő', back: 'Vissza', submit: 'Küldés', done: 'Kész', selectCategory: 'Válasszon kategóriát', thanks: 'Köszönöm!', submitted: (v) => `A ${v} értékelése elküldve.`, nextCar: 'Következő kamion', startOver: 'Kezdje újra', tap: 'Érintse az indításhoz', restarting: (n) => `Újraindítás ${n}s múlva` },
    is: { chooseLanguage: 'Veldu tungumál', welcome: 'Velkomin í mat á prufuakstri þínum.', chooseVehicle: 'Veldu ökutæki þitt:', next: 'Næst', back: 'Til baka', submit: 'Senda', done: 'Lokið', selectCategory: 'Veldu flokk', thanks: 'Takk!', submitted: (v) => `Einkunnir þínar fyrir ${v} hafa verið sendar.`, nextCar: 'Næsti vörubíll', startOver: 'Byrja aftur', tap: 'Snertu til að byrja', restarting: (n) => `Endurræsing eftir ${n}s` },
    it: { chooseLanguage: 'Scegli la lingua', welcome: 'Benvenuto nella valutazione del tuo test drive.', chooseVehicle: 'Scegli il tuo veicolo:', next: 'Avanti', back: 'Indietro', submit: 'Invia', done: 'Fatto', selectCategory: 'Seleziona una categoria', thanks: 'Grazie!', submitted: (v) => `Le tue valutazioni per ${v} sono state inviate.`, nextCar: 'Prossimo camion', startOver: 'Ricomincia', tap: 'Tocca per iniziare', restarting: (n) => `Riavvio tra ${n}s` },
    lv: { chooseLanguage: 'Izvēlieties valodu', welcome: 'Laipni lūdzam jūsu izmēģinājuma brauciena novērtējumā.', chooseVehicle: 'Izvēlieties savu transportlīdzekli:', next: 'Tālāk', back: 'Atpakaļ', submit: 'Iesniegt', done: 'Gatavs', selectCategory: 'Izvēlieties kategoriju', thanks: 'Paldies!', submitted: (v) => `Jūsu vērtējumi par ${v} ir iesniegti.`, nextCar: 'Nākamā kravas mašīna', startOver: 'Sākt no jauna', tap: 'Pieskarieties, lai sāktu', restarting: (n) => `Atsāknēšana pēc ${n}s` },
    lt: { chooseLanguage: 'Pasirinkite kalbą', welcome: 'Sveiki atvykę į jūsų bandomojo važiavimo vertinimą.', chooseVehicle: 'Pasirinkite savo transporto priemonę:', next: 'Kitas', back: 'Atgal', submit: 'Pateikti', done: 'Atlikta', selectCategory: 'Pasirinkite kategoriją', thanks: 'Ačiū!', submitted: (v) => `Jūsų įvertinimai dėl ${v} buvo pateikti.`, nextCar: 'Kitas sunkvežimis', startOver: 'Pradėti iš naujo', tap: 'Palieskite, kad pradėtumėte', restarting: (n) => `Paleidžiama iš naujo po ${n}s` },
    lb: { chooseLanguage: 'Sprooch wiele', welcome: 'Wëllkomm bei der Evaluatioun vun Ärer Testfaart.', chooseVehicle: 'Wielt Äert Gefier:', next: 'Weider', back: 'Zréck', submit: 'Schécken', thanks: 'Merci!', submitted: (v) => `Är Bewäertunge fir ${v} goufen ofgeschéckt.`, nextCar: 'Nächste LKW', startOver: 'Nei ufänken', tap: 'Tippt fir unzefänken', restarting: (n) => `Neistarten an ${n}s` },
    mk: { chooseLanguage: 'Изберете јазик', welcome: 'Добредојдовте на евалуацијата на вашата тест вожња.', chooseVehicle: 'Изберете го вашето возило:', next: 'Следно', back: 'Назад', submit: 'Испрати', thanks: 'Благодарам!', submitted: (v) => `Вашите оцени за ${v} се испратени.`, nextCar: 'Следен камион', startOver: 'Почни одново', tap: 'Допрете за почеток', restarting: (n) => `Рестартирање за ${n}s` },
    mt: { chooseLanguage: 'Agħżel il-lingwa', welcome: 'Merħba fl-evalwazzjoni tat-test drive tiegħek.', chooseVehicle: 'Agħżel il-vettura tiegħek:', next: 'Li jmiss', back: 'Lura', submit: 'Ibgħat', thanks: 'Grazzi!', submitted: (v) => `Il-klassifikazzjonijiet tiegħek għal ${v} ġew mibgħuta.`, nextCar: 'It-trakk li jmiss', startOver: 'Ibda mill-ġdid', tap: 'Agħfas biex tibda', restarting: (n) => `Jerġa jibda f'${n}s` },
    no: { chooseLanguage: 'Velg språk', welcome: 'Velkommen til evalueringen av din prøvekjøring.', chooseVehicle: 'Velg ditt kjøretøy:', next: 'Neste', back: 'Tilbake', submit: 'Send inn', done: 'Ferdig', selectCategory: 'Velg en kategori', thanks: 'Takk!', submitted: (v) => `Dine vurderinger for ${v} er sendt inn.`, nextCar: 'Neste lastebil', startOver: 'Start på nytt', tap: 'Trykk for å starte', restarting: (n) => `Starter på nytt om ${n}s` },
    pl: { chooseLanguage: 'Wybierz język', welcome: 'Witamy w ocenie jazdy próbnej.', chooseVehicle: 'Wybierz swój pojazd:', next: 'Dalej', back: 'Wstecz', submit: 'Wyślij', done: 'Gotowe', selectCategory: 'Wybierz kategorię', thanks: 'Dziękujemy!', submitted: (v) => `Twoje oceny dla ${v} zostały przesłane.`, nextCar: 'Następna ciężarówka', startOver: 'Zacznij od nowa', tap: 'Dotknij, aby rozpocząć', restarting: (n) => `Ponowne uruchomienie za ${n}s` },
    pt: { chooseLanguage: 'Escolha o idioma', welcome: 'Bem-vindo à avaliação do seu test drive.', chooseVehicle: 'Escolha o seu veículo:', next: 'Seguinte', back: 'Voltar', submit: 'Enviar', done: 'Concluído', selectCategory: 'Selecione uma categoria', thanks: 'Obrigado!', submitted: (v) => `As suas avaliações de ${v} foram enviadas.`, nextCar: 'Outro veículo', startOver: 'Recomeçar', tap: 'Toque para começar', restarting: (n) => `A reiniciar em ${n}s` },
    ro: { chooseLanguage: 'Alegeți limba', welcome: 'Bun venit la evaluarea test drive-ului dvs.', chooseVehicle: 'Alegeți vehiculul dvs.:', next: 'Următorul', back: 'Înapoi', submit: 'Trimite', done: 'Finalizat', selectCategory: 'Selectați o categorie', thanks: 'Mulțumesc!', submitted: (v) => `Evaluările dvs. pentru ${v} au fost trimise.`, nextCar: 'Camionul următor', startOver: 'Începeți din nou', tap: 'Atingeți pentru a începe', restarting: (n) => `Repornire în ${n}s` },
    ru: { chooseLanguage: 'Выберите язык', welcome: 'Добро пожаловать на оценку вашего тест-драйва.', chooseVehicle: 'Выберите ваш автомобиль:', next: 'Далее', back: 'Назад', submit: 'Отправить', thanks: 'Спасибо!', submitted: (v) => `Ваши оценки для ${v} были отправлены.`, nextCar: 'Следующий грузовик', startOver: 'Начать заново', tap: 'Нажмите для начала', restarting: (n) => `Перезапуск через ${n}с` },
    sr: { chooseLanguage: 'Izaberite jezik', welcome: 'Dobrodošli u ocenu vaše probne vožnje.', chooseVehicle: 'Izaberite vaše vozilo:', next: 'Dalje', back: 'Nazad', submit: 'Pošalji', done: 'Gotovo', selectCategory: 'Izaberite kategoriju', thanks: 'Hvala!', submitted: (v) => `Vaše ocene za ${v} su poslate.`, nextCar: 'Sledeći kamion', startOver: 'Počni iznova', tap: 'Dodirnite za početak', restarting: (n) => `Pokretanje za ${n}s` },
    sk: { chooseLanguage: 'Vyberte jazyk', welcome: 'Vitajte v hodnotení vašej skúšobnej jazdy.', chooseVehicle: 'Vyberte si vozidlo:', next: 'Ďalej', back: 'Späť', submit: 'Odoslať', done: 'Hotovo', selectCategory: 'Vyberte kategóriu', thanks: 'Ďakujeme!', submitted: (v) => `Vaše hodnotenia pre ${v} boli odoslané.`, nextCar: 'Ďalší kamión', startOver: 'Začať odznova', tap: 'Klepnite pre spustenie', restarting: (n) => `Reštartovanie za ${n}s` },
    sl: { chooseLanguage: 'Izberite jezik', welcome: 'Dobrodošli pri ocenjevanju vaše preizkusne vožnje.', chooseVehicle: 'Izberite svoje vozilo:', next: 'Naprej', back: 'Nazaj', submit: 'Pošlji', done: 'Končano', selectCategory: 'Izberite kategorijo', thanks: 'Hvala!', submitted: (v) => `Vaše ocene za ${v} so bile poslane.`, nextCar: 'Naslednji tovornjak', startOver: 'Začni znova', tap: 'Dotaknite se za začetek', restarting: (n) => `Ponovni zagon čez ${n} s` },
    es: { chooseLanguage: 'Elige idioma', welcome: 'Bienvenido a la evaluación de tu prueba de conducción.', chooseVehicle: 'Elige tu vehículo:', next: 'Siguiente', back: 'Atrás', submit: 'Enviar', done: 'Listo', selectCategory: 'Selecciona una categoría', thanks: '¡Gracias!', submitted: (v) => `Tus valoraciones de ${v} se han enviado.`, nextCar: 'Otro camión', startOver: 'Reiniciar', tap: 'Toca para empezar', restarting: (n) => `Reiniciando en ${n}s` },
    sv: { chooseLanguage: 'Välj språk', welcome: 'Välkommen till utvärderingen av din provkörning.', chooseVehicle: 'Välj ditt fordon:', next: 'Nästa', back: 'Tillbaka', submit: 'Skicka', done: 'Klar', selectCategory: 'Välj en kategori', thanks: 'Tack!', submitted: (v) => `Dina betyg för ${v} har skickats.`, nextCar: 'Nästa lastbil', startOver: 'Börja om', tap: 'Tryck för att börja', restarting: (n) => `Startar om om ${n}s` },
    tr: { chooseLanguage: 'Dil seçin', welcome: 'Test sürüşü değerlendirmenize hoş geldiniz.', chooseVehicle: 'Aracınızı seçin:', next: 'İleri', back: 'Geri', submit: 'Gönder', thanks: 'Teşekkürler!', submitted: (v) => `${v} için puanlarınız gönderildi.`, nextCar: 'Sonraki kamyon', startOver: 'Yeniden başla', tap: 'Başlamak için dokunun', restarting: (n) => `${n}s içinde yeniden başlatılıyor` },
    uk: { chooseLanguage: 'Виберіть мову', welcome: 'Ласкаво просимо до оцінки вашого тест-драйву.', chooseVehicle: 'Виберіть ваш автомобіль:', next: 'Далі', back: 'Назад', submit: 'Надіслати', done: 'Готово', selectCategory: 'Виберіть категорію', thanks: 'Дякуємо!', submitted: (v) => `Ваші оцінки для ${v} було надіслано.`, nextCar: 'Наступна вантажівка', startOver: 'Почати знову', tap: 'Торкніться для початку', restarting: (n) => `Перезапуск через ${n}с` },
    cy: { chooseLanguage: 'Dewiswch iaith', welcome: 'Croeso i werthusiad eich gyriad prawf.', chooseVehicle: 'Dewiswch eich cerbyd:', next: 'Nesaf', back: 'Yn ôl', submit: 'Cyflwyno', thanks: 'Diolch!', submitted: (v) => `Mae eich sgoriau ar gyfer ${v} wedi eu cyflwyno.`, nextCar: 'Lori nesaf', startOver: 'Dechrau eto', tap: 'Tapiwch i ddechrau', restarting: (n) => `Ailgychwyn mewn ${n}s` },
  };
  const t = () => T[state.lang] || T.en;

  /* ---------- i18n for question content ---------- */
  const QI18N = {
    es: {
      cab:      { title: 'Evaluación de cabina y cambio de marchas', instruction: 'Arranque y parada en la subida, luego acelera. Evalúa la caja de cambios y el comportamiento de la cabina.', metrics: { cab_assessment: { label: 'Evaluación de cabina', min: 'Mala', max: 'Muy buena' }, gear_shift: { label: 'Respuesta del cambio de marchas', min: 'Poco fiable', max: 'Muy fiable' } } },
      aux:      { title: 'Freno auxiliar', instruction: 'Freno auxiliar en la bajada. Evalúa la facilidad de uso y la confianza en el control.', metrics: { ease_handling: { label: 'Facilidad de manejo', min: 'Muy difícil', max: 'Muy fácil' } } },
      steering: { title: 'Dirección y manejo', instruction: 'Seguimiento de línea con una mano y luego slalom de conos. Evalúa la precisión de dirección y la estabilidad del chasis.', metrics: { steering_precision: { label: 'Precisión de dirección', min: 'Impreciso', max: 'Muy preciso' }, chassis_stability: { label: 'Estabilidad del chasis', min: 'Inestable', max: 'Muy estable' } } },
      parking:  { title: 'Aparcamiento y maniobra de precisión', instruction: 'Modo de maniobra hasta el aparcamiento. Evalúa la precisión, la facilidad de marcha atrás y el control de atraque.', metrics: { precision_maneuver: { label: 'Precisión — modo maniobra', min: 'Impreciso', max: 'Muy preciso' }, reversing_docking: { label: 'Facilidad de marcha atrás y atraque', min: 'Muy difícil', max: 'Muy fácil' } } },
      overall:  { title: 'Experiencia de conducción general', instruction: 'Habiendo completado todas las tareas, da tu impresión general de conducir este vehículo.', metrics: { overall_exp: { label: 'Experiencia de conducción general', min: 'Mala', max: 'Premium' } } },
      boarding:   { title: 'Subida y bajada de la cabina', instruction: 'Sube y baja de la cabina. Evalúa la visibilidad del escalón superior desde arriba y la facilidad general de entrada y salida.', metrics: { boarding_ease: { label: 'Facilidad de subida y bajada', min: 'Muy difícil', max: 'Muy fácil' } } },
      ergonomics: { title: 'Ergonomía y alcance de controles', instruction: 'Sentado en posición de conducción: evalúa el alcance de los controles clave, la pantalla de información y la agrupación lógica de funciones.', metrics: { ergonomics_overall: { label: 'Impresión ergonómica general', min: 'Mala', max: 'Muy buena' }, info_display: { label: 'Pantalla de información', min: 'Mala', max: 'Muy buena' } } },
      fit_finish: { title: 'Acabado y calidad de materiales', instruction: 'Evalúa la calidad de los materiales, la concordancia de colores entre superficies y la uniformidad de las juntas entre paneles.', metrics: { overall_finish: { label: 'Acabado general', min: 'Malo', max: 'Premium' } } },
      safety:     { title: 'Seguridad y visión directa', instruction: 'Evalúa el campo de visión directa. Los objetos están colocados en posiciones marcadas en el suelo — anota cuáles son visibles desde el asiento del conductor.', metrics: { direct_vision: { label: 'Visión directa — frente y laterales', min: 'Muy limitada', max: 'Excelente' }, mirror_visibility: { label: 'Visibilidad de espejos laterales', min: 'Bloqueada', max: 'Clara' } } },
    },
    fr: {
      cab:      { title: 'Évaluation de la cabine et passage des vitesses', instruction: 'Démarrage-arrêt en montée, puis accélérez. Évaluez la boîte de vitesses et le comportement de la cabine.', metrics: { cab_assessment: { label: 'Évaluation de la cabine', min: 'Médiocre', max: 'Très bien' }, gear_shift: { label: 'Réponse du passage des vitesses', min: 'Peu fiable', max: 'Très fiable' } } },
      aux:      { title: 'Frein auxiliaire', instruction: "Frein auxiliaire en descente. Évaluez la facilité d'utilisation et la confiance dans le contrôle.", metrics: { ease_handling: { label: 'Facilité de maniement', min: 'Très difficile', max: 'Très facile' } } },
      steering: { title: 'Direction et maniabilité', instruction: 'Suivi de ligne à une main puis slalom de cônes. Évaluez la précision de direction et la stabilité du châssis.', metrics: { steering_precision: { label: 'Précision de direction', min: 'Imprécis', max: 'Très précis' }, chassis_stability: { label: 'Stabilité du châssis', min: 'Instable', max: 'Très stable' } } },
      parking:  { title: 'Stationnement et manœuvre de précision', instruction: "Mode manœuvre jusqu'au stationnement. Évaluez la précision, la facilité de marche arrière et le contrôle d'accostage.", metrics: { precision_maneuver: { label: 'Précision — mode manœuvre', min: 'Imprécis', max: 'Très précis' }, reversing_docking: { label: "Facilité de marche arrière et d'accostage", min: 'Très difficile', max: 'Très facile' } } },
      overall:  { title: 'Expérience de conduite globale', instruction: 'Ayant effectué toutes les tâches, donnez votre impression générale de conduite de ce véhicule.', metrics: { overall_exp: { label: 'Expérience de conduite globale', min: 'Médiocre', max: 'Premium' } } },
      boarding:   { title: 'Montée et descente de la cabine', instruction: "Montez dans la cabine et descendez-en. Évaluez la visibilité de la marche supérieure vue d'en haut et la facilité générale d'entrée et de sortie.", metrics: { boarding_ease: { label: "Facilité de montée et descente", min: 'Très difficile', max: 'Très facile' } } },
      ergonomics: { title: 'Ergonomie et accessibilité des commandes', instruction: "En position de conduite : évaluez l'accessibilité des commandes principales, l'écran d'information et le regroupement logique des fonctions.", metrics: { ergonomics_overall: { label: 'Impression ergonomique générale', min: 'Médiocre', max: 'Très bien' }, info_display: { label: "Écran d'information", min: 'Médiocre', max: 'Très bien' } } },
      fit_finish: { title: 'Finition et qualité des matériaux', instruction: "Évaluez la qualité des matériaux, la correspondance des couleurs entre les surfaces et l'uniformité des jeux entre les panneaux.", metrics: { overall_finish: { label: 'Finition générale', min: 'Médiocre', max: 'Premium' } } },
      safety:     { title: 'Sécurité et vision directe', instruction: "Évaluez le champ de vision directe. Des accessoires sont placés à des positions marquées au sol — notez lesquels sont visibles depuis le siège du conducteur.", metrics: { direct_vision: { label: 'Vision directe — avant et côtés', min: 'Très limitée', max: 'Excellente' }, mirror_visibility: { label: 'Visibilité des rétroviseurs latéraux', min: 'Bloquée', max: 'Dégagée' } } },
    },
    pt: {
      cab:      { title: 'Avaliação da cabine e mudança de marchas', instruction: 'Arranque e paragem na subida, depois acelere. Avalie a caixa de velocidades e o comportamento da cabine.', metrics: { cab_assessment: { label: 'Avaliação da cabine', min: 'Fraco', max: 'Muito bom' }, gear_shift: { label: 'Resposta da mudança de marchas', min: 'Pouco fiável', max: 'Muito fiável' } } },
      aux:      { title: 'Travagem auxiliar', instruction: 'Travão auxiliar na descida. Avalie a facilidade de utilização e a confiança no controlo.', metrics: { ease_handling: { label: 'Facilidade de manuseamento', min: 'Muito difícil', max: 'Muito fácil' } } },
      steering: { title: 'Direção e comportamento', instruction: 'Seguimento de linha a uma mão e depois slalom de cones. Avalie a precisão de direção e a estabilidade do chassis.', metrics: { steering_precision: { label: 'Precisão de direção', min: 'Impreciso', max: 'Muito preciso' }, chassis_stability: { label: 'Estabilidade do chassis', min: 'Instável', max: 'Muito estável' } } },
      parking:  { title: 'Estacionamento e manobra de precisão', instruction: 'Modo de manobra de volta ao estacionamento. Avalie a precisão, a facilidade de marcha-atrás e o controlo ao encostar à doca.', metrics: { precision_maneuver: { label: 'Precisão — modo de manobra', min: 'Impreciso', max: 'Muito preciso' }, reversing_docking: { label: 'Facilidade de marcha-atrás e encosto à doca', min: 'Muito difícil', max: 'Muito fácil' } } },
      overall:  { title: 'Experiência de condução geral', instruction: 'Tendo completado todas as tarefas, dê a sua impressão geral de conduzir este veículo.', metrics: { overall_exp: { label: 'Experiência de condução geral', min: 'Fraco', max: 'Premium' } } },
      boarding:   { title: 'Entrada e saída da cabine', instruction: 'Entre e saia da cabine. Avalie a visibilidade do degrau superior visto de cima e a facilidade geral de entrada e saída.', metrics: { boarding_ease: { label: 'Facilidade de entrada e saída', min: 'Muito difícil', max: 'Muito fácil' } } },
      ergonomics: { title: 'Ergonomia e alcance dos controlos', instruction: 'Na posição de condução: avalie o alcance dos controlos principais, o ecrã de informação e o agrupamento lógico das funções.', metrics: { ergonomics_overall: { label: 'Impressão ergonómica geral', min: 'Fraco', max: 'Muito bom' }, info_display: { label: 'Ecrã de informação', min: 'Fraco', max: 'Muito bom' } } },
      fit_finish: { title: 'Acabamento e qualidade dos materiais', instruction: 'Avalie a qualidade dos materiais, a correspondência de cores entre superfícies e a uniformidade das juntas entre painéis.', metrics: { overall_finish: { label: 'Acabamento geral', min: 'Fraco', max: 'Premium' } } },
      safety:     { title: 'Segurança e visão direta', instruction: "Avalie o campo de visão direta. Os objetos estão colocados em posições marcadas no chão — anote quais são visíveis a partir do assento do condutor.", metrics: { direct_vision: { label: 'Visão direta — frente e lados', min: 'Muito limitada', max: 'Excelente' }, mirror_visibility: { label: 'Visibilidade dos espelhos laterais', min: 'Bloqueada', max: 'Clara' } } },
    },
    sv: {
      cab:      { title: 'Utvärdering av hytt och växling', instruction: 'Stopp-start i uppförsbacken, accelerera sedan. Utvärdera växellådan och hyttens beteende.', metrics: { cab_assessment: { label: 'Hyttbedömning', min: 'Dålig', max: 'Mycket bra' }, gear_shift: { label: 'Växlingsrespons', min: 'Opålitlig', max: 'Mycket pålitlig' } } },
      aux:      { title: 'Hjälpbroms', instruction: 'Hjälpbroms i nedförsbacken. Utvärdera användarvänlighet och förtroende för kontrollen.', metrics: { ease_handling: { label: 'Lätthet att hantera', min: 'Mycket svårt', max: 'Mycket lätt' } } },
      steering: { title: 'Styrning & köregenskaper', instruction: 'Linjeföljning med en hand, sedan konslalom. Utvärdera styrprecision och chassistabilitet.', metrics: { steering_precision: { label: 'Styrprecision', min: 'Oprecis', max: 'Mycket precis' }, chassis_stability: { label: 'Chassistabilitet', min: 'Instabil', max: 'Mycket stabil' } } },
      parking:  { title: 'Parkering & precisionsmanöver', instruction: 'Använd manövreringsläge för att backa tillbaka till parkeringen. Utvärdera precision, lätthet vid backning och dockningskontroll.', metrics: { precision_maneuver: { label: 'Precision — manöverläge', min: 'Oprecis', max: 'Mycket precis' }, reversing_docking: { label: 'Lätthet vid backning & dockning', min: 'Mycket svårt', max: 'Mycket lätt' } } },
      overall:  { title: 'Övergripande körupplevelse', instruction: 'Efter att ha slutfört alla uppgifter, ge ditt övergripande intryck av att köra detta fordon.', metrics: { overall_exp: { label: 'Övergripande körupplevelse', min: 'Dålig', max: 'Premium' } } },
      boarding:   { title: 'På- och avstigning', instruction: 'Klättra in i och ur hytten. Bedöm synligheten av det översta steget från ovan och den övergripande lättheten vid in- och urstigning.', metrics: { boarding_ease: { label: 'Lätthet vid på- och avstigning', min: 'Mycket svårt', max: 'Mycket lätt' } } },
      ergonomics: { title: 'Ergonomi & räckvidd', instruction: 'Sittande i förarposition: bedöm räckvidden till viktiga reglage, informationsdisplayen och den logiska grupperingen av funktioner.', metrics: { ergonomics_overall: { label: 'Övergripande ergonomiskt intryck', min: 'Dålig', max: 'Mycket bra' }, info_display: { label: 'Informationsdisplay', min: 'Dålig', max: 'Mycket bra' } } },
      fit_finish: { title: 'Passning & ytfinish', instruction: 'Bedöm materialkvalitet, färgmatchning mellan ytor och enhetlighet i spaltmåtten mellan paneler.', metrics: { overall_finish: { label: 'Övergripande finish', min: 'Dålig', max: 'Premium' } } },
      safety:     { title: 'Säkerhet & direkt sikt', instruction: 'Bedöm det direkta synfältet. Föremål är placerade på markerade golvpositioner — notera vilka som är synliga från förarsätet.', metrics: { direct_vision: { label: 'Direkt sikt — fram & sidor', min: 'Mycket begränsad', max: 'Utmärkt' }, mirror_visibility: { label: 'Sikt i sidospeglar', min: 'Blockerad', max: 'Klar' } } },
    },
    bg: {
      cab:      { title: 'Оценка на кабината и превключване на скоростите', instruction: 'Старт-стоп на наклона нагоре, след което ускорете. Оценете скоростната кутия и поведението на кабината.', metrics: { cab_assessment: { label: 'Оценка на кабината', min: 'Слабо', max: 'Много добро' }, gear_shift: { label: 'Реакция на превключване на скоростите', min: 'Ненадеждно', max: 'Много надеждно' } } },
      aux:      { title: 'Спомагателна спирачка', instruction: 'Спомагателна спирачка на наклона надолу. Оценете лекотата на използване и увереността в контрола.', metrics: { ease_handling: { label: 'Лекота на управление', min: 'Много трудно', max: 'Много лесно' } } },
      steering: { title: 'Управление и стабилност', instruction: 'Следване на линия с една ръка, след което слалом между конуси. Оценете точността на управлението и стабилността на шасито.', metrics: { steering_precision: { label: 'Точност на управлението', min: 'Неточно', max: 'Много точно' }, chassis_stability: { label: 'Стабилност на шасито', min: 'Нестабилно', max: 'Много стабилно' } } },
      parking:  { title: 'Паркиране и прецизна маневра', instruction: 'Маневрен режим обратно към паркиране. Оценете точността, лекотата на движение назад и контрола при докинг.', metrics: { precision_maneuver: { label: 'Точност — маневрен режим', min: 'Неточно', max: 'Много точно' }, reversing_docking: { label: 'Лекота на движение назад и докинг', min: 'Много трудно', max: 'Много лесно' } } },
      overall:  { title: 'Общо усещане от карането', instruction: 'След изпълнение на всички задачи, дайте цялостното си впечатление от карането на това превозно средство.', metrics: { overall_exp: { label: 'Общо усещане от карането', min: 'Слабо', max: 'Премиум' } } },
      boarding:   { title: 'Качване и слизане', instruction: 'Качете се и слезте от кабината. Оценете видимостта на горното стъпало отгоре и цялостната лекота на влизане и излизане.', metrics: { boarding_ease: { label: 'Лекота на качване и слизане', min: 'Много трудно', max: 'Много лесно' } } },
      ergonomics: { title: 'Ергономия и достъпност', instruction: 'Седнали в позицията на водача: оценете достъпността на основните контроли, информационния дисплей и логическото групиране на функциите.', metrics: { ergonomics_overall: { label: 'Общо ергономично впечатление', min: 'Слабо', max: 'Много добро' }, info_display: { label: 'Информационен дисплей', min: 'Слабо', max: 'Много добро' } } },
      fit_finish: { title: 'Прилягане и завършеност', instruction: 'Оценете качеството на материалите, съответствието на цветовете между повърхностите и еднаквостта на фугите между панелите.', metrics: { overall_finish: { label: 'Обща завършеност', min: 'Слабо', max: 'Премиум' } } },
      safety:     { title: 'Безопасност и директна видимост', instruction: 'Оценете директното зрително поле. Предметите са поставени на маркирани позиции на пода — отбележете кои са видими от седалката на водача.', metrics: { direct_vision: { label: 'Директна видимост — отпред и отстрани', min: 'Много ограничена', max: 'Отлична' }, mirror_visibility: { label: 'Видимост на страничните огледала', min: 'Блокирана', max: 'Ясна' } } },
    },
    cs: {
      cab:      { title: 'Hodnocení kabiny a řazení převodů', instruction: 'Zastavení a rozjezd do kopce, poté akcelerujte. Zhodnoťte převodovku a chování kabiny.', metrics: { cab_assessment: { label: 'Hodnocení kabiny', min: 'Špatné', max: 'Velmi dobré' }, gear_shift: { label: 'Odezva řazení', min: 'Nespolehlivé', max: 'Velmi spolehlivé' } } },
      aux:      { title: 'Pomocná brzda', instruction: 'Pomocná brzda na sjezdu. Zhodnoťte snadnost použití a jistotu při ovládání.', metrics: { ease_handling: { label: 'Snadnost ovládání', min: 'Velmi obtížné', max: 'Velmi snadné' } } },
      steering: { title: 'Řízení a ovladatelnost', instruction: 'Sledování linie jednou rukou, poté slalom mezi kužely. Zhodnoťte přesnost řízení a stabilitu podvozku.', metrics: { steering_precision: { label: 'Přesnost řízení', min: 'Nepřesné', max: 'Velmi přesné' }, chassis_stability: { label: 'Stabilita podvozku', min: 'Nestabilní', max: 'Velmi stabilní' } } },
      parking:  { title: 'Parkování a přesný manévr', instruction: 'Manévrovací režim zpět na parkování. Zhodnoťte přesnost, snadnost couvání a kontrolu při dokování.', metrics: { precision_maneuver: { label: 'Přesnost — manévrovací režim', min: 'Nepřesné', max: 'Velmi přesné' }, reversing_docking: { label: 'Snadnost couvání a dokování', min: 'Velmi obtížné', max: 'Velmi snadné' } } },
      overall:  { title: 'Celkový dojem z jízdy', instruction: 'Po dokončení všech úkolů uveďte svůj celkový dojem z jízdy s tímto vozidlem.', metrics: { overall_exp: { label: 'Celkový dojem z jízdy', min: 'Špatné', max: 'Prémiové' } } },
      boarding:   { title: 'Nastupování a vystupování', instruction: 'Nastupte do kabiny a vystupte z ní. Zhodnoťte viditelnost horního schodu shora a celkovou snadnost nastupování a vystupování.', metrics: { boarding_ease: { label: 'Snadnost nastupování a vystupování', min: 'Velmi obtížné', max: 'Velmi snadné' } } },
      ergonomics: { title: 'Ergonomie a dosažitelnost', instruction: 'V pozici řidiče: zhodnoťte dosažitelnost klíčových ovládacích prvků, informačního displeje a logické uspořádání funkcí.', metrics: { ergonomics_overall: { label: 'Celkový ergonomický dojem', min: 'Špatné', max: 'Velmi dobré' }, info_display: { label: 'Informační displej', min: 'Špatné', max: 'Velmi dobré' } } },
      fit_finish: { title: 'Kvalita zpracování', instruction: 'Zhodnoťte kvalitu materiálů, barevnou shodu mezi povrchy a jednotnost spár mezi panely.', metrics: { overall_finish: { label: 'Celkové zpracování', min: 'Špatné', max: 'Prémiové' } } },
      safety:     { title: 'Bezpečnost a přímá viditelnost', instruction: 'Zhodnoťte přímé zorné pole. Předměty jsou umístěny na značených místech na podlaze — zaznamenejte, které jsou viditelné z místa řidiče.', metrics: { direct_vision: { label: 'Přímá viditelnost — vpředu a po stranách', min: 'Velmi omezená', max: 'Vynikající' }, mirror_visibility: { label: 'Viditelnost bočních zrcátek', min: 'Zablokovaná', max: 'Čistá' } } },
    },
    da: {
      cab:      { title: 'Kabinevurdering & gearskift', instruction: 'Stop-start på stigningen, derefter accelerer. Vurder gearkassen og kabinens adfærd.', metrics: { cab_assessment: { label: 'Kabinevurdering', min: 'Dårlig', max: 'Meget god' }, gear_shift: { label: 'Gearskift respons', min: 'Upålidelig', max: 'Meget pålidelig' } } },
      aux:      { title: 'Hjælpebremse', instruction: 'Hjælpebremse på nedkørslen. Vurder brugervenlighed og tillid til kontrollen.', metrics: { ease_handling: { label: 'Nem håndtering', min: 'Meget svær', max: 'Meget nem' } } },
      steering: { title: 'Styring & håndtering', instruction: 'Linjefølgning med én hånd, derefter kegleslalom. Vurder styrepræcision og chassisstabilitet.', metrics: { steering_precision: { label: 'Styrepræcision', min: 'Upræcis', max: 'Meget præcis' }, chassis_stability: { label: 'Chassisstabilitet', min: 'Ustabil', max: 'Meget stabil' } } },
      parking:  { title: 'Parkering & præcisionsmanøvre', instruction: 'Manøvretilstand tilbage til parkering. Vurder præcision, bakning og dokningskontrol.', metrics: { precision_maneuver: { label: 'Præcision — manøvretilstand', min: 'Upræcis', max: 'Meget præcis' }, reversing_docking: { label: 'Nem bakning & dokning', min: 'Meget svær', max: 'Meget nem' } } },
      overall:  { title: 'Samlet køreoplevelse', instruction: 'Efter at have udført alle opgaver, giv dit samlede indtryk af at køre dette køretøj.', metrics: { overall_exp: { label: 'Samlet køreoplevelse', min: 'Dårlig', max: 'Premium' } } },
      boarding:   { title: 'Ind- og udstigning', instruction: 'Stig ind i og ud af kabinen. Vurder synligheden af det øverste trin fra oven og den generelle nemhed ved ind- og udstigning.', metrics: { boarding_ease: { label: 'Nem ind- og udstigning', min: 'Meget svær', max: 'Meget nem' } } },
      ergonomics: { title: 'Ergonomi & tilgængelighed', instruction: 'Sæt dig i førerposition: vurder tilgængeligheden af vigtige kontroller, infodisplay og logisk gruppering af funktioner.', metrics: { ergonomics_overall: { label: 'Samlet ergonomisk indtryk', min: 'Dårlig', max: 'Meget god' }, info_display: { label: 'Infodisplay', min: 'Dårlig', max: 'Meget god' } } },
      fit_finish: { title: 'Finish & kvalitet', instruction: 'Vurder materialekvalitet, farvematchning mellem overflader og ensartethed af paneladskillelser.', metrics: { overall_finish: { label: 'Samlet finish', min: 'Dårlig', max: 'Premium' } } },
      safety:     { title: 'Sikkerhed & direkte udsyn', instruction: 'Vurder det direkte synsfelt. Rekvisitter er placeret på markerede gulvpositioner — noter hvilke der er synlige fra førersædet.', metrics: { direct_vision: { label: 'Direkte udsyn — fortil & på siderne', min: 'Meget begrænset', max: 'Fremragende' }, mirror_visibility: { label: 'Sidespejlssynlighed', min: 'Blokeret', max: 'Klar' } } },
    },
    nl: {
      cab:      { title: 'Cabinebeoordeling & schakelen', instruction: 'Stop-start op de helling omhoog, versnel dan. Beoordeel de versnellingsbak en het gedrag van de cabine.', metrics: { cab_assessment: { label: 'Cabinebeoordeling', min: 'Slecht', max: 'Zeer goed' }, gear_shift: { label: 'Schakelrespons', min: 'Onbetrouwbaar', max: 'Zeer betrouwbaar' } } },
      aux:      { title: 'Hulprem', instruction: 'Hulprem op de helling omlaag. Beoordeel het gebruiksgemak en het vertrouwen in de bediening.', metrics: { ease_handling: { label: 'Gemak van bediening', min: 'Zeer moeilijk', max: 'Zeer gemakkelijk' } } },
      steering: { title: 'Besturing & wegligging', instruction: 'Lijnvolgen met één hand, daarna slalom tussen pionnen. Beoordeel de stuurprecisie en chassisstabiliteit.', metrics: { steering_precision: { label: 'Stuurprecisie', min: 'Onnauwkeurig', max: 'Zeer nauwkeurig' }, chassis_stability: { label: 'Chassisstabiliteit', min: 'Onstabiel', max: 'Zeer stabiel' } } },
      parking:  { title: 'Parkeren & precisiemanoeuvre', instruction: 'Manoeuvreermodus terug naar parkeren. Beoordeel precisie, gemak van achteruitrijden en dockingcontrole.', metrics: { precision_maneuver: { label: 'Precisie — manoeuvreermodus', min: 'Onnauwkeurig', max: 'Zeer nauwkeurig' }, reversing_docking: { label: 'Gemak van achteruitrijden & docking', min: 'Zeer moeilijk', max: 'Zeer gemakkelijk' } } },
      overall:  { title: 'Algemene rijervaring', instruction: 'Na het voltooien van alle taken, geef uw algemene indruk van het rijden met dit voertuig.', metrics: { overall_exp: { label: 'Algemene rijervaring', min: 'Slecht', max: 'Premium' } } },
      boarding:   { title: 'In- en uitstappen', instruction: 'Klim in en uit de cabine. Beoordeel de zichtbaarheid van de bovenste trede van boven en het algemene gemak van in- en uitstappen.', metrics: { boarding_ease: { label: 'Gemak van in- en uitstappen', min: 'Zeer moeilijk', max: 'Zeer gemakkelijk' } } },
      ergonomics: { title: 'Ergonomie & bereikbaarheid', instruction: 'Zittend in de bestuurdersstoel: beoordeel de bereikbaarheid van belangrijke bedieningselementen, het infodisplay en de logische groepering van functies.', metrics: { ergonomics_overall: { label: 'Algemene ergonomische indruk', min: 'Slecht', max: 'Zeer goed' }, info_display: { label: 'Infodisplay', min: 'Slecht', max: 'Zeer goed' } } },
      fit_finish: { title: 'Pasvorm & afwerking', instruction: 'Beoordeel de materiaalkwaliteit, kleurovereenkomst tussen oppervlakken en consistentie van paneelspleten.', metrics: { overall_finish: { label: 'Algemene afwerking', min: 'Slecht', max: 'Premium' } } },
      safety:     { title: 'Veiligheid & direct zicht', instruction: 'Beoordeel het directe gezichtsveld. Objecten zijn geplaatst op gemarkeerde vloerposities — noteer welke zichtbaar zijn vanaf de bestuurdersstoel.', metrics: { direct_vision: { label: 'Direct zicht — voor & zijkanten', min: 'Zeer beperkt', max: 'Uitstekend' }, mirror_visibility: { label: 'Zichtbaarheid zijspiegels', min: 'Geblokkeerd', max: 'Helder' } } },
    },
    et: {
      cab:      { title: 'Kabiini hindamine ja käiguvahetus', instruction: 'Peatu ja käivita tõusul, seejärel kiirenda. Hinda käigukasti ja kabiini käitumist.', metrics: { cab_assessment: { label: 'Kabiini hindamine', min: 'Halb', max: 'Väga hea' }, gear_shift: { label: 'Käiguvahetuse reaktsioon', min: 'Ebausaldusväärne', max: 'Väga usaldusväärne' } } },
      aux:      { title: 'Aeglusti', instruction: 'Aeglusti laskumisel. Hinda kasutuslihtsust ja kindlustunnet juhtimisel.', metrics: { ease_handling: { label: 'Käsitsemise lihtsus', min: 'Väga raske', max: 'Väga lihtne' } } },
      steering: { title: 'Roolimine ja juhitavus', instruction: 'Joone järgimine ühe käega, seejärel koonuste slaalom. Hinda roolimise täpsust ja šassii stabiilsust.', metrics: { steering_precision: { label: 'Roolimise täpsus', min: 'Ebatäpne', max: 'Väga täpne' }, chassis_stability: { label: 'Šassii stabiilsus', min: 'Ebastabiilne', max: 'Väga stabiilne' } } },
      parking:  { title: 'Parkimine ja täppismanööver', instruction: 'Kasuta manööverdusrežiimi, et sõita tagurpidi tagasi parkimiskohale. Hinda täpsust, tagurdamise lihtsust ja dokkimiskontrolli.', metrics: { precision_maneuver: { label: 'Täpsus — manööverdusrežiim', min: 'Ebatäpne', max: 'Väga täpne' }, reversing_docking: { label: 'Tagurdamise ja dokkimise lihtsus', min: 'Väga raske', max: 'Väga lihtne' } } },
      overall:  { title: 'Üldine sõidumulje', instruction: 'Pärast kõigi ülesannete täitmist andke oma üldine mulje sellel sõidukiga sõitmisest.', metrics: { overall_exp: { label: 'Üldine sõidumulje', min: 'Halb', max: 'Premium' } } },
      boarding:   { title: 'Sisenemine ja väljumine', instruction: 'Ronige kabiini ja väljuge sealt. Hinda ülemise astme nähtavust ülevalt ning sisenemise ja väljumise üldist lihtsust.', metrics: { boarding_ease: { label: 'Sisenemise ja väljumise lihtsus', min: 'Väga raske', max: 'Väga lihtne' } } },
      ergonomics: { title: 'Ergonoomika ja käeulatus', instruction: 'Juhiistmel istudes: hinda peamiste juhtseadiste käeulatust, infoekraani ning funktsioonide loogilist rühmitamist.', metrics: { ergonomics_overall: { label: 'Üldine ergonoomiline mulje', min: 'Halb', max: 'Väga hea' }, info_display: { label: 'Infoekraan', min: 'Halb', max: 'Väga hea' } } },
      fit_finish: { title: 'Kokkupanekukvaliteet ja viimistlus', instruction: 'Hinda materjali kvaliteeti, pindade värvisobivust ja paneelivahede ühtlust.', metrics: { overall_finish: { label: 'Üldine viimistlus', min: 'Halb', max: 'Premium' } } },
      safety:     { title: 'Ohutus ja otsenähtavus', instruction: 'Hinda otsest vaatevälja. Rekvisiidid on paigutatud märgistatud põrandapositsioonidele — märgi, millised on juhiistmelt nähtavad.', metrics: { direct_vision: { label: 'Otsenähtavus — ees ja külgedel', min: 'Väga piiratud', max: 'Suurepärane' }, mirror_visibility: { label: 'Külgpeeglite nähtavus', min: 'Blokeeritud', max: 'Selge' } } },
    },
    fi: {
      cab:      { title: 'Ohjaamon arviointi ja vaihteenvaihto', instruction: 'Pysähdys-käynnistys ylämäessä, kiihdytä sitten. Arvioi vaihteisto ja ohjaamon käyttäytyminen.', metrics: { cab_assessment: { label: 'Ohjaamon arviointi', min: 'Heikko', max: 'Erittäin hyvä' }, gear_shift: { label: 'Vaihteenvaihdon vaste', min: 'Epäluotettava', max: 'Erittäin luotettava' } } },
      aux:      { title: 'Apujarru', instruction: 'Apujarru alamäessä. Arvioi käytön helppoutta ja hallinnan varmuutta.', metrics: { ease_handling: { label: 'Käsittelyn helppous', min: 'Erittäin vaikea', max: 'Erittäin helppo' } } },
      steering: { title: 'Ohjaus ja käsiteltävyys', instruction: 'Viivan seuranta yhdellä kädellä, sitten kartioslalom. Arvioi ohjaustarkkuutta ja alustan vakautta.', metrics: { steering_precision: { label: 'Ohjaustarkkuus', min: 'Epätarkka', max: 'Erittäin tarkka' }, chassis_stability: { label: 'Alustan vakaus', min: 'Epävakaa', max: 'Erittäin vakaa' } } },
      parking:  { title: 'Pysäköinti ja tarkkuusmanööveri', instruction: 'Manööveritila takaisin pysäköintiin. Arvioi tarkkuutta, peruutuksen helppoutta ja telakointihallintaa.', metrics: { precision_maneuver: { label: 'Tarkkuus — manööveritila', min: 'Epätarkka', max: 'Erittäin tarkka' }, reversing_docking: { label: 'Peruutuksen ja telakoinnin helppous', min: 'Erittäin vaikea', max: 'Erittäin helppo' } } },
      overall:  { title: 'Kokonaisajokokemus', instruction: 'Kun olet suorittanut kaikki tehtävät, anna kokonaisvaikutelmasi tämän ajoneuvon ajamisesta.', metrics: { overall_exp: { label: 'Kokonaisajokokemus', min: 'Heikko', max: 'Premium' } } },
      boarding:   { title: 'Nousu ja poistuminen', instruction: 'Kiipeä ohjaamoon ja poistu siitä. Arvioi ylimmän askelman näkyvyyttä ylhäältä ja sisään- ja uloskäynnin yleistä helppoutta.', metrics: { boarding_ease: { label: 'Nousun ja poistumisen helppous', min: 'Erittäin vaikea', max: 'Erittäin helppo' } } },
      ergonomics: { title: 'Ergonomia ja ulottuvuus', instruction: 'Kuljettajan asennossa istuen: arvioi tärkeimpien hallintalaitteiden ja infonäytön ulottuvuutta sekä toimintojen loogista ryhmittelyä.', metrics: { ergonomics_overall: { label: 'Yleinen ergonominen vaikutelma', min: 'Heikko', max: 'Erittäin hyvä' }, info_display: { label: 'Infonäyttö', min: 'Heikko', max: 'Erittäin hyvä' } } },
      fit_finish: { title: 'Sopivuus ja viimeistely', instruction: 'Arvioi materiaalin laatua, pintojen värivastaavuutta ja paneelirakojen yhtenäisyyttä.', metrics: { overall_finish: { label: 'Yleinen viimeistely', min: 'Heikko', max: 'Premium' } } },
      safety:     { title: 'Turvallisuus ja suora näkyvyys', instruction: 'Arvioi suoraa näkökenttää. Esineet on sijoitettu merkityille lattiapaikoille — merkitse, mitkä näkyvät kuljettajan istuimelta.', metrics: { direct_vision: { label: 'Suora näkyvyys — eteen ja sivuille', min: 'Erittäin rajoitettu', max: 'Erinomainen' }, mirror_visibility: { label: 'Sivupeilien näkyvyys', min: 'Estetty', max: 'Selkeä' } } },
    },
    hu: {
      cab:      { title: 'Kabin értékelése és váltás', instruction: 'Álló helyzetből indulás emelkedőn, majd gyorsítás. Értékelje a váltót és a kabin viselkedését.', metrics: { cab_assessment: { label: 'Kabin értékelése', min: 'Rossz', max: 'Nagyon jó' }, gear_shift: { label: 'Váltás visszajelzése', min: 'Megbízhatatlan', max: 'Nagyon megbízható' } } },
      aux:      { title: 'Segédfék', instruction: 'Segédfék lejtőn lefelé. Értékelje a használat egyszerűségét és a vezérlés biztonságát.', metrics: { ease_handling: { label: 'Kezelés egyszerűsége', min: 'Nagyon nehéz', max: 'Nagyon könnyű' } } },
      steering: { title: 'Kormányzás és kezelhetőség', instruction: 'Vonalkövetés egy kézzel, majd kúpszlalom. Értékelje a kormányzás pontosságát és az alváz stabilitását.', metrics: { steering_precision: { label: 'Kormányzás pontossága', min: 'Pontatlan', max: 'Nagyon pontos' }, chassis_stability: { label: 'Alváz stabilitása', min: 'Instabil', max: 'Nagyon stabil' } } },
      parking:  { title: 'Parkolás és pontos manőver', instruction: 'Manőverező mód vissza a parkoláshoz. Értékelje a pontosságot, a hátrameneti könnyűséget és a dokkolás vezérlését.', metrics: { precision_maneuver: { label: 'Pontosság — manőverező mód', min: 'Pontatlan', max: 'Nagyon pontos' }, reversing_docking: { label: 'Hátramenet és dokkolás egyszerűsége', min: 'Nagyon nehéz', max: 'Nagyon könnyű' } } },
      overall:  { title: 'Általános vezetési élmény', instruction: 'Az összes feladat elvégzése után adja meg általános véleményét ennek a járműnek a vezetéséről.', metrics: { overall_exp: { label: 'Általános vezetési élmény', min: 'Rossz', max: 'Prémium' } } },
      boarding:   { title: 'Be- és kiszállás', instruction: 'Szálljon be a kabinba, és szálljon ki belőle. Értékelje a felső lépcsőfok láthatóságát felülről és a be- és kiszállás általános egyszerűségét.', metrics: { boarding_ease: { label: 'Be- és kiszállás egyszerűsége', min: 'Nagyon nehéz', max: 'Nagyon könnyű' } } },
      ergonomics: { title: 'Ergonómia és elérhetőség', instruction: 'Vezetői helyzetben ülve: értékelje a fő kezelőszervek, az infokijelző elérhetőségét és a funkciók logikus csoportosítását.', metrics: { ergonomics_overall: { label: 'Általános ergonómiai benyomás', min: 'Rossz', max: 'Nagyon jó' }, info_display: { label: 'Infokijelző', min: 'Rossz', max: 'Nagyon jó' } } },
      fit_finish: { title: 'Illeszkedés és megjelenés', instruction: 'Értékelje az anyagminőséget, a felületek közötti színegyezést és a panelrések egységességét.', metrics: { overall_finish: { label: 'Általános megjelenés', min: 'Rossz', max: 'Prémium' } } },
      safety:     { title: 'Biztonság és közvetlen látótér', instruction: 'Értékelje a közvetlen látóteret. A kellékek jelölt padlópozíciókban vannak elhelyezve — jegyezze fel, melyek láthatók a vezetőülésből.', metrics: { direct_vision: { label: 'Közvetlen látótér — elöl és oldalt', min: 'Nagyon korlátozott', max: 'Kiváló' }, mirror_visibility: { label: 'Oldaltükrök láthatósága', min: 'Korlátozott', max: 'Tiszta' } } },
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
      cab:      { title: 'Valutazione della cabina e cambio marce', instruction: 'Arresto e partenza in salita, poi accelera. Valuta il cambio e il comportamento della cabina.', metrics: { cab_assessment: { label: 'Valutazione della cabina', min: 'Scarso', max: 'Molto buono' }, gear_shift: { label: 'Risposta del cambio', min: 'Poco affidabile', max: 'Molto affidabile' } } },
      aux:      { title: 'Freno ausiliario', instruction: "Freno ausiliario in discesa. Valuta la facilità d'uso e la fiducia nel controllo.", metrics: { ease_handling: { label: 'Facilità di gestione', min: 'Molto difficile', max: 'Molto facile' } } },
      steering: { title: 'Sterzo e maneggevolezza', instruction: 'Seguimento della linea con una mano, poi slalom tra i birilli. Valuta la precisione dello sterzo e la stabilità del telaio.', metrics: { steering_precision: { label: 'Precisione dello sterzo', min: 'Impreciso', max: 'Molto preciso' }, chassis_stability: { label: 'Stabilità del telaio', min: 'Instabile', max: 'Molto stabile' } } },
      parking:  { title: 'Parcheggio e manovra di precisione', instruction: 'Modalità manovra per il parcheggio. Valuta la precisione, la facilità di retromarcia e il controllo di attracco.', metrics: { precision_maneuver: { label: 'Precisione — modalità manovra', min: 'Impreciso', max: 'Molto preciso' }, reversing_docking: { label: 'Facilità di retromarcia e attracco', min: 'Molto difficile', max: 'Molto facile' } } },
      overall:  { title: 'Esperienza di guida generale', instruction: 'Dopo aver completato tutti i compiti, dai la tua impressione generale sulla guida di questo veicolo.', metrics: { overall_exp: { label: 'Esperienza di guida generale', min: 'Scarso', max: 'Premium' } } },
      boarding:   { title: 'Salita e discesa', instruction: "Sali e scendi dalla cabina. Valuta la visibilità del gradino superiore dall'alto e la facilità generale di ingresso e uscita.", metrics: { boarding_ease: { label: 'Facilità di salita e discesa', min: 'Molto difficile', max: 'Molto facile' } } },
      ergonomics: { title: 'Ergonomia e raggiungibilità', instruction: 'Seduto in posizione di guida: valuta la raggiungibilità dei comandi principali, del display informativo e il raggruppamento logico delle funzioni.', metrics: { ergonomics_overall: { label: 'Impressione ergonomica generale', min: 'Scarso', max: 'Molto buono' }, info_display: { label: 'Display informativo', min: 'Scarso', max: 'Molto buono' } } },
      fit_finish: { title: 'Finitura e qualità', instruction: "Valuta la qualità dei materiali, la corrispondenza dei colori tra le superfici e l'uniformità delle fessure tra i pannelli.", metrics: { overall_finish: { label: 'Finitura generale', min: 'Scarso', max: 'Premium' } } },
      safety:     { title: 'Sicurezza e visione diretta', instruction: 'Valuta il campo visivo diretto. Gli oggetti sono posizionati in posizioni contrassegnate sul pavimento — annota quali sono visibili dal sedile del guidatore.', metrics: { direct_vision: { label: 'Visione diretta — frontale e laterale', min: 'Molto limitata', max: 'Eccellente' }, mirror_visibility: { label: 'Visibilità degli specchietti laterali', min: 'Bloccata', max: 'Chiara' } } },
    },
    lt: {
      cab:      { title: 'Kabinos įvertinimas ir pavarų perjungimas', instruction: 'Sustojimas-paleidimas kalne į viršų, tada pagreitinkite. Įvertinkite pavarų dėžę ir kabinos elgesį.', metrics: { cab_assessment: { label: 'Kabinos įvertinimas', min: 'Prastas', max: 'Labai geras' }, gear_shift: { label: 'Pavarų perjungimo atsakas', min: 'Nepatikimas', max: 'Labai patikimas' } } },
      aux:      { title: 'Pagalbinis stabdys', instruction: 'Pagalbinis stabdys kalne žemyn. Įvertinkite naudojimo paprastumą ir pasitikėjimą valdymu.', metrics: { ease_handling: { label: 'Valdymo paprastumas', min: 'Labai sunku', max: 'Labai lengva' } } },
      steering: { title: 'Vairavimas ir valdymas', instruction: 'Linijos sekimas viena ranka, tada kūgių slalomas. Įvertinkite vairavimo tikslumą ir važiuoklės stabilumą.', metrics: { steering_precision: { label: 'Vairavimo tikslumas', min: 'Netikslus', max: 'Labai tikslus' }, chassis_stability: { label: 'Važiuoklės stabilumas', min: 'Nestabilus', max: 'Labai stabilus' } } },
      parking:  { title: 'Parkavimas ir tikslus manevras', instruction: 'Manevravimo režimas atgal į parkavimą. Įvertinkite tikslumą, atbulinės eigos paprastumą ir dokavimo valdymą.', metrics: { precision_maneuver: { label: 'Tikslumas — manevravimo režimas', min: 'Netikslus', max: 'Labai tikslus' }, reversing_docking: { label: 'Atbulinės eigos ir dokavimo paprastumas', min: 'Labai sunku', max: 'Labai lengva' } } },
      overall:  { title: 'Bendras vairavimo įspūdis', instruction: 'Atlikę visas užduotis, pateikite bendrą įspūdį apie šio transporto priemonės vairavimą.', metrics: { overall_exp: { label: 'Bendras vairavimo įspūdis', min: 'Prastas', max: 'Premium' } } },
      boarding:   { title: 'Įlipimas ir išlipimas', instruction: 'Įlipkite į kabiną ir išlipkite iš jos. Įvertinkite viršutinio laiptelio matomumą iš viršaus ir bendrą įlipimo ir išlipimo paprastumą.', metrics: { boarding_ease: { label: 'Įlipimo ir išlipimo paprastumas', min: 'Labai sunku', max: 'Labai lengva' } } },
      ergonomics: { title: 'Ergonomika ir pasiekiamumas', instruction: 'Sėdint vairuotojo padėtyje: įvertinkite pagrindinių valdiklių, informacijos ekrano pasiekiamumą ir funkcijų loginį grupavimą.', metrics: { ergonomics_overall: { label: 'Bendras ergonominis įspūdis', min: 'Prastas', max: 'Labai geras' }, info_display: { label: 'Informacijos ekranas', min: 'Prastas', max: 'Labai geras' } } },
      fit_finish: { title: 'Priegludos ir apdailos kokybė', instruction: 'Įvertinkite medžiagos kokybę, spalvų atitikimą tarp paviršių ir plokščių tarpų vienodumą.', metrics: { overall_finish: { label: 'Bendra apdaila', min: 'Prastas', max: 'Premium' } } },
      safety:     { title: 'Sauga ir tiesioginis matomumas', instruction: 'Įvertinkite tiesioginį matymo lauką. Objektai išdėstyti pažymėtose grindų vietose — pažymėkite, kurie matomi iš vairuotojo sėdynės.', metrics: { direct_vision: { label: 'Tiesioginis matomumas — priekyje ir šonuose', min: 'Labai ribotas', max: 'Puikus' }, mirror_visibility: { label: 'Šoninių veidrodžių matomumas', min: 'Blokuotas', max: 'Aiškus' } } },
    },
    lv: {
      cab:      { title: 'Kabīnes novērtējums un pārslēgšana', instruction: 'Apstāšanās un sākšana kāpumā, tad paātrinājums. Novērtējiet pārnesumkārbu un kabīnes uzvedību.', metrics: { cab_assessment: { label: 'Kabīnes novērtējums', min: 'Vājš', max: 'Ļoti labs' }, gear_shift: { label: 'Pārslēgšanas reakcija', min: 'Neuzticams', max: 'Ļoti uzticams' } } },
      aux:      { title: 'Palīgbremze', instruction: 'Palīgbremze kalnā lejup. Novērtējiet lietošanas vieglumu un pārliecību par vadību.', metrics: { ease_handling: { label: 'Vadības vieglums', min: 'Ļoti grūti', max: 'Ļoti vienkārši' } } },
      steering: { title: 'Stūrēšana un vadāmība', instruction: 'Līnijas sekošana ar vienu roku, tad konusu slaloms. Novērtējiet stūrēšanas precizitāti un šasijas stabilitāti.', metrics: { steering_precision: { label: 'Stūrēšanas precizitāte', min: 'Neprecīzs', max: 'Ļoti precīzs' }, chassis_stability: { label: 'Šasijas stabilitāte', min: 'Nestabils', max: 'Ļoti stabils' } } },
      parking:  { title: 'Novietošana un precīzijas manevrs', instruction: 'Manevrēšanas režīms atpakaļ uz stāvvietu. Novērtējiet precizitāti, braukšanas atpakaļgaitā vieglumu un piestāšanas kontroli.', metrics: { precision_maneuver: { label: 'Precizitāte — manevrēšanas režīms', min: 'Neprecīzs', max: 'Ļoti precīzs' }, reversing_docking: { label: 'Braukšanas atpakaļgaitā un piestāšanas vieglums', min: 'Ļoti grūti', max: 'Ļoti vienkārši' } } },
      overall:  { title: 'Vispārējā braukšanas pieredze', instruction: 'Pēc visu uzdevumu izpildes sniedziet savu vispārējo iespaidu par šī transportlīdzekļa vadīšanu.', metrics: { overall_exp: { label: 'Vispārējā braukšanas pieredze', min: 'Vājš', max: 'Premium' } } },
      boarding:   { title: 'Iekāpšana un izkāpšana', instruction: 'Uzkāpiet kabīnē un izkāpiet no tās. Novērtējiet augšējā pakāpiena redzamību no augšas un vispārējo iekāpšanas un izkāpšanas vieglumu.', metrics: { boarding_ease: { label: 'Iekāpšanas un izkāpšanas vieglums', min: 'Ļoti grūti', max: 'Ļoti vienkārši' } } },
      ergonomics: { title: 'Ergonomika un pieejamība', instruction: 'Sēžot vadītāja pozīcijā: novērtējiet galveno vadības elementu, informācijas displeja pieejamību un funkciju loģisko grupēšanu.', metrics: { ergonomics_overall: { label: 'Vispārējais ergonomikas iespaids', min: 'Vājš', max: 'Ļoti labs' }, info_display: { label: 'Informācijas displejs', min: 'Vājš', max: 'Ļoti labs' } } },
      fit_finish: { title: 'Detaļu piegulums un apdare', instruction: 'Novērtējiet materiāla kvalitāti, virsmu krāsu saderību un paneļu spraugu vienveidību.', metrics: { overall_finish: { label: 'Vispārējā apdare', min: 'Vājš', max: 'Premium' } } },
      safety:     { title: 'Drošība un tieša redzamība', instruction: 'Novērtējiet tiešo redzamības lauku. Priekšmeti ir novietoti atzīmētās grīdas pozīcijās — atzīmējiet, kuri ir redzami no vadītāja sēdekļa.', metrics: { direct_vision: { label: 'Tieša redzamība — priekšā un sānos', min: 'Ļoti ierobežota', max: 'Izcila' }, mirror_visibility: { label: 'Sānu spoguļu redzamība', min: 'Bloķēta', max: 'Skaidra' } } },
    },
    no: {
      cab:      { title: 'Kabinvurdering & girskifte', instruction: 'Stopp-start i motbakken, akseler deretter. Vurder girkassen og kabinens oppførsel.', metrics: { cab_assessment: { label: 'Kabinvurdering', min: 'Dårlig', max: 'Veldig god' }, gear_shift: { label: 'Girskifterespons', min: 'Upålitelig', max: 'Veldig pålitelig' } } },
      aux:      { title: 'Hjelpebrems', instruction: 'Hjelpebrems i utforbakken. Vurder brukervennlighet og trygghet i kontrollen.', metrics: { ease_handling: { label: 'Enkel håndtering', min: 'Veldig vanskelig', max: 'Veldig enkelt' } } },
      steering: { title: 'Styring & håndtering', instruction: 'Linjefølging med én hånd, deretter kjegleslalom. Vurder styrepresisjon og chassisstabilitet.', metrics: { steering_precision: { label: 'Styrepresisjon', min: 'Upresis', max: 'Veldig presis' }, chassis_stability: { label: 'Chassisstabilitet', min: 'Ustabil', max: 'Veldig stabil' } } },
      parking:  { title: 'Parkering & presisjonsmanøver', instruction: 'Manøvreringsmodus tilbake til parkering. Vurder presisjon, enkelhet i revers og rygging til rampe.', metrics: { precision_maneuver: { label: 'Presisjon — manøvreringsmodus', min: 'Upresis', max: 'Veldig presis' }, reversing_docking: { label: 'Enkel revers & dokking', min: 'Veldig vanskelig', max: 'Veldig enkelt' } } },
      overall:  { title: 'Samlet kjøreopplevelse', instruction: 'Etter å ha fullført alle oppgaver, gi ditt generelle inntrykk av å kjøre dette kjøretøyet.', metrics: { overall_exp: { label: 'Samlet kjøreopplevelse', min: 'Dårlig', max: 'Premium' } } },
      boarding:   { title: 'Inn- og utstigning', instruction: 'Klatre inn i og ut av kabinen. Vurder synligheten av det øvre trinnet fra oven og den generelle enkelheten ved inn- og utstigning.', metrics: { boarding_ease: { label: 'Enkel inn- og utstigning', min: 'Veldig vanskelig', max: 'Veldig enkelt' } } },
      ergonomics: { title: 'Ergonomi & tilgjengelighet', instruction: 'Sittende i førerposisjon: vurder tilgjengeligheten til viktige kontroller, infoskjerm og logisk gruppering av funksjoner.', metrics: { ergonomics_overall: { label: 'Generelt ergonomisk inntrykk', min: 'Dårlig', max: 'Veldig god' }, info_display: { label: 'Infoskjerm', min: 'Dårlig', max: 'Veldig god' } } },
      fit_finish: { title: 'Tilpasning & finish', instruction: 'Vurder materialkvalitet, fargematching mellom overflater og jevn passform mellom paneler.', metrics: { overall_finish: { label: 'Generell finish', min: 'Dårlig', max: 'Premium' } } },
      safety:     { title: 'Sikkerhet & direkte sikt', instruction: 'Vurder det direkte synsfeltet. Objekter er plassert på merkede gulvposisjoner — noter hvilke som er synlige fra førersetet.', metrics: { direct_vision: { label: 'Direkte sikt — foran & sidene', min: 'Veldig begrenset', max: 'Utmerket' }, mirror_visibility: { label: 'Sikt i sidespeil', min: 'Blokkert', max: 'Klar' } } },
    },
    pl: {
      cab:      { title: 'Ocena kabiny i zmiana biegów', instruction: 'Zatrzymanie i ruszanie na wzniesieniu, następnie przyspiesz. Oceń skrzynię biegów i zachowanie kabiny.', metrics: { cab_assessment: { label: 'Ocena kabiny', min: 'Słaba', max: 'Bardzo dobra' }, gear_shift: { label: 'Reakcja zmiany biegów', min: 'Zawodna', max: 'Bardzo niezawodna' } } },
      aux:      { title: 'Hamulec pomocniczy', instruction: 'Hamulec pomocniczy na zjeździe. Oceń łatwość użycia i pewność kontroli.', metrics: { ease_handling: { label: 'Łatwość obsługi', min: 'Bardzo trudna', max: 'Bardzo łatwa' } } },
      steering: { title: 'Kierowanie i prowadzenie', instruction: 'Śledzenie linii jedną ręką, następnie slalom między pachołkami. Oceń precyzję kierowania i stabilność podwozia.', metrics: { steering_precision: { label: 'Precyzja kierowania', min: 'Nieprecyzyjna', max: 'Bardzo precyzyjna' }, chassis_stability: { label: 'Stabilność podwozia', min: 'Niestabilna', max: 'Bardzo stabilna' } } },
      parking:  { title: 'Parkowanie i precyzyjny manewr', instruction: 'Włącz tryb manewrowania i zaparkuj pojazd tyłem. Oceń precyzję, łatwość jazdy na wstecznym i kontrolę podjazdu pod rampę.', metrics: { precision_maneuver: { label: 'Precyzja — tryb manewrowania', min: 'Nieprecyzyjna', max: 'Bardzo precyzyjna' }, reversing_docking: { label: 'Łatwość jazdy na wstecznym i podjazdu pod rampę', min: 'Bardzo trudna', max: 'Bardzo łatwa' } } },
      overall:  { title: 'Ogólne wrażenie z jazdy', instruction: 'Po wykonaniu wszystkich zadań, podaj swoje ogólne wrażenie z prowadzenia tego pojazdu.', metrics: { overall_exp: { label: 'Ogólne wrażenie z jazdy', min: 'Słabe', max: 'Premium' } } },
      boarding:   { title: 'Wchodzenie i wychodzenie', instruction: 'Wejdź do kabiny i wyjdź z niej. Oceń widoczność górnego stopnia z góry oraz ogólną łatwość wchodzenia i wychodzenia.', metrics: { boarding_ease: { label: 'Łatwość wchodzenia i wychodzenia', min: 'Bardzo trudna', max: 'Bardzo łatwa' } } },
      ergonomics: { title: 'Ergonomia i dostępność', instruction: 'Siedząc w pozycji kierowcy: oceń łatwość sięgania do głównych elementów sterujących, wyświetlacza informacyjnego oraz logiczne grupowanie funkcji.', metrics: { ergonomics_overall: { label: 'Ogólne wrażenie ergonomiczne', min: 'Słabe', max: 'Bardzo dobre' }, info_display: { label: 'Wyświetlacz informacyjny', min: 'Słabe', max: 'Bardzo dobre' } } },
      fit_finish: { title: 'Wykonanie i wykończenie', instruction: 'Oceń jakość materiałów, zgodność kolorów między powierzchniami oraz równomierność szczelin między panelami.', metrics: { overall_finish: { label: 'Ogólne wykończenie', min: 'Słabe', max: 'Premium' } } },
      safety:     { title: 'Bezpieczeństwo i widoczność bezpośrednia', instruction: 'Oceń bezpośrednie pole widzenia. Przedmioty są umieszczone w oznaczonych miejscach na podłodze — zanotuj, które są widoczne z siedzenia kierowcy.', metrics: { direct_vision: { label: 'Widoczność bezpośrednia — przód i boki', min: 'Bardzo ograniczona', max: 'Doskonała' }, mirror_visibility: { label: 'Widoczność lusterek bocznych', min: 'Zablokowana', max: 'Czysta' } } },
    },
    ro: {
      cab:      { title: 'Evaluarea cabinei și schimbarea vitezelor', instruction: 'Pornire-oprire pe pantă în sus, apoi accelerați. Evaluați cutia de viteze și comportamentul cabinei.', metrics: { cab_assessment: { label: 'Evaluarea cabinei', min: 'Slabă', max: 'Foarte bună' }, gear_shift: { label: 'Răspunsul schimbării de viteze', min: 'Nesigur', max: 'Foarte sigur' } } },
      aux:      { title: 'Frână auxiliară', instruction: 'Frână auxiliară pe pantă în jos. Evaluați facilitatea de utilizare și încrederea în control.', metrics: { ease_handling: { label: 'Ușurința manevrării', min: 'Foarte dificil', max: 'Foarte ușor' } } },
      steering: { title: 'Direcție și manevrabilitate', instruction: 'Urmărirea liniei cu o mână, apoi slalom printre conuri. Evaluați precizia direcției și stabilitatea șasiului.', metrics: { steering_precision: { label: 'Precizia direcției', min: 'Imprecis', max: 'Foarte precis' }, chassis_stability: { label: 'Stabilitatea șasiului', min: 'Instabil', max: 'Foarte stabil' } } },
      parking:  { title: 'Parcare și manevră de precizie', instruction: 'Mod de manevră înapoi la parcare. Evaluați precizia, ușurința de mers înapoi și controlul andocării.', metrics: { precision_maneuver: { label: 'Precizie — mod de manevră', min: 'Imprecis', max: 'Foarte precis' }, reversing_docking: { label: 'Ușurința mersului înapoi și andocării', min: 'Foarte dificil', max: 'Foarte ușor' } } },
      overall:  { title: 'Experiența generală de condus', instruction: 'După finalizarea tuturor sarcinilor, oferiți impresia generală despre condusul acestui vehicul.', metrics: { overall_exp: { label: 'Experiența generală de condus', min: 'Slab', max: 'Premium' } } },
      boarding:   { title: 'Îmbarcare și debarcare', instruction: 'Urcați și coborâți din cabină. Evaluați vizibilitatea treptei superioare de sus și ușurința generală de intrare și ieșire.', metrics: { boarding_ease: { label: 'Ușurința îmbarcării și debarcării', min: 'Foarte dificil', max: 'Foarte ușor' } } },
      ergonomics: { title: 'Ergonomie și accesibilitate', instruction: 'Așezat în poziția șoferului: evaluați accesibilitatea comenzilor principale, afișajul de informații și gruparea logică a funcțiilor.', metrics: { ergonomics_overall: { label: 'Impresia ergonomică generală', min: 'Slabă', max: 'Foarte bună' }, info_display: { label: 'Afișaj de informații', min: 'Slab', max: 'Foarte bun' } } },
      fit_finish: { title: 'Ajustare și finisaj', instruction: 'Evaluați calitatea materialelor, corespondența culorilor între suprafețe și uniformitatea rosturilor dintre panouri.', metrics: { overall_finish: { label: 'Finisaj general', min: 'Slab', max: 'Premium' } } },
      safety:     { title: 'Siguranță și vizibilitate directă', instruction: 'Evaluați câmpul vizual direct. Obiectele sunt plasate în poziții marcate pe podea — notați care sunt vizibile din scaunul șoferului.', metrics: { direct_vision: { label: 'Vizibilitate directă — față și lateral', min: 'Foarte limitată', max: 'Excelentă' }, mirror_visibility: { label: 'Vizibilitatea oglinzilor laterale', min: 'Blocată', max: 'Clară' } } },
    },
    sk: {
      cab:      { title: 'Hodnotenie kabíny a preraďovania', instruction: 'Zastavenie a rozjazd do kopca, potom akcelerujte. Zhodnoťte prevodovku a správanie kabíny.', metrics: { cab_assessment: { label: 'Hodnotenie kabíny', min: 'Slabé', max: 'Veľmi dobré' }, gear_shift: { label: 'Odozva preraďovania', min: 'Nespoľahlivé', max: 'Veľmi spoľahlivé' } } },
      aux:      { title: 'Pomocná brzda', instruction: 'Pomocná brzda na zjazde. Zhodnoťte jednoduchosť použitia a istotu pri ovládaní.', metrics: { ease_handling: { label: 'Jednoduchosť ovládania', min: 'Veľmi náročné', max: 'Veľmi jednoduché' } } },
      steering: { title: 'Riadenie a ovládateľnosť', instruction: 'Sledovanie čiary jednou rukou, potom slalom medzi kužeľmi. Zhodnoťte presnosť riadenia a stabilitu podvozka.', metrics: { steering_precision: { label: 'Presnosť riadenia', min: 'Nepresné', max: 'Veľmi presné' }, chassis_stability: { label: 'Stabilita podvozka', min: 'Nestabilné', max: 'Veľmi stabilné' } } },
      parking:  { title: 'Parkovanie a presný manéver', instruction: 'Manévrovanie späť na parkovacie miesto. Zhodnoťte presnosť, jednoduchosť cúvania a kontrolu pri dokovaní.', metrics: { precision_maneuver: { label: 'Presnosť — manévrovací režim', min: 'Nepresné', max: 'Veľmi presné' }, reversing_docking: { label: 'Jednoduchosť cúvania a dokovania', min: 'Veľmi náročné', max: 'Veľmi jednoduché' } } },
      overall:  { title: 'Celkový dojem z jazdy', instruction: 'Po dokončení všetkých úloh uveďte svoj celkový dojem z jazdy s týmto vozidlom.', metrics: { overall_exp: { label: 'Celkový dojem z jazdy', min: 'Slabé', max: 'Prémiové' } } },
      boarding:   { title: 'Nastupovanie a vystupovanie', instruction: 'Nastúpte do kabíny a vystúpte z nej. Zhodnoťte viditeľnosť horného schodíka zhora a celkovú jednoduchosť nastupovania a vystupovania.', metrics: { boarding_ease: { label: 'Jednoduchosť nastupovania a vystupovania', min: 'Veľmi náročné', max: 'Veľmi jednoduché' } } },
      ergonomics: { title: 'Ergonómia a dosiahnuteľnosť', instruction: 'V pozícii vodiča: zhodnoťte dosiahnuteľnosť hlavných ovládacích prvkov, informačného displeja a logické zoskupenie funkcií.', metrics: { ergonomics_overall: { label: 'Celkový ergonomický dojem', min: 'Slabé', max: 'Veľmi dobré' }, info_display: { label: 'Informačný displej', min: 'Slabé', max: 'Veľmi dobré' } } },
      fit_finish: { title: 'Kvalita spracovania a presnosť dielov', instruction: 'Zhodnoťte kvalitu materiálov, farebný súlad medzi povrchmi a jednotnosť medzier medzi panelmi.', metrics: { overall_finish: { label: 'Celkové spracovanie', min: 'Slabé', max: 'Prémiové' } } },
      safety:     { title: 'Bezpečnosť a priama viditeľnosť', instruction: 'Zhodnoťte priame zorné pole. Predmety sú umiestnené na značených miestach na podlahe — zaznamenajte, ktoré sú viditeľné z miesta vodiča.', metrics: { direct_vision: { label: 'Priama viditeľnosť — vpredu a po stranách', min: 'Veľmi obmedzená', max: 'Výborná' }, mirror_visibility: { label: 'Viditeľnosť bočných zrkadiel', min: 'Zablokovaná', max: 'Čistá' } } },
    },
    sl: {
      cab:      { title: 'Ocena kabine in menjava prestav', instruction: 'Ustavljanje in speljevanje na klancu navzgor, nato pospešite. Ocenite menjalnik in obnašanje kabine.', metrics: { cab_assessment: { label: 'Ocena kabine', min: 'Slabo', max: 'Zelo dobro' }, gear_shift: { label: 'Odziv menjave prestav', min: 'Nezanesljivo', max: 'Zelo zanesljivo' } } },
      aux:      { title: 'Pomožna zavora', instruction: 'Pomožna zavora na klancu navzdol. Ocenite enostavnost uporabe in zanesljivost nadzora.', metrics: { ease_handling: { label: 'Enostavnost upravljanja', min: 'Zelo težko', max: 'Zelo enostavno' } } },
      steering: { title: 'Krmiljenje in vozne lastnosti', instruction: 'Sledenje črti z eno roko, nato slalom med stožci. Ocenite natančnost krmiljenja in stabilnost šasije.', metrics: { steering_precision: { label: 'Natančnost krmiljenja', min: 'Nenatančno', max: 'Zelo natančno' }, chassis_stability: { label: 'Stabilnost šasije', min: 'Nestabilno', max: 'Zelo stabilno' } } },
      parking:  { title: 'Parkiranje in natančen manever', instruction: 'Preklop v vzvratno vožnjo za parkiranje. Ocenite natančnost, enostavnost vzvratne vožnje in nadzor priklopa.', metrics: { precision_maneuver: { label: 'Natančnost — manevrski način', min: 'Nenatančno', max: 'Zelo natančno' }, reversing_docking: { label: 'Enostavnost vzvratne vožnje in priklopa', min: 'Zelo težko', max: 'Zelo enostavno' } } },
      overall:  { title: 'Splošni vozni vtis', instruction: 'Po opravljenih vseh nalogah podajte svoj splošni vtis o vožnji s tem vozilom.', metrics: { overall_exp: { label: 'Splošni vozni vtis', min: 'Slabo', max: 'Premium' } } },
      boarding:   { title: 'Vstopanje in izstopanje', instruction: 'Vstopite v kabino in izstopite iz nje. Ocenite vidljivost zgornje stopnice od zgoraj in splošno enostavnost vstopa in izstopa.', metrics: { boarding_ease: { label: 'Enostavnost vstopa in izstopa', min: 'Zelo težko', max: 'Zelo enostavno' } } },
      ergonomics: { title: 'Ergonomija in dosegljivost', instruction: 'Sedeč v vozniškem položaju: ocenite dosegljivost glavnih kontrol, informacijskega zaslona in logično razporeditev funkcij.', metrics: { ergonomics_overall: { label: 'Splošni ergonomski vtis', min: 'Slabo', max: 'Zelo dobro' }, info_display: { label: 'Informacijski zaslon', min: 'Slabo', max: 'Zelo dobro' } } },
      fit_finish: { title: 'Prileganje in izdelava', instruction: 'Ocenite kakovost materiala, ujemanje barv med površinami in enotnost rež med paneli.', metrics: { overall_finish: { label: 'Splošna izdelava', min: 'Slabo', max: 'Premium' } } },
      safety:     { title: 'Varnost in neposredna vidljivost', instruction: 'Ocenite neposredno vidno polje. Predmeti so postavljeni na označena mesta na tleh — zapišite, kateri so vidni z voznikovega sedeža.', metrics: { direct_vision: { label: 'Neposredna vidljivost — spredaj in ob straneh', min: 'Zelo omejena', max: 'Odlična' }, mirror_visibility: { label: 'Vidljivost stranskih vzvratnih zrcal', min: 'Blokirana', max: 'Jasna' } } },
    },
    sr: {
      cab:      { title: 'Ocena kabine i menjanja brzina', instruction: 'Zaustavite se i krenite na usponu, zatim ubrzajte. Ocenite menjač i ponašanje kabine.', metrics: { cab_assessment: { label: 'Ocena kabine', min: 'Loše', max: 'Veoma dobro' }, gear_shift: { label: 'Odziv menjanja brzina', min: 'Nepouzdano', max: 'Veoma pouzdano' } } },
      aux:      { title: 'Pomoćna kočnica', instruction: 'Pomoćna kočnica na nizbrdici. Ocenite lakoću upotrebe i sigurnost kontrole.', metrics: { ease_handling: { label: 'Lakoća upravljanja', min: 'Veoma teško', max: 'Veoma lako' } } },
      steering: { title: 'Upravljanje i upravljivost', instruction: 'Praćenje linije jednom rukom, zatim slalom između konusa. Ocenite preciznost upravljanja i stabilnost šasije.', metrics: { steering_precision: { label: 'Preciznost upravljanja', min: 'Neprecizno', max: 'Veoma precizno' }, chassis_stability: { label: 'Stabilnost šasije', min: 'Nestabilno', max: 'Veoma stabilno' } } },
      parking:  { title: 'Parkiranje i precizan manevar', instruction: 'Režim manevrisanja nazad do parkiranja. Ocenite preciznost, lakoću vožnje unatrag i kontrolu prilikom približavanja.', metrics: { precision_maneuver: { label: 'Preciznost — režim manevrisanja', min: 'Neprecizno', max: 'Veoma precizno' }, reversing_docking: { label: 'Lakoća vožnje unatrag i približavanja', min: 'Veoma teško', max: 'Veoma lako' } } },
      overall:  { title: 'Ukupan utisak vožnje', instruction: 'Nakon završetka svih zadataka, dajte svoj ukupan utisak o vožnji ovog vozila.', metrics: { overall_exp: { label: 'Ukupan utisak vožnje', min: 'Loše', max: 'Premium' } } },
      boarding:   { title: 'Ulazak i izlazak', instruction: 'Uđite u kabinu i izađite iz nje. Ocenite vidljivost gornjeg stepenika odozgo i ukupnu lakoću ulaza i izlaza.', metrics: { boarding_ease: { label: 'Lakoća ulaza i izlaza', min: 'Veoma teško', max: 'Veoma lako' } } },
      ergonomics: { title: 'Ergonomija i dostupnost', instruction: 'Sedeći u položaju vozača: ocenite dostupnost glavnih kontrola, informacionog displeja i logičko grupisanje funkcija.', metrics: { ergonomics_overall: { label: 'Ukupan ergonomski utisak', min: 'Loše', max: 'Veoma dobro' }, info_display: { label: 'Informacioni displej', min: 'Loše', max: 'Veoma dobro' } } },
      fit_finish: { title: 'Uklapanje i završna obrada', instruction: 'Ocenite kvalitet materijala, usklađenost boja između površina i ujednačenost razmaka između panela.', metrics: { overall_finish: { label: 'Ukupna završna obrada', min: 'Loše', max: 'Premium' } } },
      safety:     { title: 'Bezbednost i direktna vidljivost', instruction: 'Ocenite direktno vidno polje. Predmeti su postavljeni na obeleženim pozicijama na podu — zabeležite koji su vidljivi sa sedišta vozača.', metrics: { direct_vision: { label: 'Direktna vidljivost — napred i sa strana', min: 'Veoma ograničena', max: 'Izvrsna' }, mirror_visibility: { label: 'Vidljivost bočnih retrovizora', min: 'Blokirana', max: 'Čista' } } },
    },
    uk: {
      cab:      { title: 'Оцінка кабіни та перемикання передач', instruction: 'Зупинка-старт на підйомі, потім прискорення. Оцініть коробку передач та поведінку кабіни.', metrics: { cab_assessment: { label: 'Оцінка кабіни', min: 'Погано', max: 'Дуже добре' }, gear_shift: { label: 'Реакція перемикання передач', min: 'Ненадійно', max: 'Дуже надійно' } } },
      aux:      { title: 'Допоміжне гальмо', instruction: 'Допоміжне гальмо на спуску. Оцініть простоту використання та впевненість у керуванні.', metrics: { ease_handling: { label: 'Простота керування', min: 'Дуже важко', max: 'Дуже легко' } } },
      steering: { title: 'Керування та стійкість', instruction: 'Слідування лінії однією рукою, потім слалом між конусами. Оцініть точність керування та стабільність шасі.', metrics: { steering_precision: { label: 'Точність керування', min: 'Неточно', max: 'Дуже точно' }, chassis_stability: { label: 'Стабільність шасі', min: 'Нестабільно', max: 'Дуже стабільно' } } },
      parking:  { title: 'Паркування та точний маневр', instruction: 'Режим маневрування назад до паркування. Оцініть точність, легкість руху назад та контроль стикування.', metrics: { precision_maneuver: { label: 'Точність — режим маневрування', min: 'Неточно', max: 'Дуже точно' }, reversing_docking: { label: 'Легкість руху назад та стикування', min: 'Дуже важко', max: 'Дуже легко' } } },
      overall:  { title: 'Загальне враження від керування', instruction: 'Виконавши всі завдання, надайте загальне враження від керування цим транспортним засобом.', metrics: { overall_exp: { label: 'Загальне враження від керування', min: 'Погано', max: 'Преміум' } } },
      boarding:   { title: 'Посадка та висадка', instruction: 'Залізьте в кабіну та вийдіть з неї. Оцініть видимість верхньої сходинки зверху та загальну легкість посадки та висадки.', metrics: { boarding_ease: { label: 'Легкість посадки та висадки', min: 'Дуже важко', max: 'Дуже легко' } } },
      ergonomics: { title: 'Ергономіка та доступність', instruction: 'Сидячи в положенні водія: оцініть доступність основних елементів керування, інформаційного дисплея та логічне групування функцій.', metrics: { ergonomics_overall: { label: 'Загальне ергономічне враження', min: 'Погано', max: 'Дуже добре' }, info_display: { label: 'Інформаційний дисплей', min: 'Погано', max: 'Дуже добре' } } },
      fit_finish: { title: 'Обробка та якість матеріалів', instruction: 'Оцініть якість матеріалів, відповідність кольорів між поверхнями та однорідність зазорів між панелями.', metrics: { overall_finish: { label: 'Загальна обробка', min: 'Погано', max: 'Преміум' } } },
      safety:     { title: 'Безпека та пряма видимість', instruction: 'Оцініть пряме поле зору. Предмети розміщені на позначених позиціях на підлозі — відзначте, які видно з сидіння водія.', metrics: { direct_vision: { label: 'Пряма видимість — спереду та з боків', min: 'Дуже обмежена', max: 'Відмінна' }, mirror_visibility: { label: 'Видимість бокових дзеркал', min: 'Заблоковано', max: 'Чітко' } } },
    },
  };
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
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) { seedDemo(); return; }
      const d = JSON.parse(raw);
      state.lang = d.lang || 'en';
      state.country = d.country || '';
      const today = new Date().toISOString().slice(0, 10);
      state.group = d.group || today;
      state.questions = (d.questions && d.questions.length) ? d.questions : DEFAULT_QUESTIONS;
      state.vehicles = (d.vehicles && d.vehicles.length) ? d.vehicles : DEFAULT_VEHICLES;
      state.answers = d.answers || {};
      state.cabQuestions = (d.cabQuestions && d.cabQuestions.length) ? d.cabQuestions : DEFAULT_CAB_QUESTIONS;
      state.cabVehicles = (d.cabVehicles && d.cabVehicles.length) ? d.cabVehicles : DEFAULT_CAB_VEHICLES;
      state.cabAnswers = d.cabAnswers || {};
      state.translations = d.translations || {};
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

  function normaliseCategory(c) {
    return {
      id: c.id || slug(c.title),
      title: c.title || 'Untitled category',
      instruction: c.instruction || '',
      metrics: (c.metrics || []).map((m) => ({
        id: m.id || slug(m.label),
        label: m.label || 'Untitled metric',
        min: m.min || 'Low', max: m.max || 'High',
        scale: m.scale || 10,
      })),
    };
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
  const STD = {
    STORE_KEY, $, h, esc, clamp, hashStr, slug,
    BRANDS, brandOf, DEFAULT_VEHICLES, DEFAULT_QUESTIONS, DEFAULT_CAB_VEHICLES, DEFAULT_CAB_QUESTIONS, LANGS, COUNTRIES, T, t, tCat, QI18N,
    state, save, load, seedDemo, normaliseCategory,
    vehicleCategoryScore, vehicleOverall, evaluatedVehicles, brandsPresent, brandCategoryScore, computeAll,
    onQuestionsChanged: null,   // pages set this to re-render when questions change
  };
  window.STD = STD;

  /* Haptic feedback — short vibration on any interactive button tap */
  if ('vibrate' in navigator) {
    document.addEventListener('pointerdown', function (e) {
      var el = e.target.closest('button, .pill, .vehicle, .linkbtn, [role="button"]');
      if (el && !el.disabled) navigator.vibrate(8);
    }, { passive: true });
  }

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

  window.ScaniaEval = {
    getQuestions: () => JSON.parse(JSON.stringify(state.questions)),
    setQuestions(questions) {
      if (!Array.isArray(questions) || !questions.length) throw new Error('setQuestions expects a non-empty array');
      state.questions = questions.map(normaliseCategory);
      save();
      if (typeof STD.onQuestionsChanged === 'function') STD.onQuestionsChanged();
      return window.ScaniaEval.getQuestions();
    },
    addQuestion(cat) { return window.ScaniaEval.setQuestions([...state.questions, cat]); },
    resetQuestions() { return window.ScaniaEval.setQuestions(DEFAULT_QUESTIONS); },
    getResults: () => computeAll(),
  };
})();
