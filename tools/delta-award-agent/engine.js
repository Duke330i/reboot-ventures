// Delta award-flight search agent — v0 engine.
// Pure functions: filter (hard constraints), valuation (cpp), ranking.
// No external dependencies; data comes from a provider (see providers/).
//
// TIME CONVENTION (important): all datetimes in itineraries are LOCAL,
// no timezone suffix. outbound.depart / return.arrive are local at the
// ORIGIN (CMH). outbound.arrive / return.depart are local at the
// DESTINATION. We parse the wall-clock components directly so results are
// identical regardless of the machine's timezone.

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Parse a naive local "YYYY-MM-DDTHH:MM" into stable components. */
export function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s));
  if (!m) throw new Error(`Bad datetime (need YYYY-MM-DDTHH:MM): ${s}`);
  const [, Y, Mo, D, H, Mi] = m.map(Number);
  const ms = Date.UTC(Y, Mo - 1, D, H, Mi); // UTC used only as a stable clock
  return { ms, weekday: new Date(ms).getUTCDay(), minutes: H * 60 + Mi, raw: String(s) };
}

/** "23:00" -> 1380 minutes since midnight. */
export function hhmmToMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s));
  if (!m) throw new Error(`Bad time (need HH:MM): ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function weekdayIndex(name) {
  const i = WEEKDAYS.findIndex((w) => w.toLowerCase() === String(name).toLowerCase());
  if (i < 0) throw new Error(`Unknown weekday: ${name}`);
  return i;
}

/** Hours on the ground at the destination (dest arrival -> dest departure). */
export function groundHours(itin) {
  const arrive = parseLocal(itin.outbound.arrive);
  const depart = parseLocal(itin.return.depart);
  return (depart.ms - arrive.ms) / 3_600_000;
}

/**
 * Apply hard constraints. Returns { pass, reasons[], groundHours }.
 * An itinerary fails if ANY reason is present.
 */
export function checkConstraints(itin, criteria) {
  const s = criteria.schedule;
  const reasons = [];

  // Destination must be in the candidate list.
  const allowed = new Set(criteria.destinations.map((d) => d.code));
  if (!allowed.has(itin.destination)) reasons.push(`destination ${itin.destination} not in candidate list`);

  // Outbound: correct day + within depart window (origin local).
  const out = parseLocal(itin.outbound.depart);
  if (out.weekday !== weekdayIndex(s.outbound_day)) {
    reasons.push(`outbound departs ${WEEKDAYS[out.weekday]}, need ${s.outbound_day}`);
  }
  const after = hhmmToMinutes(s.outbound_depart_after);
  const before = hhmmToMinutes(s.outbound_depart_before);
  if (out.minutes < after || out.minutes > before) {
    reasons.push(`outbound departs ${itin.outbound.depart.slice(11, 16)}, need ${s.outbound_depart_after}-${s.outbound_depart_before}`);
  }

  // Return: correct arrival day + by cutoff (origin local).
  const arr = parseLocal(itin.return.arrive);
  if (arr.weekday !== weekdayIndex(s.return_day)) {
    reasons.push(`return arrives ${WEEKDAYS[arr.weekday]}, need ${s.return_day}`);
  }
  if (arr.minutes > hhmmToMinutes(s.return_arrive_by)) {
    reasons.push(`return arrives ${itin.return.arrive.slice(11, 16)}, after cutoff ${s.return_arrive_by}`);
  }

  // Ground time.
  const gh = groundHours(itin);
  if (gh < s.min_ground_hours) {
    reasons.push(`ground time ${gh.toFixed(1)}h < ${s.min_ground_hours}h minimum`);
  }

  return { pass: reasons.length === 0, reasons, groundHours: gh };
}

/** cents per mile = (cash - taxes_fees) / miles * 100. */
export function centsPerMile(cabin) {
  if (!cabin || !cabin.miles || cabin.cash == null) return null;
  const fees = cabin.taxes_fees ?? 0;
  return ((cabin.cash - fees) / cabin.miles) * 100;
}

/** Per-cabin valuation with the >= threshold flag. */
export function valuate(itin, criteria) {
  const threshold = criteria.valuation.flag_cpp_at_or_above;
  const out = {};
  for (const name of criteria.cabins) {
    const cabin = itin.cabins?.[name];
    const cpp = centsPerMile(cabin);
    out[name] = {
      present: !!cabin,
      miles: cabin?.miles ?? null,
      cash: cabin?.cash ?? null,
      cpp,
      flagged: cpp != null && cpp >= threshold,
    };
  }
  return out;
}

const PRIORITY_WEIGHT = { high: 15, medium: 8, low: 2 };

/**
 * Score a (passing) itinerary. Higher is better.
 *   D1 saver award space ...... +100
 *   GUC space (Z available) .... +80
 *   best cpp across cabins ..... + cpp*10  (+25 bonus if any cabin flagged)
 *   destination priority ....... + weight
 */
export function score(itin, valuation, criteria) {
  let pts = 0;
  const parts = [];

  const d1 = itin.cabins?.delta_one;
  if (criteria.ranking.prefer_d1_saver_award && d1?.saver_award) { pts += 100; parts.push("D1 saver +100"); }
  if (criteria.ranking.prefer_guc_space && d1?.z_available) { pts += 80; parts.push("Z/GUC +80"); }

  const cpps = Object.values(valuation).map((v) => v.cpp).filter((c) => c != null);
  const bestCpp = cpps.length ? Math.max(...cpps) : 0;
  pts += bestCpp * 10;
  if (bestCpp) parts.push(`bestCpp ${bestCpp.toFixed(2)} +${(bestCpp * 10).toFixed(0)}`);
  const anyFlagged = Object.values(valuation).some((v) => v.flagged);
  if (anyFlagged) { pts += 25; parts.push("flagged +25"); }

  const dest = criteria.destinations.find((d) => d.code === itin.destination);
  const w = PRIORITY_WEIGHT[dest?.priority] ?? 0;
  pts += w;
  if (w) parts.push(`${dest.priority} +${w}`);

  return { points: pts, bestCpp, parts, notes: dest?.notes || "" };
}

/**
 * Full pipeline: filter -> valuate -> rank.
 * Returns { matches: [...sorted], rejected: [{itin, reasons}] }.
 */
export function search(itineraries, criteria) {
  const matches = [];
  const rejected = [];
  for (const itin of itineraries) {
    const check = checkConstraints(itin, criteria);
    if (!check.pass) { rejected.push({ itin, reasons: check.reasons }); continue; }
    const valuation = valuate(itin, criteria);
    const scored = score(itin, valuation, criteria);
    matches.push({ itin, groundHours: check.groundHours, valuation, score: scored });
  }
  matches.sort((a, b) => b.score.points - a.score.points);
  return { matches, rejected };
}
