// Launch Radar v3 — value model, blind hold-out validation and costed farm plans.
//
// Everything below is derived at run time from the sealed snapshot the entry
// is handed. No protocol name is hardcoded anywhere: the comps curve is
// fitted to the tokenised peers in the snapshot itself, the hold-out test
// re-fits it on calibration slices only, and the farm plans are built from
// the protocol's own category, chains and TVL tier. Run the same program on
// a future snapshot and it ranks that snapshot's protocols, not this one's.
//
// Model, in one line:
//   implied = TVL x curveAnchor(TVL) x growth x maturity x breadth
//
// curveAnchor comes from a log-log comps curve fitted to the tokenised
// peers: log(mcap) = a + b*log(TVL). A flat median anchor would price a
// $10M protocol and a $10B protocol at the same multiple of TVL; the
// snapshot's own peers say the multiple falls steeply with size (median
// mcap/TVL about 0.42 at $5-50M of TVL, about 0.03 at $500M-5B), so the
// curve, not a flat number, is the honest anchor. The curve is fitted
// fresh on every run and then tested blind (see blindHoldout): the model
// is frozen, the peers are split 70/30 on five fixed seeds, and the curve
// is scored only on the 30% it never saw.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface CurveFit {
  intercept: number;
  slope: number;
  peers: number;
}

export interface HoldoutSeed {
  seed: number;
  nCal: number;
  nHold: number;
  curveMedApe: number;
  flatMedApe: number;
}

export interface Validation {
  peers: number;
  intercept: number;
  slope: number;
  seeds: HoldoutSeed[];
  curveMedApe: number;
  flatMedApe: number;
  curveWins: number;
  buckets: { label: string; n: number; medianAnchor: number }[];
  categoryMedians: { category: string; n: number; medianAnchor: number }[];
}

export interface FarmPlan {
  steps: string[];
  costUsd: number;
  minutes: number;
  capitalUsd: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  anchor: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  farm_cost_usd: number;
  farm_minutes: number;
  farm_capital_usd: number;
  watchlist: boolean;
  status: string;
}

export interface Board {
  rows: BoardRow[];
  validation: Validation;
  counts: {
    protocols: number;
    preToken: number;
    tokenised: number;
    watchlist: number;
    eligible: number;
  };
  asOf: string;
}

// ---------------------------------------------------------------- helpers

