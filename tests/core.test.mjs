import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const C = require("../dashboard/core.js");

test("parseDateTime handles the formats the sources export", () => {
  assert.deepEqual(C.parseDateTime("2026-10-03"), { date: "2026-10-03", time: null });
  assert.deepEqual(C.parseDateTime("2026-10-03T08:15:00Z"), { date: "2026-10-03", time: "08:15" });
  assert.deepEqual(C.parseDateTime("3 Oct 2026, 08:15"), { date: "2026-10-03", time: "08:15" });
  assert.deepEqual(C.parseDateTime("Oct 3, 2026 6:30 PM"), { date: "2026-10-03", time: "18:30" });
  assert.deepEqual(C.parseDateTime("10/3/2026"), { date: "2026-10-03", time: null });
  assert.deepEqual(C.parseDateTime("25/12/2026"), { date: "2026-12-25", time: null });
  assert.equal(C.parseDateTime("2026-02-30"), null);
  assert.equal(C.parseDateTime("hello"), null);
  // Excel serial for 2026-10-03
  assert.equal(C.parseDateTime(46298).date, "2026-10-03");
});

test("week helpers", () => {
  assert.equal(C.dow("2026-10-03"), 6); // Saturday
  assert.equal(C.weekStart("2026-10-03", 1), "2026-09-28");
  assert.equal(C.weekStart("2026-10-03", 0), "2026-09-27");
  assert.equal(C.weekStart("2026-10-04", 0), "2026-10-04");
  assert.equal(C.addDays("2026-10-30", 3), "2026-11-02");
  assert.equal(C.daysBetween("2026-10-01", "2026-10-08"), 7);
});

