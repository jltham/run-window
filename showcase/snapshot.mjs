// Saves a snapshot of live NEA + Open-Meteo data to data.json next to the page.
// The page uses it only when it can't fetch live data (for example inside a Claude artifact,
// which blocks requests to other sites). Uses the same normalise() as the page.
// Usage (from the run-window folder): node showcase/snapshot.mjs
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const E = createRequire(import.meta.url)("./engine.js");
const NEA = "https://api-open.data.gov.sg/v2/real-time/api";

async function get(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// Taken before any request, so "now" never runs ahead of the data it describes.
const fetchedAt = new Date();
const lats = E.AREAS.map((a) => a[1]).join(",");
const lons = E.AREAS.map((a) => a[2]).join(",");
const om = "&timezone=Asia%2FSingapore&forecast_days=3";

const [nowcast, rain, pm25, wx, aq] = await Promise.all([
  get(`${NEA}/two-hr-forecast`),
  get(`${NEA}/rainfall`),
  get(`${NEA}/pm25`),
  get(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=precipitation_probability,apparent_temperature,weather_code${om}`),
  get(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&hourly=pm2_5${om}`),
]);

const out = E.normalise(fetchedAt, nowcast, rain, pm25, wx, aq);
const file = join(dirname(fileURLToPath(import.meta.url)), "data.json");
await writeFile(file, JSON.stringify(out));
console.log(`Wrote ${file}: ${out.areas.length} areas, ${out.areas[0].hours.length} forecast hours from ${out.firstHour}, nowcast to ${out.nowcast?.validTo ?? "missing"}`);
