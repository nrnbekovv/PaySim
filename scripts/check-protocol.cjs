const path=require('node:path'),fs=require('node:fs'),Module=require('node:module'),assert=require('node:assert/strict');
const dependencies=process.env.PAYSIM_DEPENDENCIES||path.resolve('node_modules');
const ts=require(path.join(dependencies,'typescript')),original=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){if(!name.startsWith('.')&&!path.isAbsolute(name)&&!Module.isBuiltin(name)){try{return original.call(this,name,{...parent,paths:[dependencies]},...rest);}catch{}}return original.call(this,name,parent,...rest);};
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const p=require('../src/protocol.ts'),{Keypair,PublicKey,Transaction,ComputeBudgetProgram}=require('@solana/web3.js');
(async()=>{
 const issuer=Keypair.generate(),program=new PublicKey(p.DEFAULT_PROGRAM),a=p.addresses(program,issuer.publicKey);
 const holder=()=>({wallet:Keypair.generate().publicKey,vault:Keypair.generate().publicKey,settlement:Keypair.generate().publicKey,balance:100n});
 const bond={issuer:issuer.publicKey,mint:a.mint,treasury:a.treasury,settlementMint:Keypair.generate().publicKey,face:1000000000n,couponBps:1000,frequency:2,maturity:1846022400n,issued:1782864000n,revision:0n,nextAction:0n,lastCoupon:0,holders:[holder(),holder(),holder()],registered:3,bump:255};
 const data=Buffer.concat([await p.discriminator('account','Bond'),...[bond.issuer,bond.mint,bond.settlementMint,bond.treasury].map(k=>k.toBuffer()),p.numberBytes(bond.face,8),p.numberBytes(1000,2),p.numberBytes(2,1),p.numberBytes(bond.maturity,8,true),p.numberBytes(bond.issued,8,true),p.numberBytes(0,8),p.numberBytes(0,8),p.numberBytes(0,4),...bond.holders.flatMap(h=>[h.wallet.toBuffer(),h.vault.toBuffer(),h.settlement.toBuffer(),p.numberBytes(h.balance,8)]),p.numberBytes(3,1),p.numberBytes(255,1)]);
 const decoded=p.decodeBond(data);assert.equal(decoded.face,bond.face);assert.equal(decoded.holders[2].wallet.toBase58(),bond.holders[2].wallet.toBase58());assert.equal(decoded.bump,255);assert.equal(data.length,497);
 const action=p.actionAddress(program,a.bond,0n),ix=await p.executeIx(program,a.bond,bond,action);
 const tx=new Transaction({feePayer:issuer.publicKey,blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:1}).add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}),ix);tx.sign(issuer);const bytes=tx.serialize().length;assert.ok(bytes<=1232);
 const snapshot=await p.snapshotIx(program,a.bond,bond,0,21000n,2000,10200,4055);assert.equal(snapshot.data.length,33);
 console.log(`Protocol layout and atomic transaction sizing passed: ${bytes}/1232 bytes for three holders. Actual execution still requires a validator.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
