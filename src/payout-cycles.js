/**
 * Payout cycle calendar (issue #24) — pure date math, no database.
 *
 * Product rules:
 *   * Payout cycles run on the 15th and the 30th of each month.
 *   * For February — the only month where the 30th never exists — the second
 *     cycle ends on the LAST CALENDAR DAY of the month (28th, or 29th in a
 *     leap year).
 *   * A cycle's earning window is (previous cycle end, this cycle end],
 *     computed in the application timezone (America/Port-au-Prince — the
 *     same canonical timezone the web app already uses). Windows tile
 *     contiguously: every instant belongs to exactly one cycle, so an
 *     earning can never be counted in two cycles.
 *
 * All boundary instants are derived from wall-clock time in the app
 * timezone via the Intl API (DST-correct for any date the tz database
 * knows about). Monetary math never happens here — only dates.
 */
'use strict';

const APP_TIMEZONE = 'America/Port-au-Prince';

const wallClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
});

/** Instant → app-timezone wall clock {y, m (1-12), d, hh, mm, ss}. */
function wallClock(date) {
  const parts = wallClockFormatter.formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return {
    y: get('year'), m: get('month'), d: get('day'),
    hh: get('hour') % 24, mm: get('minute'), ss: get('second'),
  };
}

/** UTC offset (ms) of the app timezone AT the given instant. */
function tzOffsetMs(date) {
  const w = wallClock(date);
  return Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, w.ss) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant representing a wall-clock time in the app timezone. */
function instantAt(y, m, d, hh, mm, ss, ms) {
  const target = Date.UTC(y, m - 1, d, hh, mm, ss, ms);
  let guess = target;
  // Converge through DST discontinuities (max 2 iterations needed in practice).
  for (let i = 0; i < 3; i++) {
    const offset = tzOffsetMs(new Date(guess));
    const next = target - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** Last representable instant of a calendar day in the app timezone. */
function endOfDay(y, m, d) {
  return instantAt(y, m, d, 23, 59, 59, 999);
}

/** Cycle end days for a month: [15, 30] — February uses its last day. */
function cycleEndDays(year, month /* 1-12 */) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month === 2 ? [15, lastDay] : [15, 30];
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextCalendarDay({ y, m, d }) {
  if (d < lastDayOfMonth(y, m)) return { y, m, d: d + 1 };
  if (m < 12) return { y, m: m + 1, d: 1 };
  return { y: y + 1, m: 1, d: 1 };
}

/** The cycle end date that immediately precedes the given cycle end date. */
function previousCycleEnd({ y, m, d }) {
  if (d === 15) {
    const pm = m === 1 ? 12 : m - 1;
    const py = m === 1 ? y - 1 : y;
    return { y: py, m: pm, d: cycleEndDays(py, pm)[1] };
  }
  return { y, m, d: 15 };
}

function isoDate(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Cycle descriptor for a cycle that ENDS on the given calendar date. */
function cycleWithEnd(endDate) {
  const { y, m, d } = endDate;
  const prev = previousCycleEnd(endDate);
  const start = nextCalendarDay(prev);
  return {
    endDate: isoDate(y, m, d),
    startDate: isoDate(start.y, start.m, start.d),
    // Exclusive window start = last instant of the previous cycle's end day.
    windowStartExclusive: endOfDay(prev.y, prev.m, prev.d),
    // Inclusive window end = last instant of this cycle's end day.
    windowEndInclusive: endOfDay(y, m, d),
    label: `${String(start.d).padStart(2, '0')} – ${String(d).padStart(2, '0')} ${MONTHS_FR[m - 1]} ${y}`,
    labelLong: `du ${String(start.d).padStart(2, '0')} au ${String(d).padStart(2, '0')} ${MONTHS_FR[m - 1]} ${y}`,
  };
}

/** The cycle whose window CONTAINS the given instant. */
function cycleForInstant(date) {
  const w = wallClock(new Date(date));
  const ends = cycleEndDays(w.y, w.m);
  let endDate;
  if (w.d <= ends[0]) endDate = { y: w.y, m: w.m, d: ends[0] };
  else if (w.d <= ends[1]) endDate = { y: w.y, m: w.m, d: ends[1] };
  else {
    const nm = w.m === 12 ? 1 : w.m + 1;
    const ny = w.m === 12 ? w.y + 1 : w.y;
    endDate = { y: ny, m: nm, d: cycleEndDays(ny, nm)[0] };
  }
  return cycleWithEnd(endDate);
}

/** The latest cycle END DATE that is on or before the given wall-clock date. */
function latestCycleEndOnOrBefore({ y, m, d }) {
  const ends = cycleEndDays(y, m);
  if (d >= ends[1]) return { y, m, d: ends[1] };
  if (d >= ends[0]) return { y, m, d: ends[0] };
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return { y: py, m: pm, d: cycleEndDays(py, pm)[1] };
}

/** ISO date (YYYY-MM-DD) of the latest cycle end that has arrived. */
function latestDueCycleEndIso(now) {
  return cycleWithEnd(latestCycleEndOnOrBefore(wallClock(new Date(now)))).endDate;
}

/**
 * Cycles that are settleable as of `now`: every cycle whose end DATE is
 * today or in the past (oldest first). On a cycle's end day the admin may
 * already settle it ("payouts run on the 15th and the 30th"); earnings that
 * materialize later that day become stragglers swept by a later settlement.
 */
function settleableCycles(now, lookbackMonths = 12) {
  const list = [];
  let endDate = latestCycleEndOnOrBefore(wallClock(new Date(now)));
  for (let i = 0; i < lookbackMonths * 2; i++) {
    list.push(cycleWithEnd(endDate));
    endDate = previousCycleEnd(endDate);
  }
  return list.reverse(); // oldest first
}

/**
 * Validate a (cycleStart, cycleEnd) pair against the real calendar —
 * settlement may only target actual cycle boundaries, never arbitrary
 * date ranges. Returns the normalized cycle object or null.
 */
function isValidCyclePair(startStr, endStr) {
  const s = parseIsoDate(startStr);
  const e = parseIsoDate(endStr);
  if (!s || !e) return null;
  const ends = cycleEndDays(e.y, e.m);
  if (e.d !== ends[0] && e.d !== ends[1]) return null;
  const cycle = cycleWithEnd(e);
  if (cycle.startDate !== isoDate(s.y, s.m, s.d)) return null;
  return cycle;
}

module.exports = {
  APP_TIMEZONE,
  cycleEndDays,
  cycleForInstant,
  cycleWithEnd,
  settleableCycles,
  latestCycleEndOnOrBefore,
  latestDueCycleEndIso,
  isValidCyclePair,
  previousCycleEnd,
  endOfDay,
  wallClock,
};
