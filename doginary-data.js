/*
  Doginary — insiktsmotor för hunddagboken (Logga + Insikter)
  ----------------------------------------------------------------
  Denna fil innehåller ENDAST beräkningarna (rena funktioner: data in,
  insikter ut). Inloggning och lagring sköts av doginary-supabase.js,
  som pratar med Supabase och alltid skickar in en dogName-sträng hit —
  antingen hundens sparade namn, eller "your dog" om inget namn är satt
  än (se dogDisplayName-hjälpen i doginary-supabase.js).

  ---- Om tolkningen av datan (viktigt att läsa innan ni ändrar gränser) ----

  Två helt olika typer av beräkning används här, och de bör inte blandas ihop:

  1) SJÄLVJÄMFÖRELSE (trender, sparklines, "upp/ner"-pilar): jämför alltid
     hundens senaste värde mot snittet av dess egna senaste dagar. Det här
     kräver ingen extern källa — poängen är att fånga förändringar hos
     just den här hunden, inte att jämföra mot någon "normal" hund.

  2) FASTA GRÄNSER (t.ex. "3 dagar i rad" för varningen om låg energi):
     de här är INTE hämtade ur någon veterinär eller vetenskaplig källa.
     De är rimliga, försiktiga standardvärden jag (Claude) satte för att
     systemet skulle fungera. De ska inte presenteras som medicinska fakta.

  Källor som faktiskt använts, och vad de faktiskt säger:
  - Sömn: en vuxen hund sover normalt 8–16 timmar per DYGN (inklusive
    tupplurar dagtid), enligt Agria/forskare Iida Niinikoski, Helsingfors
    universitet:
    https://www.agria.se/hund/artiklar/forskning/somn-har-stor-inverkan-pa-hundens-valbefinnande/
    OBS: formuläret loggar bara nattsömn, inte dygnssömn. Den siffran går
    alltså INTE att jämföra rakt av mot en fast gräns här — därför används
    självjämförelse (hundens eget snitt) för sömn istället för en fast
    tim-gräns.
  - Motion: de flesta hundar mår bäst av minst 1–2 timmars sammanlagd
    rörelse per dag, enligt veterinär Marie Kron, Agria Vårdguide:
    https://news.cision.com/se/agria-djurforsakring/r/hundar-far-for-lite-motion---allvarligt-halsohot,c3555427
    OBS: formuläret loggar bara en promenad per dag, inte total dagsmotion,
    så den här siffran används som ett riktmärke i texten på sidan snarare
    än som ett automatiskt tröskelvärde i koden.
  - När trötthet är en varningssignal: Evidensias allmänna djurvårdsguide
    listar bl.a. att djuret blir trött/orkeslöst, blir sämre, får feber,
    kräkning/diarré, dricker/kissar onormalt, eller inte vill äta som skäl
    att höra av sig till veterinären: https://evidensia.se/djurvardguiden/
    Det här är generell vägledning, inte en tidsgräns i dagar — "3 dagar"
    i varningen nedan är vår egen försiktiga buffert, inte ett tal från
    Evidensia.
*/
(function (global) {
  'use strict';

  var DEFAULT_NAME = 'your dog';

  function sortByDate(entries) {
    return entries.slice().sort(function (a, b) {
      var da = a.isoDate || '', db = b.isoDate || '';
      if (da !== db) return da < db ? -1 : 1;
      return 0;
    });
  }

  // ---------- hjälpfunktioner ----------

  var ENERGY_VALUE = { 'Låg': 1, 'Normal': 2, 'Hög': 3 };
  var APPETITE_VALUE = { 'Dålig': 1, 'Normal': 2, 'Stark': 3 };

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function avg(arr) {
    var nums = arr.filter(function (v) { return typeof v === 'number' && !isNaN(v); });
    if (!nums.length) return null;
    return nums.reduce(function (a, b) { return a + b; }, 0) / nums.length;
  }

  function pctChange(current, previous) {
    if (current === null || current === undefined) return null;
    if (previous === null || previous === undefined || previous === 0) return null;
    return Math.round(((current - previous) / previous) * 100);
  }

  function dirFromDelta(delta, flatBand) {
    if (delta === null || delta === undefined) return 'flat';
    var band = flatBand || 5;
    if (delta > band) return 'up';
    if (delta < -band) return 'down';
    return 'flat';
  }

  function mostCommon(values) {
    var vals = values.filter(Boolean);
    if (!vals.length) return null;
    var counts = {};
    vals.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0];
  }

  function loggingStreak(entries) {
    var days = Array.from(new Set(entries.map(function (e) { return e.isoDate; }).filter(Boolean))).sort();
    if (!days.length) return 0;
    var streak = 1;
    for (var i = days.length - 1; i > 0; i--) {
      var diff = (new Date(days[i]) - new Date(days[i - 1])) / 86400000;
      if (diff === 1) streak++;
      else break;
    }
    return streak;
  }

  // Namnformer: "your dog" är en avsiktlig engelsk fallback (även om
  // resten av gränssnittet är svenskt) för hundar som inte fått ett
  // namn än. Riktiga namn böjs på svenska ("Bellas"), fallbacken böjs
  // på engelska ("your dog's") eftersom den redan är på engelska.
  function subject(name) {
    return name || DEFAULT_NAME;
  }
  function possessive(name) {
    var n = name || DEFAULT_NAME;
    return n === DEFAULT_NAME ? "your dog's" : n + 's';
  }

  // ---------- insiktsmotor ----------
  // Beräknar riktiga insikter från de sparade dagarna, istället för
  // den tidigare hårdkodade exempeldatan i insikter-prototypen.

  function computeToday(entriesRaw, dogName) {
    var entries = sortByDate(entriesRaw);
    if (!entries.length) return null;
    var latest = entries[entries.length - 1];
    var prior = entries.slice(0, -1).slice(-6);
    var cards = [];

    var energyToday = ENERGY_VALUE[latest.energi] || null;
    var energyDelta = pctChange(energyToday, avg(prior.map(function (e) { return ENERGY_VALUE[e.energi]; })));
    cards.push({
      type: 'energy', label: 'Energi',
      text: 'Energinivå idag: ' + (latest.energi || 'ej angiven') + '.',
      trend: energyDelta === null ? '—' : (energyDelta > 0 ? '+' : '') + energyDelta + '%',
      dir: dirFromDelta(energyDelta)
    });

    var walkToday = num(latest.walkLength);
    var walkDelta = pctChange(walkToday, avg(prior.map(function (e) { return num(e.walkLength); })));
    cards.push({
      type: 'walk', label: 'Promenad',
      text: walkToday !== null ? 'Dagens promenad var ' + walkToday + ' minuter.' : 'Ingen promenadtid loggad idag.',
      trend: walkDelta === null ? '—' : (walkDelta > 0 ? '+' : '') + walkDelta + '%',
      dir: dirFromDelta(walkDelta)
    });

    var priorAppetite = mostCommon(prior.map(function (e) { return e.aptit; }));
    var appetiteSame = !priorAppetite || latest.aptit === priorAppetite;
    var appetiteUp = !appetiteSame && APPETITE_VALUE[latest.aptit] > APPETITE_VALUE[priorAppetite];
    cards.push({
      type: 'food', label: 'Aptit',
      text: 'Aptit idag: ' + (latest.aptit || 'ej angiven') + (appetiteSame ? ' — som väntat.' : ' — en förändring mot vanligt.'),
      trend: appetiteSame ? '±0%' : (appetiteUp ? '↑' : '↓'),
      dir: appetiteSame ? 'flat' : (appetiteUp ? 'up' : 'down')
    });

    var sleepToday = num(latest.sleepHours);
    var sleepDelta = pctChange(sleepToday, avg(prior.map(function (e) { return num(e.sleepHours); })));
    cards.push({
      type: 'sleep', label: 'Sömn',
      text: sleepToday !== null ? 'Sov ' + sleepToday + ' timmar i natt.' : 'Ingen sömntid loggad.',
      trend: sleepDelta === null ? '—' : (sleepDelta > 0 ? '+' : '') + sleepDelta + '%',
      dir: dirFromDelta(sleepDelta)
    });

    return { latest: latest, cards: cards };
  }

  function computeWeek(entriesRaw, dogName) {
    var entries = sortByDate(entriesRaw);
    if (!entries.length) return null;
    var thisWeek = entries.slice(-7);
    var lastWeek = entries.slice(-14, -7);
    var name = subject(dogName);

    var energy = thisWeek.map(function (e) { return ENERGY_VALUE[e.energi] || null; }).filter(function (v) { return v !== null; });
    var walks = thisWeek.map(function (e) { return num(e.walkLength); }).filter(function (v) { return v !== null; });
    var sleep = thisWeek.map(function (e) { return num(e.sleepHours); }).filter(function (v) { return v !== null; });

    var walkAvgThis = avg(walks);
    var walkAvgLast = avg(lastWeek.map(function (e) { return num(e.walkLength); }));
    var sleepAvgThis = avg(sleep);
    var sleepAvgLast = avg(lastWeek.map(function (e) { return num(e.sleepHours); }));

    var bits = [];
    if (walkAvgThis !== null && walkAvgLast !== null) {
      bits.push(walkAvgThis > walkAvgLast ? name + ' har rört på sig mer än vanligt den här veckan' : (walkAvgThis < walkAvgLast ? name + ' har rört på sig mindre än vanligt den här veckan' : 'Promenaderna har varit ungefär som vanligt'));
    } else if (walkAvgThis !== null) {
      bits.push('Snittpromenaden i veckan har legat på ' + Math.round(walkAvgThis) + ' minuter');
    }
    if (sleepAvgThis !== null && sleepAvgLast !== null && Math.abs(sleepAvgThis - sleepAvgLast) >= 0.4) {
      bits.push(sleepAvgThis < sleepAvgLast ? 'och sovit lite kortare nätter' : 'och sovit lite längre nätter');
    }
    var summary = bits.length ? bits.join(', ') + '.' : 'Här samlas veckans mönster så fort det finns fler loggade dagar.';

    var streak = loggingStreak(entries);
    var highlight = streak >= 3
      ? name + ' har haft loggade dagar ' + streak + ' i rad — ett bra tecken på att rutinerna fungerar.'
      : 'Logga några dagar till så börjar mönster och trender synas här.';

    return {
      summary: summary,
      sparklines: { energy: energy, walks: walks, sleep: sleep },
      highlight: highlight
    };
  }

  function computeMonth(entriesRaw, dogName) {
    var entries = sortByDate(entriesRaw);
    if (!entries.length) return null;
    var last30 = entries.slice(-30);
    var prev30 = entries.slice(-60, -30);
    var name = subject(dogName);
    var poss = possessive(dogName);

    var walkAvgThis = avg(last30.map(function (e) { return num(e.walkLength); }));
    var walkAvgPrev = avg(prev30.map(function (e) { return num(e.walkLength); }));
    var walkChange = pctChange(walkAvgThis, walkAvgPrev);

    var highlights = [];
    var watch = [];
    var recommendations = [];

    if (walkChange !== null) {
      highlights.push('Promenaderna är i snitt ' + Math.abs(walkChange) + '% ' + (walkChange >= 0 ? 'längre' : 'kortare') + ' än föregående period.');
    }
    var playfulDays = last30.filter(function (e) { return e.play === 'Mer än vanligt'; }).length;
    if (playfulDays >= Math.min(5, last30.length)) {
      highlights.push(name + ' har varit extra lekfull ' + playfulDays + ' dagar den senaste perioden.');
    }
    var lowPlayDays = last30.slice(-5).filter(function (e) { return e.play === 'Mindre än vanligt'; }).length;
    if (lowPlayDays >= 2) {
      watch.push('Lekfrekvensen har minskat något de senaste dagarna.');
      recommendations.push('Ett lugnt lekpass eller en ny promenadmiljö kan väcka nyfikenheten igen.');
    }
    // Sömn jämförs mot hundens EGET snitt, inte mot en fast timgräns — se
    // kommentaren högst upp i filen om varför (formuläret loggar bara
    // nattsömn, medan vetenskapliga sömnsiffror gäller hela dygnet).
    var recentSleep = last30.slice(-5).map(function (e) { return num(e.sleepHours); });
    var baselineSleepAvg = avg(last30.map(function (e) { return num(e.sleepHours); }));
    var shortNights = recentSleep.filter(function (h) {
      return h !== null && baselineSleepAvg !== null && h < baselineSleepAvg * 0.85;
    }).length;
    if (shortNights >= 2 && baselineSleepAvg !== null) {
      watch.push('Sömnen har varit kortare än ' + poss + ' eget snitt (' + baselineSleepAvg.toFixed(1) + ' h) ' + shortNights + ' av de senaste nätterna.');
      recommendations.push('Ett lugnare kvällspass kan hjälpa ' + name + ' att varva ner inför natten.');
    }

    var walkTrend = last30.map(function (e) { return num(e.walkLength); }).filter(function (v) { return v !== null; });

    return {
      highlights: highlights.length ? highlights : ['Fler loggade dagar ger en tydligare månadsbild.'],
      watch: watch,
      recommendations: recommendations,
      walkTrend: walkTrend
    };
  }

  function computeWarnings(entriesRaw, dogName) {
    var entries = sortByDate(entriesRaw);
    var warnings = [];
    var name = subject(dogName);
    var lastThree = entries.slice(-3);
    if (lastThree.length === 3 && lastThree.every(function (e) { return e.energi === 'Låg'; })) {
      warnings.push({ title: 'Låg energi i tre dagar', text: 'Håll koll på ' + name + ' de kommande dagarna. Kontakta veterinär tidigare om tröttheten kom plötsligt eller kraftigt, eller om ' + name + ' samtidigt äter sämre, kräks, får diarré eller dricker/kissar onormalt mycket eller lite.' });
    }
    var latest = entries[entries.length - 1];
    if (latest && latest.symptoms) {
      warnings.push({ title: 'Symptom noterat', text: '"' + latest.symptoms + '" — håll ett extra öga på det, och kontakta veterinär om det kvarstår eller förvärras.' });
    }
    return warnings;
  }

  function computeRewards(entriesRaw, dogName) {
    var entries = sortByDate(entriesRaw);
    var rewards = [];
    var name = subject(dogName);
    var poss = possessive(dogName);
    var streak = loggingStreak(entries);
    if (streak >= 3) {
      rewards.push({ title: streak + ' dagar i rad', text: 'Bra jobbat — du har loggat ' + poss + ' dag ' + streak + ' dagar i rad.' });
    }
    var lastSeven = entries.slice(-7);
    if (lastSeven.length >= 5 && lastSeven.every(function (e) { return e.aptit === lastSeven[0].aptit; })) {
      rewards.push({ title: 'Stabil aptit', text: name + ' har ätit jämnt och bra de senaste dagarna.' });
    }
    return rewards;
  }

  global.DoginaryData = {
    DEFAULT_NAME: DEFAULT_NAME,
    computeToday: computeToday,
    computeWeek: computeWeek,
    computeMonth: computeMonth,
    computeWarnings: computeWarnings,
    computeRewards: computeRewards,
    loggingStreak: loggingStreak
  };
})(window);
