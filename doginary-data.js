/*
  Doginary - insiktsmotor for hunddagboken

  Viktiga principer:
  - Hunden jamfors i forsta hand med sin egen historik.
  - Ras och alder ger endast forsiktig kontext, aldrig diagnoser.
  - 3, 7 och 14 dagar ar Doginarys produktregler, inte medicinska gransvarden.
  - Nattlig somn jamfors endast med hundens egen nattliga somn.
*/
(function (global) {
  'use strict';

  var DEFAULT_NAME = 'your dog';
  var BASELINE_MAX_DAYS = 14;
  var PRELIMINARY_MIN_DAYS = 3;
  var ESTABLISHED_MIN_DAYS = 7;

  var ENERGY_VALUE = { 'Låg': 1, 'Normal': 2, 'Hög': 3, 'Low': 1, 'High': 3 };
  var APPETITE_VALUE = { 'Dålig': 1, 'Normal': 2, 'Stark': 3, 'Poor': 1, 'Strong': 3 };

  // Visningsöversättningar för kategoriska värden som kan vara sparade på
  // antingen svenska eller engelska (se ENERGY_VALUE/APPETITE_VALUE ovan).
  // Används när en sådan lagrad text ska skrivas in i en genererad mening,
  // så att texten alltid visas på det språk som för tillfället är valt —
  // oavsett vilket språk som gällde när posten sparades.
  var ENERGI_LABELS = {
    'Låg': { sv: 'Låg', en: 'Low' }, 'Low': { sv: 'Låg', en: 'Low' },
    'Normal': { sv: 'Normal', en: 'Normal' },
    'Hög': { sv: 'Hög', en: 'High' }, 'High': { sv: 'Hög', en: 'High' }
  };
  var APTIT_LABELS = {
    'Dålig': { sv: 'Dålig', en: 'Poor' }, 'Poor': { sv: 'Dålig', en: 'Poor' },
    'Normal': { sv: 'Normal', en: 'Normal' },
    'Stark': { sv: 'Stark', en: 'Strong' }, 'Strong': { sv: 'Stark', en: 'Strong' }
  };
  var STOOL_LABELS = {
    'Normal': { sv: 'Normal', en: 'Normal' },
    'Lös': { sv: 'Lös', en: 'Loose' }, 'Loose': { sv: 'Lös', en: 'Loose' },
    'Hård': { sv: 'Hård', en: 'Hard' }, 'Hard': { sv: 'Hård', en: 'Hard' },
    'Ovanlig': { sv: 'Ovanlig', en: 'Unusual' }, 'Unusual': { sv: 'Ovanlig', en: 'Unusual' }
  };
  function labelFor(map, value, lang) {
    var entry = map[value];
    return entry ? entry[lang === 'en' ? 'en' : 'sv'] : value;
  }

  var SOURCES = {
    'aaha-senior-care': {
      organization: 'American Animal Hospital Association',
      title: '2023 AAHA Senior Care Guidelines for Dogs and Cats',
      url: 'https://www.aaha.org/resources/2023-aaha-senior-care-guidelines-for-dogs-and-cats/',
      supports: ['Hog alder ar inte i sig en sjukdom och forandringar ska bedomas individuellt.']
    },
    'evidensia-fatigue': {
      organization: 'Evidensia',
      title: 'Djurvardsguiden',
      url: 'https://evidensia.se/djurvardguiden/',
      supports: ['Trotthet tillsammans med andra symtom kan vara skal att kontakta veterinar.']
    },
    'agria-sleep': {
      organization: 'Agria',
      title: 'Somn har stor inverkan pa hundens valbefinnande',
      url: 'https://www.agria.se/hund/artiklar/forskning/somn-har-stor-inverkan-pa-hundens-valbefinnande/',
      supports: ['Publicerade dygnssiffror omfattar aven vila och tupplurar, inte bara nattsomn.']
    }
  };

  global.DoginarySources = Object.assign(global.DoginarySources || {}, SOURCES, {
    'rcvs-brachycephalic-evidence': {
      organization: 'RCVS Knowledge / Veterinary Evidence',
      title: 'Heatstroke and brachycephalic dogs - is there an increased risk?',
      url: 'https://veterinaryevidence.org/index.php/ve/article/view/534',
      supports: ['Moderate evidence indicates increased heat-related illness risk in brachycephalic dogs.'],
      limitations: ['Other factors, including body weight and the individual dog, also contribute to risk.']
    },
    'rvc-brachycephalic-heat': {
      organization: 'Royal Veterinary College / Brachycephalic Working Group',
      title: 'Consensus statement on preventing and moderating heat-related illness in dogs',
      url: 'https://www.rvc.ac.uk/Media/Default/VetCompass/BWG%20Heat%20related%20illness%20in%20dogs.pdf',
      supports: ['Brachycephalic dogs have increased risk of heat-related illness.'],
      limitations: ['The individual level of exercise and environmental exposure needed to trigger illness varies between dogs.']
    }
  });

  function unique(values) {
    return values.filter(function (v, i, a) { return v != null && a.indexOf(v) === i; });
  }

  /*
    ---------------------------------------------------------------------
    Daglig normalisering av loggbokens rader (uppgift 13)
    ---------------------------------------------------------------------
    logga.html sparar i nuläget dels "snabbloggnings"-händelser
    ({ type: 'walk'|'eat'|'poop'|'play'|'energy'|..., detail: '<etikett>' },
    flera per dag), dels (för vikt/symptom och en ny energikort) rader med
    strukturerade fält som redan matchar det denna fil förväntar sig
    (energi, aptit, walkLength, sleepHours, weight, symptoms, stool, play).

    computeToday/computeWeek/computeMonth/computeWarnings antar EN post per
    kalenderdag. Den här funktionen är den enda platsen där händelser slås
    ihop till en sådan daglig post, så att ingen annan fil behöver
    duplicera mappningen mellan snabbloggningens etiketter och de
    strukturerade fälten.

    Principer:
    - Ingen ny information hittas på. Kategoriska etiketter (t.ex.
      sömnkvalitet) omvandlas ALDRIG till en siffra (t.ex. sömntimmar) –
      det skulle ge falsk precision. Bara sådant som redan är en tydlig
      tidsintervall (promenadlängd) får en representativ mittpunkt.
    - Explicit numeriskt värde (t.ex. redan satt walkLength/sleepHours)
      vinner alltid över en gissning från en snabbloggningsetikett.
    - 0 promenadminuter ska bevaras som 0, aldrig tolkas som saknat värde.
  */

  // Ungefärlig, dokumenterad mittpunkt för promenadens längdintervall –
  // detta är en Doginary-uppskattning för sortering/jämförelse, inte en
  // exakt loggad tid.
  var WALK_BUCKET_MINUTES = {
    'Kort (10–20 min)': 15, 'Medel (20–40 min)': 30, 'Lång (40+ min)': 50,
    'Short (10–20 min)': 15, 'Medium (20–40 min)': 30, 'Long (40+ min)': 50
  };
  var EAT_BUCKET_APTIT = {
    'Dålig aptit': 'Dålig', 'Normal aptit': 'Normal', 'Stark aptit': 'Stark',
    'Poor appetite': 'Poor', 'Normal appetite': 'Normal', 'Strong appetite': 'Strong'
  };
  var POOP_BUCKET_STOOL = {
    'Bra': 'Normal', 'Lös': 'Lös', 'Hård': 'Hård',
    'Good': 'Normal', 'Loose': 'Loose', 'Hard': 'Hard'
  };
  // Används för att avgöra vilket avföringsvärde som "vinner" om flera är
  // loggade samma dag – det mest avvikande visas, så att ett ovanligt
  // tillfälle inte döljs av ett normalt tillfälle senare samma dag.
  var STOOL_PRIORITY = ['Ovanlig', 'Unusual', 'Hård', 'Hard', 'Lös', 'Loose', 'Normal'];

  function worseStool(a, b) {
    if (!a) return b;
    if (!b) return a;
    var ai = STOOL_PRIORITY.indexOf(a);
    var bi = STOOL_PRIORITY.indexOf(b);
    if (ai === -1) return a;
    if (bi === -1) return b;
    return ai <= bi ? a : b;
  }

  // Härleder ÅÅÅÅ-MM-DD för äldre poster som saknar isoDate, på samma sätt
  // som logga.html:s egen kalenderplacering – men bara som en fallback.
  var SV_MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  function fallbackIsoDate(entry) {
    if (!entry) return null;
    if (entry.isoDate) return entry.isoDate;
    if (entry.created_at) {
      var d = new Date(entry.created_at);
      if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
    }
    if (typeof entry.date === 'string') {
      var m = entry.date.match(/(\d{1,2})\s+([a-zA-ZåäöÅÄÖ]+)/);
      if (m) {
        var day = parseInt(m[1], 10);
        var monthIdx = SV_MONTHS.indexOf(m[2].toLowerCase());
        if (monthIdx >= 0 && day >= 1 && day <= 31) {
          return new Date().getFullYear() + '-' + String(monthIdx + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        }
      }
    }
    return null;
  }

  var STRUCTURED_FIELDS = ['energi', 'aptit', 'weight', 'symptoms', 'sleepHours', 'play', 'walkLength', 'stool'];

  function hasValue(v) { return v !== undefined && v !== null && v !== ''; }

  function buildDailyEntries(rawEntriesInput) {
    var raw = Array.isArray(rawEntriesInput) ? rawEntriesInput : [];
    var byDay = {};
    var order = [];

    raw.forEach(function (entry) {
      if (!entry || typeof entry !== 'object') return;
      var iso = fallbackIsoDate(entry);
      if (!iso) return;
      if (!byDay[iso]) {
        byDay[iso] = { isoDate: iso, date: entry.date || null };
        order.push(iso);
      }
      var day = byDay[iso];
      if (entry.date && !day.date) day.date = entry.date;

      // Strukturerade fält som redan finns direkt på raden (t.ex. en
      // vikt/symptom-anteckning, eller framtida poster som sparas direkt i
      // rätt form) vinner alltid och kopieras igenom oförändrade.
      STRUCTURED_FIELDS.forEach(function (field) {
        if (hasValue(entry[field])) day[field] = entry[field];
      });

      // Snabbloggningens type/detail-händelser översätts till samma
      // strukturerade fält, enbart här.
      if (entry.type === 'walk' && WALK_BUCKET_MINUTES[entry.detail] != null && !hasValue(entry.walkLength)) {
        day.walkLength = (typeof day.walkLength === 'number' ? day.walkLength : 0) + WALK_BUCKET_MINUTES[entry.detail];
      } else if (entry.type === 'eat' && EAT_BUCKET_APTIT[entry.detail]) {
        day.aptit = EAT_BUCKET_APTIT[entry.detail];
      } else if (entry.type === 'poop' && POOP_BUCKET_STOOL[entry.detail]) {
        day.stool = worseStool(day.stool, POOP_BUCKET_STOOL[entry.detail]);
      } else if (entry.type === 'play' && entry.detail) {
        day.play = entry.detail;
      } else if ((entry.type === 'energy' || entry.type === 'energi') && entry.detail) {
        day.energi = entry.detail;
      }
    });

    return order.map(function (iso) { return byDay[iso]; });
  }

  function num(value) {
    if (value === '' || value === null || value === undefined) return null;
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function dateValue(entry) {
    var value = entry && (entry.isoDate || entry.date || entry.created_at || entry.createdAt);
    if (!value) return 0;
    var timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function sortByDate(entries) {
    return (Array.isArray(entries) ? entries : []).slice().sort(function (a, b) {
      return dateValue(a) - dateValue(b);
    });
  }

  function normalizeEntries(entries) {
    return sortByDate(entries).filter(function (entry) { return entry && typeof entry === 'object'; });
  }

  function validNumericValues(entries, field) {
    return (Array.isArray(entries) ? entries : []).map(function (entry) {
      return num(entry && entry[field]);
    }).filter(function (value) { return value !== null; });
  }

  function buildBaseline(entries, options) {
    options = options || {};
    var field = options.field;
    var type = options.type || 'numeric';
    var windowEntries = (Array.isArray(entries) ? entries : []).slice(-(options.maxDays || BASELINE_MAX_DAYS));
    if (type === 'categorical') {
      var categorical = windowEntries.map(function (entry) { return entry && entry[field]; }).filter(Boolean);
      return {
        value: mode(categorical), distribution: distribution(categorical), sampleSize: categorical.length,
        confidence: confidenceFor(categorical.length), windowSize: windowEntries.length,
        baselineMethod: categorical.length ? 'distribution' : null, isProductRule: true
      };
    }
    var values = validNumericValues(windowEntries, field);
    var useIqr = values.length >= ESTABLISHED_MIN_DAYS;
    return {
      value: median(values), q1: useIqr ? quantile(values, .25) : null,
      q3: useIqr ? quantile(values, .75) : null,
      iqr: useIqr ? interquartileRange(values) : null,
      sampleSize: values.length, confidence: confidenceFor(values.length),
      windowSize: windowEntries.length, baselineMethod: values.length ? 'median' : null,
      isProductRule: true
    };
  }

  function median(values) {
    var list = values.filter(function (v) { return typeof v === 'number' && Number.isFinite(v); }).slice().sort(function (a, b) { return a - b; });
    if (!list.length) return null;
    var middle = Math.floor(list.length / 2);
    return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  }

  function quantile(values, q) {
    var list = values.filter(function (v) { return typeof v === 'number' && Number.isFinite(v); }).slice().sort(function (a, b) { return a - b; });
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    var position = (list.length - 1) * q;
    var base = Math.floor(position);
    var rest = position - base;
    return list[base + 1] === undefined ? list[base] : list[base] + rest * (list[base + 1] - list[base]);
  }

  function interquartileRange(values) {
    var q1 = quantile(values, 0.25);
    var q3 = quantile(values, 0.75);
    return q1 === null || q3 === null ? null : q3 - q1;
  }

  function mode(values) {
    var counts = {};
    var best = null;
    var bestCount = 0;
    values.filter(Boolean).forEach(function (value) {
      counts[value] = (counts[value] || 0) + 1;
      if (counts[value] > bestCount) {
        best = value;
        bestCount = counts[value];
      }
    });
    return best;
  }

  function distribution(values) {
    var result = {};
    var valid = values.filter(Boolean);
    valid.forEach(function (value) { result[value] = (result[value] || 0) + 1; });
    Object.keys(result).forEach(function (key) { result[key] = result[key] / valid.length; });
    return result;
  }

  function confidenceFor(sampleSize) {
    if (sampleSize < PRELIMINARY_MIN_DAYS) return 'insufficient';
    if (sampleSize < ESTABLISHED_MIN_DAYS) return 'preliminary';
    return 'established';
  }

  function baselineText(confidence, sampleSize, lang) {
    if (lang === 'en') {
      if (confidence === 'insufficient') return 'Not enough data yet to assess a pattern (' + sampleSize + ' earlier days).';
      if (confidence === 'preliminary') return 'Preliminary pattern based on ' + sampleSize + ' earlier days.';
      return 'Compared with ' + sampleSize + ' previously logged days.';
    }
    if (confidence === 'insufficient') return 'För lite data för att bedöma ett mönster (' + sampleSize + ' tidigare dagar).';
    if (confidence === 'preliminary') return 'Preliminärt mönster baserat på ' + sampleSize + ' tidigare dagar.';
    return 'Jämfört med ' + sampleSize + ' tidigare loggade dagar.';
  }

  function buildNumericBaseline(entries, field) {
    return buildBaseline(entries, { field: field, type: 'numeric' });
  }

  function buildCategoricalBaseline(entries, field) {
    return buildBaseline(entries, { field: field, type: 'categorical' });
  }

  function classifyNumericChange(current, baseline, practicalTolerance) {
    if (current === null || !baseline || baseline.value === null || baseline.confidence === 'insufficient') return 'unknown';
    var tolerance = Math.max(practicalTolerance || 0, baseline.iqr && baseline.iqr > 0 ? baseline.iqr * 0.5 : 0);
    if (current > baseline.value + tolerance) return 'up';
    if (current < baseline.value - tolerance) return 'down';
    return 'flat';
  }

  function classifyCategoricalChange(current, baseline, valueMap) {
    if (!current || !baseline || !baseline.value || baseline.confidence === 'insufficient') return 'unknown';
    if (current === baseline.value) return 'flat';
    if (valueMap && valueMap[current] && valueMap[baseline.value]) return valueMap[current] > valueMap[baseline.value] ? 'up' : 'down';
    return 'unknown';
  }

  function trendLabel(direction, confidence, lang) {
    if (lang === 'en') {
      if (direction === 'unknown') return confidence === 'preliminary' ? 'Preliminary' : 'More data needed';
      if (direction === 'up') return 'Above your own median';
      if (direction === 'down') return 'Below your own median';
      return 'Near your own median';
    }
    if (direction === 'unknown') return confidence === 'preliminary' ? 'Preliminärt' : 'Mer data behövs';
    if (direction === 'up') return 'Över eget medianvärde';
    if (direction === 'down') return 'Under eget medianvärde';
    return 'Nära eget medianvärde';
  }

  function subject(name, profile, lang) {
    var value = (profile && profile.name) || name || DEFAULT_NAME;
    if (value === DEFAULT_NAME) return lang === 'en' ? 'your dog' : 'din hund';
    return value;
  }

  function possessive(name, profile, lang) {
    var value = subject(name, profile, lang);
    if (value === 'your dog') return "your dog's";
    if (value === 'din hund') return 'din hunds';
    return value + (lang === 'en' ? '\u2019s' : 's');
  }

  function profileContext(profile) {
    if (!profile) return null;
    var age = ['puppy', 'adult', 'senior'].indexOf(profile.age) >= 0 ? profile.age : null;
    return { name: profile.name || '', breed: profile.breed || '', age: age };
  }

  function loggingStreak(entriesRaw) {
    var entries = normalizeEntries(entriesRaw);
    var days = unique(entries.map(function (entry) {
      var value = entry.isoDate || entry.date;
      var parsed = value ? new Date(value) : null;
      return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
    })).sort();
    if (!days.length) return 0;
    var streak = 1;
    for (var i = days.length - 1; i > 0; i--) {
      var diff = (new Date(days[i] + 'T12:00:00') - new Date(days[i - 1] + 'T12:00:00')) / 86400000;
      if (diff === 1) streak += 1;
      else break;
    }
    return streak;
  }

  function makeCard(type, label, text, currentValue, baseline, direction, lang, extra) {
    return Object.assign({
      type: type,
      label: label,
      text: text,
      dir: direction,
      trend: trendLabel(direction, baseline.confidence, lang),
      currentValue: currentValue,
      baselineValue: baseline.value,
      sampleSize: baseline.sampleSize,
      confidence: baseline.confidence,
      // Jämförelsen (median över senaste upp till 14 dagarna) är alltid
      // Doginarys egen produktregel, inte ett medicinskt fastställt mått –
      // se filens huvudkommentar. baselineMethod beskriver HUR baslinjen
      // räknades fram (t.ex. "median"), för "Varför ser jag detta?".
      baselineMethod: baseline.baselineMethod || null,
      isProductRule: baseline.isProductRule !== false,
      reasons: [baselineText(baseline.confidence, baseline.sampleSize, lang)],
      profileContext: null,
      sourceIds: []
    }, extra || {});
  }

  function computeToday(entriesRaw, dogName, profile, lang) {
    lang = lang === 'en' ? 'en' : 'sv';
    var entries = normalizeEntries(entriesRaw);
    if (!entries.length) return null;
    var latest = entries[entries.length - 1];
    var prior = entries.slice(0, -1);
    var name = subject(dogName, profile, lang);
    var cards = [];
    var notSpecified = lang === 'en' ? 'not specified' : 'ej angiven';

    var energyBaseline = buildCategoricalBaseline(prior, 'energi');
    var energyDirection = classifyCategoricalChange(latest.energi, energyBaseline, ENERGY_VALUE);
    var energyText = lang === 'en'
      ? 'Energy level today: ' + (latest.energi ? labelFor(ENERGI_LABELS, latest.energi, lang) : notSpecified) + '.'
      : 'Energinivå idag: ' + (latest.energi ? labelFor(ENERGI_LABELS, latest.energi, lang) : notSpecified) + '.';
    if (energyBaseline.value && energyBaseline.confidence !== 'insufficient') {
      energyText += lang === 'en'
        ? ' The most common earlier level has been ' + labelFor(ENERGI_LABELS, energyBaseline.value, lang).toLowerCase() + '.'
        : ' Vanligast tidigare nivå har varit ' + labelFor(ENERGI_LABELS, energyBaseline.value, lang).toLowerCase() + '.';
    } else {
      energyText += ' ' + baselineText(energyBaseline.confidence, energyBaseline.sampleSize, lang);
    }
    cards.push(makeCard('energy', lang === 'en' ? 'Energy' : 'Energi', energyText, latest.energi || null, energyBaseline, energyDirection, lang, { profileContext: profileContext(profile) }));

    var walk = num(latest.walkLength);
    var walkBaseline = buildNumericBaseline(prior, 'walkLength');
    var walkDirection = classifyNumericChange(walk, walkBaseline, 10);
    var walkText = walk === null
      ? (lang === 'en' ? 'No walk time logged today.' : 'Ingen promenadtid loggad idag.')
      : (lang === 'en' ? 'The walk was ' + walk + ' minutes.' : 'Promenaden var ' + walk + ' minuter.');
    if (walk !== null && walkBaseline.value !== null && walkBaseline.confidence !== 'insufficient') {
      walkText += lang === 'en'
        ? ' ' + possessive(dogName, profile, lang).replace(/^./, function (c) { return c.toUpperCase(); }) + ' median is ' + Math.round(walkBaseline.value) + ' minutes over ' + walkBaseline.sampleSize + ' previously logged days.'
        : ' ' + name + 's median är ' + Math.round(walkBaseline.value) + ' minuter under ' + walkBaseline.sampleSize + ' tidigare loggade dagar.';
    } else {
      walkText += ' ' + baselineText(walkBaseline.confidence, walkBaseline.sampleSize, lang);
    }
    cards.push(makeCard('walk', lang === 'en' ? 'Walk' : 'Promenad', walkText, walk, walkBaseline, walkDirection, lang, { profileContext: profileContext(profile) }));

    var appetiteBaseline = buildCategoricalBaseline(prior, 'aptit');
    var appetiteDirection = classifyCategoricalChange(latest.aptit, appetiteBaseline, APPETITE_VALUE);
    var appetiteText = lang === 'en'
      ? 'Appetite today: ' + (latest.aptit ? labelFor(APTIT_LABELS, latest.aptit, lang) : notSpecified) + '.'
      : 'Aptit idag: ' + (latest.aptit ? labelFor(APTIT_LABELS, latest.aptit, lang) : notSpecified) + '.';
    if (appetiteBaseline.value && appetiteBaseline.confidence !== 'insufficient') {
      appetiteText += lang === 'en'
        ? ' The most common earlier level has been ' + labelFor(APTIT_LABELS, appetiteBaseline.value, lang).toLowerCase() + '.'
        : ' Vanligast tidigare nivå har varit ' + labelFor(APTIT_LABELS, appetiteBaseline.value, lang).toLowerCase() + '.';
    } else {
      appetiteText += ' ' + baselineText(appetiteBaseline.confidence, appetiteBaseline.sampleSize, lang);
    }
    cards.push(makeCard('food', lang === 'en' ? 'Appetite' : 'Aptit', appetiteText, latest.aptit || null, appetiteBaseline, appetiteDirection, lang));

    var sleep = num(latest.sleepHours);
    var sleepBaseline = buildNumericBaseline(prior, 'sleepHours');
    var sleepDirection = classifyNumericChange(sleep, sleepBaseline, 0.75);
    var sleepText = sleep === null
      ? (lang === 'en' ? 'No night sleep logged.' : 'Ingen nattlig sömn loggad.')
      : (lang === 'en' ? 'Night sleep: ' + sleep + ' hours.' : 'Nattlig sömn: ' + sleep + ' timmar.');
    if (sleep !== null && sleepBaseline.value !== null && sleepBaseline.confidence !== 'insufficient') {
      sleepText += lang === 'en'
        ? ' Your own median is ' + sleepBaseline.value.toFixed(1) + ' hours.'
        : ' Egen median är ' + sleepBaseline.value.toFixed(1) + ' timmar.';
    } else {
      sleepText += ' ' + baselineText(sleepBaseline.confidence, sleepBaseline.sampleSize, lang);
    }
    cards.push(makeCard('sleep', lang === 'en' ? 'Sleep last night' : 'Sömn i natt', sleepText, sleep, sleepBaseline, sleepDirection, lang, { sourceIds: ['agria-sleep'] }));

    return { latest: latest, cards: cards, confidence: confidenceFor(prior.length), sampleSize: prior.length };
  }

  function computeWeek(entriesRaw, dogName, profile, lang) {
    lang = lang === 'en' ? 'en' : 'sv';
    var entries = normalizeEntries(entriesRaw);
    if (!entries.length) return null;
    var week = entries.slice(-7);
    var name = subject(dogName, profile, lang);
    var walks = week.map(function (e) { return num(e.walkLength); }).filter(function (v) { return v !== null; });
    var sleep = week.map(function (e) { return num(e.sleepHours); }).filter(function (v) { return v !== null; });
    var energy = week.map(function (e) { return ENERGY_VALUE[e.energi] || null; }).filter(function (v) { return v !== null; });
    var walkMedian = median(walks);
    var sleepMedian = median(sleep);
    var confidence = confidenceFor(week.length);
    var summary = lang === 'en' ? week.length + ' logged days included. ' : week.length + ' loggade dagar ingår. ';
    if (walkMedian === null) {
      summary += lang === 'en' ? 'No walk time to summarize.' : 'Ingen promenadtid finns att sammanställa.';
    } else {
      summary += lang === 'en' ? 'The median walk was ' + Math.round(walkMedian) + ' minutes.' : 'Medianpromenaden var ' + Math.round(walkMedian) + ' minuter.';
    }
    if (sleepMedian !== null) {
      summary += lang === 'en'
        ? ' The median night sleep was ' + sleepMedian.toFixed(1) + ' hours.'
        : ' Medianen för nattlig sömn var ' + sleepMedian.toFixed(1) + ' timmar.';
    }
    var streak = loggingStreak(entries);
    var highlight = streak >= 3
      ? (lang === 'en'
          ? 'You\u2019ve logged ' + name + ' ' + streak + ' days in a row. That improves the basis for personal patterns.'
          : 'Du har loggat ' + name + ' ' + streak + ' dagar i rad. Det förbättrar underlaget för personliga mönster.')
      : baselineText(confidence, week.length, lang);
    return {
      summary: summary,
      sparklines: { energy: energy, walks: walks, sleep: sleep },
      highlight: highlight,
      loggedDays: week.length,
      confidence: confidence,
      coverageText: lang === 'en' ? 'Based on ' + week.length + ' logged days.' : 'Baserat på ' + week.length + ' loggade dagar.',
      walkMedian: walkMedian,
      sleepMedian: sleepMedian,
      energyDistribution: distribution(week.map(function (e) { return e.energi; })),
      profileContext: profileContext(profile)
    };
  }

  function computeMonth(entriesRaw, dogName, profile, lang) {
    lang = lang === 'en' ? 'en' : 'sv';
    var entries = normalizeEntries(entriesRaw);
    if (!entries.length) return null;
    var period = entries.slice(-30);
    var name = subject(dogName, profile, lang);
    var walks = period.map(function (e) { return num(e.walkLength); }).filter(function (v) { return v !== null; });
    var weights = period.map(function (e) { return num(e.weight); }).filter(function (v) { return v !== null; });
    var energyDist = distribution(period.map(function (e) { return e.energi; }));
    var appetiteDist = distribution(period.map(function (e) { return e.aptit; }));
    var highlights = [lang === 'en' ? 'The report is based on ' + period.length + ' logged days.' : 'Rapporten bygger på ' + period.length + ' loggade dagar.'];
    var watch = [];
    var recommendations = [];
    if (walks.length) {
      highlights.push(lang === 'en'
        ? 'The median walk was ' + Math.round(median(walks)) + ' minutes per logged day.'
        : 'Medianpromenaden var ' + Math.round(median(walks)) + ' minuter per loggad dag.');
    }
    var energyMode = mode(period.map(function (e) { return e.energi; }));
    if (energyMode) {
      highlights.push(lang === 'en'
        ? 'The most commonly logged energy level was ' + labelFor(ENERGI_LABELS, energyMode, lang).toLowerCase() + '.'
        : 'Vanligast loggade energinivå var ' + labelFor(ENERGI_LABELS, energyMode, lang).toLowerCase() + '.');
    }
    if (weights.length >= 3) {
      var difference = weights[weights.length - 1] - weights[0];
      watch.push(lang === 'en'
        ? 'Weight went from ' + weights[0].toFixed(1) + ' to ' + weights[weights.length - 1].toFixed(1) + ' kg over the logged measurements (' + (difference >= 0 ? '+' : '') + difference.toFixed(1) + ' kg).'
        : 'Vikten gick från ' + weights[0].toFixed(1) + ' till ' + weights[weights.length - 1].toFixed(1) + ' kg under de loggade mätningarna (' + (difference >= 0 ? '+' : '') + difference.toFixed(1) + ' kg).');
      recommendations.push(lang === 'en'
        ? 'Track the weight trend over time and contact a vet if the change is unexpected or concerning.'
        : 'Följ viktens utveckling över tid och kontakta veterinär om förändringen är oväntad eller oroande.');
    }
    if (period.length < ESTABLISHED_MIN_DAYS) {
      watch.push(lang === 'en'
        ? 'The data is still limited. More logged days give a more reliable personal comparison.'
        : 'Underlaget är fortfarande begränsat. Fler loggade dagar ger en säkrare personlig jämförelse.');
    }
    return {
      highlights: highlights,
      watch: watch,
      recommendations: recommendations,
      walkTrend: walks,
      loggedDays: period.length,
      walkMedian: median(walks),
      firstWeight: weights.length >= 3 ? weights[0] : null,
      latestWeight: weights.length >= 3 ? weights[weights.length - 1] : null,
      weightChangeKg: weights.length >= 3 ? Number((weights[weights.length - 1] - weights[0]).toFixed(1)) : null,
      energyDistribution: energyDist,
      appetiteDistribution: appetiteDist,
      confidence: confidenceFor(period.length),
      profileContext: profileContext(profile),
      dogName: name
    };
  }

  function lowEnergy(entry) { return entry && (entry.energi === 'Låg' || entry.energi === 'Low'); }
  function poorAppetite(entry) { return entry && (entry.aptit === 'Dålig' || entry.aptit === 'Poor'); }
  function abnormalStool(entry) { return entry && ['Lös', 'Hård', 'Ovanlig', 'Loose', 'Hard', 'Unusual'].indexOf(entry.stool) >= 0; }

  function computeWarnings(entriesRaw, dogName, profile, lang) {
    lang = lang === 'en' ? 'en' : 'sv';
    var entries = normalizeEntries(entriesRaw);
    var warnings = [];
    if (!entries.length) return warnings;
    var name = subject(dogName, profile, lang);
    var latest = entries[entries.length - 1];
    var recent3 = entries.slice(-3);
    var recent5 = entries.slice(-5);
    var latestLow = lowEnergy(latest);
    var latestPoorAppetite = poorAppetite(latest);
    var latestSymptoms = typeof latest.symptoms === 'string' && latest.symptoms.trim();

    if (latestSymptoms && (latestLow || latestPoorAppetite)) {
      warnings.push({
        severity: 'watch',
        title: lang === 'en' ? 'Several changes have been logged' : 'Flera förändringar är loggade',
        text: lang === 'en'
          ? name + ' has a noted symptom together with ' + (latestLow ? 'low energy' : 'reduced appetite') + '. Keep a closer eye and contact a vet if the condition worsens or worries you.'
          : name + ' har ett noterat symptom tillsammans med ' + (latestLow ? 'låg energi' : 'sämre aptit') + '. Håll extra uppsikt och kontakta veterinär om tillståndet försämras eller oroar dig.',
        triggers: ['symptoms', latestLow ? 'low_energy' : 'poor_appetite'],
        sampleSize: recent5.length,
        profileContext: profileContext(profile),
        sourceIds: ['evidensia-fatigue'],
        isProductRule: false
      });
    } else if (latestSymptoms) {
      warnings.push({
        severity: 'observation',
        title: lang === 'en' ? 'Symptom noted' : 'Symptom noterat',
        text: lang === 'en'
          ? 'You noted: "' + latest.symptoms.trim() + '". Keep track of it and contact a vet if the symptom persists, worsens, or worries you.'
          : 'Du noterade: "' + latest.symptoms.trim() + '". Följ utvecklingen och kontakta veterinär om symptomet kvarstår, förvärras eller oroar dig.',
        triggers: ['symptoms'], sampleSize: 1, profileContext: profileContext(profile),
        sourceIds: ['evidensia-fatigue'], isProductRule: false
      });
    }

    if (latestLow && latestPoorAppetite) {
      warnings.push({
        severity: 'watch', title: lang === 'en' ? 'Low energy and reduced appetite' : 'Låg energi och sämre aptit',
        text: lang === 'en'
          ? 'Both low energy and poor appetite are logged for ' + name + '. Watch the dog\u2019s overall condition and contact a vet if the change is clear, sudden, or continues.'
          : 'Både låg energi och dålig aptit är loggade för ' + name + '. Följ hundens allmäntillstånd och kontakta veterinär om förändringen är tydlig, plötslig eller fortsätter.',
        triggers: ['low_energy', 'poor_appetite'], sampleSize: 1,
        profileContext: profileContext(profile), sourceIds: ['evidensia-fatigue'], isProductRule: false
      });
    } else if (latestLow) {
      warnings.push({
        severity: 'observation', title: lang === 'en' ? 'Low energy today' : 'Låg energi idag',
        text: lang === 'en'
          ? 'A single low-energy day is an observation, not a trend. Keep logging and watch for other changes.'
          : 'En enstaka låg energidag är en observation, inte en trend. Fortsätt logga och håll uppsikt efter andra förändringar.',
        triggers: ['low_energy'], sampleSize: 1,
        profileContext: profileContext(profile), sourceIds: [], isProductRule: true
      });
    }

    if (recent3.length === 3 && recent3.every(lowEnergy) && !latestPoorAppetite && !latestSymptoms) {
      warnings.push({
        severity: 'watch', title: lang === 'en' ? 'Low energy for three logged days' : 'Låg energi i tre loggade dagar',
        text: lang === 'en'
          ? 'Low energy has been logged three days in a row. This is Doginary\u2019s cautious observation rule, not a medical threshold.'
          : 'Låg energi har loggats tre dagar i rad. Det är Doginarys försiktiga observationsregel, inte en medicinsk tidsgräns.',
        triggers: ['low_energy_3_days'], sampleSize: 3,
        profileContext: profileContext(profile), sourceIds: [], isProductRule: true
      });
    }

    var abnormalCount = recent5.filter(abnormalStool).length;
    if (abnormalCount >= 2) {
      warnings.push({
        severity: 'watch', title: lang === 'en' ? 'Stool has been unusual several times' : 'Avföringen har avvikit flera gånger',
        text: lang === 'en'
          ? 'Unusual stool has been logged ' + abnormalCount + ' of the last ' + recent5.length + ' days. Keep track and contact a vet if it worsens or other symptoms appear.'
          : 'Avvikande avföring har loggats ' + abnormalCount + ' av de senaste ' + recent5.length + ' dagarna. Följ utvecklingen och kontakta veterinär vid försämring eller andra symptom.',
        triggers: ['repeated_abnormal_stool'], sampleSize: recent5.length,
        profileContext: profileContext(profile), sourceIds: ['evidensia-fatigue'], isProductRule: true
      });
    }
    var walkBaseline = buildNumericBaseline(entries.slice(0, -1), 'walkLength');
    var latestWalk = num(latest.walkLength);
    var walkDirection = classifyNumericChange(latestWalk, walkBaseline, 10);
    if (latestLow && walkBaseline.confidence === 'established' && walkDirection === 'down') {
      warnings.push({ severity: 'watch', title: lang === 'en' ? 'Low energy and a shorter walk' : 'Låg energi och kortare promenad',
        text: lang === 'en'
          ? 'Low energy and a walk noticeably shorter than the personal baseline have been logged at the same time. Keep observing and contact a vet if you\u2019re worried or it worsens.'
          : 'Låg energi och en tydligt kortare promenad än den personliga baslinjen har loggats samtidigt. Fortsätt observera och kontakta veterinär vid oro eller försämring.',
        triggers: ['low_energy', 'walk_below_baseline'], sampleSize: walkBaseline.sampleSize,
        confidence: walkBaseline.confidence, profileContext: profileContext(profile),
        sourceIds: ['evidensia-fatigue'], isProductRule: true });
    }
    var recentWeights = validNumericValues(entries.slice(-30), 'weight');
    if (recentWeights.length >= 3 && latestPoorAppetite) {
      var weightDelta = recentWeights[recentWeights.length - 1] - recentWeights[0];
      if (Math.abs(weightDelta) >= 0.1) {
        warnings.push({ severity: 'watch', title: lang === 'en' ? 'Weight and appetite have changed' : 'Vikt och aptit har förändrats',
          text: lang === 'en'
            ? 'A weight change and poor appetite appear in the logged information. This is an observation, not a diagnosis. Contact a vet if the change is unexpected or concerning.'
            : 'En viktförändring och dålig aptit finns i den loggade informationen. Detta är en observation, inte en diagnos. Kontakta veterinär om förändringen är oväntad eller oroande.',
          triggers: ['weight_change', 'poor_appetite'], sampleSize: recentWeights.length,
          confidence: confidenceFor(recentWeights.length), profileContext: profileContext(profile),
          sourceIds: ['evidensia-fatigue'], isProductRule: true });
      }
    }
    warnings.forEach(function (warning) {
      if (!warning.confidence) warning.confidence = confidenceFor(warning.sampleSize || 0);
      warning.sourceIds = unique(warning.sourceIds || []);
    });
    return warnings;
  }

  function computeRewards(entriesRaw, dogName, profile, lang) {
    lang = lang === 'en' ? 'en' : 'sv';
    var entries = normalizeEntries(entriesRaw);
    var rewards = [];
    var name = subject(dogName, profile, lang);
    var streak = loggingStreak(entries);
    if (streak >= 3) rewards.push({
      title: lang === 'en' ? streak + ' days in a row' : streak + ' dagar i rad',
      text: lang === 'en'
        ? 'Well done. You\u2019ve logged ' + name + ' ' + streak + ' days in a row, which improves the basis for personal patterns.'
        : 'Bra jobbat. Du har loggat ' + name + ' ' + streak + ' dagar i rad, vilket förbättrar underlaget för personliga mönster.'
    });
    if (entries.length === ESTABLISHED_MIN_DAYS) rewards.push({
      title: lang === 'en' ? 'Personal baseline unlocked' : 'Personlig baslinje upplåst',
      text: lang === 'en'
        ? 'Seven logged days give Doginary a better basis for careful comparisons with the dog\u2019s own history.'
        : 'Sju loggade dagar ger Doginary ett bättre underlag för försiktiga jämförelser med hundens egen historik.'
    });
    if (entries.length > ESTABLISHED_MIN_DAYS && entries.length % 10 === 0) rewards.push({
      title: lang === 'en' ? entries.length + ' logged days' : entries.length + ' loggade dagar',
      text: lang === 'en'
        ? 'More regularly logged days make the insights more representative for ' + name + '.'
        : 'Fler regelbundet loggade dagar gör insikterna mer representativa för ' + name + '.'
    });
    return rewards;
  }

  global.DoginaryData = {
    DEFAULT_NAME: DEFAULT_NAME,
    SOURCES: SOURCES,
    PRODUCT_RULES: {
      preliminaryMinDays: PRELIMINARY_MIN_DAYS,
      establishedMinDays: ESTABLISHED_MIN_DAYS,
      baselineMaxDays: BASELINE_MAX_DAYS
    },
    computeToday: computeToday,
    computeWeek: computeWeek,
    computeMonth: computeMonth,
    computeWarnings: computeWarnings,
    computeRewards: computeRewards,
    // Visningsöversättning av lagrade kategoriska värden (energi/aptit/
    // avföring) till aktuellt visningsspråk — se ENERGI_LABELS m.fl. ovan.
    displayEnergi: function (value, lang) { return labelFor(ENERGI_LABELS, value, lang); },
    displayAptit: function (value, lang) { return labelFor(APTIT_LABELS, value, lang); },
    displayStool: function (value, lang) { return labelFor(STOOL_LABELS, value, lang); },
    loggingStreak: loggingStreak,
    normalizeEntries: normalizeEntries,
    buildDailyEntries: buildDailyEntries,
    validNumericValues: validNumericValues,
    buildBaseline: buildBaseline,
    median: median,
    quantile: quantile,
    interquartileRange: interquartileRange,
    mode: mode,
    distribution: distribution,
    buildNumericBaseline: buildNumericBaseline,
    buildCategoricalBaseline: buildCategoricalBaseline,
    classifyNumericChange: classifyNumericChange,
    classifyCategoricalChange: classifyCategoricalChange
  };
})(window);
