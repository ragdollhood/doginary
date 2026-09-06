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

  var ENERGY_VALUE = { 'Låg': 1, 'Normal': 2, 'Hög': 3, 'Low': 1, 'Normal': 2, 'High': 3 };
  var APPETITE_VALUE = { 'Dålig': 1, 'Normal': 2, 'Stark': 3, 'Poor': 1, 'Normal': 2, 'Strong': 3 };

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

  function baselineText(confidence, sampleSize) {
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

  function trendLabel(direction, confidence) {
    if (direction === 'unknown') return confidence === 'preliminary' ? 'Preliminärt' : 'Mer data behövs';
    if (direction === 'up') return 'Över eget medianvärde';
    if (direction === 'down') return 'Under eget medianvärde';
    return 'Nära eget medianvärde';
  }

  function subject(name, profile) {
    return (profile && profile.name) || name || DEFAULT_NAME;
  }

  function possessive(name, profile) {
    var value = subject(name, profile);
    return value === DEFAULT_NAME ? "your dog's" : value + 's';
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

  function makeCard(type, label, text, currentValue, baseline, direction, extra) {
    return Object.assign({
      type: type,
      label: label,
      text: text,
      dir: direction,
      trend: trendLabel(direction, baseline.confidence),
      currentValue: currentValue,
      baselineValue: baseline.value,
      sampleSize: baseline.sampleSize,
      confidence: baseline.confidence,
      reasons: [baselineText(baseline.confidence, baseline.sampleSize)],
      profileContext: null,
      sourceIds: []
    }, extra || {});
  }

  function computeToday(entriesRaw, dogName, profile) {
    var entries = normalizeEntries(entriesRaw);
    if (!entries.length) return null;
    var latest = entries[entries.length - 1];
    var prior = entries.slice(0, -1);
    var name = subject(dogName, profile);
    var cards = [];

    var energyBaseline = buildCategoricalBaseline(prior, 'energi');
    var energyDirection = classifyCategoricalChange(latest.energi, energyBaseline, ENERGY_VALUE);
    cards.push(makeCard('energy', 'Energi', 'Energinivå idag: ' + (latest.energi || 'ej angiven') + '. ' + baselineText(energyBaseline.confidence, energyBaseline.sampleSize), latest.energi || null, energyBaseline, energyDirection, { profileContext: profileContext(profile) }));

    var walk = num(latest.walkLength);
    var walkBaseline = buildNumericBaseline(prior, 'walkLength');
    var walkDirection = classifyNumericChange(walk, walkBaseline, 10);
    var walkText = walk === null ? 'Ingen promenadtid loggad idag.' : 'Promenaden var ' + walk + ' minuter.';
    if (walk !== null && walkBaseline.value !== null && walkBaseline.confidence !== 'insufficient') walkText += ' ' + name + 's median är ' + Math.round(walkBaseline.value) + ' minuter under ' + walkBaseline.sampleSize + ' tidigare loggade dagar.';
    else walkText += ' ' + baselineText(walkBaseline.confidence, walkBaseline.sampleSize);
    cards.push(makeCard('walk', 'Promenad', walkText, walk, walkBaseline, walkDirection, { profileContext: profileContext(profile) }));

    var appetiteBaseline = buildCategoricalBaseline(prior, 'aptit');
    var appetiteDirection = classifyCategoricalChange(latest.aptit, appetiteBaseline, APPETITE_VALUE);
    cards.push(makeCard('food', 'Aptit', 'Aptit idag: ' + (latest.aptit || 'ej angiven') + '. ' + baselineText(appetiteBaseline.confidence, appetiteBaseline.sampleSize), latest.aptit || null, appetiteBaseline, appetiteDirection));

    var sleep = num(latest.sleepHours);
    var sleepBaseline = buildNumericBaseline(prior, 'sleepHours');
    var sleepDirection = classifyNumericChange(sleep, sleepBaseline, 0.75);
    var sleepText = sleep === null ? 'Ingen nattlig sömn loggad.' : 'Nattlig sömn: ' + sleep + ' timmar.';
    if (sleep !== null && sleepBaseline.value !== null && sleepBaseline.confidence !== 'insufficient') sleepText += ' Egen median är ' + sleepBaseline.value.toFixed(1) + ' timmar.';
    else sleepText += ' ' + baselineText(sleepBaseline.confidence, sleepBaseline.sampleSize);
    cards.push(makeCard('sleep', 'Sömn i natt', sleepText, sleep, sleepBaseline, sleepDirection, { sourceIds: ['agria-sleep'] }));

    return { latest: latest, cards: cards, confidence: confidenceFor(prior.length), sampleSize: prior.length };
  }

  function computeWeek(entriesRaw, dogName, profile) {
    var entries = normalizeEntries(entriesRaw);
    if (!entries.length) return null;
    var week = entries.slice(-7);
    var name = subject(dogName, profile);
    var walks = week.map(function (e) { return num(e.walkLength); }).filter(function (v) { return v !== null; });
    var sleep = week.map(function (e) { return num(e.sleepHours); }).filter(function (v) { return v !== null; });
    var energy = week.map(function (e) { return ENERGY_VALUE[e.energi] || null; }).filter(function (v) { return v !== null; });
    var walkMedian = median(walks);
    var sleepMedian = median(sleep);
    var confidence = confidenceFor(week.length);
    var summary = week.length + ' loggade dagar ingår. ';
    summary += walkMedian === null ? 'Ingen promenadtid finns att sammanställa.' : 'Medianpromenaden var ' + Math.round(walkMedian) + ' minuter.';
    if (sleepMedian !== null) summary += ' Medianen för nattlig sömn var ' + sleepMedian.toFixed(1) + ' timmar.';
    var streak = loggingStreak(entries);
    var highlight = streak >= 3 ? 'Du har loggat ' + name + ' ' + streak + ' dagar i rad. Det förbättrar underlaget för personliga mönster.' : baselineText(confidence, week.length);
    return {
      summary: summary,
      sparklines: { energy: energy, walks: walks, sleep: sleep },
      highlight: highlight,
      loggedDays: week.length,
      confidence: confidence,
      coverageText: 'Baserat på ' + week.length + ' loggade dagar.',
      walkMedian: walkMedian,
      sleepMedian: sleepMedian,
      energyDistribution: distribution(week.map(function (e) { return e.energi; })),
      profileContext: profileContext(profile)
    };
  }

  function computeMonth(entriesRaw, dogName, profile) {
    var entries = normalizeEntries(entriesRaw);
    if (!entries.length) return null;
    var period = entries.slice(-30);
    var name = subject(dogName, profile);
    var walks = period.map(function (e) { return num(e.walkLength); }).filter(function (v) { return v !== null; });
    var weights = period.map(function (e) { return num(e.weight); }).filter(function (v) { return v !== null; });
    var energyDist = distribution(period.map(function (e) { return e.energi; }));
    var appetiteDist = distribution(period.map(function (e) { return e.aptit; }));
    var highlights = ['Rapporten bygger på ' + period.length + ' loggade dagar.'];
    var watch = [];
    var recommendations = [];
    if (walks.length) highlights.push('Medianpromenaden var ' + Math.round(median(walks)) + ' minuter per loggad dag.');
    if (mode(period.map(function (e) { return e.energi; }))) highlights.push('Vanligast loggade energinivå var ' + mode(period.map(function (e) { return e.energi; })).toLowerCase() + '.');
    if (weights.length >= 3) {
      var difference = weights[weights.length - 1] - weights[0];
      watch.push('Vikten gick från ' + weights[0].toFixed(1) + ' till ' + weights[weights.length - 1].toFixed(1) + ' kg under de loggade mätningarna (' + (difference >= 0 ? '+' : '') + difference.toFixed(1) + ' kg).');
      recommendations.push('Följ viktens utveckling över tid och kontakta veterinär om förändringen är oväntad eller oroande.');
    }
    if (period.length < ESTABLISHED_MIN_DAYS) watch.push('Underlaget är fortfarande begränsat. Fler loggade dagar ger en säkrare personlig jämförelse.');
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

  function computeWarnings(entriesRaw, dogName, profile) {
    var entries = normalizeEntries(entriesRaw);
    var warnings = [];
    if (!entries.length) return warnings;
    var name = subject(dogName, profile);
    var latest = entries[entries.length - 1];
    var recent3 = entries.slice(-3);
    var recent5 = entries.slice(-5);
    var latestLow = lowEnergy(latest);
    var latestPoorAppetite = poorAppetite(latest);
    var latestSymptoms = typeof latest.symptoms === 'string' && latest.symptoms.trim();

    if (latestSymptoms && (latestLow || latestPoorAppetite)) {
      warnings.push({
        severity: 'watch',
        title: 'Flera förändringar är loggade',
        text: name + ' har ett noterat symptom tillsammans med ' + (latestLow ? 'låg energi' : 'sämre aptit') + '. Håll extra uppsikt och kontakta veterinär om tillståndet försämras eller oroar dig.',
        triggers: ['symptoms', latestLow ? 'low_energy' : 'poor_appetite'],
        sampleSize: recent5.length,
        profileContext: profileContext(profile),
        sourceIds: ['evidensia-fatigue'],
        isProductRule: false
      });
    } else if (latestSymptoms) {
      warnings.push({
        severity: 'observation',
        title: 'Symptom noterat',
        text: 'Du noterade: "' + latest.symptoms.trim() + '". Följ utvecklingen och kontakta veterinär om symptomet kvarstår, förvärras eller oroar dig.',
        triggers: ['symptoms'], sampleSize: 1, profileContext: profileContext(profile),
        sourceIds: ['evidensia-fatigue'], isProductRule: false
      });
    }

    if (latestLow && latestPoorAppetite) {
      warnings.push({
        severity: 'watch', title: 'Låg energi och sämre aptit',
        text: 'Både låg energi och dålig aptit är loggade för ' + name + '. Följ hundens allmäntillstånd och kontakta veterinär om förändringen är tydlig, plötslig eller fortsätter.',
        triggers: ['low_energy', 'poor_appetite'], sampleSize: 1,
        profileContext: profileContext(profile), sourceIds: ['evidensia-fatigue'], isProductRule: false
      });
    } else if (latestLow) {
      warnings.push({
        severity: 'observation', title: 'Låg energi idag',
        text: 'En enstaka låg energidag är en observation, inte en trend. Fortsätt logga och håll uppsikt efter andra förändringar.',
        triggers: ['low_energy'], sampleSize: 1,
        profileContext: profileContext(profile), sourceIds: [], isProductRule: true
      });
    }

    if (recent3.length === 3 && recent3.every(lowEnergy) && !latestPoorAppetite && !latestSymptoms) {
      warnings.push({
        severity: 'watch', title: 'Låg energi i tre loggade dagar',
        text: 'Låg energi har loggats tre dagar i rad. Det är Doginarys försiktiga observationsregel, inte en medicinsk tidsgräns.',
        triggers: ['low_energy_3_days'], sampleSize: 3,
        profileContext: profileContext(profile), sourceIds: [], isProductRule: true
      });
    }

    var abnormalCount = recent5.filter(abnormalStool).length;
    if (abnormalCount >= 2) {
      warnings.push({
        severity: 'watch', title: 'Avföringen har avvikit flera gånger',
        text: 'Avvikande avföring har loggats ' + abnormalCount + ' av de senaste ' + recent5.length + ' dagarna. Följ utvecklingen och kontakta veterinär vid försämring eller andra symptom.',
        triggers: ['repeated_abnormal_stool'], sampleSize: recent5.length,
        profileContext: profileContext(profile), sourceIds: ['evidensia-fatigue'], isProductRule: true
      });
    }
    var walkBaseline = buildNumericBaseline(entries.slice(0, -1), 'walkLength');
    var latestWalk = num(latest.walkLength);
    var walkDirection = classifyNumericChange(latestWalk, walkBaseline, 10);
    if (latestLow && walkBaseline.confidence === 'established' && walkDirection === 'down') {
      warnings.push({ severity: 'watch', title: 'Låg energi och kortare promenad',
        text: 'Låg energi och en tydligt kortare promenad än den personliga baslinjen har loggats samtidigt. Fortsätt observera och kontakta veterinär vid oro eller försämring.',
        triggers: ['low_energy', 'walk_below_baseline'], sampleSize: walkBaseline.sampleSize,
        confidence: walkBaseline.confidence, profileContext: profileContext(profile),
        sourceIds: ['evidensia-fatigue'], isProductRule: true });
    }
    var recentWeights = validNumericValues(entries.slice(-30), 'weight');
    if (recentWeights.length >= 3 && latestPoorAppetite) {
      var weightDelta = recentWeights[recentWeights.length - 1] - recentWeights[0];
      if (Math.abs(weightDelta) >= 0.1) {
        warnings.push({ severity: 'watch', title: 'Vikt och aptit har förändrats',
          text: 'En viktförändring och dålig aptit finns i den loggade informationen. Detta är en observation, inte en diagnos. Kontakta veterinär om förändringen är oväntad eller oroande.',
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

  function computeRewards(entriesRaw, dogName, profile) {
    var entries = normalizeEntries(entriesRaw);
    var rewards = [];
    var name = subject(dogName, profile);
    var streak = loggingStreak(entries);
    if (streak >= 3) rewards.push({ title: streak + ' dagar i rad', text: 'Bra jobbat. Du har loggat ' + name + ' ' + streak + ' dagar i rad, vilket förbättrar underlaget för personliga mönster.' });
    if (entries.length === ESTABLISHED_MIN_DAYS) rewards.push({ title: 'Personlig baslinje upplåst', text: 'Sju loggade dagar ger Doginary ett bättre underlag för försiktiga jämförelser med hundens egen historik.' });
    if (entries.length > ESTABLISHED_MIN_DAYS && entries.length % 10 === 0) rewards.push({ title: entries.length + ' loggade dagar', text: 'Fler regelbundet loggade dagar gör insikterna mer representativa för ' + name + '.' });
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
    loggingStreak: loggingStreak,
    normalizeEntries: normalizeEntries,
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
