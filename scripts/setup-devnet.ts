import fs from 'node:fs';
import path from 'node:path';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL, type TransactionInstruction } from '@solana/web3.js';
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { addresses, decodeBond, DEFAULT_PROGRAM, initializeIx, registerIx } from '../src/protocol';

// This script creates test assets only. It refuses mainnet even through a custom RPC.
const rpc=process.env.SOLANA_RPC||'https://api.devnet.solana.com';
const c=new Connection(rpc,'confirmed');
const genesis=await c.getGenesisHash();
if(genesis!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1'&&!/^http:\/\/(127\.0\.0\.1|localhost):/.test(rpc))throw Error('Only devnet or localhost is supported.');
fs.mkdirSync('.local',{recursive:true});
function key(file:string){if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(Array.from(Keypair.generate().secretKey)),{mode:0o600});return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file,'utf8'))));}
const issuer=key(process.env.ISSUER_KEYPAIR||'.local/issuer.json');
const program=new PublicKey(process.env.PAYSIM_PROGRAM||DEFAULT_PROGRAM);
const executable=await c.getAccountInfo(program);if(!executable?.executable)throw Error(`Deploy target/deploy/paysim.so at ${program.toBase58()} before running setup.`);
if(await c.getBalance(issuer.publicKey)<LAMPORTS_PER_SOL/5){const signature=await c.requestAirdrop(issuer.publicKey,2*LAMPORTS_PER_SOL);const latest=await c.getLatestBlockhash();const result=await c.confirmTransaction({...latest,signature},'confirmed');if(result.value.err)throw Error('Devnet airdrop failed.');}
async function send(ix:TransactionInstruction){return sendAndConfirmTransaction(c,new Transaction().add(ix),[issuer]);}
const a=addresses(program,issuer.publicKey);
let info=await c.getAccountInfo(a.bond);
let settlement:PublicKey;
if(!info){
 const mintKey=key('.local/settlement-mint.json');
 const mintInfo=await c.getAccountInfo(mintKey.publicKey);
 settlement=mintInfo?mintKey.publicKey:await createMint(c,issuer,issuer.publicKey,null,6,mintKey);
 const maturity=process.env.DEMO_MATURITY_SECONDS?BigInt(Math.floor(Date.now()/1000)+Number(process.env.DEMO_MATURITY_SECONDS)):BigInt(Date.parse('2028-07-01T00:00:00Z')/1000);
 await send(await initializeIx(program,issuer.publicKey,settlement,maturity));
 info=await c.getAccountInfo(a.bond);
}else settlement=decodeBond(info.data).settlementMint;
if(!info)throw Error('Initialization was not confirmed.');
let state=decodeBond(info.data);
for(let i=state.registered;i<3;i++){
 const holder=key(`.local/holder-${i}.json`);
 const receiver=await getOrCreateAssociatedTokenAccount(c,issuer,settlement,holder.publicKey);
 await send(await registerIx(program,issuer.publicKey,holder.publicKey,receiver.address,i,[100n,50n,20n][i]));
}
const treasury=await getAccount(c,a.treasury);
const target=200_000n*1_000_000n;
if(treasury.amount<target)await mintTo(c,issuer,settlement,a.treasury,issuer,target-treasury.amount);
const env=`VITE_SOLANA_RPC=${rpc}\nVITE_PAYSIM_PROGRAM=${program.toBase58()}\nVITE_PAYSIM_BOND=${a.bond.toBase58()}\n`;
fs.writeFileSync('.env.local',env);
console.log(JSON.stringify({issuer:issuer.publicKey.toBase58(),program:program.toBase58(),bond:a.bond.toBase58(),settlementMint:settlement.toBase58(),note:'Test-only issuer key remains in .local; never commit or fund it on mainnet. Restart/rebuild the app to read .env.local.'},null,2));