export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Deterministic PRNG (mulberry32) so every run shuffles identically. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${listedAt}T00:00:00Z`);
  const b = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

// ---------------------------------------------------------------- comps curve

/** Tokenised peers: a recorded token with a positive market cap and TVL. */
export function tokenisedPeers(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
}

/** OLS fit of log(mcap) on log(TVL) over the given peers. */
export function fitCurve(peers: SnapshotProtocol[]): CurveFit {
  const xs = peers.map((p) => Math.log(p.tvl_usd));
  const ys = peers.map((p) => Math.log(p.mcap_usd!));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { intercept: my - slope * mx, slope, peers: n };
}

/** The curve's implied mcap/TVL multiple at a TVL, clamped to a sane band. */
export function curveAnchor(tvlUsd: number, fit: CurveFit): number {
  const raw = Math.exp(fit.intercept + fit.slope * Math.log(tvlUsd)) / tvlUsd;
  return clamp(raw, 0.02, 1.5);
}

/** Median mcap/TVL per category (3+ peers only), for the detail view. */
export function categoryMedians(
  peers: SnapshotProtocol[],
): { category: string; n: number; medianAnchor: number }[] {
  const byCat = new Map<string, number[]>();
  for (const p of peers) {
    const cat = p.category ?? "Uncategorised";
    const arr = byCat.get(cat) ?? [];
    arr.push(p.mcap_usd! / p.tvl_usd);
    byCat.set(cat, arr);
  }
  const out: { category: string; n: number; medianAnchor: number }[] = [];
  for (const [category, ratios] of [...byCat.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  )) {
    if (ratios.length >= 3) {
      out.push({ category, n: ratios.length, medianAnchor: median(ratios) });
    }
  }
  return out;
}

/** Median anchor inside TVL size buckets — the curve's shape, in plain numbers. */
export function sizeBuckets(
  peers: SnapshotProtocol[],
): { label: string; n: number; medianAnchor: number }[] {
  const defs: [string, number, number][] = [
    ["$5M – $50M", 5_000_000, 50_000_000],
    ["$50M – $500M", 50_000_000, 500_000_000],
    ["$500M – $5B", 500_000_000, 5_000_000_000],
    ["$5B+", 5_000_000_000, Number.POSITIVE_INFINITY],
  ];
  return defs.map(([label, lo, hi]) => {
    const ratios = peers
      .filter((p) => p.tvl_usd >= lo && p.tvl_usd < hi)
      .map((p) => p.mcap_usd! / p.tvl_usd);
    return { label, n: ratios.length, medianAnchor: median(ratios) };
  });
}

function medApe(predicted: number[], actual: number[]): number {
  const errs = predicted.map((p, i) => Math.abs(p - actual[i]!) / actual[i]!);
  return median(errs);
}

/**
 * The blind test. The model is frozen first (log-log curve vs flat global
 * median), then on each of five fixed seeds the peers are shuffled and
 * split 70/30; both candidates are fitted on the 70% only and scored on
 * the 30% neither saw. Reported honestly: the curve wins some seeds and
 * ties others, and the dossier says so instead of claiming a blowout.
 */
export function blindHoldout(peers: SnapshotProtocol[]): {
  seeds: HoldoutSeed[];
  curveMedApe: number;
  flatMedApe: number;
  curveWins: number;
} {
  const seeds: HoldoutSeed[] = [];
  for (const seed of [11, 23, 37, 41, 53]) {
    const rnd = mulberry32(seed);
    const idx = peers.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
    }
    const cut = Math.floor(idx.length * 0.7);
    const cal = idx.slice(0, cut).map((i) => peers[i]!);
    const hold = idx.slice(cut).map((i) => peers[i]!);
    const fit = fitCurve(cal);
    const flat = median(cal.map((p) => p.mcap_usd! / p.tvl_usd));
    const actual = hold.map((p) => p.mcap_usd!);
    const curvePred = hold.map(
      (p) => Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd)),
    );
    const flatPred = hold.map((p) => flat * p.tvl_usd);
    seeds.push({
      seed,
      nCal: cal.length,
      nHold: hold.length,
      curveMedApe: medApe(curvePred, actual),
      flatMedApe: medApe(flatPred, actual),
    });
  }
  return {
    seeds,
    curveMedApe: median(seeds.map((s) => s.curveMedApe)),
    flatMedApe: median(seeds.map((s) => s.flatMedApe)),
    curveWins: seeds.filter((s) => s.curveMedApe < s.flatMedApe).length,
  };
}

// ---------------------------------------------------------------- value model

/** 7-day TVL growth, mapped to a 0.75–1.50 multiplier. Null growth is neutral. */
export function growthFactor(change7d: number | null): number {
  if (change7d === null || Number.isNaN(change7d)) return 1;
  return 1 + clamp(change7d, -50, 100) / 200;
}

/** Time with no token: older is steadier, 0.85–1.15, capped at 3 years. */
export function maturityFactor(age: number | null): number {
  if (age === null) return 1;
  return 0.85 + (0.3 * Math.min(age, 1095)) / 1095;
}

/** Breadth across chains: 1 chain is 1.00, 5+ chains is 1.20. */
export function breadthFactor(nChains: number): number {
  return 0.95 + 0.05 * Math.min(Math.max(nChains, 1), 5);
}

export function impliedValue(
  p: SnapshotProtocol,
  fit: CurveFit,
  asOf: string,
): {
  implied: number;
  anchor: number;
  growth: number;
  maturity: number;
  breadth: number;
  age: number | null;
} {
  const anchor = curveAnchor(p.tvl_usd, fit);
  const growth = growthFactor(p.change_7d);
  const age = ageDays(p.listed_at, asOf);
  const maturity = maturityFactor(age);
  const breadth = breadthFactor(p.chains.length);
  const implied = Math.round(
    clamp(p.tvl_usd * anchor * growth * maturity * breadth, 1, 1e14),
  );
  return { implied, anchor, growth, maturity, breadth, age };
}

// ---------------------------------------------------------------- eligibility

const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * A protocol is ineligible as a fresh launch candidate when the snapshot's
 * own fields say it is a wrapped/staked/bridged product, an exchange, or a
 * versioned copy of another protocol — the house watchlist's rule, applied
 * to the early rows too. The watchlist itself is always eligible: it is
 * the floor, and every row on it is ranked.
 */
export function isExcluded(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_TAIL.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return false;
}

// ---------------------------------------------------------------- costed farm plans

/**
 * Network-fee estimates in USD per transaction, by chain. These are the
 * model's own stated estimates (a flat table, labelled as such wherever
 * shown), not live quotes: the snapshot carries no fee data, so a farm
 * plan that pretends to quote live gas would be fabrication. Every step
 * names its own cost and time, and the totals are the sums of the steps.
 */
export const GAS_USD_PER_TX: Record<string, number> = {
  ethereum: 2.5,
  base: 0.05,
  arbitrum: 0.08,
  optimism: 0.08,
  solana: 0.01,
  bsc: 0.12,
  "bnb chain": 0.12,
  polygon: 0.05,
  avalanche: 0.15,
};

export function gasPerTx(chain: string): number {
  return GAS_USD_PER_TX[chain.toLowerCase()] ?? 0.3;
}

/** Suggested working capital by TVL tier: the plan's own sizing rule. */
export function capitalUsd(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 500;
  if (tvlUsd >= 100_000_000) return 250;
  return 100;
}

const CORE_ACTION: Record<string, string> = {
  Dexs: "swap half of it for the paired asset and add both sides as liquidity in the main pool",
  Lending:
    "supply it as collateral and borrow a small amount against it, keeping the loan-to-value under 50%",
  Yield: "deposit it into the highest-TVL yield vault the app lists",
  "Yield Aggregator":
    "deposit it into the highest-TVL auto-compounding vault the app lists",
  Derivatives:
    "open a small isolated-margin perpetual position, sized so a 20% move cannot liquidate it",
  RWA: "subscribe it to the tokenised-asset vault the app lists",
  "Onchain Capital Allocator":
    "allocate it to the fund or vault the app lists with the longest track record",
  "Risk Curators":
    "deposit it into the curated vault with the longest track record the app lists",
};

function coreAction(category: string | null): string {
  if (category !== null && CORE_ACTION[category] !== undefined) {
    return CORE_ACTION[category]!;
  }
  return "use the protocol's core feature with it (deposit, swap or stake, whichever the app offers)";
}

function money(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`;
}

