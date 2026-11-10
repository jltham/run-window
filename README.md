# Run Window

A Singapore runner's go / no-go: will conditions stay safe for my *whole* run, and if not now, when?
It checks NEA nowcasts, live rainfall and PM2.5, plus Open-Meteo hourly forecasts, against my own limits.

**Use it:** https://jltham.github.io/run-window/

## How it works

- Fetches live data every time the page opens, when you tap refresh, or when you pull down from the top.
- Shows a Go / Caution / No-go verdict for your area and run length, the best start time in the next 12 hours,
  an hour-by-hour strip and a map of all 47 NEA areas.
- "Use my location" picks your nearest NEA area (your location stays in the browser).
- If live data can't be reached, it shows the last data it got (or the saved snapshot) and says how old it is.

## What's here

| Path | What it is |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | The agreed spec: problem, metrics, risks, decision rules, screen, stack |
| [`showcase/run-window.html`](showcase/run-window.html) | The app (single page) |
| [`showcase/data.json`](showcase/data.json) | Saved data snapshot, used only when live data can't be fetched (for example inside a Claude artifact) |
| [`showcase/snapshot.mjs`](showcase/snapshot.mjs) | Script that refreshes the saved snapshot |

## Refresh the saved snapshot

Needs Node 18+ (uses built-in `fetch`). No API keys. Run from this folder:

```bash
node showcase/snapshot.mjs
```

## Data sources

- [NEA via data.gov.sg](https://data.gov.sg): 2-hour nowcast, rainfall, PM2.5
- [Open-Meteo](https://open-meteo.com): hourly forecast and air quality (CC BY 4.0)
- Coastline: Natural Earth (public domain), simplified
