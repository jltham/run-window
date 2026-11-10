# Run Window — Spec

> Status: agreed (grilling session, 2026-11-10). This is the source of truth for building. Nothing is built yet.

**One line:** A phone-first web app that tells a Singapore runner, in one glance, whether conditions will stay safe for their *whole* planned run, now, and when the best window is in the next 24 hours.

---

## 1. Problem

### Five Whys

1. **Why do I skip or doubt long runs?** I can't tell whether the *whole* run will stay dry and safe.
2. **Why not?** Weather apps give a point-in-time or region-wide forecast, not *my spot, for my run's length*.
3. **Why is that worse in Singapore?** Convective showers form fast and very locally.
4. **Why does being wrong hurt?** On a 2–3 h run I'm far from home and shelter, so getting caught costs a lot.
5. **Why do I still check several apps?** No single app answers "is my whole run safe?", so I piece it together myself.

**Root cause we can act on (#2 + #5):** there's no single verdict that covers the whole run length for one spot. #3 is nature, so the app's job there is to **be honest about uncertainty**.

**Main problem:** committing to long runs. **Side benefit:** checking fewer apps.

### Problem statement (4Cs)

| | |
|---|---|
| **Clarity** | As a Singapore runner, I can't quickly tell whether conditions will stay safe for my whole planned run. |
| **Consequence** | I skip or cut short long runs, or I get caught in storms or haze far from home. |
| **Cause** | Existing apps give regional snapshots, not a verdict for my run's length against my own limits. |
| **Confirmation** | 2-week baseline log before building, one line per run day: apps checked, and skipped / shortened / caught, and why. |

### Today's behaviour
I look at the sky, think about how I feel, open a weather app, and make a gut call.

---

## 2. Audience & scope

- **Primary user:** me, a runner in Singapore who starts most runs from the same place.
- **Shareable:** anyone can open the public URL and set their own area, thresholds and run hours. Settings are kept in their browser.
- **Not doing:** accounts, a backend, push alerts, support for places outside Singapore, judging how I feel (sleep, fatigue, soreness). The app judges **conditions only**, and I stay the final judge.

## 3. Existing solutions & the gap

| Solution | What it does | Gap |
|---|---|---|
| IQAir AirVisual | Weather + AQI together, hourly AQI forecast | Raw data, no verdict for a run |
| Apple / Google Weather | Forecast with AQI | Region-wide, no run-length window, no personal limits |
| Garmin / Coros / Strava | Weather on the device, readiness scores | Readiness ≠ conditions over the next N minutes |
| Running-weather apps | Score conditions for running | Generic limits, a single moment, weak Singapore nowcasting |

**Gap:** a **localised Go / Caution / No-go for the whole run length**, using **my limits**, with a **best window** and an **honest confidence label**.

---

## 4. Success metrics

### SMART
- **Lagging (real outcome):** long runs (≥ 90 min) finished per month **rise compared with the 2-week baseline**, and **zero thunderstorm encounters on a Go verdict**, measured over the 4 weeks after launch.
- **Leading (early signal):** the app is the **only** thing I check before **≥ 80%** of runs, and I reach a **decision in < 10 s**.

**Measurement:** an optional one-tap "Did you go? Stayed dry?" prompt after a suggested window, saved in browser storage. No analytics service.

### Value-Cost Ratio
- **Value:** a few minutes saved per day, avoided ruined long runs, and learning.
- **Cost:** build hours, plus fixing it when NEA or Open-Meteo change their APIs.
- **Budget:** **v1 is capped at about 2 weekends.** If it runs over, cut scope (settings UI, polish) before adding time.

---

## 5. Risks & de-risking

| Risk | Level | Response |
|---|---|---|
| **Technical:** free model forecasts + NEA nowcast can't predict Singapore rain 1–3 h ahead well enough | **High** | **Proof of concept first** (below) |
| Market: I won't trust the verdict over the sky | Low | I'm the user. Confidence labels earn trust. |
| Team | None | Solo |
| API change or outage | Medium | Adapters per source, clear error states, never default to Go |

### PoC: forecast back-test (stage 1)
- A Node + TypeScript script in `run-window/poc/`.
- Covers the **last ~60 days**, for my area, **only hours inside allowed run times**.
- **Forecast side:** Open-Meteo Historical Forecast API (`precipitation_probability`, `precipitation`, `weather_code`).
- **Actual side:** NEA rainfall (`/v2/real-time/api/rainfall?date=YYYY-MM-DD`, paginated, 5-min readings) from the station nearest my area, summed per hour. An hour counts as a **rain hour** if it has ≥ 0.5 mm.
- **Output:** a hit/miss table and, most importantly, the **"Go-hour stayed dry" rate**.
- **Decision rule:** if accuracy is **< ~70%**, change the design. Either shorten the outlook horizon or show only "Outlook: uncertain".
- **Caveat:** the archive keeps the *most recent* forecast for each hour (0–6 h ahead), so the result is a **best case** compared with the real 12 h outlook. A bad result here settles it. A good result is only suggestive.

---

## 6. Delivery stages

Each stage is usable on its own.

1. **PoC:** the forecast back-test script (§5).
2. **Now-verdict:** NEA nowcast + live rain + PM2.5 → Go / Caution / No-go for a run starting now, ≤ 120 min.
3. **Outlook:** Open-Meteo 24 h search, configurable length, confidence labels, "Leave by".
4. **Public-ready:** settings drawer, browser storage, error states, home-screen install, deploy.

Stage 2 alone replaces "look at the sky + weather app".

**Experience target:** v1 is **7★** (opens instantly with the last result while refreshing, plus "Leave by 6:10pm to finish dry"). v2 is **9★** ("90 min won't fit, 60 min will").

---

## 7. Data sources

All endpoints were checked on 2026-11-10. They return `access-control-allow-origin: *` and need **no API key**, so the browser can call them directly.

| Source | Endpoint | Used for | Granularity |
|---|---|---|---|
| NEA 2-hour nowcast | `https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast` | Thunderstorm / rain, now to +2 h | 47 named areas, updated about every 30 min |
| NEA rainfall | `https://api-open.data.gov.sg/v2/real-time/api/rainfall` | "Raining right now" at the nearest station | Station, 5-min readings |
| NEA PM2.5 | `https://api-open.data.gov.sg/v2/real-time/api/pm25` | PM2.5 now | 5 regions (N/S/E/W/Central), hourly |
| Open-Meteo forecast | `https://api.open-meteo.com/v1/forecast` (`hourly=precipitation_probability,apparent_temperature,weather_code`, `timezone=Asia/Singapore`, `forecast_days=3`, 28 hours used) | Heat index, rain probability, thunderstorm codes for 0–27 h | Model grid (~coarse), hourly |
| Open-Meteo air quality | `https://air-quality-api.open-meteo.com/v1/air-quality` (`hourly=pm2_5`) | PM2.5 outlook | Model grid, hourly |

Every source sits behind an **adapter** that returns normalised data with an `observedAt` / `issuedAt` timestamp, so another country's sources could be added later.

---

## 8. Decision rules

### Inputs
- **Area:** one NEA nowcast area, chosen from a list. A one-time "Use my location" button picks the nearest area. The area's coordinates give the Open-Meteo point, the nearest PM2.5 region and the nearest rain station.
- **Run length:** presets **45 / 60 / 90 / 120 / 180 min**, default **60**.
- **Allowed run hours** (defaults, editable). A run must fit **completely** inside one block.

| Days | Blocks | Reason |
|---|---|---|
| Mon–Fri | **05:30–08:30**, **18:00–19:30** | Office 09:00–18:00; finish before dinner |
| Sat–Sun | **06:00–11:30**, **15:00–19:30** | Lunch 12:00–13:30 + 90 min digestion buffer |

  So a 180-min run only fits on weekend mornings, and the app says so instead of suggesting something that can't work.

### Thresholds (defaults, editable)

Each value is the worst one across the whole run window.

| Factor | Go | Caution | No-go |
|---|---|---|---|
| Thunderstorm in window | none | — | **any (veto)** |
| Rain probability (max) | ≤ 30% | 31–60% | > 60% |
| Heat index / apparent temp (max) | ≤ 33 °C | > 33–38 °C | > 38 °C |
| PM2.5, 1-h µg/m³ (max) | ≤ 55 | 56–150 | **> 150 (veto)** |

(PM2.5 bands follow NEA's bands. In Singapore, heat is the factor that will push most suggestions to early morning and evening.)

### Combining sources (the worse one wins)
- **Thunderstorm:** NEA nowcast text containing "Thundery" for my area (within its valid period), **or** an Open-Meteo `weather_code` of 95 / 96 / 99 in any hour of the window → **No-go (veto)**.
- **Rain now:** the nearest NEA station's latest 5-min reading > 0 mm → the start-now verdict is **No-go** ("Raining at <station> now").
- **NEA nowcast rain words** (no thunder): "Heavy Rain" / "Heavy Showers" → No-go. Any other rain or shower wording → at least Caution.
- **Rain probability, heat:** Open-Meteo.
- **PM2.5:** NEA measured value for the current hour, Open-Meteo forecast for later hours.
- When two sources disagree, **the worse verdict wins**.

### Verdict
- Each factor is rated Go / Caution / No-go. **The overall verdict is the worst factor rating.**
- Every verdict comes with its **reasons**: the factor(s) that set it, with values (e.g. "Caution · heat index 36 °C at 07:00").

### Confidence label

| Label | When |
|---|---|
| **Verdict · high** | The whole run window falls inside NEA's 2-hour nowcast period |
| **Outlook · medium** | The window starts within 2–6 h |
| **Outlook · low** | The window starts 6 h or more ahead |

### Best-window search
- Try start times every **15 min** from now to +24 h, keeping only those where the whole run fits inside an allowed block.
- *Changed from +12 h on 2026-11-10:* a 12 h search run in the afternoon only reached the 18:00–19:30 weekday block, never the next morning, so the card kept saying "No safe window" on rainy evenings.
- Pick the best: **Go before Caution**, then **earliest**, then **lowest max heat index**. Never suggest a No-go window.
- **"Leave by"** = the latest start in the same unbroken run of Go start times as the pick.
- If nothing fits: "No window fits a 180-min run in the next 24 h. Next allowed block: Sat 06:00."

### Missing or stale data
- **Never default to Go.**
- If a **veto factor is missing** (thunderstorm or PM2.5): **no verdict** → "Can't confirm: PM2.5 data unavailable (NEA)".
- If a **non-veto factor is missing** (heat or rain probability): show the verdict with a **warning badge** on that factor.
- Data **older than 2 h** counts as missing. Every source always shows its **"as of" time**.
- If everything fails: an error message naming each failed source, with a retry button.

---

## 9. Screen

One screen, no navigation, phone first, and it also works on desktop.

1. **Run length buttons:** 45 / 60 / 90 / 120 / 180
2. **"Start now" card:** a large Go / Caution / No-go, a one-line reason, and the confidence label
3. **"Best window" card:** "Leave by 6:10pm, finish dry", or why nothing fits
4. **12-hour strip:** each hour coloured by verdict, hours outside allowed run times greyed out. The best window can be further out than the strip (up to 24 h).
5. **Footer:** each source with its "as of" time, and a settings button (opens a drawer: area, thresholds, run hours)

**Loading:** show the last result from browser storage immediately, labelled "from 25 min ago, refreshing…", and replace it when fresh data arrives. If the refresh fails, show the error, and grey out the old verdict so it is never shown as current.

**Refresh:** on open, plus a manual refresh button. No background polling and no alerts.

## 10. Settings & storage
- Kept in `localStorage`: area, run length, thresholds, run hours, last result, and "did you go?" answers. Every read and write is wrapped in try/catch, with defaults used if storage is empty.
- No accounts and no server.

## 11. Tech
- **Vite + React + TypeScript**
- **The verdict engine is pure functions:** `(normalisedData, settings, runLength, now) → { startNow, bestWindow, hourly[] }`, **unit tested with Vitest**. Test cases: each threshold boundary, veto override, worse-source-wins, run spanning a block edge, stale and missing data, "nothing fits".
- Installable web app (manifest + service worker) so it can be added to the home screen.
- **Hosting:** Vercel (static).
- **Repo:** branch `feat/run-window`, folder `run-window/` (`docs/`, `poc/`, app source).

## 12. Distribution
- **Live app** (daily use): Vercel URL. Calls the APIs directly when opened.
- **Claude artifact** (showcase): a separate page with the problem, how the verdict works, an interactive demo on **sample data clearly labelled as sample**, and a link to the live app. An artifact can't call outside APIs (its security rules block `fetch` to other hosts), and it can't register a service worker, so it can't be the live app.

## 13. Decision log

| # | Decision |
|---|---|
| D1 | Real personal annoyance first, learning second |
| D2 | Audience: me; anyone can use the public URL with settings in their browser; no accounts |
| D3 | Judge the next run window and suggest the best one in the next 24 h |
| D4 | Fetch when opened; no polling for alerts |
| D5 | Factors: heat index, rain probability, PM2.5, thunderstorm veto |
| D6 | One saved location (an NEA area) |
| D7 | Configurable run length, default 60 |
| D8 | Singapore only; NEA + Open-Meteo combined, the worse one wins |
| D9 | Confidence labels by how far ahead the window is |
| D10 | Three levels with vetoes; default thresholds as in §8 |
| D11 | Run only outside office hours and meal times (§8 defaults) |
| D12 | Data failures show errors; never default to Go |
| D13 | Conditions only; "how I feel" is out of scope |
| D14 | Web app for phone and desktop, installable |
| D15 | PoC back-test before building the UI |
| D16 | v1 targets 7★; v1 time budget about 2 weekends |
| D17 | Live app on Vercel; Claude artifact is a showcase with sample data |
