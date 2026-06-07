# Delta Award-Flight Search Agent — v0

Finds and ranks **CMH → Asia** weekend award itineraries on Delta against a
tight schedule, and scores each by redemption value. See
[`../../docs/delta-award-agent/DESIGN.md`](../../docs/delta-award-agent/DESIGN.md)
for the full architecture and roadmap.

**This is v0: the engine + a manual data feed.** It does the filtering,
the cents-per-mile math, and the ranking. You supply the raw numbers
(award miles, cash price, D1 saver / Z-class flags) in a JSON file. No
Delta login, no API, no scraping — a real data provider drops in behind
the same interface later (v1).

## Run

```bash
node tools/delta-award-agent/run.js                 # uses bundled samples
node tools/delta-award-agent/run.js --data ./my-itineraries.json
node tools/delta-award-agent/run.js --json          # machine-readable
node tools/delta-award-agent/test.js                # or: node --test test.js
```

Or via npm: `npm run award:search`.

## What it enforces (hard filters)

- Origin CMH, destination in the candidate list (`criteria.json`)
- Outbound **Friday**, departing in the afternoon/evening window
- Return arriving **Monday by 23:00**
- **≥ 20 hours on the ground** at the destination
- Prices **Main / Premium Select / Delta One**

## How it ranks (survivors)

1. **Delta One saver award space** (`saver_award: true`) — biggest weight
2. **GUC / Z-class space** (`z_available: true`)
3. **Best cents-per-mile**, with a `*` flag at **≥ 1.5¢** —
   `cpp = (cash − taxes_fees) / miles × 100`
4. Destination priority (high/medium/low) as a tie-breaker

## Feeding it data

Edit `criteria.json` to change the rules. Provide itineraries as a JSON
array (see `sample-itineraries.json`):

```json
{
  "id": "DL-ICN-0918",
  "destination": "ICN",
  "outbound": { "depart": "2026-09-18T17:25", "arrive": "2026-09-19T21:40" },
  "return":   { "depart": "2026-09-21T13:10", "arrive": "2026-09-21T16:55" },
  "cabins": {
    "main":           { "miles": 95000,  "taxes_fees": 92, "cash": 1380 },
    "premium_select": { "miles": 165000, "taxes_fees": 92, "cash": 2750 },
    "delta_one":      { "miles": 295000, "taxes_fees": 92, "cash": 7100,
                        "saver_award": true, "z_available": true }
  }
}
```

**Datetime convention:** local wall-clock, no timezone suffix.
`outbound.depart` / `return.arrive` are local at the **origin (CMH)**;
`outbound.arrive` / `return.depart` are local at the **destination**.
(That's what makes the 20h ground-time math come out right.)

## Files

| File | Purpose |
|------|---------|
| `engine.js` | Pure logic: filter, valuation (cpp), ranking |
| `providers/manual.js` | v0 data source — reads itineraries from JSON |
| `run.js` | CLI: load criteria + data, print ranked results |
| `criteria.json` | The search rules as data |
| `sample-itineraries.json` | Example feed (3 match, 2 rejected) |
| `test.js` | Engine tests (`node --test test.js`) |
