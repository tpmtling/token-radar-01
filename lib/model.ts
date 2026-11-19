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

export interface Comp {
  category: string;
  anchor: number;
  observed_median: number | null;
  observations: number;
  multiple: number;
}

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  excluded: boolean;
  exclusion_reason: string | null;
  implied_value_usd: number | null;
  comp_multiple: number | null;
  momentum_multiplier: number | null;
  age_multiplier: number | null;
  confidence: number;
  confidence_label: string;
  thesis: string | null;
  farm_plan: string[];
}

export interface RadarRow {
  slug: string;
  name: string;
  w: boolean;
  category: string | null;
  ci: number[];
  chain: string;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  comp_multiple: number;
  confidence: number;
  plan: string;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  schema: string;
  summary: { watchlist: number; included: number; excluded: number; early: number; live: number };
  chains: string[];
  comps: Comp[];
  plans: Record<string, string[]>;
  phrases: Record<string, string>;
  screened: { slug: string; name: string; category: string | null; tvl_usd: number; reason: string }[];
  rows: RadarRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const EARLY_ROWS = 64;
const MIN_BOARD_ROWS = 100;

const ANCHORS: Record<string, number> = {
  'dexs': 1.5,
  'derivatives': 2.0,
  'options': 1.8,
  'options vault': 1.6,
  'interest rate derivatives': 1.7,
  'synthetics': 1.7,
  'lending': 1.2,
  'cdp': 1.3,
  'cdp manager': 1.2,
  'collateral markets': 1.3,
  'collateral management': 1.3,
  'uncollateralized lending': 1.0,
  'risk curators': 1.6,
  'onchain capital allocator': 1.5,
  'yield': 1.3,
  'yield aggregator': 1.2,
  'liquidity manager': 1.2,
  'basis trading': 1.1,
  'leveraged farming': 1.2,
  'farm': 1.1,
  'rwa': 1.0,
  'chain': 1.8,
  'restaking': 0.9,
  'staking pool': 0.8,
  'governance incentives': 0.9,
  'cedefi': 1.1,
  'insurance': 1.2,
  'payments': 0.9,
  'privacy': 1.2,
  'prediction market': 1.5,
  'launchpad': 1.3,
  'indexes': 1.0,
  'ai agents': 1.6,
  'decentralized ai': 1.6,
  'nft marketplace': 1.0,
  'otc marketplace': 1.0,
  'token locker': 0.7,
  'community': 0.8,
};

const DEFAULT_ANCHOR = 1.1;

const CATEGORY_EXCLUSIONS: { re: RegExp; reason: string }[] = [
  { re: /^(liquid staking|liquid restaking|lst|lrt)$/i, reason: 'Liquid-staking derivative: value accrues to the underlying token, not a new launch.' },
  { re: /^(wrapped|bridged|stablecoin wrapper|canonical bridge|cross chain bridge|restaked btc|anchor btc|decentralized btc)$/i, reason: 'Wrapped or bridged product of an existing asset; no independent token thesis.' },
  { re: /^options vault$/i, reason: 'Options vault is a yield wrapper around an existing asset, not a standalone protocol.' },
  { re: /^cex$/i, reason: 'Centralised exchange: it does not launch a user-facing DeFi token.' },
];

const NAME_DERIVATIVE = /\b(staked|restaked|wrapped|bridged|vaults?|savings?|liquid staking|liquid restaking|lst|lrt|earn|pooling)\b/i;
const DERIV_PREFIX = /^(?:w|r|x|st|cb)[A-Z]/;
const VERSIONED = /\s[vV]\d+(?:\.\d+)?$/;
const GENERIC_SUFFIX = /\s+(bridge|staking|lending|farm|farm(s|ing)?|dex|vaults?|perps?|protocol|finance|mainnet|earn|pooling|app|v\d+(?:\.\d+)?|by\s+.+)$/i;

const THAT = (n: number): string => {
  if (!Number.isFinite(n)) return 'n/a';
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};

const pct = (n: number): string => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const norm = (s: string | null): string => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const blank = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (blank(listedAt)) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return blank(p.mcap_usd) && blank(p.gecko_id) && blank(p.symbol);
}

