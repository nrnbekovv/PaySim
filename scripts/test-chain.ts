import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram, type TransactionInstruction } from '@solana/web3.js';
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, getMint, mintTo } from '@solana/spl-token';
import { actionAddress, addresses, decodeAction, decodeBond, DEFAULT_PROGRAM, executeIx, initializeIx, registerIx, snapshotIx } from '../src/protocol';

// Requires a LOCAL validator with the program preloaded. Creates disposable test wallets.
const c=new Connection('http://127.0.0.1:8899','confirmed'),program=new PublicKey(DEFAULT_PROGRAM),issuer=Keypair.generate();
const airdrop=await c.requestAirdrop(issuer.publicKey,10_000_000_000);await c.confirmTransaction({...await c.getLatestBlockhash(),signature:airdrop});
const a=addresses(program,issuer.publicKey);
const send=async(ix:TransactionInstruction,signer=issuer)=>sendAndConfirmTransaction(c,new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}),ix),[signer]);
const read=async()=>decodeBond((await c.getAccountInfo(a.bond))!.data);
const mint=await createMint(c,issuer,issuer.publicKey,null,6);
const now=(await c.getBlockTime(await c.getSlot()))!;
// A short test maturity allows all scenarios on one fresh instrument.
const maturity=now+40;
await send(await initializeIx(program,issuer.publicKey,mint,BigInt(maturity)));
for(let i=0;i<3;i++){const holder=Keypair.generate();const receiver=await getOrCreateAssociatedTokenAccount(c,issuer,mint,holder.publicKey);await send(await registerIx(program,issuer.publicKey,holder.publicKey,receiver.address,i,[100n,50n,20n][i]));}
await mintTo(c,issuer,mint,a.treasury,issuer,200_000_000_000n);
async function snap(kind:number){const b=await read(),t=(await c.getBlockTime(await c.getSlot()))!,d=new Date(t*1000),period=d.getUTCFullYear()*2+(d.getUTCMonth()>=6?1:0);const action=actionAddress(program,a.bond,b.nextAction);await send(await snapshotIx(program,a.bond,b,kind,BigInt(Math.floor(t/86400)),2000,10200,period));return action;}
await assert.rejects(()=>snap(2),/./,'Maturity before due date must fail');
const first=await snap(0),stale=await snap(1);
const coupon=decodeAction((await c.getAccountInfo(first))!.data);assert.equal(coupon.total,8_500_000_000n);
const stranger=Keypair.generate();const gift=await c.requestAirdrop(stranger.publicKey,1_000_000_000);await c.confirmTransaction({...await c.getLatestBlockhash(),signature:gift});
const unauthorized=await executeIx(program,a.bond,await read(),first);unauthorized.keys[0].pubkey=stranger.publicKey;await assert.rejects(()=>send(unauthorized,stranger));
await send(await executeIx(program,a.bond,await read(),first));
await assert.rejects(async()=>send(await executeIx(program,a.bond,await read(),first)));
await assert.rejects(async()=>send(await executeIx(program,a.bond,await read(),stale)));
await assert.rejects(()=>snap(0));
const partial=await snap(1);assert.equal(decodeAction((await c.getAccountInfo(partial))!.data).total,34_680_000_000n);
const execute=await executeIx(program,a.bond,await read(),partial);
const tx=new Transaction({feePayer:issuer.publicKey,blockhash:(await c.getLatestBlockhash()).blockhash,lastValidBlockHeight:0}).add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}),execute);tx.sign(issuer);assert.ok(tx.serialize().length<=1232,'Atomic 3-holder settlement fits in one transaction');
await send(execute);assert.equal((await getMint(c,a.mint)).supply,136n);
while((await c.getBlockTime(await c.getSlot()))!<maturity)await new Promise(r=>setTimeout(r,1000));
const final=await snap(2);await send(await executeIx(program,a.bond,await read(),final));assert.equal((await getMint(c,a.mint)).supply,0n);
const b=await read();const received=await Promise.all(b.holders.map(h=>getAccount(c,h.settlement)));const treasury=await getAccount(c,a.treasury);assert.equal(received.reduce((n,h)=>n+h.amount,treasury.amount),200_000_000_000n);
console.log('On-chain lifecycle, token supply, atomic size, authorization, stale snapshot, duplicate and maturity tests passed.');
