/*
  Doginary — inloggning (mejl + lösenord) + synkad lagring i Supabase
  --------------------------------------------------------------------------
  Eget Supabase-projekt ("doginary"), separat från det äldre projektet som
  räknar besök på startsidan (index.html använder fortfarande det gamla).
  Kräver att https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2 laddas
  FÖRE den här filen (se <script>-taggarna i logga.html / insikter.html).

  VIKTIGT — säkerhet: bara URL + PUBLIK/publishable-nyckel hör hemma här.
  Den hemliga nyckeln (secret key) får ALDRIG läggas i en fil som skickas
  till besökarens webbläsare (det gäller alla filer i det här projektet:
  logga.html, insikter.html, doginary-supabase.js) — den ger fullständig
  adminåtkomst till databasen och kringgår RLS-policyerna nedan helt.

  VIKTIGT att göra i Supabase-projektet innan detta fungerar skarpt:
  1. Kör doginary-schema.sql i SQL Editor (skapar tabeller + RLS-policyer).
  2. Under Authentication -> URL Configuration: lägg till er riktiga
     doginary.com-adress (t.ex. https://doginary.com/logga.html och
     https://doginary.com/insikter.html) under "Redirect URLs", annars
     nekar Supabase att skicka tillbaka användaren efter bekräftelse-
     eller återställningslänken i mejlet.
  3. Under Authentication -> Providers -> Email: bestäm om "Confirm
     email" ska vara på (standard, säkrast — användaren måste klicka en
     länk i mejlet innan kontot är aktivt) eller av (enklare, kontot är
     klart direkt efter registrering). Koden här hanterar båda lägena.

  Datan är trygg trots att den publika nyckeln syns i webbläsaren, EFTERSOM
  Row Level Security (steg 1 ovan) ser till att varje användare bara kan
  läsa och skriva sina egna rader.
*/
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://jjbziqsjapyiihdrlnsw.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_94seiOtGg1rsEr2Vve6BoA_H1bv4zxo';

  if (!global.supabase || typeof global.supabase.createClient !== 'function') {
    console.error('Doginary: supabase-js kunde inte hittas. Kontrollera att CDN-scriptet laddats före doginary-supabase.js.');
    return;
  }

  var client = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  // ---------- Auth ----------

  function getSession() {
    return client.auth.getSession().then(function (res) {
      return res.data && res.data.session ? res.data.session : null;
    });
  }

  function signUp(email, password) {
    return client.auth.signUp({
      email: email,
      password: password,
      options: { emailRedirectTo: global.location.href }
    }).then(function (res) {
      if (res.error) throw res.error;
      // Om "Confirm email" är avstängt i Supabase-projektet kommer en
      // session direkt. Om det är påslaget (standard) måste användaren
      // klicka en bekräftelselänk i mejlet innan inloggning fungerar.
      return { session: res.data.session, needsConfirmation: !res.data.session };
    });
  }

  function signIn(email, password) {
    return client.auth.signInWithPassword({
      email: email,
      password: password
    }).then(function (res) {
      if (res.error) throw res.error;
      return res.data.session;
    });
  }

  function resetPassword(email) {
    return client.auth.resetPasswordForEmail(email, {
      redirectTo: global.location.href
    }).then(function (res) {
      if (res.error) throw res.error;
      return true;
    });
  }

  function signOut() {
    return client.auth.signOut();
  }

  function onAuthStateChange(callback) {
    var sub = client.auth.onAuthStateChange(function (_event, session) {
      callback(session);
    });
    return sub;
  }

  // ---------- Hundprofil (ett konto = en hund just nu) ----------

  function getOrCreateDog(userId) {
    return client
      .from('dogs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(function (res) {
        if (res.error) throw res.error;
        if (res.data) return res.data;
        return client
          .from('dogs')
          .insert({ user_id: userId, name: null })
          .select()
          .single()
          .then(function (createRes) {
            if (createRes.error) throw createRes.error;
            return createRes.data;
          });
      });
  }

  function updateDogName(dogId, name) {
    return client
      .from('dogs')
      .update({ name: name })
      .eq('id', dogId)
      .select()
      .single()
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
  }

  // ---------- Dagboksrader ----------

  function loadEntries(dogId) {
    return client
      .from('entries')
      .select('*')
      .eq('dog_id', dogId)
      .order('created_at', { ascending: true })
      .then(function (res) {
        if (res.error) throw res.error;
        // mappa databasens snake_case till samma fältnamn som resten av
        // koden redan använder (samma form som tidigare localStorage-rader)
        return (res.data || []).map(function (row) {
          return {
            id: row.id,
            isoDate: row.iso_date,
            date: row.display_date,
            aptit: row.aptit,
            walkLength: row.walk_length,
            walkEnv: row.walk_env,
            energi: row.energi,
            play: row.play,
            mood: row.mood,
            stool: row.stool,
            weight: row.weight,
            symptoms: row.symptoms,
            medGiven: row.med_given,
            sleepHours: row.sleep_hours,
            sleepQuality: row.sleep_quality,
            freeNote: row.free_note
          };
        });
      });
  }

  function addEntry(dogId, userId, entry) {
    var row = {
      user_id: userId,
      dog_id: dogId,
      iso_date: new Date().toISOString().slice(0, 10),
      display_date: entry.date,
      aptit: entry.aptit,
      walk_length: entry.walkLength === '' || entry.walkLength == null ? null : Number(entry.walkLength),
      walk_env: entry.walkEnv,
      energi: entry.energi,
      play: entry.play,
      mood: entry.mood,
      stool: entry.stool,
      weight: entry.weight === '' || entry.weight == null ? null : Number(entry.weight),
      symptoms: entry.symptoms,
      med_given: !!entry.medGiven,
      sleep_hours: entry.sleepHours === '' || entry.sleepHours == null ? null : Number(entry.sleepHours),
      sleep_quality: entry.sleepQuality,
      free_note: entry.freeNote
    };
    return client
      .from('entries')
      .insert(row)
      .select()
      .single()
      .then(function (res) {
        if (res.error) throw res.error;
        return true;
      });
  }

  function removeEntry(id) {
    return client
      .from('entries')
      .delete()
      .eq('id', id)
      .then(function (res) {
        if (res.error) throw res.error;
        return true;
      });
  }

  global.DoginaryAuth = {
    client: client,
    getSession: getSession,
    signUp: signUp,
    signIn: signIn,
    resetPassword: resetPassword,
    signOut: signOut,
    onAuthStateChange: onAuthStateChange
  };

  global.DoginaryDB = {
    getOrCreateDog: getOrCreateDog,
    updateDogName: updateDogName,
    loadEntries: loadEntries,
    addEntry: addEntry,
    removeEntry: removeEntry
  };
})(window);
