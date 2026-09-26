/*
  Doginary — delad inloggningsmodul (modal + kontoknapp)
  ----------------------------------------------------------------------
  En och samma inloggningsruta återanvänds på index.html, logga.html och
  insikter.html, istället för att varje sida har sin egen inbäddade
  formulär-yta. Bygger vidare på doginary-supabase.js (måste laddas
  FÖRE den här filen).

  ANVÄNDNING PÅ EN SIDA
  ----------------------------------------------------------------------
  1. Lägg till i <head>: <link rel="stylesheet" href="doginary-auth-ui.css">
  2. Lägg till en tom behållare där kontoknappen ska synas (valfritt —
     annars visas bara den osynliga modalen, som du kan öppna själv):
       <div id="doginaryAuthRoot"></div>
  3. Ladda i den här ordningen, sist i <body>:
       <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
       <script src="doginary-supabase.js"></script>
       <script src="doginary-auth.js"></script>
  4. Lyssna på inloggning/utloggning var som helst i sidans egen kod:
       document.addEventListener('doginary:auth', (e) => {
         // e.detail.session är null vid utloggning, annars Supabase-sessionen
       });
     Vid sidladdning eldas eventet alltid en gång när första statusen är känd.

     Vill sidan istället veta EXAKT när den får visa sitt riktiga
     (betalvägg-skyddade) innehåll — t.ex. Breeder Hub, som visar en
     klickbar demo tills det är klart — lyssna på 'doginary:access'
     istället, som eldas varje gång prenumerations-/provperiodsstatusen
     är (om-)beräknad:
       document.addEventListener('doginary:access', (e) => {
         // e.detail.hasAccess: true/false, e.detail.session, e.detail.subscription
       });
     OBS: det eventet eldas bara när det finns en inloggad session — vid
     utloggning används fortfarande bara 'doginary:auth' (session: null).
  5. Öppna rutan manuellt från valfri knapp (t.ex. en gammal "Logga in"-länk):
       someBtn.addEventListener('click', (ev) => {
         ev.preventDefault();
         DoginaryAuthUI.open('signup'); // eller 'signin'
       });

  SPRÅK (svenska / engelska)
  ----------------------------------------------------------------------
  Rutan och kontomenyn följer sidans språkval automatiskt. Språket läses
  från localStorage-nyckeln 'dogWeatherLang' ('sv' | 'en') som app.js
  sparar, och i andra hand från <html lang>. Byter besökaren språk medan
  sidan är öppen byts texterna direkt — ingen omladdning behövs, och
  ingen ändring krävs i sidans egen kod. Se I18N-tabellen längst upp i
  filen; nya texter läggs till i BÅDA språken där.

  OM SNABB INLOGGNING UTAN BEKRÄFTELSEMEJL (viktigt!)
  ----------------------------------------------------------------------
  Den här filen loggar in ett nytt konto DIREKT om Supabase skickar
  tillbaka en session vid registreringen (inget mejl krävs). Om Supabase
  istället säger att kontot behöver bekräftas visas ett tydligt
  meddelande om det i rutan — koden kan inte tvinga fram en session när
  Supabase inte ger en.

  Detta styrs INTE härifrån utan i själva Supabase-projektet:
    Supabase Dashboard → Authentication → Sign In / Providers → Email
    → stäng av "Confirm email".
  Med den inställningen avstängd blir registrering + inloggning
  ögonblicklig, precis som efterfrågat. Den är påslagen som standard i
  nya Supabase-projekt.
*/
(function (global) {
  'use strict';

  if (!global.DoginaryAuth || !global.DoginaryDB) {
    console.error('doginary-auth.js: DoginaryAuth/DoginaryDB saknas — kontrollera att doginary-supabase.js laddas före den här filen.');
    return;
  }
  if (!global.DoginaryBilling) {
    console.error('doginary-auth.js: DoginaryBilling saknas — uppdatera doginary-supabase.js till versionen med prenumerations-/provperiodsstöd.');
  }

  // ---------- Språk (svenska / engelska) ----------
  //
  // Inloggningsrutan och kontomenyn följer samma språkval som resten av
  // sidan. Sidans egen kod (app.js på index.html) sparar valet i
  // localStorage under 'dogWeatherLang' ('sv' | 'en') och sätter samtidigt
  // <html lang="…">. Vi läser båda:
  //
  //   1. localStorage — ett MANUELLT val ska alltid gälla, på alla sidor.
  //   2. <html lang> — täcker fallet när app.js själv valt språk utan att
  //      spara det (t.ex. det automatiska "besökare i Sverige får svenska"
  //      i app.js, som medvetet inte skriver till localStorage), och sidor
  //      som bara finns på ett språk.
  //   3. svenska som sista utväg.
  //
  // Byter användaren språk medan sidan är öppen upptäcks det nedan (både
  // via <html lang>-observern och via 'storage' från andra flikar) och
  // texterna byts direkt — även om rutan råkar stå öppen just då.

  var I18N = {
    sv: {
      close: 'Stäng',
      emailLabel: 'Mejladress',
      emailPlaceholder: 'din@mejl.se',
      passwordLabel: 'Lösenord',
      passwordPlaceholder: 'Minst 6 tecken',
      forgot: 'Glömt lösenord?',
      trialBadge: '14 dagar fritt att testa — inget kort behövs',
      signupTitle: 'Skapa konto',
      signupDesc: 'Skapa ett konto med mejl och lösenord, så sparas din hunds dagbok och syncar mellan dina enheter. Du får 14 dagars fri provperiod direkt vid registrering.',
      signupSubmit: 'Skapa konto',
      signupToggle: 'Har du redan ett konto? Logga in',
      signinTitle: 'Logga in',
      signinDesc: 'Logga in med din mejladress och ditt lösenord.',
      signinSubmit: 'Logga in',
      signinToggle: 'Inget konto än? Skapa ett',
      creating: 'Skapar konto …',
      signingIn: 'Loggar in …',
      needsConfirmation: 'Kontot är skapat! Kolla din inkorg och klicka på bekräftelselänken, logga sedan in här.',
      enterEmailFirst: 'Skriv din mejladress i fältet ovan först.',
      resetSent: 'Vi har skickat en länk för att återställa lösenordet till {email}.',
      resetFailed: 'Kunde inte skicka återställningslänken just nu — försök igen.',
      genericError: 'Något gick fel — försök igen.',
      errInvalidCredentials: 'Fel mejladress eller lösenord.',
      errEmailNotConfirmed: 'Kontot är inte bekräftat än — klicka på länken i mejlet först.',
      errUserExists: 'Det finns redan ett konto med den mejladressen. Logga in istället.',
      errWeakPassword: 'Lösenordet är för kort — använd minst 6 tecken.',
      errRateLimit: 'För många försök just nu — vänta en stund och prova igen.',
      authAgreeText: 'Jag godkänner {terms} och bekräftar att jag har tagit del av {privacy}.',
      termsLinkLabel: 'användarvillkoren',
      privacyLinkLabel: 'integritetspolicyn',
      consentRequired: 'Du behöver godkänna villkoren för att skapa ett konto.',
      accountMenuAria: 'Kontomeny',
      loginAria: 'Logga in',
      dogNameLabel: 'Hundens namn',
      dogNamePlaceholder: 'Hundens namn',
      breedLabel: 'Ras',
      breedPlaceholder: 'Välj ras',
      breedMixed: 'Blandras',
      breedOther: 'Annan ras',
      ageLabel: 'Ålder',
      agePuppy: 'Valp (under 1 år)',
      ageAdult: 'Vuxen',
      ageSenior: 'Senior (8+ år)',
      save: 'Spara',
      saving: 'Sparar …',
      saved: 'Sparat.',
      saveFailed: 'Kunde inte spara just nu — försök igen.',
      logout: 'Logga ut',
      trialDaysLeft: '{days} dagar kvar av provperioden',
      trialLastDay: 'Sista dagen av provperioden',
      manageSubscription: 'Hantera prenumeration',
      portalRedirecting: 'Öppnar …',
      portalError: 'Kunde inte öppna prenumerationshanteringen — försök igen.',
      paywallTitle: 'Din provperiod har gått ut',
      paywallDesc: 'Lås upp Doginary för att fortsätta logga dagbok och se insikter om din hund.',
      paywallUnlock: 'Lås upp Doginary',
      paywallRedirecting: 'Öppnar betalning …',
      paywallError: 'Något gick fel — försök igen.',
      paywallLogout: 'Logga ut'
    },
    en: {
      close: 'Close',
      emailLabel: 'Email address',
      emailPlaceholder: 'you@email.com',
      passwordLabel: 'Password',
      passwordPlaceholder: 'At least 6 characters',
      forgot: 'Forgot your password?',
      trialBadge: '14 days free to try — no card needed',
      signupTitle: 'Create account',
      signupDesc: 'Create an account with your email and a password, and your dog’s diary is saved and synced across your devices. You get a 14-day free trial as soon as you sign up.',
      signupSubmit: 'Create account',
      signupToggle: 'Already have an account? Log in',
      signinTitle: 'Log in',
      signinDesc: 'Log in with your email address and password.',
      signinSubmit: 'Log in',
      signinToggle: 'No account yet? Create one',
      creating: 'Creating account …',
      signingIn: 'Logging in …',
      needsConfirmation: 'Your account has been created! Check your inbox, click the confirmation link, then log in here.',
      enterEmailFirst: 'Enter your email address in the field above first.',
      resetSent: 'We’ve sent a password reset link to {email}.',
      resetFailed: 'Couldn’t send the reset link right now — please try again.',
      genericError: 'Something went wrong — please try again.',
      errInvalidCredentials: 'Wrong email address or password.',
      errEmailNotConfirmed: 'This account isn’t confirmed yet — click the link in the email first.',
      errUserExists: 'An account with that email address already exists. Log in instead.',
      errWeakPassword: 'That password is too short — use at least 6 characters.',
      errRateLimit: 'Too many attempts right now — wait a moment and try again.',
      authAgreeText: 'I agree to the {terms} and acknowledge the {privacy}.',
      termsLinkLabel: 'Terms & Conditions',
      privacyLinkLabel: 'Privacy Policy',
      consentRequired: 'You need to agree to the terms to create an account.',
      accountMenuAria: 'Account menu',
      loginAria: 'Log in',
      dogNameLabel: 'Dog’s name',
      dogNamePlaceholder: 'Dog’s name',
      breedLabel: 'Breed',
      breedPlaceholder: 'Choose breed',
      breedMixed: 'Mixed breed',
      breedOther: 'Other breed',
      ageLabel: 'Age',
      agePuppy: 'Puppy (under 1 year)',
      ageAdult: 'Adult',
      ageSenior: 'Senior (8+ years)',
      save: 'Save',
      saving: 'Saving …',
      saved: 'Saved.',
      saveFailed: 'Couldn’t save right now — please try again.',
      logout: 'Log out',
      trialDaysLeft: '{days} days left in your trial',
      trialLastDay: 'Last day of your trial',
      manageSubscription: 'Manage subscription',
      portalRedirecting: 'Opening …',
      portalError: 'Could not open subscription management — please try again.',
      paywallTitle: 'Your trial has ended',
      paywallDesc: 'Unlock Doginary to keep logging your dog’s diary and seeing insights.',
      paywallUnlock: 'Unlock Doginary',
      paywallRedirecting: 'Redirecting to checkout …',
      paywallError: 'Something went wrong — please try again.',
      paywallLogout: 'Log out'
    }
  };

  function detectLang() {
    try {
      var saved = localStorage.getItem('dogWeatherLang');
      if (saved === 'sv' || saved === 'en') return saved;
    } catch (e) { /* localStorage kan vara avstängd */ }
    var htmlLang = (document.documentElement.getAttribute('lang') || '').slice(0, 2).toLowerCase();
    if (htmlLang === 'sv' || htmlLang === 'en') return htmlLang;
    return 'sv';
  }

  var uiLang = detectLang();

  function T(key, vars) {
    var pack = I18N[uiLang] || I18N.sv;
    var s = pack[key] != null ? pack[key] : (I18N.sv[key] != null ? I18N.sv[key] : key);
    if (vars) {
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) s = s.replace('{' + k + '}', vars[k]);
      }
    }
    return s;
  }

  // Supabase svarar alltid på engelska. Här översätts de vanligaste
  // felen till sidans språk; okända fel visas som de kommer (på engelska)
  // hellre än att döljas bakom en intetsägande generisk text.
  function translateAuthError(err) {
    var raw = (err && err.message) ? String(err.message) : '';
    var low = raw.toLowerCase();
    if (low.indexOf('invalid login credentials') !== -1) return T('errInvalidCredentials');
    if (low.indexOf('email not confirmed') !== -1) return T('errEmailNotConfirmed');
    if (low.indexOf('already registered') !== -1 || low.indexOf('user already') !== -1) return T('errUserExists');
    if (low.indexOf('password should be') !== -1 || low.indexOf('weak password') !== -1) return T('errWeakPassword');
    if (low.indexOf('rate limit') !== -1 || low.indexOf('too many requests') !== -1) return T('errRateLimit');
    return raw || T('genericError');
  }

  // Byt språk i redan byggd DOM. Anropas när <html lang> ändras (app.js
  // gör det i applyStaticTranslations()), när en annan flik sparar ett
  // nytt språkval, och om sidan själv skickar 'doginary:langchange'.
  function applyLanguage() {
    var next = detectLang();
    if (next === uiLang) return;
    uiLang = next;
    if (modalEl) applyModalTexts();
    if (paywallEl) applyPaywallTexts();
    renderAccountChip();
  }

  if (window.MutationObserver) {
    new MutationObserver(applyLanguage).observe(document.documentElement, {
      attributes: true, attributeFilter: ['lang']
    });
  }
  global.addEventListener('storage', function (ev) {
    if (!ev || ev.key === 'dogWeatherLang' || ev.key === null) applyLanguage();
  });
  document.addEventListener('doginary:langchange', applyLanguage);

  var currentSession = null;
  var currentDog = null; // hämtas lat, se getCurrentDog()
  var currentSubscription = null; // { active, trial_ends_at, stripe_customer_id } — se checkAccess()
  var _resolveReady;
  var readyPromise = new Promise(function (resolve) { _resolveReady = resolve; });

  function fireAuthEvent() {
    document.dispatchEvent(new CustomEvent('doginary:auth', { detail: { session: currentSession } }));
  }

  // Hämtar (eller skapar) den inloggade användarens hund en gång och
  // cachar den här, så flera sidor/komponenter inte behöver fråga
  // Supabase om samma sak var för sig.
  function getCurrentDog(forceRefresh) {
    if (!currentSession) return Promise.resolve(null);
    if (currentDog && !forceRefresh) return Promise.resolve(currentDog);
    return global.DoginaryDB.getOrCreateDog(currentSession.user.id).then(function (dog) {
      currentDog = dog;
      return dog;
    });
  }

  // Enda vägen in för att SKRIVA namn/ras/ålder på den inloggade hunden,
  // oavsett vilken sida det görs från (index.html:s profilformulär,
  // logga.html:s namnruta, eller kontomenyns namnfält här nedanför).
  //
  // Tidigare gick t.ex. index.html:s profilformulär och logga.html:s
  // namnruta direkt via DoginaryDB.updateDogProfile()/updateDogName(),
  // vilket sparade rätt i databasen men ALDRIG uppdaterade den hund som
  // redan låg cachad här (currentDog) eller talade om för de andra
  // sidorna/kontomenyn att något ändrats — därav att namnet kunde se
  // olika ut i kontomenyn jämfört med t.ex. index, tills sidan laddades
  // om. Genom att alltid gå via den här funktionen hålls cachen och
  // "doginary:dogupdate"-eventet (som logga.html och insikter.html redan
  // lyssnar på) i synk direkt, oavsett varifrån ändringen kom.
  //
  // `fields` kan innehålla valfri kombination av { name, breed, size,
  // coat, age }, se updateDogProfile() i doginary-supabase.js.
  function updateCurrentDog(fields) {
    return getCurrentDog().then(function (dog) {
      if (!dog) throw new Error('Ingen inloggad hund att uppdatera.');
      return global.DoginaryDB.updateDogProfile(dog.id, fields).then(function (updatedDog) {
        currentDog = updatedDog;
        // Om kontomenyn redan är byggd (öppen eller inte) håller vi dess
        // fält i synk direkt, se fillDogFormFields() längre ner.
        fillDogFormFields(updatedDog);
        fireDogUpdateEvent(updatedDog);
        return updatedDog;
      });
    });
  }

  // ---------- Paywall: 14 dagars provperiod + Stripe ----------
  //
  // Körs varje gång en inloggad session blir känd (bootstrap + varje
  // onAuthStateChange). Bygger och visar en heltäckande ruta
  // (#doginaryPaywallGate) som blockerar resten av sidan så fort
  // provperioden gått ut och inget aktivt abonnemang finns — oavsett
  // vilken sida (index/logga/insikter) den här filen råkar vara laddad
  // på, eftersom den inte behöver känna till sidans egen DOM-struktur.
  //
  // Fail CLOSED: om statusen inte går att läsa (nätverksfel, RLS-avslag
  // osv) visas paywallen ändå, precis som i Breeder Hub — hellre en
  // legitim användare som får ladda om sidan än att ett fel av misstag
  // låser upp något som borde vara stängt.
  var paywallEl, paywallTitleEl, paywallDescEl, paywallMessageEl, paywallUnlockBtn, paywallLogoutBtn;

  function buildPaywall() {
    if (document.getElementById('doginaryPaywallGate')) return;
    paywallEl = document.createElement('div');
    paywallEl.id = 'doginaryPaywallGate';
    paywallEl.setAttribute('role', 'dialog');
    paywallEl.setAttribute('aria-modal', 'true');
    paywallEl.setAttribute('aria-labelledby', 'doginaryPaywallTitle');
    paywallEl.innerHTML =
      '<div id="doginaryPaywallCard">' +
        '<p class="doginaryAuthEyebrow">Doginary</p>' +
        '<h2 id="doginaryPaywallTitle"></h2>' +
        '<p id="doginaryPaywallDesc"></p>' +
        '<p id="doginaryPaywallMessage" role="alert"></p>' +
        '<button type="button" id="doginaryPaywallUnlockBtn"></button>' +
        '<button type="button" id="doginaryPaywallLogoutBtn"></button>' +
      '</div>';
    document.body.appendChild(paywallEl);

    paywallTitleEl = document.getElementById('doginaryPaywallTitle');
    paywallDescEl = document.getElementById('doginaryPaywallDesc');
    paywallMessageEl = document.getElementById('doginaryPaywallMessage');
    paywallUnlockBtn = document.getElementById('doginaryPaywallUnlockBtn');
    paywallLogoutBtn = document.getElementById('doginaryPaywallLogoutBtn');

    paywallUnlockBtn.addEventListener('click', startPaywallCheckout);
    paywallLogoutBtn.addEventListener('click', function () {
      global.DoginaryAuth.signOut().then(function () {
        global.location.reload();
      });
    });
  }

  function applyPaywallTexts() {
    if (!paywallEl) return;
    paywallTitleEl.textContent = T('paywallTitle');
    paywallDescEl.textContent = T('paywallDesc');
    paywallUnlockBtn.textContent = T('paywallUnlock');
    paywallLogoutBtn.textContent = T('paywallLogout');
  }

  function showPaywall() {
    buildPaywall();
    applyPaywallTexts();
    paywallMessageEl.textContent = '';
    paywallMessageEl.className = '';
    paywallUnlockBtn.disabled = false;
    paywallUnlockBtn.textContent = T('paywallUnlock');
    paywallEl.classList.add('show');
    // Modalen för inloggning ska aldrig kunna stå öppen samtidigt som
    // paywallen — annars kan en redan inloggad-men-spärrad användare
    // öppna den (t.ex. via en gammal "Logga in"-länk) och den skulle stå
    // ovanpå/under på ett förvirrande sätt.
    closeModal();
  }

  function hidePaywall() {
    if (paywallEl) paywallEl.classList.remove('show');
  }

  function startPaywallCheckout() {
    if (!global.DoginaryBilling) return;
    paywallUnlockBtn.disabled = true;
    paywallMessageEl.textContent = '';
    paywallMessageEl.className = '';
    paywallUnlockBtn.textContent = T('paywallRedirecting');
    global.DoginaryBilling.startCheckout(global.location.href).then(function (data) {
      if (!data || !data.url) throw new Error('No checkout URL returned');
      global.location.href = data.url;
    }).catch(function (err) {
      console.error('Doginary: kunde inte starta checkout', err);
      paywallMessageEl.textContent = T('paywallError');
      paywallMessageEl.className = 'error';
      paywallUnlockBtn.disabled = false;
      paywallUnlockBtn.textContent = T('paywallUnlock');
    });
  }

  // true om raden har ett giltigt, ännu inte passerat trial_ends_at.
  function isTrialActive(sub) {
    return !!(sub && sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() > Date.now());
  }

  function hasAccess(sub) {
    return !!(sub && (sub.active === true || isTrialActive(sub)));
  }

  function evaluateAccess(sub) {
    currentSubscription = sub;
    if (hasAccess(sub)) {
      hidePaywall();
    } else {
      showPaywall();
    }
    // Uppdatera ev. "X dagar kvar"/"Hantera prenumeration" i kontomenyn,
    // om den redan är byggd (renderAccountChip byggde den innan
    // statusen hunnit läsas klart).
    if (currentSession && document.getElementById('doginaryAccountMenu')) {
      renderAccountChip();
    }
    // Egen sida (t.ex. breeder-hub.html) vill ofta veta EXAKT när
    // prenumerationsstatusen är klar — till skillnad från 'doginary:auth'
    // (som bara säger om man är inloggad) säger det här om man faktiskt
    // FÅR använda appen just nu. Eldas efter varje checkAccess()-anrop,
    // inklusive den allra första efter sidladdning.
    document.dispatchEvent(new CustomEvent('doginary:access', {
      detail: { session: currentSession, hasAccess: hasAccess(sub), subscription: sub }
    }));
  }

  // Läser den EN raden ur breeder_subscriptions (trial_ends_at + active,
  // se getSubscriptionStatus() i doginary-supabase.js) och skickar den
  // rakt vidare till hasAccess()/isTrialActive(). En betald Breeder
  // Hub-prenumeration ger alltså automatiskt tillgång här också, och en
  // provperiod startad här ger tillgång till Breeder Hub — samma rad,
  // samma regel, oavsett vilken sida man skapade kontot på.
  function checkAccess() {
    if (!global.DoginaryBilling || !currentSession) {
      hidePaywall();
      return;
    }
    var userId = currentSession.user.id;

    global.DoginaryBilling.getSubscriptionStatus(userId).then(function (row) {
      // Ingen rad än — troligen ett konto som just skapats (eller ett
      // äldre konto från innan provperiods-funktionen infördes). Starta
      // trialen (idempotent, servern sätter trial_ends_at) innan vi går
      // vidare. Rör aldrig en befintlig rad, så det här är säkert att
      // köra även om kontot redan har en aktiv, betald rad.
      if (row) return row;
      return global.DoginaryBilling.startTrial();
    }).then(function (row) {
      evaluateAccess(row);
    }).catch(function (err) {
      console.error('Doginary: kunde inte läsa prenumerationsstatus', err);
      showPaywall(); // fail closed, se kommentar ovanför funktionerna
    });
  }

  // ---------- Modal + kontoknapp: bygg DOM ----------

  var modalEl, formEl, emailInput, passwordInput, messageEl, submitBtn,
      titleEl, descEl, trialBadgeEl, toggleBtn, forgotBtn, closeBtn,
      consentRow, consentCheckbox, consentLabel;
  var mode = 'signup'; // 'signup' | 'signin'

  function buildModal() {
    if (document.getElementById('doginaryAuthModal')) return;

    modalEl = document.createElement('div');
    modalEl.id = 'doginaryAuthModal';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-labelledby', 'doginaryAuthTitle');
    // Texterna sätts av applyModalTexts() längre ner, på sidans språk —
    // markeringen här är bara stommen.
    modalEl.innerHTML =
      '<div id="doginaryAuthCard">' +
        '<button type="button" id="doginaryAuthClose">&times;</button>' +
        '<p class="doginaryAuthEyebrow">Doginary</p>' +
        '<h2 id="doginaryAuthTitle"></h2>' +
        '<p id="doginaryAuthTrialBadge" style="display:none"></p>' +
        '<p id="doginaryAuthDesc"></p>' +
        '<form id="doginaryAuthForm" novalidate>' +
          '<label for="doginaryAuthEmail" id="doginaryAuthEmailLabel"></label>' +
          '<input id="doginaryAuthEmail" type="email" autocomplete="email" required>' +
          '<label for="doginaryAuthPassword" id="doginaryAuthPasswordLabel"></label>' +
          '<input id="doginaryAuthPassword" type="password" autocomplete="new-password" required minlength="6">' +
          '<div class="auth-consent-row" id="doginaryAuthConsentRow">' +
            '<input type="checkbox" id="doginaryAuthConsentCheckbox">' +
            '<label for="doginaryAuthConsentCheckbox" id="doginaryAuthConsentLabel"></label>' +
          '</div>' +
          '<p id="doginaryAuthMessage" role="alert"></p>' +
          '<button type="submit" id="doginaryAuthSubmit"></button>' +
        '</form>' +
        '<p class="doginaryAuthSwitch"><button type="button" id="doginaryAuthToggle"></button></p>' +
        '<p class="doginaryAuthSwitch"><button type="button" id="doginaryAuthForgot"></button></p>' +
      '</div>';
    document.body.appendChild(modalEl);

    formEl = document.getElementById('doginaryAuthForm');
    emailInput = document.getElementById('doginaryAuthEmail');
    passwordInput = document.getElementById('doginaryAuthPassword');
    messageEl = document.getElementById('doginaryAuthMessage');
    submitBtn = document.getElementById('doginaryAuthSubmit');
    titleEl = document.getElementById('doginaryAuthTitle');
    trialBadgeEl = document.getElementById('doginaryAuthTrialBadge');
    descEl = document.getElementById('doginaryAuthDesc');
    toggleBtn = document.getElementById('doginaryAuthToggle');
    forgotBtn = document.getElementById('doginaryAuthForgot');
    closeBtn = document.getElementById('doginaryAuthClose');
    consentRow = document.getElementById('doginaryAuthConsentRow');
    consentCheckbox = document.getElementById('doginaryAuthConsentCheckbox');
    consentLabel = document.getElementById('doginaryAuthConsentLabel');

    closeBtn.addEventListener('click', closeModal);
    modalEl.addEventListener('click', function (ev) {
      if (ev.target === modalEl) closeModal();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && modalEl.classList.contains('show')) closeModal();
    });

    toggleBtn.addEventListener('click', function () {
      setMode(mode === 'signup' ? 'signin' : 'signup');
    });

    forgotBtn.addEventListener('click', function () {
      var email = emailInput.value.trim();
      if (!email) {
        showMessage(T('enterEmailFirst'), 'error');
        return;
      }
      forgotBtn.disabled = true;
      global.DoginaryAuth.resetPassword(email).then(function () {
        showMessage(T('resetSent', { email: email }), 'success');
      }).catch(function () {
        showMessage(T('resetFailed'), 'error');
      }).finally(function () {
        forgotBtn.disabled = false;
      });
    });

    formEl.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = emailInput.value.trim();
      var password = passwordInput.value;
      if (!email || !password) return;

      if (mode === 'signup' && consentCheckbox && !consentCheckbox.checked) {
        showMessage(T('consentRequired'), 'error');
        return;
      }

      submitBtn.disabled = true;
      showMessage(mode === 'signup' ? T('creating') : T('signingIn'), '');

      var action = mode === 'signup'
        ? global.DoginaryAuth.signUp(email, password)
        : global.DoginaryAuth.signIn(email, password);

      action.then(function (result) {
        // signUp() returnerar {session, needsConfirmation}; signIn()
        // returnerar sessionen direkt. Om Supabase-projektet har
        // "Confirm email" AVSTÄNGT kommer en session med en gång och
        // onAuthStateChange (se längre ner) loggar in och stänger
        // rutan automatiskt — inget mer att göra här.
        if (mode === 'signup' && result && result.needsConfirmation) {
          showMessage(T('needsConfirmation'), 'success');
          setMode('signin');
        } else if (mode === 'signup' && result && result.session) {
          // Kontot skapades och loggades in direkt (Supabase-projektets
          // "Confirm email" är avstängt, se filens header).
          //
          // Från startsidan tar vi användaren vidare till "Logga en dag",
          // som tidigare. MEN sidor som själva har något att göra — och
          // som numera visar allt även utloggat — sätter
          // window.DOGINARY_STAY_AFTER_SIGNUP = true och blir kvar där de
          // är, så att ett påbörjat formulär inte försvinner i en
          // sidväxling mitt i. onAuthStateChange (längre ner) stänger
          // modalen; sidan själv tar hand om resten.
          var stay = global.DOGINARY_STAY_AFTER_SIGNUP === true ||
                     /(^|\/)logga\.html$/i.test(global.location.pathname);
          if (!stay) {
            global.location.href = 'logga.html';
          }
        }
      }).catch(function (err) {
        showMessage(translateAuthError(err), 'error');
      }).finally(function () {
        submitBtn.disabled = false;
      });
    });

    setMode('signup');
  }

  function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = type || '';
  }

  // Skriver ALLA texter i rutan på sidans nuvarande språk, utan att röra
  // det användaren redan hunnit skriva i fälten. Anropas både vid lägesbyte
  // (skapa konto / logga in) och vid språkbyte medan rutan står öppen.
  function applyModalTexts() {
    if (!modalEl) return;
    closeBtn.setAttribute('aria-label', T('close'));
    document.getElementById('doginaryAuthEmailLabel').textContent = T('emailLabel');
    document.getElementById('doginaryAuthPasswordLabel').textContent = T('passwordLabel');
    emailInput.setAttribute('placeholder', T('emailPlaceholder'));
    passwordInput.setAttribute('placeholder', T('passwordPlaceholder'));
    forgotBtn.textContent = T('forgot');
    if (mode === 'signup') {
      titleEl.textContent = T('signupTitle');
      trialBadgeEl.textContent = T('trialBadge');
      trialBadgeEl.style.display = '';
      descEl.textContent = T('signupDesc');
      submitBtn.textContent = T('signupSubmit');
      toggleBtn.textContent = T('signupToggle');
      if (consentRow) consentRow.hidden = false;
      if (consentLabel) {
        consentLabel.innerHTML = T('authAgreeText', {
          terms: '<a href="terms.html" target="_blank" rel="noopener">' + T('termsLinkLabel') + '</a>',
          privacy: '<a href="privacy.html" target="_blank" rel="noopener">' + T('privacyLinkLabel') + '</a>'
        });
      }
    } else {
      titleEl.textContent = T('signinTitle');
      trialBadgeEl.style.display = 'none';
      descEl.textContent = T('signinDesc');
      submitBtn.textContent = T('signinSubmit');
      toggleBtn.textContent = T('signinToggle');
      // Samtycket gäller bara nya konton — dölj rutan helt vid inloggning.
      if (consentRow) consentRow.hidden = true;
    }
  }

  function setMode(newMode) {
    mode = newMode;
    showMessage('', '');
    emailInput.value = '';
    passwordInput.value = '';
    if (consentCheckbox) consentCheckbox.checked = false;
    applyModalTexts();
  }

  function openModal(startMode) {
    // Läs av språket på nytt precis innan rutan visas: den byggs lat, och
    // sidans egen kod kan ha hunnit byta språk sedan sidladdningen.
    uiLang = detectLang();
    buildModal();
    setMode(startMode === 'signin' ? 'signin' : 'signup');
    modalEl.classList.add('show');
    setTimeout(function () { emailInput.focus(); }, 50);
  }

  function closeModal() {
    if (modalEl) modalEl.classList.remove('show');
  }

  // ---------- Liten kontoikon + meny (för header/crossnav) ----------

  var ICON_PERSON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';

  var menuEl = null;
  var menuOpen = false;
  var dogNameMenuInput = null;
  var dogBreedMenuInput = null;
  var dogAgeMenuInput = null;
  var dogMenuStatus = null;

  // Rullmeny istället för fritext för ras — tryggare/mer korrekt indata.
  // Samma raslista som index.html:s profilkort använder (DOG_BREED_OPTIONS
  // i app.js), nu med båda språken precis som där — hålls i synk manuellt,
  // se kommentaren i app.js.
  //
  // Rasen sparas som text i databasen på det språk som var valt när den
  // sparades. Det är ofarligt: app.js:s findBreedIdForText() matchar både
  // det svenska och det engelska namnet, så en hund som sparats som
  // "Tax" visas som "Dachshund" när sidan står på engelska och tvärtom.
  var DOG_BREEDS = [
    { sv: 'Labrador retriever', en: 'Labrador Retriever' },
    { sv: 'Golden retriever', en: 'Golden Retriever' },
    { sv: 'Tysk schäferhund', en: 'German Shepherd' },
    { sv: 'Fransk bulldogg', en: 'French Bulldog' },
    { sv: 'Engelsk bulldogg', en: 'English Bulldog' },
    { sv: 'Mops', en: 'Pug' },
    { sv: 'Boston terrier', en: 'Boston Terrier' },
    { sv: 'Pekingeser', en: 'Pekingese' },
    { sv: 'Shih tzu', en: 'Shih Tzu' },
    { sv: 'Beagle', en: 'Beagle' },
    { sv: 'Border collie', en: 'Border Collie' },
    { sv: 'Belgisk vallhund (malinois)', en: 'Belgian Malinois' },
    { sv: 'Cocker spaniel', en: 'Cocker Spaniel' },
    { sv: 'Cavalier King Charles spaniel', en: 'Cavalier King Charles Spaniel' },
    { sv: 'Tax', en: 'Dachshund' },
    { sv: 'Chihuahua', en: 'Chihuahua' },
    { sv: 'Pudel', en: 'Poodle' },
    { sv: 'Schnauzer', en: 'Schnauzer' },
    { sv: 'Rottweiler', en: 'Rottweiler' },
    { sv: 'Dobermann', en: 'Doberman' },
    { sv: 'Boxer', en: 'Boxer' },
    { sv: 'Australian shepherd', en: 'Australian Shepherd' },
    { sv: 'Sibirisk husky', en: 'Siberian Husky' },
    { sv: 'Alaskan malamute', en: 'Alaskan Malamute' },
    { sv: 'Akita', en: 'Akita' },
    { sv: 'Shiba inu', en: 'Shiba Inu' },
    { sv: 'Jack Russell terrier', en: 'Jack Russell Terrier' },
    { sv: 'Staffordshire bullterrier', en: 'Staffordshire Bull Terrier' },
    { sv: 'American staffordshire terrier', en: 'American Staffordshire Terrier' },
    { sv: 'Berner sennenhund', en: 'Bernese Mountain Dog' },
    { sv: 'Sankt bernhardshund', en: 'Saint Bernard' },
    { sv: 'Newfoundlandshund', en: 'Newfoundland' },
    { sv: 'Leonberger', en: 'Leonberger' },
    { sv: 'Vit herdehund', en: 'White Swiss Shepherd' },
    { sv: 'Weimaraner', en: 'Weimaraner' },
    { sv: 'Vizsla', en: 'Vizsla' },
    { sv: 'Pointer', en: 'Pointer' },
    { sv: 'Engelsk setter', en: 'English Setter' },
    { sv: 'Flatcoated retriever', en: 'Flat-Coated Retriever' },
    { sv: 'Welsh corgi', en: 'Welsh Corgi' },
    { sv: 'Shetland sheepdog', en: 'Shetland Sheepdog' },
    { sv: 'Collie', en: 'Collie' },
    { sv: 'Greyhound', en: 'Greyhound' },
    { sv: 'Whippet', en: 'Whippet' },
    { sv: 'Basset hound', en: 'Basset Hound' },
    { sv: 'Bichon frisé', en: 'Bichon Frisé' },
    { sv: 'Malteser', en: 'Maltese' },
    { sv: 'Yorkshireterrier', en: 'Yorkshire Terrier' },
    { sv: 'West highland white terrier', en: 'West Highland White Terrier' },
    { sv: 'Cairnterrier', en: 'Cairn Terrier' },
    { sv: 'Belgisk vallhund (groenendael)', en: 'Belgian Sheepdog' },
    { sv: 'Bernedoodle', en: 'Bernedoodle' },
    { sv: 'Labradoodle', en: 'Labradoodle' },
    { sv: 'Goldendoodle', en: 'Goldendoodle' },
    { sv: 'Cane corso', en: 'Cane Corso' },
    { sv: 'Kaukasisk ovtjarka', en: 'Caucasian Shepherd' },
    { sv: 'Västgötaspets', en: 'Swedish Vallhund' },
    { sv: 'Svensk lapphund', en: 'Swedish Lapphund' },
    { sv: 'Jämthund', en: 'Jämthund' },
    { sv: 'Norsk älghund', en: 'Norwegian Elkhound' },
    { sv: 'Finsk spets', en: 'Finnish Spitz' },
    { sv: 'Drever', en: 'Drever' }
  ];

  // Slår upp en sparad rastext (på valfritt språk) och ger namnet på
  // sidans nuvarande språk, så ett språkbyte inte gör att en redan sparad
  // ras hamnar under "Annan ras".
  function breedInCurrentLang(breedText) {
    if (!breedText) return '';
    var needle = String(breedText).trim().toLowerCase();
    if (needle === 'blandras' || needle === 'mixed breed') return T('breedMixed');
    for (var i = 0; i < DOG_BREEDS.length; i++) {
      if (DOG_BREEDS[i].sv.toLowerCase() === needle || DOG_BREEDS[i].en.toLowerCase() === needle) {
        return DOG_BREEDS[i][uiLang] || DOG_BREEDS[i].sv;
      }
    }
    return breedText;
  }

  // Bygger <option>-listan för rasrullmenyn på sidans språk: en tom
  // platshållare, sedan "Blandras"/"Mixed breed" (vanligt val), sedan
  // raserna i bokstavsordning, sist "Annan ras"/"Other breed" som
  // uppsamlingsval för raser som inte finns listade.
  function dogBreedOptionsHtml(selectedBreed) {
    var selected = breedInCurrentLang(selectedBreed);
    var names = DOG_BREEDS.map(function (b) { return b[uiLang] || b.sv; })
      .sort(function (a, b) { return a.localeCompare(b, uiLang); });

    var html = '<option value="" disabled' + (selected ? '' : ' selected') + '>' + escapeHtml(T('breedPlaceholder')) + '</option>';
    html += '<option value="' + escapeHtml(T('breedMixed')) + '"' + (selected === T('breedMixed') ? ' selected' : '') + '>' + escapeHtml(T('breedMixed')) + '</option>';
    names.forEach(function (breed) {
      html += '<option value="' + escapeHtml(breed) + '"' + (selected === breed ? ' selected' : '') + '>' + escapeHtml(breed) + '</option>';
    });
    var isOther = selected && selected !== T('breedMixed') && names.indexOf(selected) === -1;
    html += '<option value="' + (isOther ? escapeHtml(selected) : escapeHtml(T('breedOther'))) + '"' + (isOther ? ' selected' : '') + '>' + escapeHtml(T('breedOther')) + '</option>';
    return html;
  }

  function closeAccountMenu() {
    if (menuEl) menuEl.classList.remove('show');
    menuOpen = false;
    var btn = document.getElementById('doginaryAccountIconBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  // Fyller i namn/ras/ålder-fälten i kontomenyn utifrån en hund-rad.
  function fillDogFormFields(dog) {
    if (dogNameMenuInput) dogNameMenuInput.value = (dog && dog.name) || '';
    if (dogBreedMenuInput) dogBreedMenuInput.innerHTML = dogBreedOptionsHtml((dog && dog.breed) || '');
    if (dogAgeMenuInput) dogAgeMenuInput.value = (dog && dog.age) || 'adult';
  }

  function openAccountMenu() {
    if (!menuEl) return;
    menuOpen = true;
    menuEl.classList.add('show');
    var btn = document.getElementById('doginaryAccountIconBtn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    // Fyll i hundens nuvarande uppgifter varje gång menyn öppnas, ifall de
    // hunnit ändras (t.ex. på en annan flik/sida) sedan sist.
    getCurrentDog().then(fillDogFormFields);
  }

  function toggleAccountMenu() {
    if (menuOpen) closeAccountMenu(); else openAccountMenu();
  }

  // Andra sidans egen kod (logga.html/insikter.html/index.html) lyssnar på
  // det här för att uppdatera sin egen visning av hundens namn/ras/ålder,
  // eftersom ändringen nu kan ske härifrån (den delade menyn) istället för
  // bara på index.html:s profilformulär.
  function fireDogUpdateEvent(dog) {
    document.dispatchEvent(new CustomEvent('doginary:dogupdate', { detail: { dog: dog } }));
  }

  // Sparar namn, ras och ålder tillsammans från kontomenyn — samma
  // profilfält som index.html:s formulär, se dogProfileFromAccountDog() i
  // app.js. Precis som där räknas tomt namn som "inget namn" (null) men
  // ras/ålder skickas alltid med, tomma eller inte.
  function saveDogProfileFromMenu() {
    var saveBtn = document.getElementById('doginaryAccountDogSave');
    var name = dogNameMenuInput.value.trim();
    var breed = dogBreedMenuInput.value.trim();
    var age = dogAgeMenuInput.value;
    saveBtn.disabled = true;
    dogMenuStatus.className = '';
    dogMenuStatus.textContent = T('saving');
    // Går via updateCurrentDog() (inte DoginaryDB.updateDogProfile direkt)
    // så att cachen och "doginary:dogupdate"-eventet uppdateras på samma
    // sätt som från index.html, se kommentaren där.
    updateCurrentDog({ name: name || null, breed: breed, age: age }).then(function () {
      dogMenuStatus.className = '';
      dogMenuStatus.textContent = T('saved');
    }).catch(function () {
      dogMenuStatus.className = 'error';
      dogMenuStatus.textContent = T('saveFailed');
    }).finally(function () {
      saveBtn.disabled = false;
    });
  }

  // Bygger raden i kontomenyn som visar antingen "X dagar kvar av
  // provperioden" (under trial) eller en "Hantera prenumeration"-knapp
  // (aktivt betalande konto). Tomt om statusen inte hunnit läsas klart
  // än (currentSubscription är null direkt efter inloggning, innan
  // checkAccess() svarat) — dyker upp av sig själv när renderAccountChip()
  // körs igen från evaluateAccess().
  function subscriptionMenuHtml() {
    if (!currentSubscription) return '';
    if (currentSubscription.active === true) {
      return '<button type="button" id="doginaryAccountManageSub" class="doginaryAccountMenu__logout">' + escapeHtml(T('manageSubscription')) + '</button>' +
             '<p id="doginaryAccountSubStatus" role="status" aria-live="polite"></p>' +
             '<div class="doginaryAccountMenu__divider"></div>';
    }
    if (isTrialActive(currentSubscription)) {
      var msLeft = new Date(currentSubscription.trial_ends_at).getTime() - Date.now();
      var daysLeft = Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
      var label = daysLeft <= 1 ? T('trialLastDay') : T('trialDaysLeft', { days: daysLeft });
      return '<p class="doginaryAccountMenu__label" style="text-transform:none;letter-spacing:normal;margin-top:0;">' + escapeHtml(label) + '</p>' +
             '<div class="doginaryAccountMenu__divider"></div>';
    }
    return '';
  }

  function renderAccountChip() {
    var root = document.getElementById('doginaryAuthRoot');
    if (!root) return;

    if (currentSession) {
      root.innerHTML =
        '<button type="button" id="doginaryAccountIconBtn" aria-haspopup="true" aria-expanded="false" aria-label="' + escapeHtml(T('accountMenuAria')) + '">' + ICON_PERSON + '</button>' +
        '<div id="doginaryAccountMenu" role="menu">' +
          '<p id="doginaryAccountMenuEmail">' + escapeHtml(currentSession.user.email) + '</p>' +
          '<div class="doginaryAccountMenu__divider"></div>' +
          '<label class="doginaryAccountMenu__label" for="doginaryAccountDogName">' + escapeHtml(T('dogNameLabel')) + '</label>' +
          '<input type="text" id="doginaryAccountDogName" placeholder="' + escapeHtml(T('dogNamePlaceholder')) + '" maxlength="40">' +
          '<label class="doginaryAccountMenu__label" for="doginaryAccountDogBreed">' + escapeHtml(T('breedLabel')) + '</label>' +
          '<select id="doginaryAccountDogBreed">' + dogBreedOptionsHtml('') + '</select>' +
          '<label class="doginaryAccountMenu__label" for="doginaryAccountDogAge">' + escapeHtml(T('ageLabel')) + '</label>' +
          '<select id="doginaryAccountDogAge">' +
            '<option value="puppy">' + escapeHtml(T('agePuppy')) + '</option>' +
            '<option value="adult">' + escapeHtml(T('ageAdult')) + '</option>' +
            '<option value="senior">' + escapeHtml(T('ageSenior')) + '</option>' +
          '</select>' +
          '<button type="button" id="doginaryAccountDogSave">' + escapeHtml(T('save')) + '</button>' +
          '<p id="doginaryAccountDogStatus" role="status" aria-live="polite"></p>' +
          '<div class="doginaryAccountMenu__divider"></div>' +
          subscriptionMenuHtml() +
          '<button type="button" id="doginaryAccountLogout" class="doginaryAccountMenu__logout">' + escapeHtml(T('logout')) + '</button>' +
        '</div>';

      menuEl = document.getElementById('doginaryAccountMenu');
      dogNameMenuInput = document.getElementById('doginaryAccountDogName');
      dogBreedMenuInput = document.getElementById('doginaryAccountDogBreed');
      dogAgeMenuInput = document.getElementById('doginaryAccountDogAge');
      dogMenuStatus = document.getElementById('doginaryAccountDogStatus');
      menuOpen = false;

      document.getElementById('doginaryAccountIconBtn').addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleAccountMenu();
      });
      document.getElementById('doginaryAccountLogout').addEventListener('click', function () {
        closeAccountMenu();
        global.DoginaryAuth.signOut();
      });
      document.getElementById('doginaryAccountDogSave').addEventListener('click', saveDogProfileFromMenu);
      dogNameMenuInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); saveDogProfileFromMenu(); }
      });

      var manageSubBtn = document.getElementById('doginaryAccountManageSub');
      if (manageSubBtn) {
        manageSubBtn.addEventListener('click', function () {
          var statusEl = document.getElementById('doginaryAccountSubStatus');
          var original = manageSubBtn.textContent;
          manageSubBtn.disabled = true;
          manageSubBtn.textContent = T('portalRedirecting');
          if (statusEl) { statusEl.textContent = ''; statusEl.className = ''; }
          global.DoginaryBilling.startPortal(global.location.href).then(function (data) {
            if (!data || !data.url) throw new Error('No portal URL returned');
            global.location.href = data.url;
          }).catch(function (err) {
            console.error('Doginary: kunde inte öppna prenumerationsportalen', err);
            if (statusEl) { statusEl.textContent = T('portalError'); statusEl.className = 'error'; }
            manageSubBtn.disabled = false;
            manageSubBtn.textContent = original;
          });
        });
      }

      getCurrentDog().then(fillDogFormFields);
    } else {
      menuEl = null;
      menuOpen = false;
      root.innerHTML = '<button type="button" id="doginaryLoginChipBtn" aria-label="' + escapeHtml(T('loginAria')) + '">' + ICON_PERSON + '</button>';
      document.getElementById('doginaryLoginChipBtn').addEventListener('click', function () {
        openModal('signup');
      });
    }
  }

  // Stäng menyn vid klick utanför, eller Escape — samma mönster som modalen.
  document.addEventListener('click', function (ev) {
    if (!menuOpen) return;
    var root = document.getElementById('doginaryAuthRoot');
    if (root && !root.contains(ev.target)) closeAccountMenu();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && menuOpen) closeAccountMenu();
  });

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // ---------- Bootstrap ----------

  global.DoginaryAuthUI = {
    open: openModal,
    close: closeModal,
    getCurrentDog: getCurrentDog,
    // Skriv namn/ras/ålder på den inloggade hunden. Använd ALLTID den här
    // (aldrig DoginaryDB.updateDogProfile/updateDogName direkt) från sidans
    // egen kod, annars tappar kontomenyn och de andra sidorna synken —
    // se kommentaren vid updateCurrentDog() ovan.
    updateDog: updateCurrentDog,
    getSession: function () { return currentSession; },
    // Tvinga fram en språkuppdatering av rutan/kontomenyn. Behövs normalt
    // inte — filen upptäcker själv när <html lang> ändras (det app.js gör
    // i applyStaticTranslations()) — men finns här för sidor som byter
    // språk på något annat sätt.
    refreshLanguage: applyLanguage,
    // Rasrullmenyn på sidans språk, så att andra sidor (t.ex.
    // guidelines.html) kan visa exakt samma raslista utan att kopiera
    // den — och utan att själva behöva hålla reda på språket.
    breedOptionsHtml: dogBreedOptionsHtml,
    breedInCurrentLang: breedInCurrentLang,
    // Prenumerations-/provperiodsstatus för sidor som själva vill visa
    // t.ex. "X dagar kvar" någon annanstans än kontomenyn. null tills
    // checkAccess() svarat en första gång.
    getSubscription: function () { return currentSubscription; },
    hasAccess: function () { return hasAccess(currentSubscription); },
    // Slår an EN gång med den allra första inloggningsstatusen (session
    // eller null) så att andra script (t.ex. app.js) kan vänta in det
    // säkert, istället för att chansa på om "doginary:auth" redan hunnit
    // eldas innan de la till sin lyssnare.
    ready: readyPromise
  };

  document.addEventListener('DOMContentLoaded', function () {
    renderAccountChip();
  });

  global.DoginaryAuth.getSession().then(function (session) {
    currentSession = session;
    checkAccess();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { renderAccountChip(); fireAuthEvent(); _resolveReady(session); });
    } else {
      renderAccountChip();
      fireAuthEvent();
      _resolveReady(session);
    }
  });

  global.DoginaryAuth.onAuthStateChange(function (session) {
    var wasLoggedIn = !!currentSession;
    currentSession = session;
    if (session) currentDog = null; // hämta hunden på nytt för det (nya) kontot
    else { currentDog = null; currentSubscription = null; hidePaywall(); }
    checkAccess();
    renderAccountChip();
    if (session && modalEl && modalEl.classList.contains('show')) closeModal();
    fireAuthEvent();
    void wasLoggedIn;
  });
})(window);