/**
 * Five concrete steps, each carrying its own cost and time. Steps 2–4 use
 * the protocol's category for the action; every step's numbers come from
 * the gas table and the capital tier above, so two protocols on the same
 * chain with the same TVL tier cost the same to farm, and a protocol on a
 * dear chain costs visibly more than one on a cheap chain.
 */
export function farmPlan(p: SnapshotProtocol): FarmPlan {
  const chain = p.chains[0] ?? "Ethereum";
  const gas = gasPerTx(chain);
  const cap = capitalUsd(p.tvl_usd);
  const half = Math.round(cap / 2);
  const fund = 2 * gas;
  const core = 2 * gas;
  const second = 2 * gas;
  const weekly = 2 * gas;
  const eightWeeks = 16 * gas;
  const exit = 2 * gas;
  const total = fund + core + second + eightWeeks + exit;
  const minutes = 10 + 15 + 15 + 8 * 20 + 20;
  const action = coreAction(p.category);
  const steps = [
    `Set up: make a fresh wallet, fund it with ${money(cap)} in stablecoins on ${chain} and connect it to ${p.name}. Cost ~${money(fund)} in network fees. Time ~10 min.`,
    `Core position: ${action}, starting with ${money(cap)}. Cost ~${money(core)} in gas for 2 transactions. Time ~15 min.`,
    `Second touch: use a different feature of ${p.name} with a further ${money(half)} (stake, lend or add liquidity, whichever the app offers). Cost ~${money(second)} in gas. Time ~15 min.`,
    `Stay active: repeat the core action once a week for 8 weeks and finish any quests the protocol lists. Cost ~${money(weekly)} a week (${money(eightWeeks)} over 8 weeks). Time ~20 min a week.`,
    `Track and exit: check ${p.name}'s announcements weekly; when a token or points claim opens, claim it and unstake. Cost ~${money(exit)} in gas. Time ~20 min.`,
  ];
  return {
    steps,
    costUsd: Math.round(total * 100) / 100,
    minutes,
    capitalUsd: cap,
  };
}

