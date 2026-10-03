/*
 * Check-in dashboard core: parsing, metrics and commitment checks.
 * Pure functions only (no DOM, no storage) so the same file runs in the
 * artifact page (window.Core) and under `node --test` (module.exports).
 *
 * Conventions
 *   - Dates are local calendar strings "YYYY-MM-DD"; times are "HH:MM".
 *   - Body weight and lifted weight are stored in lb.
 *   - Missing data is `undefined`, never 0. Nothing is scored on days or
 *     sessions we have no data for.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------- dates

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  function validYmd(y, m, d) {
    if (!(y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1;
  }

  function parseTime(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([ap]\.?m\.?)?/i);
    if (!m) return null;
    let h = +m[1];
    const min = +m[2];
    const ap = m[3] ? m[3][0].toLowerCase() : null;
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return `${pad(h)}:${pad(min)}`;
  }

  /**
   * Parse the date formats the sources produce. Returns {date, time} or null.
   *   2026-10-03, 2026-10-03T08:15:00(Z|±hh:mm), 2026/10/03
   *   10/3/2026, 10/3/26 (US order; day-first only when the first part > 12)
   *   3 Oct 2026, 08:15   (Hevy)      Oct 3, 2026 6:30 PM
   *   Excel serial numbers (from spreadsheets), Date objects
   */
  function parseDateTime(input) {
    if (input == null || input === "") return null;
    if (input instanceof Date) {
      if (isNaN(input)) return null;
      return { date: ymd(input.getFullYear(), input.getMonth() + 1, input.getDate()), time: pad(input.getHours()) + ":" + pad(input.getMinutes()) };
    }
    if (typeof input === "number") {
      if (input > 20000 && input < 80000) {
        // Excel serial day (1900 system); fractional part is the time.
        const ms = Math.round((input - 25569) * 86400000);
        const dt = new Date(ms);
        const time = input % 1 ? pad(dt.getUTCHours()) + ":" + pad(dt.getUTCMinutes()) : null;
        return { date: ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()), time };
      }
      return null;
    }
    const s = String(input).trim();
    let m;
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[ap]\.?m\.?)?))?/i))) {
      if (!validYmd(+m[1], +m[2], +m[3])) return null;
      return { date: ymd(+m[1], +m[2], +m[3]), time: parseTime(m[4]) };
    }
    if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:,?\s+(.+))?$/))) {
      let a = +m[1], b = +m[2], y = +m[3];
      if (y < 100) y += 2000;
      let mo = a, d = b;
      if (a > 12 && b <= 12) { mo = b; d = a; }
      if (!validYmd(y, mo, d)) return null;
      return { date: ymd(y, mo, d), time: parseTime(m[4]) };
    }
    if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?:,?\s+(.+))?$/))) {
      const mo = MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)];
      if (!mo || !validYmd(+m[3], mo, +m[1])) return null;
      return { date: ymd(+m[3], mo, +m[1]), time: parseTime(m[4]) };
    }
    if ((m = s.match(/^(?:[A-Za-z]{3,9},?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:,?\s+(?:at\s+)?(.+))?$/))) {
      const mo = MONTHS[m[1].toLowerCase().slice(0, 4)] || MONTHS[m[1].toLowerCase().slice(0, 3)];
      if (!mo || !validYmd(+m[3], mo, +m[2])) return null;
      return { date: ymd(+m[3], mo, +m[2]), time: parseTime(m[4]) };
    }
    return null;
  }

  const toUTC = (date) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const fromUTC = (ms) => { const dt = new Date(ms); return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); };
  const addDays = (date, n) => fromUTC(toUTC(date) + n * 86400000);
  const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000); // b - a
  const dow = (date) => new Date(toUTC(date)).getUTCDay(); // 0 = Sunday
  const weekStart = (date, startDow = 1) => addDays(date, -((dow(date) - startDow + 7) % 7));
  const todayLocal = () => parseDateTime(new Date()).date;

  function dateRange(from, toExclusive) {
    const out = [];
    for (let d = from; d < toExclusive; d = addDays(d, 1)) out.push(d);
    return out;
  }

  const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(date, opts = {}) {
    if (!date) return "";
    const [, m, d] = date.split("-").map(Number);
    const base = `${MON_SHORT[m - 1]} ${d}`;
    return opts.dow ? `${DOW_SHORT[dow(date)]} ${base}` : base;
  }

  // ------------------------------------------------------------------ csv

  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", q = false;
    text = String(text).replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); if (row.length > 1 || row[0] !== "") rows.push(row); }
    return rows;
  }

  /** Rows (arrays) with a header row -> array of objects keyed by header. */
  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const head = rows[0].map((h) => String(h).trim());
    return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }

  const num = (v) => {
    if (v == null || v === "") return undefined;
    if (typeof v === "number") return isFinite(v) ? v : undefined;
    const n = parseFloat(String(v).replace(/[,\s]/g, ""));
    return isFinite(n) ? n : undefined;
  };
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  // ---------------------------------------------------------------- hevy

  const LB_PER_KG = 2.20462;

  function isHevyHeader(headers) {
    const h = headers.map(norm);
    return h.includes("exercise title") && h.includes("start time") && h.includes("set index");
  }

  /**
   * Hevy "Export workouts" CSV -> workouts.
   * Each row is one set; rows are grouped by (title, start_time).
   */
  function parseHevy(objects) {
    const byKey = new Map();
    for (const o of objects) {
      const g = (name) => {
        for (const k of Object.keys(o)) if (norm(k) === name) return o[k];
        return undefined;
      };
      const start = parseDateTime(g("start time"));
      if (!start) continue;
      const end = parseDateTime(g("end time"));
      const title = (g("title") || "Workout").trim();
      const key = `${start.date}T${start.time || ""}|${title}`;
      let w = byKey.get(key);
      if (!w) {
        w = { date: start.date, time: start.time, end_time: end ? end.time : null, title, source: "hevy", notes: (g("description") || "").trim() || undefined, exercises: [] };
        byKey.set(key, w);
      }
      const exName = (g("exercise title") || "").trim();
      if (!exName) continue;
      let ex = w.exercises[w.exercises.length - 1];
      if (!ex || ex.name !== exName) {
        ex = { name: exName, sets: [] };
        w.exercises.push(ex);
      }
      let wt = num(g("weight lbs"));
      if (wt === undefined) { const kg = num(g("weight kg")); if (kg !== undefined) wt = +(kg * LB_PER_KG).toFixed(1); }
      let dist = num(g("distance miles"));
      if (dist === undefined) { const km = num(g("distance km")); if (km !== undefined) dist = +(km / 1.60934).toFixed(2); }
      const set = { type: (g("set type") || "normal").trim() || "normal" };
      if (wt !== undefined) set.w = wt;
      const reps = num(g("reps")); if (reps !== undefined) set.r = reps;
      if (dist !== undefined) set.mi = dist;
      const dur = num(g("duration seconds")); if (dur !== undefined && dur > 0) set.s = dur;
      const rpe = num(g("rpe")); if (rpe !== undefined) set.rpe = rpe;
      ex.sets.push(set);
    }
    return [...byKey.values()].sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  }

  // ---------------------------------------------------- daily metric files

  /** The daily metrics the dashboard understands. */
  const METRICS = {
    steps: { label: "Steps", unit: "steps", agg: "sum" },
    calories: { label: "Calories", unit: "kcal", agg: "sum" },
    protein: { label: "Protein", unit: "g", agg: "sum" },
    carbs: { label: "Carbs", unit: "g", agg: "sum" },
    fat: { label: "Fat", unit: "g", agg: "sum" },
    weight: { label: "Scale weight", unit: "lb", agg: "last" },
    trend_weight: { label: "Trend weight", unit: "lb", agg: "last" },
    expenditure: { label: "Expenditure", unit: "kcal", agg: "last" },
  };

  /** Map a column header to a metric (or "date"), else null. */
  function classifyHeader(header) {
    const h = norm(header);
    if (!h) return null;
    if (/^(date|day|time|start|start date|date time|datetime|timestamp)$/.test(h) || /^date\b/.test(h)) return { metric: "date" };
    const kg = /\bkg\b|kilogram/.test(h);
    if (/trend/.test(h) && /weight/.test(h)) return { metric: "trend_weight", kg };
    if (/expenditure|tdee|energy burned|active energy/.test(h)) return /tdee|expenditure/.test(h) ? { metric: "expenditure" } : null;
    if (/(body|scale)?\s*weight|body mass/.test(h) && !/target|goal|lifted|volume/.test(h)) return { metric: "weight", kg };
    if (/^steps?\b|step count|\bsteps\b/.test(h)) return { metric: "steps" };
    if (/target|goal|budget|remaining/.test(h)) return null;
    if (/calor|kcal|dietary energy|energy consumed|^energy\b/.test(h)) return { metric: "calories" };
    if (/protein/.test(h)) return { metric: "protein" };
    if (/carb/.test(h)) return { metric: "carbs" };
    if (/^fat\b|total fat|\bfat g\b|fat \(g\)/.test(h) || h === "fat") return { metric: "fat" };
    return null;
  }

  /** Long format: rows of {date, metric, value} (the Apple Health Shortcut output). */
  function isLongFormat(headers) {
    const h = headers.map(norm);
    return h.includes("metric") && h.includes("value") && h.some((x) => /date/.test(x));
  }

  const METRIC_ALIASES = {
    steps: "steps", step: "steps", "step count": "steps", stepcount: "steps",
    calories: "calories", "dietary energy": "calories", "dietary calories": "calories", energy: "calories", kcal: "calories",
    protein: "protein", carbs: "carbs", carbohydrates: "carbs", fat: "fat", "total fat": "fat",
    weight: "weight", "body weight": "weight", "body mass": "weight", bodymass: "weight",
    "trend weight": "trend_weight", expenditure: "expenditure",
  };

  function addDayValue(out, date, metric, value, agg) {
    if (value === undefined) return;
    const rec = out[date] || (out[date] = {});
    if (rec[metric] === undefined || agg === "last") rec[metric] = value;
    else rec[metric] += value;
  }

  /**
   * Parse a table (array of row objects) of daily metrics in wide format
   * (one row per day or per entry, one column per metric) or long format.
   * Returns {days: {date: {metric: value}}, metrics: [...], skipped}.
   * Multiple rows on the same date are summed (food entries) or take the
   * last value (weight).
   */
  function parseDailyTable(objects, opts = {}) {
    const days = {};
    let skipped = 0;
    if (!objects.length) return { days, metrics: [], skipped };
    const headers = Object.keys(objects[0]);
    if (isLongFormat(headers)) {
      const dk = headers.find((x) => /date/.test(norm(x)));
      const mk = headers.find((x) => norm(x) === "metric");
      const vk = headers.find((x) => norm(x) === "value");
      const uk = headers.find((x) => norm(x) === "unit");
      for (const o of objects) {
        const dt = parseDateTime(o[dk]);
        const metric = METRIC_ALIASES[norm(o[mk])] || (METRICS[norm(o[mk]).replace(/ /g, "_")] ? norm(o[mk]).replace(/ /g, "_") : null);
        let v = num(o[vk]);
        if (!dt || !metric || v === undefined) { skipped++; continue; }
        if ((metric === "weight" || metric === "trend_weight") && uk && /kg/i.test(o[uk] || "")) v = +(v * LB_PER_KG).toFixed(1);
        addDayValue(days, dt.date, metric, v, METRICS[metric].agg);
      }
    } else {
      const map = {};
      let dateKey = null;
      for (const h of headers) {
        const c = classifyHeader(h);
        if (!c) continue;
        if (c.metric === "date") { if (!dateKey) dateKey = h; continue; }
        if (!Object.values(map).some((x) => x.metric === c.metric)) map[h] = c;
      }
      if (opts.mapping) {
        // Explicit mapping {date: header, metrics: {metric: header}} overrides detection.
        dateKey = opts.mapping.date || dateKey;
        for (const k of Object.keys(map)) delete map[k];
        for (const [metric, h] of Object.entries(opts.mapping.metrics || {})) if (h && METRICS[metric]) map[h] = { metric, kg: !!(opts.mapping.kg && opts.mapping.kg[metric]) };
      }
      if (!dateKey) return { days, metrics: [], skipped: objects.length, error: "No date column found" };
      for (const o of objects) {
        const dt = parseDateTime(o[dateKey]);
        if (!dt) { skipped++; continue; }
        for (const [h, c] of Object.entries(map)) {
          let v = num(o[h]);
          if (v === undefined) continue;
          if (c.kg) v = +(v * LB_PER_KG).toFixed(1);
          if (c.metric === "weight" && v <= 0) continue;
          addDayValue(days, dt.date, c.metric, v, METRICS[c.metric].agg);
        }
      }
    }
    const metrics = [...new Set(Object.values(days).flatMap((r) => Object.keys(r)))];
    return { days, metrics, skipped };
  }

  /** Merge several parsed sheets (e.g. a multi-sheet MacroFactor export). */
  function mergeDays(...parts) {
    const out = {};
    for (const p of parts) for (const [d, rec] of Object.entries(p || {})) Object.assign(out[d] || (out[d] = {}), rec);
    return out;
  }

  /** Decide what a parsed table is. */
  function detectTable(objects) {
    if (!objects.length) return { kind: "empty" };
    const headers = Object.keys(objects[0]);
    if (isHevyHeader(headers)) return { kind: "hevy" };
    if (isLongFormat(headers)) return { kind: "daily" };
    const cls = headers.map(classifyHeader).filter(Boolean);
    if (cls.some((c) => c.metric === "date") && cls.some((c) => c.metric !== "date")) return { kind: "daily" };
    return { kind: "unknown", headers };
  }

  // ------------------------------------------------------------ exercises

  const LEG_RE = /squat|leg press|leg extension|leg curl|hamstring|lunge|\brdl\b|romanian|deadlift|calf|hip thrust|glute|hack|pendulum|step[- ]?up|adduct|abduct|tibia|quad|sissy|belt squat|good morning|nordic/i;
  const CARDIO_RE = /norwegian|4\s?x\s?4|hyrox|vo2|v02|interval|treadmill|running|\brun\b|ski ?erg|assault|air bike|cycling|stair|elliptical|rowing machine|\berg\b|zone 2|cardio/i;

  const isLegExercise = (name) => LEG_RE.test(name || "");
  const isCardioName = (name) => CARDIO_RE.test(name || "");
  const isCardioWorkout = (w) => !!(w && (w.tags || []).includes("vo2")) || isCardioName(w && w.title) || (w && (w.exercises || []).some((e) => isCardioName(e.name)));

  function exerciseMatcher(pattern) {
    if (pattern instanceof RegExp) return (n) => pattern.test(n || "");
    let re;
    try { re = new RegExp(pattern, "i"); } catch (_) { re = new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
    return (n) => re.test(n || "");
  }

  /** Epley estimate; only meaningful for 1-12 reps with weight. */
  const e1rm = (w, r) => (w > 0 && r > 0 && r <= 12 ? w * (1 + r / 30) : undefined);

  function topSet(sets) {
    let best = null;
    for (const s of sets || []) {
      if (s.type === "warmup") continue;
      if (s.w === undefined) continue;
      if (!best || s.w > best.w || (s.w === best.w && (s.r || 0) > (best.r || 0))) best = s;
    }
    return best;
  }

  // -------------------------------------------------------------- metrics

  /** values: [{date, value}] sorted. Simple mean of present values. */
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

  function series(days, metric, from, toExclusive) {
    const out = [];
    for (const d of dateRange(from, toExclusive)) {
      const v = days && days[d] ? days[d][metric] : undefined;
      out.push({ date: d, value: v });
    }
    return out;
  }

  /**
   * Exponentially smoothed trend weight (MacroFactor-style idea, simpler
   * maths): alpha 0.1 per day, gaps filled by carrying the trend forward.
   * Returns [{date, trend, scale}] from the first weigh-in to `until`.
   */
  function trendWeight(days, until, alpha = 0.1) {
    const dates = Object.keys(days || {}).filter((d) => days[d].weight !== undefined).sort();
    if (!dates.length) return [];
    const out = [];
    let t;
    for (const d of dateRange(dates[0], addDays(until || dates[dates.length - 1], 1))) {
      const s = days[d] ? days[d].weight : undefined;
      if (s !== undefined) t = t === undefined ? s : t + alpha * (s - t);
      out.push({ date: d, trend: t, scale: s });
    }
    return out;
  }

  /** Weekly rate of change of the trend over the last `span` days (lb/week). */
  function trendRate(trend, span = 21) {
    if (trend.length < 8) return undefined;
    const end = trend[trend.length - 1];
    const startIdx = Math.max(0, trend.length - 1 - span);
    const start = trend[startIdx];
    const n = trend.length - 1 - startIdx;
    if (!n || start.trend === undefined) return undefined;
    return ((end.trend - start.trend) / n) * 7;
  }

  /**
   * Coverage: the last date we know a source has reported through.
   * `coverage` is {workouts?: date, steps?: date, calories?: date, weight?: date}.
   * A window day after the coverage date is "unknown", not "missed".
   */
  function coveredUntil(coverage, key, days) {
    if (coverage && coverage[key]) return coverage[key];
    // Fall back to the last date that has a value.
    if (days) {
      const ds = Object.keys(days).filter((d) => days[d][key] !== undefined).sort();
      return ds.length ? ds[ds.length - 1] : null;
    }
    return null;
  }

  /**
   * Summary for one person over [from, toExclusive).
   * person: {days, workouts, coverage, targets}
   */
  function windowSummary(person, from, toExclusive) {
    const days = person.days || {};
    const cov = person.coverage || {};
    const dates = dateRange(from, toExclusive);
    const out = { from, to: toExclusive, nDays: dates.length };

    const workouts = (person.workouts || []).filter((w) => w.date >= from && w.date < toExclusive);
    const wCov = coveredUntil(cov, "workouts");
    out.workouts = {
      hasSource: !!(wCov || (person.workouts || []).length),
      coveredThrough: wCov,
      count: workouts.length,
      list: workouts,
      cardio: workouts.filter(isCardioWorkout).length,
      legsFirst: workouts.filter((w) => w.exercises && w.exercises.length && isLegExercise(w.exercises[0].name)).length,
      withLegs: workouts.filter((w) => (w.exercises || []).some((e) => isLegExercise(e.name))).length,
    };

    for (const metric of ["steps", "calories", "protein"]) {
      const c = coveredUntil(cov, metric, days);
      const vals = dates.map((d) => (days[d] ? days[d][metric] : undefined)).filter((v) => v !== undefined);
      const knownDays = c ? dates.filter((d) => d <= c).length : 0;
      out[metric] = { avg: mean(vals), n: vals.length, knownDays, coveredThrough: c, max: vals.length ? Math.max(...vals) : undefined };
    }
    const tgt = person.targets || {};
    if (tgt.calories_daily_max && out.calories.n) {
      out.calories.underMax = dates.filter((d) => days[d] && days[d].calories !== undefined && days[d].calories <= tgt.calories_daily_max).length;
    }

    const weighIns = dates.filter((d) => days[d] && days[d].weight !== undefined);
    const tw = trendWeight(days, addDays(toExclusive, -1));
    const twIn = tw.filter((p) => p.date >= from && p.date < toExclusive && p.trend !== undefined);
    const lastScaleDate = Object.keys(days).filter((d) => d < toExclusive && days[d].weight !== undefined).sort().pop();
    const mfTrend = dates.map((d) => days[d] && days[d].trend_weight).filter((v) => v !== undefined);
    out.weight = {
      weighIns: weighIns.length,
      knownDays: (() => { const c = coveredUntil(cov, "weight", days); return c ? dates.filter((d) => d <= c).length : 0; })(),
      latest: lastScaleDate ? { date: lastScaleDate, value: days[lastScaleDate].weight } : undefined,
      trend: mfTrend.length ? mfTrend[mfTrend.length - 1] : twIn.length ? twIn[twIn.length - 1].trend : undefined,
      trendSource: mfTrend.length ? "app" : "computed",
      rate: trendRate(tw.filter((p) => p.date < toExclusive)),
    };
    return out;
  }

  /** Per-week buckets for the last `n` weeks ending with the week containing `endDate`. */
  function weeklyBuckets(person, endDate, n, startDow = 1) {
    const out = [];
    const last = weekStart(endDate, startDow);
    for (let i = n - 1; i >= 0; i--) {
      const ws = addDays(last, -7 * i);
      const we = addDays(ws, 7);
      const s = windowSummary(person, ws, we);
      out.push({ weekStart: ws, workouts: s.workouts.count, cardio: s.workouts.cardio, steps: s.steps.avg, calories: s.calories.avg, partial: we > addDays(endDate, 1) });
    }
    return out;
  }

  /** Days logged in a row ending at `date` (or the day before if today isn't logged yet). */
  function streak(days, metric, date) {
    let d = days[date] && days[date][metric] !== undefined ? date : addDays(date, -1);
    let n = 0;
    while (days[d] && days[d][metric] !== undefined) { n++; d = addDays(d, -1); }
    return n;
  }

  // ---------------------------------------------------------- commitments

  /**
   * Evaluate one commitment check against a person's data.
   * Returns {status, value, text}; status is one of
   *   met | partial | missed | nodata | manual
   * "nodata" is shown neutral and never counts against anyone.
   */
  function evaluateCheck(check, person, from, toExclusive) {
    if (!check || !check.kind || check.kind === "manual") return { status: "manual", text: "Tick during the call" };
    const p = check.params || {};
    const wFrom = p.from || from;
    const wTo = p.by ? (addDays(p.by, 1) < toExclusive ? addDays(p.by, 1) : toExclusive) : toExclusive;
    const days = person.days || {};
    const cov = person.coverage || {};
    const inWin = (person.workouts || []).filter((w) => w.date >= wFrom && w.date < wTo);
    const wCov = coveredUntil(cov, "workouts");
    const hasWorkoutData = !!(wCov && wCov >= wFrom) || inWin.length > 0;
    const known = (key) => { const c = coveredUntil(cov, key, days); return c ? dateRange(wFrom, wTo).filter((d) => d <= c) : []; };
    const ratio = (a, b) => `${a} of ${b}`;
    const grade = (share, partialFloor = 0) => (share >= 1 ? "met" : share > partialFloor ? "partial" : "missed");

    switch (check.kind) {
      case "workout_count": {
        if (!hasWorkoutData) return { status: "nodata", text: "No workout data for this week yet" };
        const n = inWin.length, min = p.min || 1;
        return { status: n >= min ? "met" : n > 0 ? "partial" : "missed", value: n, text: `${ratio(n, min)} workouts` };
      }
      case "cardio_count": {
        if (!hasWorkoutData) return { status: "nodata", text: "No workout data for this week yet" };
        const n = inWin.filter(isCardioWorkout).length, min = p.min || 1;
        return { status: n >= min ? "met" : n > 0 ? "partial" : "missed", value: n, text: `${ratio(n, min)} conditioning sessions` };
      }
      case "workout_time_window": {
        const timed = inWin.filter((w) => w.time);
        if (!timed.length) return { status: "nodata", text: hasWorkoutData ? "No timed sessions yet" : "No workout data for this week yet" };
        const ok = timed.filter((w) => w.time >= (p.start || "00:00") && w.time < (p.end || "24:00")).length;
        return { status: grade(ok / timed.length), value: ok, text: `${ratio(ok, timed.length)} sessions started ${p.label || "in the window"}` };
      }
      case "legs_first": {
        const ordered = inWin.filter((w) => w.exercises && w.exercises.length);
        if (!ordered.length) return { status: "nodata", text: hasWorkoutData ? "No sessions with exercises yet" : "No workout data for this week yet" };
        const ok = ordered.filter((w) => isLegExercise(w.exercises[0].name)).length;
        return { status: grade(ok / ordered.length), value: ok, text: `${ratio(ok, ordered.length)} sessions opened with legs` };
      }
      case "exercise_absent": {
        const withEx = inWin.filter((w) => w.exercises && w.exercises.length);
        if (!withEx.length) return { status: "nodata", text: hasWorkoutData ? "No sessions with exercises yet" : "No workout data for this week yet" };
        const m = exerciseMatcher(p.pattern);
        const hits = withEx.filter((w) => w.exercises.some((e) => m(e.name))).length;
        return { status: hits ? "missed" : "met", value: hits, text: hits ? `Still in ${hits} session${hits > 1 ? "s" : ""}` : `Gone from all ${withEx.length} sessions` };
      }
      case "exercise_present": {
        const withEx = inWin.filter((w) => w.exercises && w.exercises.length);
        if (!withEx.length) return { status: "nodata", text: hasWorkoutData ? "No sessions with exercises yet" : "No workout data for this week yet" };
        const m = exerciseMatcher(p.pattern);
        const hits = withEx.filter((w) => w.exercises.some((e) => m(e.name))).length;
        const min = p.min || 1;
        return { status: hits >= min ? "met" : hits > 0 ? "partial" : "missed", value: hits, text: `In ${ratio(hits, withEx.length)} sessions` };
      }
      case "weigh_in_days":
      case "logging_days": {
        const metric = check.kind === "weigh_in_days" ? "weight" : "calories";
        const kd = known(metric);
        if (!kd.length) return { status: "nodata", text: metric === "weight" ? "No weight data for this week yet" : "No food log data for this week yet" };
        const n = kd.filter((d) => days[d] && days[d][metric] !== undefined).length;
        const need = p.min ? Math.min(p.min, kd.length) : Math.ceil(kd.length * (p.share || 1));
        return { status: n >= need ? "met" : n > 0 ? "partial" : "missed", value: n, text: `${ratio(n, kd.length)} days ${metric === "weight" ? "weighed in" : "logged"}` };
      }
      case "steps_avg_min": {
        const vals = dateRange(wFrom, wTo).map((d) => days[d] && days[d].steps).filter((v) => v !== undefined);
        if (!vals.length) return { status: "nodata", text: "No step data for this week yet" };
        const avg = mean(vals);
        return { status: avg >= p.min ? "met" : avg >= p.min * 0.85 ? "partial" : "missed", value: avg, text: `${Math.round(avg).toLocaleString("en-US")} avg (${vals.length} days)` };
      }
      case "calories_avg_max": {
        const vals = dateRange(wFrom, wTo).map((d) => days[d] && days[d].calories).filter((v) => v !== undefined);
        if (!vals.length) return { status: "nodata", text: "No food log data for this week yet" };
        const avg = mean(vals);
        return { status: avg <= p.max ? "met" : avg <= p.max * 1.08 ? "partial" : "missed", value: avg, text: `${Math.round(avg).toLocaleString("en-US")} kcal avg (${vals.length} days logged)` };
      }
      case "calories_daily_max": {
        const ds = dateRange(wFrom, wTo).filter((d) => days[d] && days[d].calories !== undefined);
        if (!ds.length) return { status: "nodata", text: "No food log data for this week yet" };
        const ok = ds.filter((d) => days[d].calories <= p.max).length;
        return { status: grade(ok / ds.length), value: ok, text: `${ratio(ok, ds.length)} logged days under ${p.max.toLocaleString("en-US")}` };
      }
      default:
        return { status: "manual", text: "Tick during the call" };
    }
  }

  /** Apply a manual override from the call ("met" | "missed" | "skip"). */
  function commitmentStatus(c, person, from, toExclusive) {
    const auto = evaluateCheck(c.check, person, from, toExclusive);
    if (c.override === "met" || c.override === "missed") return { ...auto, status: c.override, overridden: true };
    if (c.override === "skip") return { ...auto, status: "skip", overridden: true };
    return auto;
  }

  // ------------------------------------------------------- gemini notes

  /**
   * Pull the structured bits out of a Google Meet "Notes by Gemini" export.
   * Deterministic: date, attendees line, summary, decisions, next steps.
   */
  function parseGeminiNotes(text) {
    const src = String(text || "").replace(/\\([[\]\-_*#])/g, "$1");
    const lines = src.split(/\r?\n/);
    let date = null;
    for (const l of lines.slice(0, 40)) {
      const m = l.match(/([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})/);
      if (m) { const p = parseDateTime(m[1]); if (p) { date = p.date; break; } }
    }
    const steps = [];
    const seen = new Set();
    for (const l of lines) {
      const m = l.match(/^\s*[-*]\s*\[[ xX]?\]\s*\[([^\]]+)\]\s*(.+?)\s*$/);
      if (!m) continue;
      const owner = m[1].trim();
      let body = m[2].replace(/\s+$/, "");
      let title = body, detail = "";
      const c = body.match(/^([^:]{2,80}):\s*(.+)$/);
      if (c) { title = c[1].trim(); detail = c[2].trim(); }
      const key = owner.toLowerCase() + "|" + title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      steps.push({ owner, title, detail });
    }
    // Decisions: bold lead-ins under a "Decisions" heading.
    const decisions = [];
    const di = lines.findIndex((l) => /^#+\s*\**decisions\**/i.test(l.trim()));
    if (di >= 0) {
      for (let i = di + 1; i < lines.length; i++) {
        const l = lines[i].trim();
        if (/^#+\s*\**(next steps|details)\**/i.test(l)) break;
        const m = l.match(/^[-*]\s*\*\*(.+?)\*\*\s*(.*)$/);
        if (m) decisions.push({ title: m[1].trim(), detail: m[2].trim() });
      }
    }
    // Summary: first non-empty paragraph after a "Summary" heading, else the first plain line after the title.
    let summary = "";
    const si = lines.findIndex((l) => /^#+\s*\**summary\**/i.test(l.trim()));
    if (si >= 0) for (let i = si + 1; i < lines.length; i++) { const l = lines[i].trim(); if (l && !l.startsWith("#")) { summary = l.replace(/\*\*/g, ""); break; } }
    const title = (lines.find((l) => /^#+\s*\*\*.+\*\*\s*$/.test(l.trim())) || "").replace(/[#*]/g, "").trim() || "Check-in";
    return { date, title, summary, decisions, nextSteps: steps };
  }

  /** Match an owner label from the notes ("Abdul Ahmed") to a person id. */
  function resolveOwner(label, people) {
    const l = norm(label);
    for (const [id, p] of Object.entries(people || {})) {
      const names = [id, p.name, ...(p.aliases || [])].map(norm).filter(Boolean);
      if (names.some((n) => n === l || l.startsWith(n + " ") || n.startsWith(l + " "))) return id;
    }
    return null;
  }

  const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };

  /**
   * Guess an automatic check for a commitment from its wording.
   * Anything we can't recognise becomes a manual tick, never a miss.
   */
  function suggestCheck(title, detail, checkinDate) {
    const t = `${title} ${detail || ""}`.toLowerCase();
    const n = (() => { const m = t.match(/\b(\d+|one|two|three|four|five|six|seven)\s+(?:workouts?|sessions?|times)/); return m ? +m[1] || WORD_NUM[m[1]] : null; })();
    const byFriday = /before (?:leaving .*?)?(?:on )?(mon|tue|wed|thu|fri|sat|sun)/.exec(t);
    const nextDow = (abbr) => {
      const target = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(abbr);
      let d = addDays(checkinDate, 1);
      while (dow(d) !== target) d = addDays(d, 1);
      return addDays(d, -1); // "before Friday" = through Thursday
    };
    const remove = /\b(remove|drop|eliminate|stop|cut)\b/.test(t);
    const patterns = [
      [/serratus/, "serratus"], [/wrist/, "wrist"], [/leg press/, "leg press"],
      [/romanian|\brdl/, "romanian|rdl"], [/hack squat/, "hack squat"], [/pistol/, "pistol"],
    ];
    if (/legs? (?:training |exercises? )?(?:as the )?first|first activity|start(?:ing)? with legs|legs first/.test(t)) return { kind: "legs_first" };
    if (remove) for (const [re, pat] of patterns) if (re.test(t)) return { kind: "exercise_absent", params: { pattern: pat } };
    if (/\b(add|include|switch|replace|start)\b/.test(t)) {
      const order = /replace .*? with (.+)$/.exec(t);
      const scope = order ? order[1] : t;
      for (const [re, pat] of patterns) if (re.test(scope)) return { kind: "exercise_present", params: { pattern: pat } };
    }
    if (/weigh|body weight|record weight/.test(t)) return { kind: "weigh_in_days", params: { share: 1 } };
    if (/(track|log|record).*(food|calori|intake|consum)|(food|calori).*(track|log)/.test(t)) return { kind: "logging_days", params: { share: 1 } };
    if (/morning/.test(t) && /workout|gym|train/.test(t)) return { kind: "workout_time_window", params: { start: "05:00", end: "11:00", label: "in the morning" } };
    const steps = t.match(/(\d{1,2}(?:,\d{3}|k|000))\s*steps?/);
    if (steps) { const v = steps[1].endsWith("k") ? parseInt(steps[1]) * 1000 : num(steps[1]); return { kind: "steps_avg_min", params: { min: v } }; }
    if (n && /workout|session/.test(t)) {
      const params = { min: n };
      if (byFriday && checkinDate) { params.from = addDays(checkinDate, 1); params.by = nextDow(byFriday[1]); }
      return { kind: "workout_count", params };
    }
    return { kind: "manual" };
  }

  // ------------------------------------------------- month-bucket storage

  /**
   * Days and workouts are stored one document per person per month to
   * keep the number of writes small. These helpers convert between the
   * flat in-memory shape and those buckets.
   */
  const monthOf = (date) => date.slice(0, 7);

  function bucketDays(days, src) {
    const out = {};
    for (const [d, rec] of Object.entries(days)) {
      const m = monthOf(d);
      const b = out[m] || (out[m] = {});
      const r = { ...rec };
      if (src) r.src = Object.fromEntries(Object.keys(rec).map((k) => [k, src]));
      b[d] = r;
    }
    return out;
  }

  const workoutId = (w) => `${w.date}_${(w.time || "0000").replace(":", "")}_${norm(w.title).replace(/ /g, "-").slice(0, 24) || "workout"}`;

  function bucketWorkouts(workouts) {
    const out = {};
    for (const w of workouts) {
      const m = monthOf(w.date);
      (out[m] || (out[m] = {}))[workoutId(w)] = w;
    }
    return out;
  }

  return {
    // dates
    parseDateTime, parseTime, addDays, daysBetween, dow, weekStart, dateRange, todayLocal, fmtDate, DOW_SHORT, MON_SHORT,
    // parsing
    parseCSV, rowsToObjects, num, norm, parseHevy, isHevyHeader, parseDailyTable, mergeDays, detectTable, classifyHeader, METRICS,
    // exercises
    isLegExercise, isCardioName, isCardioWorkout, exerciseMatcher, e1rm, topSet,
    // metrics
    mean, series, trendWeight, trendRate, windowSummary, weeklyBuckets, streak, coveredUntil,
    // commitments
    evaluateCheck, commitmentStatus, parseGeminiNotes, resolveOwner, suggestCheck,
    // storage
    monthOf, bucketDays, bucketWorkouts, workoutId,
  };
});