function anchorFor(category: string | null): number {
  const key = norm(category);
  if (ANCHORS[key] !== undefined) return ANCHORS[key]!;
  if (key.includes('liquid staking') || key.includes('liquid restaking')) return 0.4;
  if (key.includes('bridge') || key.includes('wrapped')) return 1.0;
  if (key.includes('staking')) return 0.8;
  if (key.includes('dex')) return 1.5;
  if (key.includes('lend') || key.includes('cdp') || key.includes('collateral')) return 1.2;
  if (key.includes('perpetual') || key.includes('derivative') || key.includes('option')) return 1.8;
  if (key.includes('rwa')) return 1.0;
  if (key.includes('yield') || key.includes('curator') || key.includes('allocator')) return 1.4;
  return DEFAULT_ANCHOR;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

export function buildComps(snapshot: Snapshot): Map<string, Comp> {
  const samples = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < 0.01 || ratio > 20) continue;
    const key = norm(p.category);
    const list = samples.get(key) ?? [];
    list.push(ratio);
    samples.set(key, list);
  }
  const out = new Map<string, Comp>();
  const categories = new Set<string>([...samples.keys(), ...snapshot.protocols.map((p) => norm(p.category))]);
  for (const category of categories) {
    const anchor = anchorFor(category === '' ? null : category);
    const values = samples.get(category) ?? [];
    const raw = median(values);
    const observed = raw === null ? null : clamp(raw, anchor * 0.25, anchor * 2.5);
    const multiple = round2(observed === null ? anchor : 0.65 * anchor + 0.35 * observed);
    const label = category === '' ? 'Other' : category.replace(/\b\w/g, (c) => c.toUpperCase());
    out.set(category, { category: label, anchor, observed_median: raw === null ? null : round2(raw), observations: values.length, multiple });
  }
  return out;
}

interface Family { root: string; symbol: string; name: string }

function tokenFamilies(snapshot: Snapshot): Family[] {
  const out: Family[] = [];
  const seen = new Set<string>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    let root = p.name.replace(GENERIC_SUFFIX, '').trim();
    if (root.length < 5) continue;
    const key = root.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ root: key, symbol: (p.symbol ?? '').trim().toUpperCase(), name: p.name });
  }
  return out;
}

export interface Exclusion { reason: string | null; family: string | null }

export function checkExclusion(p: SnapshotProtocol, families: Family[]): Exclusion {
  if (!isPreToken(p)) {
    return { reason: `Token already live (${(p.symbol ?? p.gecko_id ?? 'listed').trim()}); no pre-token launch to find.`, family: null };
  }
  const category = p.category ?? '';
  for (const rule of CATEGORY_EXCLUSIONS) {
    if (rule.re.test(category)) return { reason: rule.reason, family: null };
  }
  if (NAME_DERIVATIVE.test(p.name)) return { reason: 'Name marks a wrapped, staked, vault or earn product rather than a standalone protocol.', family: null };
  if (DERIV_PREFIX.test(p.name)) return { reason: 'Wrapped/liquid-derivative ticker prefix (w, r, x, st or cb) on an existing asset.', family: null };
  if (VERSIONED.test(p.name)) return { reason: 'Versioned deployment of an existing protocol, not a separate token candidate.', family: null };
  const lower = norm(p.name);
  for (const f of families) {
    if (lower === f.root || lower.startsWith(`${f.root} `) || lower.includes(` ${f.root} `)) {
      return { reason: `Product line of ${f.name}${f.symbol ? ` (token ${f.symbol})` : ''}; its parent already has a token.`, family: f.name };
    }
  }
  return { reason: null, family: null };
}