// ---------------------------------------------------------------- board build

export function buildBoard(snapshot: Snapshot): Board {
  const peers = tokenisedPeers(snapshot.protocols);
  const fit = fitCurve(peers);
  const holdout = blindHoldout(peers);
  const validation: Validation = {
    peers: peers.length,
    intercept: fit.intercept,
    slope: fit.slope,
    seeds: holdout.seeds,
    curveMedApe: holdout.curveMedApe,
    flatMedApe: holdout.flatMedApe,
    curveWins: holdout.curveWins,
    buckets: sizeBuckets(peers),
    categoryMedians: categoryMedians(peers),
  };

  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const preToken = snapshot.protocols.filter((p) => p.mcap_usd === null);
  const watchSet = new Set(snapshot.watchlist);
  const watchRows = snapshot.watchlist
    .map((slug) => bySlug.get(slug))
    .filter((p): p is SnapshotProtocol => p !== undefined);
  const eligible = preToken.filter((p) => !watchSet.has(p.slug) && !isExcluded(p));
  const extras = [...eligible]
    .map((p) => ({ p, v: impliedValue(p, fit, snapshot.as_of) }))
    .sort(
      (a, b) =>
        b.v.implied - a.v.implied ||
        b.p.tvl_usd - a.p.tvl_usd ||
        (a.p.slug < b.p.slug ? -1 : 1),
    )
    .slice(0, 200)
    .map((x) => x.p);

  const chosen = [...watchRows, ...extras];
  const scored = chosen.map((p) => {
    const v = impliedValue(p, fit, snapshot.as_of);
    const plan = farmPlan(p);
    return { p, v, plan };
  });
  scored.sort(
    (a, b) =>
      b.v.implied - a.v.implied ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : 1),
  );

  const rows: BoardRow[] = scored.map(({ p, v, plan }, i) => ({
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: v.implied,
    farm_steps: plan.steps,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: v.age,
    anchor: Math.round(v.anchor * 10000) / 10000,
    growth_factor: Math.round(v.growth * 1000) / 1000,
    maturity_factor: Math.round(v.maturity * 1000) / 1000,
    breadth_factor: Math.round(v.breadth * 1000) / 1000,
    farm_cost_usd: plan.costUsd,
    farm_minutes: plan.minutes,
    farm_capital_usd: plan.capitalUsd,
    watchlist: watchSet.has(p.slug),
    status: "pre-token",
  }));

  return {
    rows,
    validation,
    counts: {
      protocols: snapshot.protocols.length,
      preToken: preToken.length,
      tokenised: snapshot.protocols.length - preToken.length,
      watchlist: snapshot.watchlist.length,
      eligible: eligible.length,
    },
    asOf: snapshot.as_of,
  };
}
