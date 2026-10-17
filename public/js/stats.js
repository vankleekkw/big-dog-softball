// Derived softball stats — BROWSER copy. Keep in sync with functions/_lib/stats.js.
// ES module; import { withRates, fmtRate } from './stats.js'

export function totalBases(s) {
  const singles = s.b1 || Math.max(0, (s.h || 0) - (s.b2 || 0) - (s.b3 || 0) - (s.hr || 0));
  return singles + 2 * (s.b2 || 0) + 3 * (s.b3 || 0) + 4 * (s.hr || 0);
}

export function withRates(s) {
  const ab = s.ab || 0, bb = s.bb || 0, sac = s.sac || 0, h = s.h || 0;
  const tb = totalBases(s);
  const obDen = ab + bb + sac;
  return {
    ...s, tb,
    avg: ab ? h / ab : 0,
    slg: ab ? tb / ab : 0,
    obp: obDen ? (h + bb + sac) / obDen : 0,
    get ops() { return this.obp + this.slg; },
  };
}

// Baseball-style rate: 3 decimals, strip the leading zero (".572", "1.250").
export function fmtRate(x) {
  if (x == null || isNaN(x)) return "—";
  const s = x.toFixed(3);
  return s.startsWith("0.") ? s.slice(1) : s;
}
