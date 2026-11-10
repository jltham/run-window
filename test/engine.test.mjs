// Run with: node --test test/   (from the run-window folder; no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const E = createRequire(import.meta.url)("../showcase/engine.js");
const AREA = "Bishan";

// Build a data.json-shaped snapshot. `at` is Singapore local time "YYYY-MM-DDTHH:MM".
// hour(i) returns the forecast for the i-th hour after the fetch hour.
function snapshot({ at, hour, hours = 30, nowcast = "Partly Cloudy (Day)", rainNow = 0, pmNow = 20, ncHours = 2 }) {
  const ms = Date.parse(at + ":00+08:00");
  const iso = (t) => new Date(t).toISOString();
  const firstHour = at.slice(0, 13) + ":00";
  return {
    fetchedAt: iso(ms),
    firstHour,
    nowcast: { updated: iso(ms), validFrom: iso(ms), validTo: iso(ms + ncHours * 3600e3) },
    rainfallAt: iso(ms - 5 * 60e3),
    pm25At: iso(ms - 30 * 60e3),
    areas: [{
      name: AREA, lat: 1.3508, lon: 103.839, nowcast, station: "Test station", rainNow, pmRegion: "central", pmNow,
      hours: Array.from({ length: hours }, (_, i) => ({ rp: 10, at: 29, code: 3, pm: 20, ...hour(i) })),
    }],
  };
}
const model = (opts) => {
  const sc = E.toModel(snapshot(opts));
  return { sc, A: sc.areas.find((a) => a.name === AREA) };
};
const clock = (min) => E.fmt(min);

// ---------- Best window (runs allowed at any hour) ----------

test("a Go slot at 11pm is the best window when the evening before it is wet (regression)", () => {
  // Tue 2:17pm. 2pm–10pm (hours 0–7) rain 90%, 10pm Caution (45%), dry from 11pm.
  const { sc, A } = model({ at: "2026-11-10T14:17", hour: (i) => (i <= 7 ? { rp: 90 } : i === 8 ? { rp: 45 } : {}) });
  const b = E.best(sc, A, 60);
  assert.equal(b.none, undefined);
  assert.equal(b.pick.r.level, 0);
  assert.equal(clock(b.pick.s), "11pm");
});

test("starting now is the best window when now is Go; Leave by is the last start that stays dry", () => {
  // Dry until 4pm, rain from 4pm (hour 2). A 60-min run must finish by 4pm, so the last Go start is 3pm.
  const { sc, A } = model({ at: "2026-11-10T14:17", hour: (i) => (i >= 2 && i <= 4 ? { rp: 90 } : {}) });
  const b = E.best(sc, A, 60);
  assert.equal(b.pick.s, sc.now);
  assert.equal(clock(b.leave), "3pm");
});

test("run length matters: 11pm is Go for 60 min but No-go for 120 min if midnight is wet", () => {
  const { sc, A } = model({ at: "2026-11-10T14:17", hour: (i) => (i === 10 ? { rp: 90 } : {}) });
  assert.equal(E.evaluate(sc, A, 23 * 60, 60, false).level, 0);
  assert.equal(E.evaluate(sc, A, 23 * 60, 120, false).level, 2);
});

test("prefers a later Go over an earlier Caution", () => {
  const { sc, A } = model({ at: "2026-11-10T14:17", hour: (i) => (i <= 2 ? { rp: 45 } : {}) });
  const b = E.best(sc, A, 60);
  assert.equal(b.pick.r.level, 0);
  assert.equal(clock(b.pick.s), "5pm");
});

test("picks the earliest Caution when there is no Go", () => {
  const { sc, A } = model({ at: "2026-11-10T14:17", hour: () => ({ rp: 45 }) });
  const b = E.best(sc, A, 60);
  assert.equal(b.pick.r.level, 1);
  assert.equal(b.pick.s, sc.now);
  assert.equal(b.leave, b.pick.s);
});

test("rain at the station right now pushes the best window to the next quarter hour", () => {
  const { sc, A } = model({ at: "2026-11-10T14:17", rainNow: 0.4, hour: () => ({}) });
  assert.equal(clock(E.best(sc, A, 60).pick.s), "2:30pm");
});

