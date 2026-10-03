# Training check-in dashboard

A weekly check-in dashboard for two people, shown on a shared screen during
the call. It pulls workouts, steps, calories and weight from whatever each
person tracks, scores last week's commitments from the data, and answers ad
hoc questions ("how many times did I do leg press this month?") as text or a
chart.

The dashboard runs as a private claude.ai artifact. Its data lives in the
artifact's database, not in this repo, and questions go to Claude on the
viewer's own Claude plan, so there is no API bill.

## Layout

| Path | What |
|---|---|
| `dashboard/index.html` | The artifact page (UI, charts, imports, Ask) |
| `dashboard/core.js` | Pure logic: parsers, metrics, commitment checks. Runs in the page and in Node |
| `tests/core.test.mjs` | Unit tests for `core.js` |
| `docs/checkin-patterns.md` | What the calls cover; updated as transcripts come in |
| `docs/data-sources.md` | How to export from each app, plus the Apple Health shortcut |

## Principles

- The dashboard supports the call; it should make it shorter, not longer.
- Partial data is fine. A missing source shows "no data" and never counts as a miss.
- Numbers come from the apps. Transcripts supply commitments, decisions and goals.
- No spend beyond existing subscriptions.

## Develop

```sh
node --test tests/*.test.mjs
```

Republish the artifact from a Claude Code session by publishing
`dashboard/index.html` with `core.js` as a supporting file, to the existing
artifact URL. Keep personal data (exports, transcripts) out of the repo;
`.gitignore` blocks the common export formats.
