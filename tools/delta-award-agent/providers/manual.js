// Manual data provider (v0): reads itineraries from a JSON file.
// This is the "you feed it numbers, it ranks them" path — no login, no API.
// Later providers (seats.aero, etc.) implement the same shape: load() -> [itinerary].
//
// Itinerary shape:
// {
//   "id": "DL-ICN-0918",
//   "destination": "ICN",
//   "outbound": { "depart": "2026-09-18T17:30", "arrive": "2026-09-19T20:15" },
//   "return":   { "depart": "2026-09-21T11:00", "arrive": "2026-09-21T22:30" },
//   "cabins": {
//     "main":           { "miles": 90000,  "taxes_fees": 86, "cash": 1450 },
//     "premium_select": { "miles": 160000, "taxes_fees": 86, "cash": 2600 },
//     "delta_one":      { "miles": 320000, "taxes_fees": 86, "cash": 6800,
//                         "saver_award": true, "z_available": true }
//   }
// }

import { readFile } from "node:fs/promises";

export async function load(path) {
  const raw = await readFile(path, "utf8");
  const data = JSON.parse(raw);
  const itineraries = Array.isArray(data) ? data : data.itineraries;
  if (!Array.isArray(itineraries)) {
    throw new Error(`${path} must be a JSON array of itineraries, or { "itineraries": [...] }`);
  }
  return itineraries;
}