function categoryAction(p: SnapshotProtocol, cap: number, chain: string): string {
  const c = norm(p.category);
  const n = p.name;
  if (c.includes('risk curat')) return `Deposit $${cap} of USDC into ${n}'s curated vault on ${chain} and save the share receipt.`;
  if (c.includes('allocator') || c.includes('liquidity manager')) return `Allocate $${cap} of USDC to a ${n} vault on ${chain} and record the vault address.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${cap} of USDC as collateral on ${n} (${chain}), borrow 20% against it, then repay.`;
  if (c.includes('dex')) return `Add $${cap} of two-sided liquidity to the deepest ${n} pool on ${chain} and swap once a week.`;
  if (c.includes('derivative') || c.includes('option') || c.includes('synthetic')) return `Deposit $${cap} of USDC margin on ${n} (${chain}) and open one small hedged position.`;
  if (c.includes('rwa')) return `Subscribe $${cap} of USDC to ${n}'s tokenised fund on ${chain} and keep the subscription receipt.`;
  if (c.includes('basis')) return `Deposit $${cap} of USDC into ${n}'s basis-trade vault on ${chain} and track the funding spread weekly.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${cap} of USDC into ${n}'s base strategy on ${chain} and reinvest rewards weekly.`;
  if (c.includes('restak') || c.includes('staking pool')) return `Delegate $${cap} worth of the native staking asset through ${n} on ${chain} and keep the receipt.`;
  if (c.includes('chain')) return `Bridge $${cap} of USDC onto ${n} (${chain}), pay gas from that wallet and use one native app weekly.`;
  if (c.includes('insurance')) return `Buy $${cap} of cover from ${n} for ${chain} positions and keep the policy in the farm wallet.`;
  if (c.includes('payment')) return `Route $${cap} of test payments through ${n} on ${chain} and keep the transaction history.`;
  if (c.includes('governance')) return `Stake or delegate $${cap} through ${n} on ${chain} and vote in one governance proposal.`;
  if (c.includes('cedefi')) return `Deposit $${cap} of USDC in ${n}'s CeDeFi account on ${chain} and complete one verified transfer.`;
  return `Deposit $${cap} of USDC into ${n}'s main product on ${chain} and keep the position open.`;
}

export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1e9) return 250;
  if (p.tvl_usd >= 4e8) return 150;
  if (p.tvl_usd >= 1.5e8) return 100;
  return 50;
}

export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

export function stepText(step: FarmStep): string {
  const s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  return s.length > 600 ? `${s.slice(0, 596)}...` : s.length < 20 ? `${s} Keep the position funded.` : s;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its primary chain';
  const cap = capitalFor(p);
  const hold = holdDaysFor(age);
  const steps: FarmStep[] = [
    { text: `Open a dedicated wallet for ${p.name}, fund it with $${cap} of USDC plus about $6 of ${chain} gas, and confirm the app URL from ${p.name}'s own channels.`, cost: `$${cap} capital and ~$6 gas`, time: '10 minutes' },
    { text: categoryAction(p, cap, chain), cost: `$${cap} at risk plus ~$4 gas`, time: '15 minutes' },
    { text: `Do one qualifying on-chain action each week from that wallet: deposit, borrow, swap, rebalance or vote, whichever ${p.name} rewards.`, cost: '~$2 gas a week', time: '10 minutes a week' },
    { text: `Keep the position open for at least ${hold} days, checking TVL every Friday and trimming only if the 7-day flow stays negative.`, cost: `$${cap} stays deployed`, time: `${hold} days` },
    { text: `If ${p.name} opens a points or token page, connect through its own published domain and claim there only, never through a DM or search ad.`, cost: 'no fee to check; never pay to claim', time: '10 minutes' },
    { text: `Log the wallet, deposit tx hash, dates and rewards in one sheet, then compare any airdrop with the $${cap} at risk before adding more.`, cost: 'nothing beyond the log', time: '10 minutes' },
  ];
  return steps.map(stepText);
}

const THESIS_PHRASES: Record<string, string> = {
  'risk curators': 'a curator network whose allocator relationships make a points or token launch plausible',
  'onchain capital allocator': 'a vault allocator whose deposit base is a natural distribution surface',
  'rwa': 'tokenised-asset TVL that can be converted into onchain yield-token incentives',
  'dexs': 'a trading venue whose weekly flow would anchor a liquidity-token launch',
  'derivatives': 'a perps book where trading fees can support a governance token',
  'lending': 'a deposit base that converts cleanly into borrow-side incentives',
  'cdp': 'a minting venue whose collateral base supports a stablecoin token design',
  'chain': 'an active chain whose users and gas spend form a ready token constituency',
  'yield': 'a strategy layer where performance fees can back a token',
  'basis trading': 'a market-neutral vault whose spread history supports a token launch',
  'restaking': 'a shared-security restaker with operator and delegator distribution potential',
  'insurance': 'a cover book whose policy holders would form a token constituency',
  'payments': 'a payments network whose transaction count is a clean launch metric',
  'governance incentives': 'a incentive layer whose participants are already doing token-like work',
  'cedefi': 'a hybrid account product with a clear deposit-based airdrop surface',
  'staking pool': 'a delegator base that can be converted into a liquid token',
  'collateral markets': 'a collateral pool whose users would qualify for a governance token',
};

