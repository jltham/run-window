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

// ---------- Best window ----------

test("afternoon with a rainy evening still finds tomorrow morning (regression)", () => {
  // Tue 2:17pm. 2pm–8pm (hours 0–5) rain 90%, dry after that.
  const { sc, A } = model({ at: "2026-11-10T14:17", hour: (i) => (i <= 5 ? { rp: 90 } : {}) });
  const b = E.best(sc, A, 45);
  assert.equal(b.none, undefined, "should not say 'No safe window'");
  assert.equal(b.pick.r.level, 0);
  assert.equal(clock(b.pick.s), "5:30am (tmrw)");
  assert.equal(clock(b.leave), "7:45am (tmrw)", "latest Go start that still ends by 8:30am");
});

test("picks today's evening when it is Go, before tomorrow", () => {
  const { sc, A } = model({ at: "2026-11-10T14:17", hour: () => ({}) });
  const b = E.best(sc, A, 60);
  assert.equal(clock(b.pick.s), "6pm");
  assert.equal(clock(b.leave), "6:30pm");
});

test("prefers a later Go over an earlier Caution", () => {
  // Evening rain 45% (Caution), tomorrow morning dry.
  const { sc, A } = model({ at: "2026-11-10T14:17", hour: (i) => (i >= 3 && i <= 5 ? { rp: 45 } : {}) });
  const b = E.best(sc, A, 60);
  assert.equal(b.pick.r.level, 0);
  assert.equal(clock(b.pick.s), "5:30am (tmrw)");
});

test("never suggests a No-go window and says why when nothing works", () => {
  const { sc, A } = model({ at: "2026-11-10T14:17", hour: () => ({ rp: 95 }) });
  const b = E.best(sc, A, 60);
  assert.equal(b.none, true);
  assert.equal(b.any, true);
});

test("a 180-min run only fits weekend mornings", () => {
  // Fri 7pm: weekday evening block is too short; Sat 6:00–11:30 fits.
  const { sc, A } = model({ at: "2026-11-13T19:00", hour: () => ({}) });
  const b = E.best(sc, A, 180);
  assert.equal(clock(b.pick.s), "6am (tmrw)");
  assert.ok(E.fits(sc, b.pick.s, 180));
  assert.ok(!E.fits(sc, 18 * 60, 180), "weekday evening block is only 90 min");
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

test("picks a Caution window when no Go exists, and Leave by stops at a break in the Go run", () => {
  const caution = model({ at: "2026-11-10T14:17", hour: () => ({ rp: 45 }) });
  const b = E.best(caution.sc, caution.A, 60);
  assert.equal(b.pick.r.level, 1);
  assert.equal(b.leave, b.pick.s);
  // Tomorrow 7am hour turns rainy: Go starts 5:30–6:00 only (a 60-min run from 6:15 reaches 7am).
  const gap = model({ at: "2026-11-10T14:17", hour: (i) => (i <= 5 || i === 17 ? { rp: 90 } : {}) });
  const g = E.best(gap.sc, gap.A, 60);
  assert.equal(clock(g.pick.s), "5:30am (tmrw)");
  assert.equal(clock(g.leave), "6am (tmrw)");
});

test("weekend to weekday rollover: Sunday night finds Monday 5:30am", () => {
  const { sc, A } = model({ at: "2026-11-15T20:00", hour: () => ({}) });
  assert.equal(clock(E.best(sc, A, 60).pick.s), "5:30am (tmrw)");
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
