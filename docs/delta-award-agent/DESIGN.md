# Delta Award-Flight Search Agent — Design

> Status: **Plan only.** No data source chosen yet, no code shipped.
> This doc encodes the search criteria, the architecture, and the open
> decisions so we can build quickly once a data source is picked.

## 1. What it does

Given a weekend window, the agent finds and ranks **CMH → Asia** award
itineraries on Delta that fit a tight schedule, then scores each one by
how good a mileage redemption it is.

It is a **search-and-rank** tool, not a booking bot. It tells you which
trips are worth booking; you book them yourself on delta.com.

## 2. Search criteria (from the brief)

### Hard constraints (an itinerary is dropped if it fails any)
| Rule | Value |
|------|-------|
| Origin | CMH (Columbus) |
| Destination | Any Asia airport in the candidate list (§ `criteria.example.yaml`) |
| Outbound day | Friday |
| Outbound depart window | Friday afternoon/evening (default 12:00–23:59 local) |
| Return arrival | Monday, **by 23:00** local at CMH |
| Minimum ground time | **≥ 20 hours** at destination (last arrival → first departure) |
| Cabins priced | Main, Premium Select (PS), Delta One (D1) |

### Ranking signals (soft — used to sort survivors)
1. **Redemption value** — cents-per-mile (cpp):
   `cpp = (cash_fare − award_taxes_fees) / miles_required × 100`
   **Flag / prioritize cpp ≥ 1.5.**
2. **Delta One quality** — prefer itineraries where **D1 has saver award
   space (open seats)** *or* **GUC upgrade space is available (Z fare
   class in revenue inventory).**
3. **Destination demand notes** (tie-breakers / annotations, from brief):
   - TPE (Taiwan): wanted, but schedule rarely fits a 3-day weekend → deprioritize.
   - Oceania (e.g., SYD/AKL): southern-hemisphere winter; many flights suspended/reduced.
   - Japan (NRT/HND): high demand → award space scarce, watch cpp.
   - China (PVG/PEK): low demand, few flights, high yield → cash is pricey, so award cpp can be excellent when space exists.
   - Seoul (ICN): opens many onward connections, but tight on 3 days.

## 3. The data problem (why login isn't the path)

GUC/Z-class and saver-award availability are the whole game, and they are
**not** reliably obtainable by logging into delta.com and scraping:

- **No public Delta API.** The booking site is protected by bot detection
  (Akamai); automated login/scrape violates Delta's ToS and breaks often.
- **GUC space isn't shown in the normal booking flow.** GUCs clear into
  the **Z** fare bucket, which is *revenue fare-class inventory* — that's
  surfaced by fare-class tools (ExpertFlyer, seats.aero Pro, GDS), not by
  the consumer site. *(This directly answers the "how do you check GUC
  availability online / do you need your brother's tool?" question: yes —
  you need a fare-class inventory source; delta.com alone won't show Z.)*

So the agent is built against a **pluggable data provider** interface.
We pick the concrete provider later; the rest of the agent doesn't change.

### Candidate providers (decide later)
| Option | Award space | Fare class (Z/GUC) | Cash fare | Notes |
|--------|:----------:|:------------------:|:---------:|-------|
| **seats.aero API** | ✅ | ✅ (Pro) | partial | Paid, legitimate, stable. Best fit. |
| **ExpertFlyer** | partial | ✅ | ✅ | Strong on fare class; API access limited. |
| **Amadeus / GDS** | depends | ✅ | ✅ | Powerful, contractual. |
| **Manual feed** | ✅ | ✅ | ✅ | You paste numbers; agent ranks. Zero integration. Good for v0. |

## 4. Architecture

```
            ┌─────────────────────────────────────────────┐
            │              criteria.yaml                    │
            │ (origin, dests, windows, ground-time, cpp)    │
            └───────────────────┬───────────────────────────┘
                                │
        ┌───────────────────────▼────────────────────────┐
        │             Candidate generator                  │
        │  dests × valid Fri-depart / Mon-return date pairs │
        └───────────────────────┬──────────────────────────┘
                                │ queries
        ┌───────────────────────▼──────────────────────────┐
        │     Data provider (interface — pluggable)         │
        │  getAwardOptions() · getFareClass(Z) · getCash()  │
        │  impls: seats.aero | expertflyer | manual | …     │
        └───────────────────────┬──────────────────────────┘
                                │ raw itineraries
        ┌───────────────────────▼──────────────────────────┐
        │  Filter engine  (hard constraints: day/time/20h)  │
        └───────────────────────┬──────────────────────────┘
        ┌───────────────────────▼──────────────────────────┐
        │  Valuation engine  (cpp per cabin; ≥1.5 flag)     │
        └───────────────────────┬──────────────────────────┘
        ┌───────────────────────▼──────────────────────────┐
        │  Ranking engine  (D1/GUC weight + demand notes)   │
        └───────────────────────┬──────────────────────────┘
        ┌───────────────────────▼──────────────────────────┐
        │  Reporters  →  console table · Slack · Notion ·    │
        │                Gmail · Calendar hold (all via MCP) │
        └───────────────────────────────────────────────────┘
```

### Components
- **criteria.yaml** — the spec as data, edited without touching code.
- **Candidate generator** — expands destinations × legal date pairs for the
  weekend(s) being searched; enforces the Fri/Mon skeleton up front.
- **Data provider interface** — the only part that talks to the outside
  world. Swappable. Keeps the agent legal/stable regardless of source.
- **Filter engine** — drops itineraries failing day/time/ground-time.
- **Valuation engine** — computes cpp per cabin, flags ≥ 1.5.
- **Ranking engine** — sorts by D1-saver/GUC availability, then cpp, then
  demand notes.
- **Reporters** — output. We already have Slack, Notion, Gmail, and
  Calendar tools wired in this workspace, so results can be posted to a
  channel, a Notion DB, an email digest, or a tentative calendar hold.
- **Scheduler (optional)** — re-run on an interval; award/Z space appears
  and vanishes, so polling + "notify on new match" is where this earns its
  keep ("this is where retirement pays dividends").

## 5. Security / credentials
- Any provider API key lives in **`.env`** (already gitignored) or an env
  var — **never committed, never hardcoded.**
- **No Delta password is stored anywhere.** The agent does not log into
  your Delta account.
- Provider keys are read at runtime only.

## 6. Suggested build order
1. **v0 — engine + manual provider.** Implements every filter, the cpp
   calc, and ranking; you feed it numbers. Proves the logic with zero
   integration risk. *(This is the recommended first PR.)*
2. **v1 — real data provider** (seats.aero or chosen source) behind the
   same interface.
3. **v2 — reporters + scheduler** (Slack/Notion/email digest, polling for
   new matches).

## 7. Open decisions
- [ ] Data provider (see §3 table).
- [ ] Destination shortlist — full Asia or a curated set? (default list in
      `criteria.example.yaml`).
- [ ] Which weekends / date range to search, and how many weeks out.
- [ ] Where results go (console only vs. Slack/Notion/email).
- [ ] Language/runtime (repo is Node/Astro — default to a Node TS script).
