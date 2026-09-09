/* =======================================================================
   DOGINARY — PWA-STÖD (delad fil, inkluderas på alla sidor)
   File: pwa.js
   -----------------------------------------------------------------------
   Ansvarar för:
   1. Registrering av service worker (sw.js) + "ny version"-hantering.
   2. Eget installationskort på Android/desktop Chrome (beforeinstallprompt).
   3. Instruktionsruta för "Lägg till på hemskärmen" på iOS Safari
      (som saknar beforeinstallprompt helt).
   4. Förberedelse för push-notiser (permission + prenumeration) — skickar
      INGA notiser själv, bara redo att kopplas på en riktig backend sen.

   Fristående: rör inte sidans egna klasser/CSS-variabler, injicerar sin
   egen lilla stilmall en gång vid start. Funkar likadant på alla sidor
   oavsett vilket färgschema respektive sida redan har (fallbacks nedan
   matchar den varma rust/teal/papper-paletten).
   ======================================================================= */
(function () {
  'use strict';

  // -----------------------------------------------------------------
  // 1. Service worker-registrering
  // -----------------------------------------------------------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        // Om det redan finns en väntande/ny SW vid sidladdning (t.ex. en
        // uppdatering som laddades i en annan flik) — visa uppdaterings-
        // bannern direkt.
        if (reg.waiting) showUpdateBanner(reg);

        reg.addEventListener('updatefound', function () {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner(reg);
            }
          });
        });
      }).catch(function (err) {
        console.warn('[PWA] Service worker-registrering misslyckades:', err);
      });

      // Ladda om sidan en gång när den nya service workern tar över,
      // så användaren faktiskt får den nya versionen.
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  function showUpdateBanner(reg) {
    injectStyles();
    if (document.getElementById('doginaryUpdateBanner')) return;
    const el = document.createElement('div');
    el.id = 'doginaryUpdateBanner';
    el.className = 'doginary-pwa-banner';
    el.innerHTML =
      '<span>En ny version av Doginary finns tillgänglig.</span>' +
      '<button type="button" id="doginaryUpdateBtn">Uppdatera</button>';
    document.body.appendChild(el);
    document.getElementById('doginaryUpdateBtn').addEventListener('click', function () {
      if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
      el.remove();
    });
  }

  // -----------------------------------------------------------------
  // 2. Eget installationskort (Android / desktop Chrome m.fl.)
  // -----------------------------------------------------------------
  let deferredInstallPrompt = null;
  const INSTALL_DISMISS_KEY = 'doginary_install_dismissed_at';
  const DISMISS_SNOOZE_DAYS = 14;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true; // äldre iOS
  }

  function recentlyDismissed() {
    const raw = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!raw) return false;
    const elapsedDays = (Date.now() - Number(raw)) / (1000 * 60 * 60 * 24);
    return elapsedDays < DISMISS_SNOOZE_DAYS;
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!isStandalone() && !recentlyDismissed()) {
      showInstallCard();
    }
  });

  function showInstallCard() {
    injectStyles();
    if (document.getElementById('doginaryInstallCard')) return;
    const el = document.createElement('div');
    el.id = 'doginaryInstallCard';
    el.className = 'doginary-pwa-card';
    el.innerHTML =
      '<img src="/icons/icon-96.png" alt="" class="doginary-pwa-card__icon">' +
      '<div class="doginary-pwa-card__text">' +
        '<strong>Installera Doginary</strong>' +
        '<span>Få snabb åtkomst från hemskärmen.</span>' +
      '</div>' +
      '<div class="doginary-pwa-card__actions">' +
        '<button type="button" id="doginaryInstallLater" class="doginary-pwa-btn doginary-pwa-btn--ghost">Senare</button>' +
        '<button type="button" id="doginaryInstallNow" class="doginary-pwa-btn">Installera</button>' +
      '</div>';
    document.body.appendChild(el);

    document.getElementById('doginaryInstallNow').addEventListener('click', function () {
      el.remove();
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.finally(function () {
        deferredInstallPrompt = null;
      });
    });
    document.getElementById('doginaryInstallLater').addEventListener('click', function () {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
      el.remove();
    });
  }

  window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    const el = document.getElementById('doginaryInstallCard');
    if (el) el.remove();
  });

  // -----------------------------------------------------------------
  // 3. iOS Safari — eget "Lägg till på hemskärmen"-tips (iOS saknar
  //    beforeinstallprompt helt, så det här är enda vägen dit).
  // -----------------------------------------------------------------
  function isIosSafari() {
    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return isIos && isSafari;
  }

  function showIosInstallHint() {
    injectStyles();
    if (document.getElementById('doginaryIosHint')) return;
    const el = document.createElement('div');
    el.id = 'doginaryIosHint';
    el.className = 'doginary-pwa-card';
    el.innerHTML =
      '<img src="/icons/icon-96.png" alt="" class="doginary-pwa-card__icon">' +
      '<div class="doginary-pwa-card__text">' +
        '<strong>Lägg till Doginary på hemskärmen</strong>' +
        '<span>Tryck på Dela ' +
          '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M12 16V4M8 8l4-4 4 4"/><rect x="4" y="12" width="16" height="8" rx="2"/></svg>' +
          ' → Lägg till på hemskärmen.</span>' +
      '</div>' +
      '<div class="doginary-pwa-card__actions">' +
        '<button type="button" id="doginaryIosHintClose" class="doginary-pwa-btn doginary-pwa-btn--ghost">Stäng</button>' +
      '</div>';
    document.body.appendChild(el);
    document.getElementById('doginaryIosHintClose').addEventListener('click', function () {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
      el.remove();
    });
  }

  if (isIosSafari() && !isStandalone() && !recentlyDismissed()) {
    // Liten fördröjning så den inte poppar upp mitt i sidladdningen.
    window.setTimeout(showIosInstallHint, 2500);
  }

  // -----------------------------------------------------------------
  // 4. Push-notiser — FÖRBEREDELSE ENDAST. Anropas inte automatiskt
  //    någonstans; koppla in dessa funktioner på en knapp/inställning
  //    den dagen det finns en riktig push-backend (VAPID-nyckel +
  //    server som sparar/använder subscription-objektet) för t.ex.
  //    vaccinations-/medicinpåminnelser, vädervarningar eller
  //    promenadpåminnelser.
  // -----------------------------------------------------------------
  window.DoginaryPush = {
    isSupported: function () {
      return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    },
    requestPermission: function () {
      if (!this.isSupported()) return Promise.resolve('unsupported');
      return Notification.requestPermission();
    },
    // vapidPublicKey: din publika VAPID-nyckel (base64url), krävs för
    // pushManager.subscribe. Sätts av backend-koden den dagen push
    // faktiskt aktiveras.
    subscribe: function (vapidPublicKey) {
      if (!this.isSupported()) return Promise.reject(new Error('Push stöds inte i den här webbläsaren.'));
      return navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidPublicKey ? urlBase64ToUint8Array(vapidPublicKey) : undefined
        });
      });
      // OBS: subscription-objektet måste sedan skickas till en egen
      // backend (t.ex. en Supabase Edge Function) och sparas mot
      // användarens konto för att faktiskt kunna skicka notiser dit.
    }
  };

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  // -----------------------------------------------------------------
  // Delad, minimal stilmall för installationskortet/bannern.
  // -----------------------------------------------------------------
  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent =
      '.doginary-pwa-card{position:fixed;left:16px;right:16px;bottom:16px;z-index:600;' +
      'display:flex;align-items:center;gap:12px;max-width:420px;margin:0 auto;' +
      'background:var(--surface,#F8F5EC);border:1px solid var(--hair,#DCD3BF);' +
      'border-radius:var(--radius-lg,18px);padding:14px 16px;box-shadow:0 18px 44px rgba(0,0,0,.22);' +
      'font-family:\'Inter\',-apple-system,BlinkMacSystemFont,sans-serif;color:var(--ink,#2B241C);}' +
      '.doginary-pwa-card__icon{width:40px;height:40px;border-radius:10px;flex-shrink:0;}' +
      '.doginary-pwa-card__text{flex:1;display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:1.4;}' +
      '.doginary-pwa-card__text strong{font-size:14.5px;}' +
      '.doginary-pwa-card__text span{color:var(--ink-soft,#6E6455);}' +
      '.doginary-pwa-card__actions{display:flex;flex-direction:column;gap:6px;flex-shrink:0;}' +
      '.doginary-pwa-btn{font-family:inherit;font-size:12.5px;font-weight:600;color:#fff;' +
      'background:var(--ink,#2B241C);border:none;border-radius:20px;padding:8px 14px;cursor:pointer;white-space:nowrap;}' +
      '.doginary-pwa-btn--ghost{background:transparent;color:var(--ink-soft,#6E6455);}' +
      '.doginary-pwa-banner{position:fixed;left:0;right:0;top:0;z-index:600;display:flex;align-items:center;' +
      'justify-content:center;gap:14px;padding:10px 16px;background:var(--teal,#33505A);color:#fff;' +
      'font-family:\'Inter\',-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;}' +
      '.doginary-pwa-banner button{font-family:inherit;font-size:12.5px;font-weight:600;color:var(--teal,#33505A);' +
      'background:#fff;border:none;border-radius:16px;padding:6px 12px;cursor:pointer;}' +
      '@media(max-width:480px){.doginary-pwa-card{flex-wrap:wrap;}.doginary-pwa-card__actions{flex-direction:row;width:100%;justify-content:flex-end;}}';
    document.head.appendChild(style);
  }
})();
