[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/giandisruw/token-radar-01-v3/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/giandisruw/token-radar-01-v3/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Launch Radar v3 — token-radar-01 improvement loop (built 2026-11-15)

Submitted 2026-11-18 as v3 (replaces the live v2 entry). Re-run 18 Nov (RunCrate): beats v2 16/20, beats starter 16/20.

## What changed vs v2

| | v2 | v3 |
|---|---|---|
| Anchor | flat category-median mcap/TVL (global median 0.2138) | log-log comps curve fitted at run time to the snapshot's own tokenised peers: log(mcap) = 6.965 + 0.522·log(TVL), clamped to [0.02, 1.50] |
| Validation | none | blind 70/30 hold-out, 5 fixed seeds, curve re-fitted on the 70% only: median error curve 88.6% vs flat median 88.8%, curve wins 5/5 seeds (median margin small — reported honestly in the dossier) |
| Farm plans | generic steps | 5 costed steps per protocol: per-step network fee + time from a stated gas table per chain and a capital tier by TVL; totals are the sums of the steps |
| Rows | 178 (40 watchlist + 138 early) | 240 (all 40 watchlist + top 200 other eligible pre-token; eligibility = house watchlist rule applied to early rows too) |
| Comps | category medians only | curve + size-bucket medians (0.419 / 0.131 / 0.032 / 0.044) + category medians shown in each detail view for comparison |

The curve matters because the snapshot's own peers say the mcap/TVL
multiple falls steeply with size: a flat anchor overvalues giants and
undervalues small protocols. The hold-out shows the curve does not
overfit (it wins 5/5 seeds, by a small median margin — not a blowout,
and the dossier says so).

## Files

- `main.ts` — entrypoint: reads the snapshot, writes `board.json`, `dashboard/data.js`, copies `dashboard/` + `screenshots/`, writes `dossier.json` via the kit's `buildDossier`. Deterministic (two runs byte-identical, verified).
- `lib/model.ts` — the whole model: curve fit, blind hold-out, implied value, eligibility rule, gas table, costed farm plans. No protocol name is hardcoded.
- `dashboard/index.html`, `app.css`, `app.js` — the page. `app.js` rebuilds each row's farm steps from the same templates as `lib/model.ts` (verified: all 240 rows identical to `board.json`).
- `dashboard/data.js` — generated at run time (compact rows + top-10 verbatim steps + validation numbers). Not shipped in the repo.
- `vendor/makefun-board.ts` — the kit's dossier library, copied byte-for-byte.
- `screenshots/` — 3 real renders (headless Chromium via Playwright, 1440×900): board, detail of rank #1 (Morpho Blue), watchlist-only filter. See `shoot.py`.
- `shoot.py` — screenshot helper (Python Playwright; `pip install playwright` + `playwright install chromium`).

## Verified locally

- 240 rows, ranks 1–240, implied values strictly non-increasing, watchlist 40/40, 0 farm-step violations (3–12 steps, 20–600 chars each).
- Dossier text 53,189 bytes (cap 65,536); dossier 1,290,263 bytes (cap 1.5 MiB).
- Determinism: two runs produce byte-identical output trees.
- Farm steps: client-side generator matches `board.json` on all 240 rows.
- Harness (2026-11-15 ~19:00–19:20 WIB): `run.py radar --entry … --anchors <kit>/starter:STARTER,<v1>:V1`.
  Three runs, all thinned by the Coarena vision judge returning almost no
  verdicts (FPS worker running concurrently; 2-concurrent account limit):
  run 1 (repeats=1): ENTRY 0.5375 [0.0644, 1.0000] > V1 0.5000 > STARTER 0.4625,
  5/6 calls no verdict, ENTRY 12/20 vs STARTER, 10/20 vs V1.
  Run 2 (repeats=2): LEG FAILED, 12/12 calls no verdict, no rates.
  Run 3 (repeats=1, after a 90 s wait): ENTRY 0.5562 [0.0854, 1.0000] > STARTER
  0.5000 > V1 0.4438, 5/6 calls no verdict, ENTRY 10/20 vs STARTER, 13/20 vs V1
  (one margin-3 verdict for ENTRY). ENTRY ranked #1 in both rated runs, but
  the 90% intervals span almost the whole [0, 1] range — NO separation from
  the anchors, and v2 itself was not an anchor in these runs, so v3-vs-v2
  is unproven on the judge. Verdict: NOT ready on judge evidence; re-test
  when the vision judge recovers. No blind rebuild was done (a rebuild with
  no judge signal would be guessing; v3 already implements all three top
  gap-analysis improvements).
- Astra leg: BLOCKED (Xingchi relay 403 client_not_allowed on all chat
  calls, both models, verified 18:47 WIB; still 403 after a key re-pair
  ~19:13 WIB). Gap analysis used Verboo (recovered from 503) + Coarena
  instead. No key reconnect was attempted.

## Known limits

- Gap analysis: Astra (Xingchi) chat refused every call with 403 on 2026-11-15 (models list still worked, so auth was fine; the chat route was the problem) and Verboo returned 503 at the same time. The gap analysis below uses Coarena as a substitute second opinion plus the measured snapshot numbers; the Astra step is still open.
- Transcript gate: NOT run here — no bundle was built (that is the parent's submit-time step). The code in this directory was written fresh in the build session (no v1/v2 entry file was read before writing it), so the authored-lines share should clear 30%, but that needs the parent's bundle + `run.py check` to confirm.
- The blind-test margin is small (88.6% vs 88.8% median). The curve's case rests on the size-bucket shape (0.419 → 0.032), not on a big hold-out win.
