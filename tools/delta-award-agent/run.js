#!/usr/bin/env node
// CLI runner for the Delta award-flight search agent (v0).
//
//   node tools/delta-award-agent/run.js
//   node tools/delta-award-agent/run.js --criteria ./criteria.json --data ./my-itins.json
//   node tools/delta-award-agent/run.js --json        # machine-readable output
//
// v0 uses the manual provider: you supply itineraries (award miles + cash
// + D1 saver / Z flags) in a JSON file; the engine filters and ranks them.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { search } from "./engine.js";
import { load as loadManual } from "./providers/manual.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { criteria: resolve(HERE, "criteria.json"), data: resolve(HERE, "sample-itineraries.json"), json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--criteria") args.criteria = resolve(argv[++i]);
    else if (a === "--data") args.data = resolve(argv[++i]);
    else if (a === "--json") args.json = true;
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp() {
  console.log(`Delta award-flight search agent (v0)

Usage:
  node run.js [--criteria FILE] [--data FILE] [--json]

  --criteria FILE  search rules (default: bundled criteria.json)
  --data FILE      itineraries to evaluate (default: sample-itineraries.json)
  --json           emit JSON instead of a table`);
}

const money = (n) => (n == null ? "—" : `$${Number(n).toLocaleString()}`);
const miles = (n) => (n == null ? "—" : `${Math.round(n / 1000)}k`);
const cpp = (v) => (v.cpp == null ? "—" : `${v.cpp.toFixed(2)}¢${v.flagged ? "*" : ""}`);

function report(result, criteria) {
  const { matches, rejected } = result;
  console.log(`\nDelta award search — ${criteria.origin} → Asia`);
  console.log(`Fri ${criteria.schedule.outbound_depart_after}+ out · back by Mon ${criteria.schedule.return_arrive_by} · ≥${criteria.schedule.min_ground_hours}h ground · flag cpp ≥ ${criteria.valuation.flag_cpp_at_or_above}¢ (*)`);
  console.log(`\n${matches.length} match(es), ${rejected.length} rejected.\n`);

  matches.forEach((m, i) => {
    const v = m.valuation;
    const d1 = m.itin.cabins?.delta_one || {};
    const tags = [d1.saver_award ? "D1 saver✓" : null, d1.z_available ? "Z/GUC✓" : null].filter(Boolean).join(" ");
    console.log(`#${i + 1}  ${m.itin.destination}  (${m.itin.id})   score ${m.score.points.toFixed(0)}   ${tags}`);
    console.log(`    out ${m.itin.outbound.depart} → ${m.itin.outbound.arrive}   |   ret ${m.itin.return.depart} → ${m.itin.return.arrive}`);
    console.log(`    ground ${m.groundHours.toFixed(1)}h`);
    console.log(`    Main  ${miles(v.main.miles)} / ${money(v.main.cash)} -> ${cpp(v.main)}`);
    console.log(`    PS    ${miles(v.premium_select.miles)} / ${money(v.premium_select.cash)} -> ${cpp(v.premium_select)}`);
    console.log(`    D1    ${miles(v.delta_one.miles)} / ${money(v.delta_one.cash)} -> ${cpp(v.delta_one)}`);
    if (m.score.notes) console.log(`    note: ${m.score.notes}`);
    console.log("");
  });

  if (rejected.length) {
    console.log("Rejected:");
    for (const r of rejected) console.log(`  ✗ ${r.itin.id} (${r.itin.destination}): ${r.reasons.join("; ")}`);
    console.log("");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const criteria = JSON.parse(await readFile(args.criteria, "utf8"));
  const itineraries = await loadManual(args.data); // swap provider here later
  const result = search(itineraries, criteria);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    report(result, criteria);
  }
}

main().catch((err) => { console.error("Error:", err.message); process.exit(1); });
