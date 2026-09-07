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
  5. Öppna rutan manuellt från valfri knapp (t.ex. en gammal "Logga in"-länk):
       someBtn.addEventListener('click', (ev) => {
         ev.preventDefault();
         DoginaryAuthUI.open('signup'); // eller 'signin'
       });

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

  var currentSession = null;
  var currentDog = null; // hämtas lat, se getCurrentDog()
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
        if (dogNameMenuInput) dogNameMenuInput.value = (updatedDog && updatedDog.name) || '';
        fireDogUpdateEvent(updatedDog);
        return updatedDog;
      });
    });
  }

  // ---------- Modal + kontoknapp: bygg DOM ----------

  var modalEl, formEl, emailInput, passwordInput, messageEl, submitBtn,
      titleEl, descEl, toggleBtn, forgotBtn, closeBtn;
  var mode = 'signup'; // 'signup' | 'signin'

  function buildModal() {
    if (document.getElementById('doginaryAuthModal')) return;

    modalEl = document.createElement('div');
    modalEl.id = 'doginaryAuthModal';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-labelledby', 'doginaryAuthTitle');
    modalEl.innerHTML =
      '<div id="doginaryAuthCard">' +
        '<button type="button" id="doginaryAuthClose" aria-label="Stäng">&times;</button>' +
        '<p class="doginaryAuthEyebrow">Doginary</p>' +
        '<h2 id="doginaryAuthTitle">Skapa konto</h2>' +
        '<p id="doginaryAuthDesc">Skapa ett konto med mejl och lösenord, så sparas din hunds dagbok och syncar mellan dina enheter.</p>' +
        '<form id="doginaryAuthForm" novalidate>' +
          '<label for="doginaryAuthEmail">Mejladress</label>' +
          '<input id="doginaryAuthEmail" type="email" autocomplete="email" required placeholder="din@mejl.se">' +
          '<label for="doginaryAuthPassword">Lösenord</label>' +
          '<input id="doginaryAuthPassword" type="password" autocomplete="new-password" required minlength="6" placeholder="Minst 6 tecken">' +
          '<p id="doginaryAuthMessage" role="alert"></p>' +
          '<button type="submit" id="doginaryAuthSubmit">Skapa konto</button>' +
        '</form>' +
        '<p class="doginaryAuthSwitch"><button type="button" id="doginaryAuthToggle">Har du redan ett konto? Logga in</button></p>' +
        '<p class="doginaryAuthSwitch"><button type="button" id="doginaryAuthForgot">Glömt lösenord?</button></p>' +
      '</div>';
    document.body.appendChild(modalEl);

    formEl = document.getElementById('doginaryAuthForm');
    emailInput = document.getElementById('doginaryAuthEmail');
    passwordInput = document.getElementById('doginaryAuthPassword');
    messageEl = document.getElementById('doginaryAuthMessage');
    submitBtn = document.getElementById('doginaryAuthSubmit');
    titleEl = document.getElementById('doginaryAuthTitle');
    descEl = document.getElementById('doginaryAuthDesc');
    toggleBtn = document.getElementById('doginaryAuthToggle');
    forgotBtn = document.getElementById('doginaryAuthForgot');
    closeBtn = document.getElementById('doginaryAuthClose');

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
        showMessage('Skriv din mejladress i fältet ovan först.', 'error');
        return;
      }
      forgotBtn.disabled = true;
      global.DoginaryAuth.resetPassword(email).then(function () {
        showMessage('Vi har skickat en länk för att återställa lösenordet till ' + email + '.', 'success');
      }).catch(function () {
        showMessage('Kunde inte skicka återställningslänken just nu — försök igen.', 'error');
      }).finally(function () {
        forgotBtn.disabled = false;
      });
    });

    formEl.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = emailInput.value.trim();
      var password = passwordInput.value;
      if (!email || !password) return;

      submitBtn.disabled = true;
      showMessage(mode === 'signup' ? 'Skapar konto …' : 'Loggar in …', '');

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
          showMessage('Kontot är skapat! Kolla din inkorg och klicka på bekräftelselänken, logga sedan in här.', 'success');
          setMode('signin');
        }
      }).catch(function (err) {
        showMessage((err && err.message) ? err.message : 'Något gick fel — försök igen.', 'error');
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

  function setMode(newMode) {
    mode = newMode;
    showMessage('', '');
    emailInput.value = '';
    passwordInput.value = '';
    if (mode === 'signup') {
      titleEl.textContent = 'Skapa konto';
      descEl.textContent = 'Skapa ett konto med mejl och lösenord, så sparas din hunds dagbok och syncar mellan dina enheter.';
      submitBtn.textContent = 'Skapa konto';
      toggleBtn.textContent = 'Har du redan ett konto? Logga in';
    } else {
      titleEl.textContent = 'Logga in';
      descEl.textContent = 'Logga in med din mejladress och ditt lösenord.';
      submitBtn.textContent = 'Logga in';
      toggleBtn.textContent = 'Inget konto än? Skapa ett';
    }
  }

  function openModal(startMode) {
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
  var dogNameMenuStatus = null;

  function closeAccountMenu() {
    if (menuEl) menuEl.classList.remove('show');
    menuOpen = false;
    var btn = document.getElementById('doginaryAccountIconBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function openAccountMenu() {
    if (!menuEl) return;
    menuOpen = true;
    menuEl.classList.add('show');
    var btn = document.getElementById('doginaryAccountIconBtn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    // Fyll i hundens nuvarande namn varje gång menyn öppnas, ifall den
    // hunnit ändras (t.ex. på en annan flik) sedan sist.
    getCurrentDog().then(function (dog) {
      if (dogNameMenuInput) dogNameMenuInput.value = (dog && dog.name) || '';
    });
  }

  function toggleAccountMenu() {
    if (menuOpen) closeAccountMenu(); else openAccountMenu();
  }

  // Andra sidans egen kod (logga.html/insikter.html/index.html) lyssnar på
  // det här för att uppdatera sin egen visning av hundens namn, eftersom
  // namnbytet nu sker härifrån (den delade menyn) istället för på varje
  // sida för sig.
  function fireDogUpdateEvent(dog) {
    document.dispatchEvent(new CustomEvent('doginary:dogupdate', { detail: { dog: dog } }));
  }

  function saveDogNameFromMenu() {
    var saveBtn = document.getElementById('doginaryAccountDogNameSave');
    var trimmed = dogNameMenuInput.value.trim();
    saveBtn.disabled = true;
    dogNameMenuStatus.className = '';
    dogNameMenuStatus.textContent = 'Sparar …';
    // Går via updateCurrentDog() (inte DoginaryDB.updateDogName direkt) så
    // att cachen och "doginary:dogupdate"-eventet uppdateras på samma sätt
    // som från index.html/logga.html, se kommentaren där.
    updateCurrentDog({ name: trimmed || null }).then(function () {
      dogNameMenuStatus.className = '';
      dogNameMenuStatus.textContent = 'Sparat.';
    }).catch(function () {
      dogNameMenuStatus.className = 'error';
      dogNameMenuStatus.textContent = 'Kunde inte spara just nu — försök igen.';
    }).finally(function () {
      saveBtn.disabled = false;
    });
  }

  function renderAccountChip() {
    var root = document.getElementById('doginaryAuthRoot');
    if (!root) return;

    if (currentSession) {
      root.innerHTML =
        '<button type="button" id="doginaryAccountIconBtn" aria-haspopup="true" aria-expanded="false" aria-label="Kontomeny">' + ICON_PERSON + '</button>' +
        '<div id="doginaryAccountMenu" role="menu">' +
          '<p id="doginaryAccountMenuEmail">' + escapeHtml(currentSession.user.email) + '</p>' +
          '<div class="doginaryAccountMenu__divider"></div>' +
          '<label class="doginaryAccountMenu__label" for="doginaryAccountDogName">Hundens namn</label>' +
          '<div class="doginaryAccountMenu__namerow">' +
            '<input type="text" id="doginaryAccountDogName" placeholder="Hundens namn" maxlength="40">' +
            '<button type="button" id="doginaryAccountDogNameSave">Spara</button>' +
          '</div>' +
          '<p id="doginaryAccountDogNameStatus" role="status" aria-live="polite"></p>' +
          '<div class="doginaryAccountMenu__divider"></div>' +
          '<button type="button" id="doginaryAccountLogout" class="doginaryAccountMenu__logout">Logga ut</button>' +
        '</div>';

      menuEl = document.getElementById('doginaryAccountMenu');
      dogNameMenuInput = document.getElementById('doginaryAccountDogName');
      dogNameMenuStatus = document.getElementById('doginaryAccountDogNameStatus');
      menuOpen = false;

      document.getElementById('doginaryAccountIconBtn').addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleAccountMenu();
      });
      document.getElementById('doginaryAccountLogout').addEventListener('click', function () {
        closeAccountMenu();
        global.DoginaryAuth.signOut();
      });
      document.getElementById('doginaryAccountDogNameSave').addEventListener('click', saveDogNameFromMenu);
      dogNameMenuInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); saveDogNameFromMenu(); }
      });

      getCurrentDog().then(function (dog) {
        if (dogNameMenuInput) dogNameMenuInput.value = (dog && dog.name) || '';
      });
    } else {
      menuEl = null;
      menuOpen = false;
      root.innerHTML = '<button type="button" id="doginaryLoginChipBtn" aria-label="Logga in">' + ICON_PERSON + '</button>';
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
    else currentDog = null;
    renderAccountChip();
    if (session && modalEl && modalEl.classList.contains('show')) closeModal();
    fireAuthEvent();
    void wasLoggedIn;
  });
})(window);
