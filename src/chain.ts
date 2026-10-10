import { Buffer } from 'buffer';
import { Connection, PublicKey, Transaction, ComputeBudgetProgram, type TransactionInstruction } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import { actionAddress, decodeAction, decodeBond, DEFAULT_PROGRAM, discriminator, executeIx, names, snapshotIx } from './protocol';
import { simulate, type Ledger, type Params, type Simulation, type ActionKind, type ActionRecord } from './domain';

const config=import.meta.env;
export const devnetConfigured=Boolean(config.VITE_PAYSIM_BOND && config.VITE_PAYSIM_PROGRAM);
const rpc=config.VITE_SOLANA_RPC || 'https://api.devnet.solana.com';
function connection(){return new Connection(rpc,'confirmed');}
function ids(){if(!devnetConfigured||!config.VITE_PAYSIM_BOND)throw Error('Devnet program is not configured.');return {program:new PublicKey(config.VITE_PAYSIM_PROGRAM||DEFAULT_PROGRAM),bond:new PublicKey(config.VITE_PAYSIM_BOND)};}
type Provider={publicKey:PublicKey|null;connect:()=>Promise<{publicKey:PublicKey}>;signTransaction:(tx:Transaction)=>Promise<Transaction>};
function provider():Provider {const w=window as unknown as {solana?:Provider;phantom?:{solana?:Provider}};const p=w.phantom?.solana||w.solana;if(!p)throw Error('Install a Solana wallet such as Phantom and select devnet.');return p;}
export async function connectWallet(){return (await provider().connect()).publicKey.toBase58();}
const iso=(timestamp:bigint)=>new Date(Number(timestamp)*1000).toISOString();
async function fetchBond(){const c=connection(),{program,bond}=ids();if(await c.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1')throw Error('The configured RPC is not Solana devnet.');const info=await c.getAccountInfo(bond);if(!info||!info.owner.equals(program)||!info.data.subarray(0,8).equals(await discriminator('account','Bond')))throw Error('PaySim bond account is missing or belongs to a different program.');return {c,program,bond,state:decodeBond(info.data)};}
export async function loadChainLedger():Promise<Ledger>{
 const {c,program,bond,state}=await fetchBond();if(state.registered!==3)throw Error('Complete the three-holder setup before connecting.');
 const slot=await c.getSlot(),blockTime=await c.getBlockTime(slot);if(!blockTime)throw Error('Unable to read chain time. Please retry.');
 const [treasury,...cash]=await Promise.all([getAccount(c,state.treasury),...state.holders.map(h=>getAccount(c,h.settlement))]);
 const accounts=await c.getProgramAccounts(program,{filters:[{dataSize:256},{memcmp:{offset:8,bytes:bond.toBase58()}}]});
 const history:ActionRecord[]=[];
 for(const account of accounts){if(!account.account.data.subarray(0,8).equals(await discriminator('account','Action')))continue;const a=decodeAction(account.account.data);if(!a.executed)continue;history.push({id:account.pubkey.toBase58(),created:iso(a.recordAt),kind:(['coupon','partial','maturity'] as ActionKind[])[a.kind],total:a.total.toString(),retired:a.retired.reduce((n,v)=>n+v,0n).toString(),recordDate:iso(a.recordAt).slice(0,10),period:`${Math.floor(a.period/2)}-H${a.period%2+1}`,mode:'devnet',rows:state.holders.map((h,i)=>({name:names[i],wallet:h.wallet.toBase58(),bonds:a.balances[i].toString(),payment:a.payments[i].toString(),retired:a.retired[i].toString(),remaining:(a.balances[i]-a.retired[i]).toString()}))});}
 history.sort((a,b)=>b.created.localeCompare(a.created));
 return {bond:{symbol:'KZ-BOND-2028',face:state.face.toString(),couponBps:state.couponBps,frequency:state.frequency,maturity:iso(state.maturity).slice(0,10),issued:iso(state.issued).slice(0,10)},holders:state.holders.map((h,i)=>({name:names[i],wallet:h.wallet.toBase58(),bonds:h.balance.toString(),cash:cash[i].amount.toString()})),treasury:treasury.amount.toString(),date:new Date(blockTime*1000).toISOString().slice(0,10),revision:Number(state.revision),history};
}
async function send(ix:TransactionInstruction,issuer:PublicKey){const p=provider();const wallet=(await p.connect()).publicKey;if(!wallet.equals(issuer))throw Error(`Connect the registered issuer wallet (${issuer.toBase58()}).`);const c=connection();const latest=await c.getLatestBlockhash();const tx=new Transaction({...latest,feePayer:wallet}).add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}),ix);const signed=await p.signTransaction(tx);const signature=await c.sendRawTransaction(signed.serialize());const result=await c.confirmTransaction({...latest,signature},'confirmed');if(result.value.err)throw Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);return signature;}
export type ChainPreview={action:string;simulation:Simulation;snapshotSignature:string};
export async function snapshotOnChain(params:Params):Promise<ChainPreview>{
 const {c,program,bond,state}=await fetchBond();
 const period=Number(params.period.slice(0,4))*2+(params.period.endsWith('H2')?1:0);
 const signature=await send(await snapshotIx(program,bond,state,['coupon','partial','maturity'].indexOf(params.kind),BigInt(Math.floor(Date.parse(params.recordDate+'T00:00:00Z')/86400000)),params.portionBps,params.priceBps,period),state.issuer);
 const action=actionAddress(program,bond,state.nextAction),info=await c.getAccountInfo(action);if(!info)throw Error('Snapshot confirmation is pending. Refresh and retry.');
 const decoded=decodeAction(info.data),ledger=await loadChainLedger(),simulation=simulate(ledger,params);
 if(decoded.total.toString()!==simulation.total||decoded.payments.some((v,i)=>v.toString()!==simulation.rows[i].payment)||decoded.revision!==BigInt(ledger.revision))throw Error('The ledger changed while capturing the snapshot. Run simulation again.');
 return {action:action.toBase58(),simulation,snapshotSignature:signature};
}
export async function executeOnChain(preview:ChainPreview){const {program,bond,state}=await fetchBond();return send(await executeIx(program,bond,state,new PublicKey(preview.action)),state.issuer);}