test("parseCSV handles quotes, commas and CRLF", () => {
  const rows = C.parseCSV('a,b\r\n"x, y","he said ""hi"""\r\n1,2\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'he said "hi"'], ["1", "2"]]);
});

const HEVY = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"
"Full Body A","5 Oct 2026, 08:20","5 Oct 2026, 09:10","","Leg Press (Machine)","","","0","warmup","180","10","","",""
"Full Body A","5 Oct 2026, 08:20","5 Oct 2026, 09:10","","Leg Press (Machine)","","","1","normal","270","8","","","8"
"Full Body A","5 Oct 2026, 08:20","5 Oct 2026, 09:10","","Incline Bench Press (Dumbbell)","","","0","normal","60","10","","",""
"Full Body C","7 Oct 2026, 19:40","7 Oct 2026, 20:30","","Lateral Raise (Dumbbell)","","","0","normal","20","12","","",""
"Full Body C","7 Oct 2026, 19:40","7 Oct 2026, 20:30","","Serratus Crunch","","","0","normal","","15","","",""`;

test("parseHevy groups sets into workouts and exercises", () => {
  const objs = C.rowsToObjects(C.parseCSV(HEVY));
  assert.equal(C.detectTable(objs).kind, "hevy");
  const ws = C.parseHevy(objs);
  assert.equal(ws.length, 2);
  assert.equal(ws[0].date, "2026-10-05");
  assert.equal(ws[0].time, "08:20");
  assert.equal(ws[0].exercises.length, 2);
  assert.equal(ws[0].exercises[0].sets.length, 2);
  assert.deepEqual(C.topSet(ws[0].exercises[0].sets), { type: "normal", w: 270, r: 8, rpe: 8 });
  assert.equal(ws[1].exercises[1].sets[0].w, undefined);
});

test("parseDailyTable reads wide exports and skips target columns", () => {
  const csv = `Date,Calories (kcal),Protein (g),Target Calories,Weight (lb),Trend Weight (lb)
2026-10-01,1850,160,1900,181.2,181.9
2026-10-02,2210,150,1900,,181.8
10/3/2026,,,1900,180.6,181.7`;
  const r = C.parseDailyTable(C.rowsToObjects(C.parseCSV(csv)));
  assert.deepEqual(r.days["2026-10-01"], { calories: 1850, protein: 160, weight: 181.2, trend_weight: 181.9 });
  assert.equal(r.days["2026-10-02"].weight, undefined);
  assert.deepEqual(r.days["2026-10-03"], { weight: 180.6, trend_weight: 181.7 });
});

test("parseDailyTable sums food entries and converts kg", () => {
  const csv = `Date,Meal,Calories,Body Weight (kg)
2026-10-01,Breakfast,400,
2026-10-01,Lunch,750,80`;
  const r = C.parseDailyTable(C.rowsToObjects(C.parseCSV(csv)));
  assert.equal(r.days["2026-10-01"].calories, 1150);
  assert.equal(r.days["2026-10-01"].weight, 176.4);
});

test("parseDailyTable reads long format from the Health shortcut", () => {
  const csv = `date,metric,value,unit
2026-10-01,steps,7000,count
2026-10-01,Dietary Energy,1700,kcal
2026-10-02,body mass,80,kg`;
  const objs = C.rowsToObjects(C.parseCSV(csv));
  assert.equal(C.detectTable(objs).kind, "daily");
  const r = C.parseDailyTable(objs);
  assert.equal(r.days["2026-10-01"].steps, 7000);
  assert.equal(r.days["2026-10-01"].calories, 1700);
  assert.equal(r.days["2026-10-02"].weight, 176.4);
});

test("unknown tables are reported with their headers", () => {
  const d = C.detectTable([{ foo: 1, bar: 2 }]);
  assert.equal(d.kind, "unknown");
  assert.deepEqual(d.headers, ["foo", "bar"]);
});

const NOTES = `## **Training Check In**

Oct 3, 2026
[A](mailto:a@example.com) [B](mailto:b@example.com)

### **Summary**

Weekly check-in covering workouts and nutrition.

### **Decisions**

## Aligned

* **Morning workouts** A will train in the morning.

* **Drop serratus** A removes the serratus exercise.

### **Next steps**

- [ ] \\[Alex\\] Remove Serratus: Eliminate the serratus exercise from the second workout plan.

- [ ] \\[Alex\\] Move Leg Training: Schedule leg exercises as the first activity in the workout routine.

- [ ] \\[Alex\\] Switch Leg Exercise: Replace free weight squat patterns with leg press movements.

- [ ] \\[Alex\\] Record Weight: Monitor body weight every morning.

- [ ] \\[Sam Lee\\] Complete Workouts: Complete 4 workouts before leaving for the conference on Friday.

- [ ] \\[Sam Lee\\] Track Calories: Track all food consumption throughout the trip.

- [ ] \\[Alex\\] Build Data Dashboard: Develop an AI interface.

### **Details**

- [ ] \\[Alex\\] Remove Serratus: Eliminate the serratus exercise from the second workout plan.
`;

test("parseGeminiNotes extracts date, decisions and de-duplicated next steps", () => {
  const n = C.parseGeminiNotes(NOTES);
  assert.equal(n.date, "2026-10-03");
  assert.equal(n.summary, "Weekly check-in covering workouts and nutrition.");
  assert.equal(n.decisions.length, 2);
  assert.equal(n.nextSteps.length, 7);
  assert.deepEqual(n.nextSteps[0], { owner: "Alex", title: "Remove Serratus", detail: "Eliminate the serratus exercise from the second workout plan." });
});

test("suggestCheck maps commitment wording to checks", () => {
  const n = C.parseGeminiNotes(NOTES);
  const kinds = n.nextSteps.map((s) => C.suggestCheck(s.title, s.detail, n.date));
  assert.deepEqual(kinds[0], { kind: "exercise_absent", params: { pattern: "serratus" } });
  assert.deepEqual(kinds[1], { kind: "legs_first" });
  assert.deepEqual(kinds[2], { kind: "exercise_present", params: { pattern: "leg press" } });
  assert.deepEqual(kinds[3], { kind: "weigh_in_days", params: { share: 1 } });
  assert.deepEqual(kinds[4], { kind: "workout_count", params: { min: 4, from: "2026-10-04", by: "2026-10-08" } });
  assert.deepEqual(kinds[5], { kind: "logging_days", params: { share: 1 } });
  assert.deepEqual(kinds[6], { kind: "manual" });
});

test("resolveOwner matches full names and aliases", () => {
  const people = { yav: { name: "Yav" }, abdul: { name: "Abdul", aliases: ["Abdul Ahmed"] } };
  assert.equal(C.resolveOwner("Abdul Ahmed", people), "abdul");
  assert.equal(C.resolveOwner("Yav", people), "yav");
  assert.equal(C.resolveOwner("Someone", people), null);
});

function person() {
  const ws = C.parseHevy(C.rowsToObjects(C.parseCSV(HEVY)));
  return {
    workouts: ws,
    coverage: { workouts: "2026-10-09" },
    days: {
      "2026-10-04": { steps: 12000, calories: 1800, weight: 166 },
      "2026-10-05": { steps: 9000, calories: 2300 },
      "2026-10-06": { steps: 11000, weight: 165.6 },
    },
    targets: { calories_daily_max: 2000 },
  };
}

test("evaluateCheck scores only what the data covers", () => {
  const p = person();
  const from = "2026-10-03", to = "2026-10-10";
  assert.equal(C.evaluateCheck({ kind: "legs_first" }, p, from, to).status, "partial");
  assert.equal(C.evaluateCheck({ kind: "exercise_absent", params: { pattern: "serratus" } }, p, from, to).status, "missed");
  assert.equal(C.evaluateCheck({ kind: "exercise_present", params: { pattern: "leg press" } }, p, from, to).status, "met");
  assert.equal(C.evaluateCheck({ kind: "workout_count", params: { min: 3 } }, p, from, to).text, "2 of 3 workouts");
  const morning = C.evaluateCheck({ kind: "workout_time_window", params: { start: "05:00", end: "11:00" } }, p, from, to);
  assert.equal(morning.value, 1);
  // Weight covered through Oct 6 (last value): days Oct 3-6 = 4 known days, 2 weigh-ins.
  const w = C.evaluateCheck({ kind: "weigh_in_days", params: { share: 1 } }, p, from, to);
  assert.equal(w.text, "2 of 4 days weighed in");
  assert.equal(w.status, "partial");
  const steps = C.evaluateCheck({ kind: "steps_avg_min", params: { min: 10000 } }, p, from, to);
  assert.equal(steps.status, "met");
  assert.equal(C.evaluateCheck({ kind: "calories_daily_max", params: { max: 2000 } }, p, from, to).text, "1 of 2 logged days under 2,000");
});

test("missing sources are 'nodata', never a miss", () => {
  const empty = { days: {}, workouts: [] };
  for (const kind of ["workout_count", "legs_first", "weigh_in_days", "logging_days", "steps_avg_min"]) {
    const r = C.evaluateCheck({ kind, params: { min: 3, share: 1, pattern: "x" } }, empty, "2026-10-03", "2026-10-10");
    assert.equal(r.status, "nodata", kind);
  }
  assert.equal(C.evaluateCheck({ kind: "manual" }, empty, "2026-10-03", "2026-10-10").status, "manual");
});

test("overrides win over automatic status", () => {
  const c = { check: { kind: "manual" }, override: "met" };
  assert.equal(C.commitmentStatus(c, { days: {} }, "2026-10-03", "2026-10-10").status, "met");
});

test("windowSummary and trend weight", () => {
  const p = person();
  const s = C.windowSummary(p, "2026-10-03", "2026-10-10");
  assert.equal(s.workouts.count, 2);
  assert.equal(s.workouts.legsFirst, 1);
  assert.equal(Math.round(s.steps.avg), 10667);
  assert.equal(s.calories.underMax, 1);
  assert.equal(s.weight.weighIns, 2);
  assert.equal(s.weight.latest.value, 165.6);
  const tw = C.trendWeight(p.days, "2026-10-06");
  assert.equal(tw.length, 3);
  assert.ok(Math.abs(tw[2].trend - 165.96) < 0.01);
});

test("weeklyBuckets and streak", () => {
  const p = person();
  const b = C.weeklyBuckets(p, "2026-10-09", 2, 1);
  assert.equal(b.length, 2);
  assert.equal(b[1].weekStart, "2026-10-05");
  assert.equal(b[1].workouts, 2);
  assert.equal(C.streak(p.days, "steps", "2026-10-07"), 3);
  assert.equal(C.streak(p.days, "calories", "2026-10-05"), 2);
});

test("month buckets keep ids stable", () => {
  const ws = C.parseHevy(C.rowsToObjects(C.parseCSV(HEVY)));
  const b = C.bucketWorkouts(ws);
  assert.deepEqual(Object.keys(b), ["2026-10"]);
  assert.deepEqual(Object.keys(b["2026-10"]), ["2026-10-05_0820_full-body-a", "2026-10-07_1940_full-body-c"]);
  const d = C.bucketDays({ "2026-09-30": { steps: 1 }, "2026-10-01": { steps: 2 } }, "apple_health");
  assert.deepEqual(d["2026-10"]["2026-10-01"], { steps: 2, src: { steps: "apple_health" } });
});