test("a long run can cross midnight", () => {
  const { sc, A } = model({ at: "2026-11-14T22:00", hour: () => ({}) });
  assert.ok(E.fits(sc, 23 * 60, 180));
  assert.equal(E.evaluate(sc, A, 23 * 60, 180, false).level, 0);
});


test("never suggests a No-go window and says why when nothing works", () => {
  const { sc, A } = model({ at: "2026-11-10T14:17", hour: () => ({ rp: 95 }) });
  const b = E.best(sc, A, 60);
  assert.equal(b.none, true);
  assert.equal(b.any, true);
});

test("missing forecast hours give Can't confirm, not Go", () => {
  const { sc, A } = model({ at: "2026-11-10T14:17", hours: 3, hour: () => ({}) });
  const r = E.evaluate(sc, A, 18 * 60, 60, false);
  assert.equal(r.level, 3);
});

// ---------- Thresholds and vetoes (SPEC §8) ----------

test("threshold edges: 30% rain is Go, 31% is Caution, 61% is No-go", () => {
  for (const [rp, level] of [[30, 0], [31, 1], [60, 1], [61, 2]]) {
    const { sc, A } = model({ at: "2026-11-11T06:00", hour: () => ({ rp }) });
    assert.equal(E.evaluate(sc, A, sc.now, 60, false).f.rain.l, level, `rain ${rp}%`);
  }
});

test("heat edges: 33 °C Go, 33.1 Caution, 38.1 No-go", () => {
  for (const [at, level] of [[33, 0], [33.1, 1], [38, 1], [38.1, 2]]) {
    const { sc, A } = model({ at: "2026-11-11T06:00", hour: () => ({ at }) });
    assert.equal(E.evaluate(sc, A, sc.now, 60, false).f.heat.l, level, `heat ${at}`);
  }
});

test("thunderstorm code vetoes even when everything else is fine", () => {
  const { sc, A } = model({ at: "2026-11-11T06:00", hour: (i) => (i === 0 ? { code: 95 } : {}) });
  assert.equal(E.evaluate(sc, A, sc.now, 60, false).level, 2);
});

test("NEA 'Thundery Showers' beats a dry model forecast (worse source wins)", () => {
  const { sc, A } = model({ at: "2026-11-11T06:00", nowcast: "Thundery Showers", hour: () => ({ rp: 5 }) });
  const r = E.evaluate(sc, A, sc.now, 60, true);
  assert.equal(r.level, 2);
  assert.equal(r.reasons[0], "storm");
});

test("PM2.5 above 150 is a veto", () => {
  const { sc, A } = model({ at: "2026-11-11T06:00", pmNow: 151, hour: () => ({}) });
  assert.equal(E.evaluate(sc, A, sc.now, 60, true).f.pm.l, 2);
});

test("raining at the nearest station makes Start now a No-go", () => {
  const { sc, A } = model({ at: "2026-11-11T06:00", rainNow: 0.4, hour: () => ({}) });
  assert.equal(E.evaluate(sc, A, sc.now, 60, true).level, 2);
  assert.equal(E.evaluate(sc, A, sc.now + 60, 60, false).level, 0, "only applies to starting now");
});

test("missing NEA PM2.5 gives Can't confirm", () => {
  const { sc, A } = model({ at: "2026-11-11T06:00", pmNow: null, hour: () => ({}) });
  assert.equal(E.evaluate(sc, A, sc.now, 60, true).level, 3);
});

test("confidence: high only inside the nowcast period", () => {
  const { sc, A } = model({ at: "2026-11-11T06:00", ncHours: 2, hour: () => ({}) });
  assert.match(E.evaluate(sc, A, sc.now, 60, true).conf, /^High/);
  assert.match(E.evaluate(sc, A, sc.now + 90, 60, false).conf, /^Medium/);
  assert.match(E.evaluate(sc, A, sc.now + 7 * 60, 60, false).conf, /^Low/);
});

// ---------- Gaps found in review ----------

