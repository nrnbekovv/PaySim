export type ActionKind = 'coupon' | 'partial' | 'maturity';
export type Holder = { name: string; wallet: string; bonds: string; cash: string };
export type Bond = { symbol: string; face: string; couponBps: number; frequency: number; maturity: string; issued: string };
export type Params = { kind: ActionKind; recordDate: string; portionBps: number; priceBps: number; period: string };
export type Entitlement = { name: string; wallet: string; bonds: string; payment: string; retired: string; remaining: string };
export type Check = { label: string; ok: boolean; detail: string };
export type Simulation = { params: Params; rows: Entitlement[]; total: string; retired: string; checks: Check[]; fingerprint: string; valid: boolean };
export type ActionRecord = { id: string; created: string; kind: ActionKind; total: string; retired: string; recordDate: string; rows: Entitlement[]; signature?: string; period: string; mode: 'demo' | 'devnet' };
export type Ledger = { bond: Bond; holders: Holder[]; treasury: string; date: string; revision: number; history: ActionRecord[] };
export const SCALE = 1_000_000n;
export const titles: Record<ActionKind, string> = { coupon: 'Coupon payment', partial: 'Partial redemption', maturity: 'Maturity redemption' };
export function initialLedger(): Ledger {
  return { bond: { symbol: 'KZ-BOND-2028', face: '1000000000', couponBps: 1000, frequency: 2, maturity: '2028-07-01', issued: '2026-07-01' }, holders: [{name:'Alice',wallet:'demo:alice',bonds:'100',cash:'0'},{name:'Bob',wallet:'demo:bob',bonds:'50',cash:'0'},{name:'Charlie',wallet:'demo:charlie',bonds:'20',cash:'0'}], treasury: '200000000000', date: '2027-07-01', revision: 0, history: [] };
}
export function fingerprint(ledger: Ledger, params: Params): string {
  return JSON.stringify({ bond: ledger.bond, holders: ledger.holders, treasury: ledger.treasury, date: ledger.date, revision: ledger.revision, history: ledger.history.map(a=>[a.id,a.kind,a.period]), params });
}
export function simulate(ledger: Ledger, params: Params): Simulation {
  const face = BigInt(ledger.bond.face);
  const parametersValid = Number.isInteger(params.portionBps) && params.portionBps > 0 && params.portionBps <= 10000 && Number.isInteger(params.priceBps) && params.priceBps >= 10000 && params.priceBps <= 20000;
  const rows = ledger.holders.map(h => {
    const bonds = BigInt(h.bonds);
    const retired = params.kind === 'maturity' ? bonds : params.kind === 'partial' && parametersValid ? bonds * BigInt(params.portionBps) / 10000n : 0n;
    const payment = params.kind === 'coupon' ? bonds * face * BigInt(ledger.bond.couponBps) / (10000n * BigInt(ledger.bond.frequency)) : retired * face * BigInt(params.kind === 'maturity' ? 10000 : parametersValid ? params.priceBps : 10000) / 10000n;
    return { name: h.name, wallet: h.wallet, bonds: bonds.toString(), retired: retired.toString(), payment: payment.toString(), remaining: (bonds-retired).toString() };
  });
  const total = rows.reduce((v,r)=>v+BigInt(r.payment),0n);
  const retired = rows.reduce((v,r)=>v+BigInt(r.retired),0n);
  const supply = ledger.holders.reduce((v,h)=>v+BigInt(h.bonds),0n);
  const checks: Check[] = [
    {label:'Record date',ok:params.recordDate === ledger.date && params.recordDate >= ledger.bond.issued,detail:'Snapshot must be captured on the current ledger date.'},
    {label:'Eligible balances',ok:supply>0n && ledger.holders.length===3 && new Set(ledger.holders.map(h=>h.wallet)).size===3,detail:'Three unique registered holders and a positive outstanding supply.'},
    {label:'Treasury coverage',ok:BigInt(ledger.treasury)>=total,detail:'Settlement treasury must cover the complete payment.'},
    {label:'Action parameters',ok:params.kind !== 'partial' || (parametersValid && retired>0n && rows.every(r=>BigInt(r.bonds)*BigInt(params.portionBps)%10000n===0n)),detail:'Partial redemption must produce whole bonds per holder; fraction 0–100%, price 100–200%.'},
    {label:'Instrument lifecycle',ok:params.kind === 'maturity' ? ledger.date>=ledger.bond.maturity : ledger.date<=ledger.bond.maturity,detail:params.kind==='maturity'?'Maturity date must have been reached.':'Coupon and partial redemption are available through maturity.'},
    {label:'Duplicate protection',ok:params.kind !== 'coupon' || (/^\d{4}-H[12]$/.test(params.period) && params.period === `${ledger.date.slice(0,4)}-H${Number(ledger.date.slice(5,7))<=6?1:2}` && !ledger.history.some(a=>a.kind==='coupon'&&a.period===params.period)),detail:'One coupon per current calendar half-year. An executed period cannot be reused.'},
  ];
  return { params: {...params}, rows, total: total.toString(), retired: retired.toString(), checks, fingerprint:fingerprint(ledger,params),valid:checks.every(c=>c.ok) };
}
export function executeDemo(ledger: Ledger, sim: Simulation, issuer: boolean): Ledger {
  if (!issuer) throw new Error('Issuer authorization required.');
  if (sim.fingerprint !== fingerprint(ledger,sim.params)) throw new Error('The ledger changed. Run a new simulation.');
  const verified = simulate(ledger,sim.params);
  if (!verified.valid) throw new Error(verified.checks.filter(c=>!c.ok).map(c=>c.label).join(', '));
  return { ...ledger, treasury:(BigInt(ledger.treasury)-BigInt(verified.total)).toString(), revision:ledger.revision+1, holders:ledger.holders.map((h,i)=>({...h,bonds:verified.rows[i].remaining,cash:(BigInt(h.cash)+BigInt(verified.rows[i].payment)).toString()})), history:[{id:`DEMO-${String(ledger.revision+1).padStart(4,'0')}`,created:new Date().toISOString(),kind:sim.params.kind,total:verified.total,retired:verified.retired,rows:verified.rows,recordDate:sim.params.recordDate,period:sim.params.period,mode:'demo'},...ledger.history] };
}
export function money(value: string | bigint, decimals = 2): string { const n=BigInt(value); const negative=n<0n; const abs=negative?-n:n; const whole=abs/SCALE; const frac=(abs%SCALE).toString().padStart(6,'0').slice(0,decimals); return `${negative?'-':''}$${whole.toLocaleString('en-US')}${decimals?'.'+frac:''}`; }
export function currentPeriod(date: string) { return `${date.slice(0,4)}-H${Number(date.slice(5,7))<=6?1:2}`; }
