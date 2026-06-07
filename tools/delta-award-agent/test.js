// Minimal tests for the v0 engine. Run: node tools/delta-award-agent/test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConstraints, groundHours, centsPerMile, valuate, search } from "./engine.js";

const criteria = {
  origin: "CMH",
  destinations: [{ code: "ICN", priority: "high", notes: "" }],
  schedule: {
    outbound_day: "Friday", outbound_depart_after: "12:00", outbound_depart_before: "23:59",
    return_day: "Monday", return_arrive_by: "23:00", min_ground_hours: 20,
  },
  cabins: ["main", "premium_select", "delta_one"],
  valuation: { flag_cpp_at_or_above: 1.5 },
  ranking: { prefer_d1_saver_award: true, prefer_guc_space: true },
};

const good = {
  id: "ok", destination: "ICN",
  outbound: { depart: "2026-09-18T17:25", arrive: "2026-09-19T21:40" },
  return: { depart: "2026-09-21T13:10", arrive: "2026-09-21T16:55" },
  cabins: { delta_one: { miles: 295000, taxes_fees: 92, cash: 7100, saver_award: true, z_available: true } },
};

test("good itinerary passes all constraints", () => {
  assert.equal(checkConstraints(good, criteria).pass, true);
});

test("ground time computed across the destination stay", () => {
  assert.ok(Math.abs(groundHours(good) - 39.5) < 0.01);
});

test("cpp = (cash - fees) / miles * 100", () => {
  assert.ok(Math.abs(centsPerMile({ miles: 100000, taxes_fees: 100, cash: 1600 }) - 1.5) < 1e-9);
});

test("cpp flag fires at >= threshold", () => {
  const v = valuate(good, criteria);
  assert.equal(v.delta_one.flagged, true); // 2.38c
});

test("under-20h ground time is rejected", () => {
  const short = { ...good, return: { depart: "2026-09-20T10:00", arrive: "2026-09-21T16:55" } };
  const c = checkConstraints(short, criteria);
  assert.equal(c.pass, false);
  assert.ok(c.reasons.some((r) => r.includes("ground time")));
});

test("wrong return day is rejected", () => {
  const sun = { ...good, return: { depart: "2026-09-20T13:10", arrive: "2026-09-20T16:55" } };
  assert.equal(checkConstraints(sun, criteria).pass, false);
});

test("morning departure outside window is rejected", () => {
  const am = { ...good, outbound: { depart: "2026-09-18T08:00", arrive: "2026-09-19T21:40" } };
  assert.equal(checkConstraints(am, criteria).pass, false);
});

test("return after cutoff is rejected", () => {
  const late = { ...good, return: { depart: "2026-09-21T13:10", arrive: "2026-09-21T23:30" } };
  assert.equal(checkConstraints(late, criteria).pass, false);
});

test("D1 saver + Z outranks a flagged-but-no-space itinerary", () => {
  const noSpace = {
    id: "nospace", destination: "ICN",
    outbound: { depart: "2026-09-18T17:25", arrive: "2026-09-19T21:40" },
    return: { depart: "2026-09-21T13:10", arrive: "2026-09-21T16:55" },
    cabins: { delta_one: { miles: 100000, taxes_fees: 0, cash: 3000, saver_award: false, z_available: false } },
  };
  const { matches } = search([noSpace, good], criteria);
  assert.equal(matches[0].itin.id, "ok");
});