function thesisFor(p: SnapshotProtocol, comp: number, implied: number, age: number | null, growth: number): string {
  const chainText = p.chains.length > 0 ? p.chains[0]! : 'its chain';
  const flow = growth > 5 ? `${pct(growth)} 7d inflow` : growth < -5 ? `${pct(growth)} 7d outflow` : `flat 7d (${pct(growth)})`;
  const ageText = age === null ? 'age unknown' : age < 180 ? `${Math.max(1, Math.round(age / 30))}mo live` : age < 730 ? `${(age / 365).toFixed(1)}y live` : `${Math.floor(age / 365)}y live`;
  const key = norm(p.category);
  const phrase = THESIS_PHRASES[key] ?? (key.includes('lend') ? THESIS_PHRASES['lending']! : key.includes('dex') ? THESIS_PHRASES['dexs']! : 'an active user base that can be rewarded at launch');
  return `${p.name}: ${THAT(p.tvl_usd)} TVL on ${chainText}, ${flow}, ${ageText}; ${comp.toFixed(2)}x comp implies ${THAT(implied)} FDV. ${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}

export function impliedValue(p: SnapshotProtocol, asOf: string, comp: number): { implied: number; momentum: number; ageMult: number; age: number | null; growth: number } {
  const age = ageDays(asOf, p.listed_at);
  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, -40, 60);
  const momentum = 1 + (growth / 100) * 0.35;
  const ageMult = age === null ? 1 : 0.86 + 0.28 * Math.exp(-age / 540);
  return { implied: Math.max(1, Math.round(p.tvl_usd * comp * momentum * ageMult)), momentum, ageMult, age, growth };
}

function confidenceFor(p: SnapshotProtocol, comp: Comp): number {
  let c = 0.48;
  c += comp.observations >= 5 ? 0.12 : comp.observations >= 2 ? 0.07 : 0;
  c += p.tvl_usd >= 1e9 ? 0.12 : p.tvl_usd >= 2.5e8 ? 0.08 : p.tvl_usd >= 1e8 ? 0.04 : 0;
  c += p.change_7d === null ? 0 : 0.06;
  c += p.listed_at === null ? 0 : 0.06;
  return round2(clamp(c, 0.35, 0.93));
}

function confidenceLabel(c: number): string {
  return c >= 0.78 ? 'High' : c >= 0.62 ? 'Medium' : 'Low';
}

export interface RadarResult { board: BoardRow[]; radar: RadarData }

export function buildRadar(snapshot: Snapshot): RadarResult {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const comps = buildComps(snapshot);
  const families = tokenFamilies(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, { p: SnapshotProtocol; watchlisted: boolean }>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, { p, watchlisted: true });
  }
  const early = snapshot.protocols
    .filter((p) => !watch.has(p.slug) && p.tvl_usd < snapshot.floor_usd && checkExclusion(p, families).reason === null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, { p, watchlisted: false });

  const included: BoardRow[] = [];
  const excluded: BoardRow[] = [];
  for (const { p, watchlisted } of chosen.values()) {
    const check = checkExclusion(p, families);
    if (check.reason !== null) {
      excluded.push({
        rank: 0, slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
        change_7d: p.change_7d, listed_at: p.listed_at, age_days: ageDays(snapshot.as_of, p.listed_at),
        watchlist: watchlisted, excluded: true, exclusion_reason: check.reason, implied_value_usd: null,
        comp_multiple: null, momentum_multiplier: null, age_multiplier: null, confidence: 0,
        confidence_label: 'n/a', thesis: null, farm_plan: [],
      });
      continue;
    }
    const comp = comps.get(norm(p.category)) ?? { category: p.category ?? 'Other', anchor: DEFAULT_ANCHOR, observed_median: null, observations: 0, multiple: anchorFor(p.category) };
    const score = impliedValue(p, snapshot.as_of, comp.multiple);
    const confidence = confidenceFor(p, comp);
    const cap = capitalFor(p);
    const hold = holdDaysFor(score.age);
    included.push({
      rank: 0, slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      change_7d: p.change_7d, listed_at: p.listed_at, age_days: score.age, watchlist: watchlisted,
      excluded: false, exclusion_reason: null, implied_value_usd: score.implied,
      comp_multiple: comp.multiple, momentum_multiplier: round4(score.momentum), age_multiplier: round4(score.ageMult),
      confidence, confidence_label: confidenceLabel(confidence), thesis: thesisFor(p, comp.multiple, score.implied, score.age, score.growth),
      farm_plan: farmSteps(p, score.age),
    });
  }
  included.sort((a, b) => (b.implied_value_usd ?? 0) - (a.implied_value_usd ?? 0) || (a.slug < b.slug ? -1 : 1));
  excluded.sort((a, b) => Number(b.watchlist) - Number(a.watchlist) || b.tvl_usd - a.tvl_usd);
  const board = [...included, ...excluded].map((r, i) => ({ ...r, rank: i + 1 }));
  if (board.length < MIN_BOARD_ROWS) {
    throw new SnapshotError(`only ${board.length} rows: the board needs at least ${MIN_BOARD_ROWS}`);
  }

  const active = new Set(included.map((r) => norm(r.category)));
  const chainNames = [...new Set(included.flatMap((r) => r.chains))].sort();
  const chainIndex = new Map(chainNames.map((c, i) => [c, i]));
  const rows: RadarRow[] = included.map((r) => ({
    slug: r.slug, name: r.name, w: r.watchlist, category: r.category,
    ci: r.chains.map((c) => chainIndex.get(c)!), chain: r.chains[0] ?? 'its chain',
    tvl_usd: r.tvl_usd, change_7d: r.change_7d, age_days: r.age_days,
    implied_value_usd: r.implied_value_usd!, comp_multiple: r.comp_multiple!, confidence: r.confidence,
    plan: planKey(r.category),
  }));

  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, schema: 'token-radar/v1',
    summary: {
      watchlist: snapshot.watchlist.length, included: included.length, excluded: excluded.length,
      early: included.filter((r) => !r.watchlist).length,
      live: snapshot.protocols.filter((p) => !isPreToken(p)).length,
    },
    chains: chainNames,
    comps: [...comps.values()].filter((c) => active.has(c.category.toLowerCase()) || c.observations > 0).sort((a, b) => a.category.localeCompare(b.category)),
    plans: PLAN_TEMPLATES,
    phrases: THESIS_PHRASES,
    screened: excluded.filter((r) => r.watchlist).map((r) => ({ slug: r.slug, name: r.name, category: r.category, tvl_usd: r.tvl_usd, reason: r.exclusion_reason! })),
    rows,
  };

  return { board, radar };
}

function planKey(category: string | null): string {
  const c = norm(category);
  if (c.includes('risk curat')) return 'curator';
  if (c.includes('allocator') || c.includes('manager')) return 'allocator';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex')) return 'dex';
  if (c.includes('derivative') || c.includes('option') || c.includes('synthetic')) return 'perps';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('basis')) return 'basis';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  if (c.includes('restak') || c.includes('staking')) return 'staking';
  if (c.includes('chain')) return 'chain';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('payment')) return 'payments';
  if (c.includes('governance')) return 'governance';
  if (c.includes('cedefi')) return 'cedefi';
  return 'generic';
}

export const PLAN_TEMPLATES: Record<string, string[]> = {
  curator: ['Open a dedicated wallet, fund it with {{$cap}} USDC plus {{$gas}} of {{chain}} gas, and verify the app URL from {{name}} itself.', 'Deposit {{$cap}} USDC into {{name}}’s curated vault on {{chain}} and save the share receipt.', 'Add, rebalance or vote once a week from the same address so the wallet shows real curator activity.', 'Hold for {{hold}} days and review the vault’s 7-day flow every Friday before adding more.', 'If points open, connect only through {{name}}’s published domain and claim there; never use a DM link.', 'Log the wallet, tx hash and dates, then weigh any airdrop against the {{$cap}} at risk.'],
  allocator: ['Open a dedicated wallet with {{$cap}} USDC and {{$gas}} of {{chain}} gas for {{name}}.', 'Allocate {{$cap}} USDC to a {{name}} vault on {{chain}} and record the vault address.', 'Rotate or top up one allocation each week to build a visible onchain history.', 'Hold for {{hold}} days, checking the vault’s weekly TVL and fee notes.', 'Claim points or tokens only from {{name}}’s own site after checking the URL.', 'Log every deposit and reward, then compare any token with the {{$cap}} deployed.'],
  lending: ['Open a dedicated wallet with {{$cap}} USDC and {{$gas}} of {{chain}} gas for {{name}}.', 'Supply {{$cap}} USDC as collateral on {{name}} ({{chain}}), borrow 20% against it, and repay.', 'Borrow, repay or add collateral once a week so the address shows repeated lending use.', 'Hold the position for {{hold}} days and watch utilisation and health factor every Friday.', 'If {{name}} launches points, connect through its own domain and claim from there only.', 'Log the wallet, tx hashes and dates; measure any token against the {{$cap}} at risk.'],
  dex: ['Open a dedicated wallet with {{$cap}} USDC, {{$gas}} of {{chain}} gas, and the paired asset for {{name}}.', 'Add {{$cap}} of two-sided liquidity to {{name}}’s deepest pool on {{chain}} and save the LP receipt.', 'Swap or rebalance once a week from the same wallet to build trading history.', 'Hold the LP position for {{hold}} days and check pool volume and fee APR weekly.', 'Claim rewards only on {{name}}’s own site; ignore airdrop links in DMs.', 'Log fees, impermanent loss and dates before deciding whether to keep the position.'],
  perps: ['Open a dedicated wallet with {{$cap}} USDC and {{$gas}} of {{chain}} gas for {{name}}.', 'Deposit {{$cap}} USDC margin on {{name}} ({{chain}}) and open one small hedged position.', 'Close or roll the hedge weekly so the wallet records real trading activity.', 'Hold margin funded for {{hold}} days while tracking fees, funding and open interest.', 'Use only {{name}}’s published rewards page to claim points or tokens.', 'Log trades and funding paid; compare any reward with the {{$cap}} risked.'],
  rwa: ['Open a dedicated wallet with {{$cap}} USDC and {{$gas}} of {{chain}} gas, and complete any required verification for {{name}}.', 'Subscribe {{$cap}} USDC to {{name}}’s tokenised fund on {{chain}} and keep the subscription receipt.', 'Check NAV and subscriptions weekly; add only if the fund is still issuing shares.', 'Hold for {{hold}} days so the wallet appears in more than one eligibility snapshot.', 'Claim only from {{name}}’s own rewards or investor page if one is announced.', 'Log the subscription, NAV dates and redemption terms; compare any token with {{$cap}}.'],
  basis: ['Open a dedicated wallet with {{$cap}} USDC and {{$gas}} of {{chain}} gas for {{name}}.', 'Deposit {{$cap}} USDC into {{name}}’s basis vault on {{chain}} and save the share receipt.', 'Check the funding spread weekly and add or trim only when the spread changes sign.', 'Hold for {{hold}} days; basis trades need more than one funding cycle.', 'If points are announced, claim through {{name}}’s own site only.', 'Log spread, fees and dates so the {{$cap}} position can be unwound cleanly.'],
  yield: ['Open a dedicated wallet with {{$cap}} USDC and {{$gas}} of {{chain}} gas for {{name}}.', 'Deposit {{$cap}} USDC into {{name}}’s base strategy on {{chain}} and record the receipt.', 'Compound or rebalance weekly from the same address to show active use.', 'Hold for {{hold}} days and review strategy APR, drawdown and TVL each Friday.', 'Claim points or rewards from {{name}}’s own domain, never from a link in chat.', 'Log deposits, yields and dates; weigh any token against the {{$cap}} at risk.'],
  staking: ['Open a dedicated wallet with {{$cap}} worth of the staking asset and {{$gas}} of {{chain}} gas for {{name}}.', 'Delegate or stake {{$cap}} through {{name}} on {{chain}} and keep the non-transferable receipt.', 'Claim rewards or restake once a week to keep the position active.', 'Hold for {{hold}} days and watch validator uptime and slashing notices weekly.', 'Claim any points or token only from {{name}}’s own site.', 'Log delegations and rewards; compare a launch with the {{$cap}} committed.'],
  chain: ['Open a dedicated wallet, bridge {{$cap}} USDC onto {{name}} and keep {{$gas}} for {{chain}} gas.', 'Use {{name}}’s native app once a week: swap, pay gas or interact with a launched contract.', 'Keep the same address active for {{hold}} days so it appears in repeated snapshots.', 'Check {{name}}’s chain explorer weekly for upgrades and bridge notices.', 'Claim any token or points only through links published by {{name}} itself.', 'Log the bridge tx and weekly actions; compare any reward with {{$cap}} bridged.'],
  insurance: ['Open a dedicated wallet with {{$cap}} USDC and {{$gas}} of {{chain}} gas for {{name}}.', 'Buy {{$cap}} of cover from {{name}} for {{chain}} positions and keep the policy in that wallet.', 'Review the policy weekly and renew or adjust it once during the holding period.', 'Hold cover for {{hold}} days so the address is a repeat user.', 'If {{name}} launches points, connect through its own published domain.', 'Log policy IDs, premiums and dates; compare any token with {{$cap}} spent.'],
  payments: ['Open a dedicated wallet with {{$cap}} USDC and {{$gas}} of {{chain}} gas for {{name}}.', 'Route {{$cap}} of test payments through {{name}} on {{chain}} and keep each transaction hash.', 'Send one small payment each week from the same wallet to build a usage record.', 'Hold the wallet active for {{hold}} days and check for outages weekly.', 'Claim any rewards only from {{name}}’s own published page.', 'Log payment hashes and dates; compare a token with the {{$cap}} routed.'],
  governance: ['Open a dedicated wallet with {{$cap}} USDC and {{$gas}} of {{chain}} gas for {{name}}.', 'Stake or delegate {{$cap}} through {{name}} on {{chain}} and vote in one governance proposal.', 'Vote or re-delegate weekly from the same address to build a governance record.', 'Hold for {{hold}} days and review proposal outcomes each week.', 'Claim any incentives through {{name}}’s own domain only.', 'Log votes and dates, then compare any token with the {{$cap}} committed.'],
  cedefi: ['Open a dedicated wallet with {{$cap}} USDC and {{$gas}} of {{chain}} gas, and finish {{name}}’s verification if asked.', 'Deposit {{$cap}} USDC in {{name}}’s CeDeFi account on {{chain}} and make one verified transfer.', 'Do one transfer or rebalance each week from the same verified account.', 'Hold for {{hold}} days and review account statements and withdrawal terms weekly.', 'Claim points only from {{name}}’s own site; never share seed phrases with support.', 'Log transfers and dates; compare any token with the {{$cap}} deposited.'],
  generic: ['Open a dedicated wallet with {{$cap}} USDC and {{$gas}} of {{chain}} gas for {{name}}.', 'Deposit {{$cap}} USDC into {{name}}’s main product on {{chain}} and save the position receipt.', 'Perform one qualifying action each week from the same wallet.', 'Hold for {{hold}} days and check {{name}}’s TVL and notices each Friday.', 'If points are opened, claim through {{name}}’s own published site only.', 'Log the wallet, tx hashes and dates; weigh any token against {{$cap}} at risk.'],
};

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const maybe = (x: unknown): string | null => (blank(x) ? null : String(x));
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    return {
      slug: p.slug, name: p.name, category: maybe(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd, change_7d: num(p.change_7d), mcap_usd: num(p.mcap_usd),
      listed_at: maybe(p.listed_at), gecko_id: maybe(p.gecko_id), symbol: maybe(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < MIN_BOARD_ROWS) return `board has ${board.length} rows, fewer than ${MIN_BOARD_ROWS}`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  let seenExcluded = false;
  let previous = Infinity;
  for (const r of board) {
    if (r.excluded) {
      seenExcluded = true;
      if (!r.exclusion_reason) return `${r.slug} is excluded without a reason`;
      if (r.implied_value_usd !== null) return `${r.slug} is excluded but carries an implied value`;
      continue;
    }
    if (seenExcluded) return `${r.slug} is ranked after an excluded row`;
    if (!Number.isSafeInteger(r.implied_value_usd) || (r.implied_value_usd ?? 0) <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if ((r.implied_value_usd ?? 0) > previous) return `${r.slug} outranks the row above it on implied value`;
    previous = r.implied_value_usd!;
    if (!r.thesis || r.thesis.length < 60) return `${r.slug} has no substantive thesis`;
    if (r.farm_plan.length < 3 || r.farm_plan.length > 12) return `${r.slug} has ${r.farm_plan.length} farm steps`;
    for (const s of r.farm_plan) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 2]!.implied_value_usd) {
    return `all ${board.length} ranked rows share the same implied value: not a ranking`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  const data = {
    schema: radar.schema, as_of: radar.as_of, source: radar.source, floor_usd: radar.floor_usd,
    summary: radar.summary, chains: radar.chains, comps: radar.comps, plans: radar.plans, phrases: radar.phrases, screened: radar.screened, rows: radar.rows,
  };
  return `window.BOARD=${JSON.stringify(data)};\n`;
}
