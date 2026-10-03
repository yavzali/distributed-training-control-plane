# Check-in patterns

A running analysis of what the weekly calls actually cover, updated as each
Gemini transcript comes in. It decides what the dashboard shows and in what
order. Personal numbers stay in the dashboard's database, not in this file.

## Transcripts analysed

| Call | Length | Notes |
|---|---|---|
| 2026-10-03 | 55 min (target 30) | First call. Set the agenda and the 30-minute limit. |

## The agenda the calls follow

Each person goes through the same order. The dashboard's Overview mirrors it.

1. **Workouts**: sessions per week compared with the target; which days; whether legs got done; program changes (exercises added or removed); conditioning sessions.
2. **Steps**: daily values for last week, weekly and monthly averages, compared with a floor.
3. **Nutrition**: 7-day calorie average, the day-to-day spread, days logged and logging streak, a daily ceiling rule.
4. **Weight**: latest weigh-in, trend weight, rate per week, how many weigh-ins happened.
5. **Commitments**: "you said X, how did it go?", then next week's goals.

Long-term goals are context, not discussed weekly.

## Where call time went (2026-10-03)

| Segment | ~Min | What would help |
|---|---|---|
| Counting workouts per week from the app | 4 | Weekly bar chart vs target |
| Program redesign | 15 | Nothing; this is the useful discussion |
| Steps, weight, calories (incl. ~3 min hunting in the nutrition app) | 7 | KPI tiles: avg, target, days logged |
| Narrating a week of exercises | 9 | Session list with exercise names |
| Steps, diet, weight, travel risk | 11 | KPI tiles + commitments |
| Goals and wrap-up | 9 | Commitments carried over automatically |

About 15 of 55 minutes were reading numbers out loud.

## Recurring questions

- How many times did I train each week this month?
- Did I do legs? Did I start with legs?
- What's my step average vs 10k?
- What's my 7-day calorie average, and how many days did I log?
- Did I stay under the daily ceiling?
- What's my trend weight and rate of loss?
- How many conditioning sessions over the last month? (Couldn't be answered on the call: the notes reset weekly. The dashboard keeps history.)
- What's my latest benchmark (a circuit time, a top set)?

## Commitments the data can check

| Commitment wording | Check |
|---|---|
| Remove/drop an exercise | `exercise_absent`: not in any session this week |
| Add/switch to an exercise | `exercise_present` |
| Legs first | `legs_first`: first exercise of each session is a leg movement |
| Work out in the morning | `workout_time_window` on session start times |
| N workouts (before a day) | `workout_count`, optionally with a date range |
| Weigh in every morning | `weigh_in_days` |
| Track food / log in real time | `logging_days` (days logged; timing isn't exported) |
| Step minimum | `steps_avg_min` |
| Calorie target / ceiling | `calories_avg_max` / `calories_daily_max` |
| Anything else | manual tick during the call |

A check with no data for the week shows "No data", never a miss. Days after a
source's last export count as unknown.

## Observations about the notes themselves

- Gemini's summary got several numbers wrong (mixed up goal and current weight,
  intake and expenditure, direction of a weight change). Numbers come from the
  apps; transcripts supply commitments, decisions and goals.
- The "Next steps" list is consistently formatted (`[Owner] Title: detail`),
  so it parses without an LLM.
