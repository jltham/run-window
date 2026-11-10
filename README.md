# Run Window

A Singapore runner's go / no-go: will conditions stay safe for my *whole* run, and if not now, when?
It checks NEA nowcasts, live rainfall and PM2.5, plus Open-Meteo hourly forecasts, against my own limits.

**Status:** spec agreed, showcase built, real app not built yet.

## What's here

| Path | What it is |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | The agreed spec: problem, metrics, risks, decision rules, screen, stack |
| [`showcase/run-window.html`](showcase/run-window.html) | Interactive Singapore map showing Go / Caution / No-go for each NEA area |
| [`showcase/data.json`](showcase/data.json) | A saved snapshot of real NEA + Open-Meteo data that the showcase reads |
| [`showcase/snapshot.mjs`](showcase/snapshot.mjs) | Script that pulls a fresh snapshot |

## Refresh the snapshot

Needs Node 18+ (uses built-in `fetch`). No API keys. Run from this folder:

```bash
node showcase/snapshot.mjs
```

## Data sources

- [NEA via data.gov.sg](https://data.gov.sg): 2-hour nowcast, rainfall, PM2.5
- [Open-Meteo](https://open-meteo.com): hourly forecast and air quality (CC BY 4.0)
- Coastline: Natural Earth (public domain), simplified