test("NEA 'Heavy Rain' is a No-go; other rain words are at least Caution", () => {
  const heavy = model({ at: "2026-11-11T06:00", nowcast: "Heavy Rain", hour: () => ({ rp: 5 }) });
  assert.equal(E.evaluate(heavy.sc, heavy.A, heavy.sc.now, 60, false).f.rain.l, 2);
  const light = model({ at: "2026-11-11T06:00", nowcast: "Light Showers", hour: () => ({ rp: 5 }) });
  assert.equal(E.evaluate(light.sc, light.A, light.sc.now, 60, false).f.rain.l, 1);
  assert.equal(E.evaluate(light.sc, light.A, light.sc.now + 180, 60, false).f.rain.l, 0, "nowcast only counts inside its valid period");
});

test("PM2.5 edges: 55 Go, 56 Caution", () => {
  for (const [pm, level] of [[55, 0], [56, 1]]) {
    const { sc, A } = model({ at: "2026-11-11T06:00", pmNow: pm, hour: () => ({ pm }) });
    assert.equal(E.evaluate(sc, A, sc.now, 60, true).f.pm.l, level, `PM2.5 ${pm}`);
  }
});

test("a missing thunderstorm code gives Can't confirm; a missing heat value only warns", () => {
  const noCode = model({ at: "2026-11-11T06:00", hour: () => ({ code: null }) });
  assert.equal(E.evaluate(noCode.sc, noCode.A, noCode.sc.now, 60, false).level, 3);
  const noHeat = model({ at: "2026-11-11T06:00", hour: () => ({ at: null }) });
  const r = E.evaluate(noHeat.sc, noHeat.A, noHeat.sc.now, 60, false);
  assert.equal(r.level, 0);
  assert.deepEqual(r.warn, ["heat"]);
});

test("NEA readings more than 2 h older than the fetch count as missing", () => {
  const j = snapshot({ at: "2026-11-11T06:00", hour: () => ({}) });
  j.pm25At = new Date(Date.parse(j.fetchedAt) - 3 * 3600e3).toISOString();
  const sc = E.toModel(j);
  assert.equal(sc.areas.find((a) => a.name === AREA).pmNow, null);
});

test("normalise: keeps FORECAST_HOURS from the current hour and maps nearest station and region", () => {
  const n = E.AREAS.length, times = Array.from({ length: 72 }, (_, i) => `2026-11-1${i < 24 ? 0 : i < 48 ? 1 : 2}T${String(i % 24).padStart(2, "0")}:00`);
  const wx = Array.from({ length: n }, () => ({ hourly: { time: times, precipitation_probability: times.map((_, i) => i), apparent_temperature: times.map(() => 30), weather_code: times.map(() => 3) } }));
  const aq = Array.from({ length: n }, () => ({ hourly: { pm2_5: times.map(() => 12.4) } }));
  const nea = (data) => ({ data });
  const fetchedAt = new Date("2026-11-10T14:17:00+08:00");
  const out = E.normalise(fetchedAt,
    nea({ items: [{ update_timestamp: "x", valid_period: { start: "a", end: "b" }, forecasts: [{ area: "Bishan", forecast: "Showers" }] }] }),
    nea({ stations: [{ id: "S1", name: "Near Bishan", location: { latitude: 1.35, longitude: 103.84 } }, { id: "S2", name: "Far", location: { latitude: 1.3, longitude: 103.64 } }], readings: [{ timestamp: "t", data: [{ stationId: "S1", value: 0.2 }] }] }),
    nea({ regionMetadata: [{ name: "central", labelLocation: { latitude: 1.35, longitude: 103.82 } }], items: [{ timestamp: "t", readings: { pm25_one_hourly: { central: 9 } } }] }),
    wx, aq);
  const b = out.areas.find((a) => a.name === AREA);
  assert.equal(out.firstHour, "2026-11-10T14:00");
  assert.equal(b.hours.length, E.FORECAST_HOURS);
  assert.equal(b.hours[0].rp, 14, "starts at the current Singapore hour");
  assert.equal(b.hours[0].pm, 12);
  assert.deepEqual([b.nowcast, b.station, b.rainNow, b.pmRegion, b.pmNow], ["Showers", "Near Bishan", 0.2, "central", 9]);
  assert.throws(() => E.normalise(new Date("2026-11-20T10:00:00+08:00"), nea({ items: [] }), nea({}), nea({}), wx, aq), /didn't line up/);
});
