// Pulls a real snapshot of NEA + Open-Meteo data for every NEA nowcast area and writes data.json
// next to the showcase page. The Claude artifact can't call outside APIs, so it reads this file instead.
// Usage: node run-window/showcase/snapshot.mjs
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NEA = "https://api-open.data.gov.sg/v2/real-time/api";

async function get(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// Taken before any request, so "now" never runs ahead of the data it describes.
const fetchedAt = new Date();

const [nowcast, rain, pm25] = await Promise.all([
  get(`${NEA}/two-hr-forecast`),
  get(`${NEA}/rainfall`),
  get(`${NEA}/pm25`),
]);

const areas = nowcast.data.area_metadata.map((a) => ({
  name: a.name,
  lat: a.label_location.latitude,
  lon: a.label_location.longitude,
}));
// A source with no data is written as missing (null) rather than crashing the script;
// the page then shows "Can't confirm" for anything that depends on it.
const nc = nowcast.data.items?.[0] ?? null;
const ncText = Object.fromEntries((nc?.forecasts ?? []).map((f) => [f.area, f.forecast]));

const stations = (rain.data.stations ?? [])
  .filter((s) => s.location?.latitude != null)
  .map((s) => ({ id: s.id, name: s.name, lat: s.location.latitude, lon: s.location.longitude }));
const rainReading = rain.data.readings?.[0] ?? null;
const rainById = Object.fromEntries((rainReading?.data ?? []).map((d) => [d.stationId, d.value]));

const pmItem = pm25.data.items?.[0] ?? null;
const pmRegions = (pm25.data.regionMetadata ?? []).map((r) => ({ name: r.name, lat: r.labelLocation.latitude, lon: r.labelLocation.longitude }));
const pmByRegion = pmItem?.readings?.pm25_one_hourly ?? {};

const lats = areas.map((a) => a.lat).join(",");
const lons = areas.map((a) => a.lon).join(",");
const [wx, aq] = await Promise.all([
  get(`https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=precipitation_probability,apparent_temperature,weather_code&timezone=Asia%2FSingapore&forecast_days=2`),
  get(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lats}&longitude=${lons}&hourly=pm2_5&timezone=Asia%2FSingapore&forecast_days=2`),
]);
const wxList = Array.isArray(wx) ? wx : [wx];
const aqList = Array.isArray(aq) ? aq : [aq];

const distSq = (a, b) => (a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2;
const nearest = (list, p) => list.reduce((best, x) => (best == null || distSq(x, p) < distSq(best, p) ? x : best), null);

// Index of the current Singapore hour in Open-Meteo's local-time arrays.
// If it isn't there, every verdict would be shifted by hours, so stop instead of guessing.
const sgHour = new Date(fetchedAt.getTime() + 8 * 3600e3).toISOString().slice(0, 13) + ":00";
const times = wxList[0].hourly.time;
const i0 = times.indexOf(sgHour);
if (i0 < 0) throw new Error(`Current hour ${sgHour} not found in Open-Meteo times (${times[0]} … ${times.at(-1)})`);
// 12 h of start times plus up to 3 h of running.
const span = 16;

const out = {
  fetchedAt: fetchedAt.toISOString(),
  firstHour: times[i0], // local SGT, e.g. "2026-11-10T14:00"
  nowcast: nc ? { updated: nc.update_timestamp, validFrom: nc.valid_period.start, validTo: nc.valid_period.end } : null,
  rainfallAt: rainReading?.timestamp ?? null,
  pm25At: pmItem?.timestamp ?? pmItem?.update_timestamp ?? null,
  areas: areas.map((a, k) => {
    const st = nearest(stations, a);
    const reg = nearest(pmRegions, a);
    const h = wxList[k].hourly;
    const pmh = aqList[k].hourly.pm2_5;
    const hours = [];
    for (let i = i0; i < i0 + span && i < h.time.length; i++) {
      hours.push({
        rp: h.precipitation_probability[i],
        at: h.apparent_temperature[i],
        code: h.weather_code[i],
        pm: pmh[i] == null ? null : Math.round(pmh[i]),
      });
    }
    // Output contract per hour: rp = rain probability %, at = apparent temperature °C,
    // code = WMO weather code, pm = PM2.5 µg/m³. Any of them may be null.
    return {
      name: a.name,
      lat: a.lat,
      lon: a.lon,
      nowcast: ncText[a.name] ?? null,
      station: st?.name ?? null,
      rainNow: st ? rainById[st.id] ?? null : null,
      pmRegion: reg?.name ?? null,
      pmNow: reg ? pmByRegion[reg.name] ?? null : null,
      hours,
    };
  }),
};

const file = join(dirname(fileURLToPath(import.meta.url)), "data.json");
await writeFile(file, JSON.stringify(out));
console.log(`Wrote ${file}: ${out.areas.length} areas, first hour ${out.firstHour}, nowcast to ${out.nowcast?.validTo ?? "missing"}`);
