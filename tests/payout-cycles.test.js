/**
 * Payout cycle calendar tests (issue #24).
 *
 * The calendar is pure date math in the app timezone (America/Port-au-Prince)
 * derived from the Intl API, so these tests assert:
 *   * the 15th/30th rule with February using the LAST calendar day
 *     (28th in 2026/2027, 29th in leap years 2028/2032);
 *   * windows tile CONTIGUOUSLY (no gap, no overlap) — an earning can never
 *     belong to two cycles;
 *   * window boundaries land at end-of-day in the app timezone (23:59:59.999);
 *   * cycleForInstant maps boundary instants to the correct cycle;
 *   * settleableCycles/due logic only exposes cycles whose end date arrived;
 *   * isValidCyclePair rejects arbitrary date ranges.
 */
'use strict';

import { describe, expect, it } from 'vitest';
const cycles = await import('../src/payout-cycles.js').then((m) => m.default ?? m);

const APP_TZ = 'America/Port-au-Prince';

function wallClockString(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

/** Instant at a given wall-clock time in the app timezone (test helper mirror). */
function haitiInstant(y, m, d, hh = 0, mm = 0, ss = 0, ms = 0) {
  const target = Date.UTC(y, m - 1, d, hh, mm, ss, ms);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date(guess));
    const [datePart, timePart] = fmt.split(', ');
    const [mm2, dd, yy] = datePart.split('/');
    const [h24, mi, se] = timePart.split(':');
    const asUTC = Date.UTC(Number(yy), Number(mm2) - 1, Number(dd), Number(h24) % 24, Number(mi), Number(se));
    const offset = asUTC - Math.floor(guess / 1000) * 1000;
    const next = target - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

describe('cycle end days (15th + 30th; February = last calendar day)', () => {
  it('regular months end on the 15th and the 30th', () => {
    expect(cycles.cycleEndDays(2026, 1)).toEqual([15, 30]);  // January
    expect(cycles.cycleEndDays(2026, 4)).toEqual([15, 30]);  // April (30-day month)
    expect(cycles.cycleEndDays(2026, 10)).toEqual([15, 30]); // October
  });

  it('February 2026 (non-leap) ends on the 28th', () => {
    expect(cycles.cycleEndDays(2026, 2)).toEqual([15, 28]);
  });

  it('February 2028 (leap year) ends on the 29th', () => {
    expect(cycles.cycleEndDays(2028, 2)).toEqual([15, 29]);
  });

  it('February 2100 (century, NOT a leap year) ends on the 28th', () => {
    expect(cycles.cycleEndDays(2100, 2)).toEqual([15, 28]);
  });
});

describe('cycle descriptors', () => {
  it('cycle ending 2026-10-30 starts 2026-10-16', () => {
    const c = cycles.cycleWithEnd({ y: 2026, m: 10, d: 30 });
    expect(c.startDate).toBe('2026-10-16');
    expect(c.endDate).toBe('2026-10-30');
  });

  it('cycle ending 2026-10-15 starts 2026-10-01', () => {
    const c = cycles.cycleWithEnd({ y: 2026, m: 10, d: 15 });
    expect(c.startDate).toBe('2026-10-01');
    expect(c.endDate).toBe('2026-10-15');
  });

  it('cycle after February starts on the 1st (Feb 2027 non-leap)', () => {
    // Cycle ending Mar 15 starts Mar 1 because February ended on the 28th.
    const c = cycles.cycleWithEnd({ y: 2027, m: 3, d: 15 });
    expect(c.startDate).toBe('2027-03-01');
    // ...and the cycle ending Feb 28 starts Feb 16.
    const feb = cycles.cycleWithEnd({ y: 2027, m: 2, d: 28 });
    expect(feb.startDate).toBe('2027-02-16');
  });

  it('cycle ending Feb 15 starts Jan 31 (Jan 30 is the previous cycle end; Jan 31 falls inside the Feb cycle window)', () => {
    const c = cycles.cycleWithEnd({ y: 2026, m: 2, d: 15 });
    expect(c.startDate).toBe('2026-01-31');
    expect(c.endDate).toBe('2026-02-15');
  });

  it('window boundaries are the LAST instant of each end day (app timezone)', () => {
    const c = cycles.cycleWithEnd({ y: 2026, m: 10, d: 30 });
    expect(wallClockString(c.windowEndInclusive)).toBe('10/30/2026, 23:59:59');
    expect(c.windowEndInclusive.getMilliseconds()).toBe(999);
    expect(wallClockString(c.windowStartExclusive)).toBe('10/15/2026, 23:59:59');
  });
});

describe('windows tile contiguously (no earning can be counted twice)', () => {
  it('consecutive cycles share the boundary instant exactly', () => {
    // Walk 3 years of cycles backward; each NEWER window's exclusive start
    // MUST equal the OLDER window's inclusive end.
    let end = { y: 2026, m: 10, d: 30 };
    let newer = null;
    for (let i = 0; i < 72; i++) {
      const older = cycles.cycleWithEnd(end);
      if (newer) {
        expect(newer.windowStartExclusive.getTime()).toBe(older.windowEndInclusive.getTime());
      }
      newer = older;
      end = cycles.previousCycleEnd(end);
    }
  });
});

describe('cycleForInstant', () => {
  it('an instant mid-month maps to the current half-month cycle', () => {
    const t = haitiInstant(2026, 10, 20, 12, 0, 0);
    expect(cycles.cycleForInstant(t).endDate).toBe('2026-10-30');
    const t2 = haitiInstant(2026, 10, 3, 8, 0, 0);
    expect(cycles.cycleForInstant(t2).endDate).toBe('2026-10-15');
  });

  it('boundary instant (last instant of an end day) belongs to that cycle', () => {
    const boundary = cycles.cycleWithEnd({ y: 2026, m: 10, d: 30 }).windowEndInclusive;
    expect(cycles.cycleForInstant(boundary).endDate).toBe('2026-10-30');
  });

  it('one instant after the boundary belongs to the NEXT cycle', () => {
    const after = new Date(cycles.cycleWithEnd({ y: 2026, m: 10, d: 30 }).windowEndInclusive.getTime() + 1);
    expect(cycles.cycleForInstant(after).endDate).toBe('2026-11-15');
  });

  it('the 31st of a 31-day month belongs to the next month\'s 15th cycle', () => {
    const t = haitiInstant(2026, 10, 31, 10, 0, 0);
    expect(cycles.cycleForInstant(t).endDate).toBe('2026-11-15');
  });

  it('February boundary: last instant of Feb 28 2027 belongs to the Feb-28 cycle', () => {
    const boundary = cycles.cycleWithEnd({ y: 2027, m: 2, d: 28 }).windowEndInclusive;
    expect(cycles.cycleForInstant(boundary).endDate).toBe('2027-02-28');
    const after = new Date(boundary.getTime() + 1);
    expect(cycles.cycleForInstant(after).endDate).toBe('2027-03-15');
  });
});

describe('settleable (due) cycles', () => {
  it('on the 20th, the latest due cycle ends on the 15th', () => {
    const now = haitiInstant(2026, 10, 20, 9, 0, 0);
    const list = cycles.settleableCycles(now, 1);
    expect(list[list.length - 1].endDate).toBe('2026-10-15');
    expect(cycles.latestDueCycleEndIso(now)).toBe('2026-10-15');
  });

  it('ON the cycle end day, that cycle is already settleable', () => {
    const now = haitiInstant(2026, 10, 30, 8, 0, 0);
    expect(cycles.latestDueCycleEndIso(now)).toBe('2026-10-30');
    const now15 = haitiInstant(2026, 10, 15, 23, 30, 0);
    expect(cycles.latestDueCycleEndIso(now15)).toBe('2026-10-15');
  });

  it('on the 1st, the latest due cycle is the previous month\'s last cycle', () => {
    const now = haitiInstant(2026, 11, 1, 0, 30, 0);
    expect(cycles.latestDueCycleEndIso(now)).toBe('2026-10-30');
  });

  it('settleableCycles is ordered oldest → newest', () => {
    const list = cycles.settleableCycles(haitiInstant(2026, 10, 20, 9, 0, 0), 2);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].endDate < list[i].endDate).toBe(true);
    }
    expect(list[0].endDate).toBe('2026-08-30');
  });

  it('crosses February correctly (Feb 10 → latest due is Jan 30)', () => {
    const now = haitiInstant(2027, 2, 10, 9, 0, 0);
    expect(cycles.latestDueCycleEndIso(now)).toBe('2027-01-30');
  });

  it('handles DST-style timezone shifts via the tz database (structural)', () => {
    // America/Port-au-Prince observes DST (EDT/EST) in the tz database —
    // boundary instants shift by an hour across transitions, and windows
    // must STILL tile across those transitions.
    let end = { y: 2015, m: 7, d: 30 };
    let newer = null;
    for (let i = 0; i < 24; i++) {
      const older = cycles.cycleWithEnd(end);
      if (newer) {
        expect(newer.windowStartExclusive.getTime()).toBe(older.windowEndInclusive.getTime());
      }
      newer = older;
      end = cycles.previousCycleEnd(end);
    }
  });
});

describe('isValidCyclePair', () => {
  it('accepts a real cycle', () => {
    expect(cycles.isValidCyclePair('2026-10-16', '2026-10-30')).not.toBeNull();
    expect(cycles.isValidCyclePair('2026-10-01', '2026-10-15')).not.toBeNull();
    expect(cycles.isValidCyclePair('2027-02-16', '2027-02-28')).not.toBeNull();
  });

  it('rejects arbitrary ranges and non-boundary ends', () => {
    expect(cycles.isValidCyclePair('2026-10-16', '2026-10-29')).toBeNull(); // end not a boundary
    expect(cycles.isValidCyclePair('2026-10-01', '2026-10-31')).toBeNull(); // 31st is not a cycle end
    expect(cycles.isValidCyclePair('2026-10-10', '2026-10-30')).toBeNull(); // wrong start
    expect(cycles.isValidCyclePair('2026-10-16', 'not-a-date')).toBeNull();
    expect(cycles.isValidCyclePair(1618033987, '2026-10-30')).toBeNull();
  });
});
