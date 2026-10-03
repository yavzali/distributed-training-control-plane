# Getting data into the dashboard

Everything goes in through the dashboard's **Add data** tab. Nothing here
needs a paid tier beyond the apps you already use. Add whatever you have; a
missing source shows as "no data" and never counts against you.

## Pre-call routine (about 2 minutes each)

| Who | Do this | Lands as |
|---|---|---|
| Yav | Hevy: export workouts as CSV, drop the file in | Workouts with sets, start times, exercise order |
| Yav | MacroFactor: export data (.xlsx or .csv), drop it in | Calories, macros, weight, trend weight |
| Yav | Run the Apple Health shortcut, drop the CSV in | Steps (and anything MacroFactor wrote to Health) |
| Abdul | Paste the week's workout notes, press "Read with Claude" | Workouts, plus benchmarks like circuit times |
| Abdul | Run the Apple Health shortcut, drop the CSV in | Steps, MyFitnessPal calories, weight |
| Either | No time? Screenshot Health / MyFitnessPal / the scale and add the screenshots | Whatever is visible |

Set "Exported on" to the export date so days after it count as unknown.

## Source notes

- **Hevy (free tier)**: the API needs Hevy Pro, but the in-app CSV export
  is free (look under Settings for export). The importer reads
  `weight_lbs` or `weight_kg`, keeps warm-up sets separate and records the
  order of exercises (that's how "legs first" is checked).
- **MacroFactor**: in-app data export. The importer reads every sheet of
  an .xlsx and matches columns by name (date, calories, protein, carbs, fat,
  weight, trend weight, expenditure, steps). Target/goal columns are ignored.
  If a column isn't recognised, "Let Claude map" asks Claude which column is
  which.
- **MyFitnessPal (free)**: CSV export is Premium-only, but MyFitnessPal
  writes nutrition to Apple Health for free. Turn that on in MyFitnessPal's
  Apple Health settings, then the Health shortcut picks it up.
- **Notes app workouts**: no structure needed. Claude converts the paste
  into sessions and sets; you check the rows and fix dates before saving.
- **Gemini notes**: paste on the **Check-ins** tab after each call. The
  "Next steps" list becomes the next week's commitments.

## Apple Health shortcut (build once per phone)

The shortcut writes a CSV with columns `date,metric,value,unit`, which the
importer reads directly. Build it in the Shortcuts app (not yet tested on a
device; adjust action names to what your iOS version shows):

1. New shortcut, name it **Check-in export**.
2. **Text** action with `date,metric,value,unit`. **Set Variable** `Rows` to it.
3. **Find Health Samples** where *Type* is *Steps*, *Start Date is in the
   last 35 days*, *Group By* *Day*, sorted by Start Date.
4. **Repeat with Each** sample:
   - **Format Date**: *Start Date* of Repeat Item, custom format `yyyy-MM-dd`.
   - **Text**: `<Formatted Date>,steps,<Value of Repeat Item>,count`
   - **Add to Variable** `Rows`.
5. Repeat steps 3–4 for *Dietary Energy* (metric `calories`, grouped by day)
   and *Weight* (metric `weight`, unit `lb`, no grouping).
6. **Combine Text** `Rows` with *New Lines*.
7. **Save File** to iCloud Drive as `checkin-health.csv` (overwrite on), or
   **Share** it straight to the dashboard on your laptop.

Optional: a Personal Automation (*Time of Day*, the morning of the call,
*Run Immediately*) saves the file before the call. The last step, dropping
the file onto the dashboard, stays manual: a phone can't push into the
dashboard's storage without a server, and a server would mean extra cost.

## Where the data lives

In the dashboard artifact's own database on claude.ai, private to the
artifact and the people it's shared with. Nothing personal goes in this
repository. Writes are grouped one document per person per month.
