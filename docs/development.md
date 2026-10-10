# PaySim Development Guide

[Back to project overview](../README.md)

Corporate action simulator for one tokenized bond and three registered holders. Dark dashboard inspired by the supplied reference, with coupon payments, partial redemption, maturity redemption, holder-level previews, validation, settlement history and JSON export.

Production demo: https://paysim-rho.vercel.app — deployed to Vercel project `daspberry/paysim` on 10 October 2026. The hosted demo uses browser-local state; Solana devnet execution remains unconfigured.

## Current status

- The local demo is built and serves at `http://127.0.0.1:5173`. It stores its ledger in this browser only. It never submits transactions or represents demo records as blockchain proof.
- React UI, TypeScript validation, and the seven calculation/state-transition tests pass. A server-rendering smoke test passes. A live Chrome smoke check loaded the dashboard and ran the coupon simulation with six passing validation checks and no observed page errors; this is not exhaustive browser QA.
- The protocol layout/transaction sizing check passes: one three-holder settlement transaction is 581 bytes against the 1232-byte limit. Execution compute usage still requires an actual validator test.
- The Anchor program passes `cargo check --target sbpf-solana-solana`. Final SBF linking is blocked by `rust-lld: permission denied` on this host. The local validator also fails to start with Windows privilege error 1314. The binary has not been deployed and the chain integration test has not run.
- The frontend devnet adapter and initialization/integration-test scripts are included. Devnet remains unavailable until a deployed program and initialized bond are configured. No transaction signatures or explorer proofs have been invented.
- On 10 October 2026, the project's pinned npm dependencies were installed and a package lockfile generated. The standard `npm run build` (TypeScript + Vite) and all seven tests passed. The original offline-build fallback is no longer required for normal development.

## Run the existing local build

Requires Node.js 22 or later. From this directory:

```powershell
node scripts/serve.cjs
```

Open `http://127.0.0.1:5173`. If the existing server is still running, just open the link. Build output is in `dist/` and is intentionally untracked.

## Standard development setup

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run build
```

For offline development with an already installed dependency directory:

```powershell
$env:PAYSIM_DEPENDENCIES = 'C:\path\to\existing\node_modules'
node scripts/local-build.cjs
node scripts/check-ui.cjs
node scripts/check-protocol.cjs
node scripts/serve.cjs
```

The fallback build does not modify that directory. It requires compatible React, React DOM, TypeScript, esbuild, lucide-react, Buffer and Solana JS packages. The normal Vite build uses this project's dependencies.

## Demo walkthrough

1. Start in **Demo**. The demo clock is 1 July 2027; Alice, Bob and Charlie own 100, 50 and 20 bonds. Treasury contains 200,000 test USD.
2. Select **Coupon payment → Run simulation**. Review payouts of $5,000, $2,500 and $1,000. Approve and confirm the local demo settlement.
3. Inspect **Activity**, then return to Overview. Attempting the same coupon period again fails duplicate validation.
4. Select **Partial redemption**, 20%, price 102%. The preview retires 20, 10 and 4 bonds for a total $34,680. Approve it.
5. Open the date/settings control. Advance the demo clock to **1 July 2028**. Select **Maturity redemption** and run the simulation. The remaining 136 bonds redeem for $136,000.
6. Inspect holders and history; outstanding supply is zero. Use **Export report** to download the results.
7. Demo settings can reset the ledger or lower treasury funds to demonstrate failed validation. Reset requires confirmation.

The full-redemption reference on a fresh instrument is $170,000. Do not run full redemption before the partial scenario on the same instrument.

## Scope and rules

- One instrument per issuer, exactly three distinct registered holders. No secondary trading or transfers in this MVP.
- Bond units are indivisible SPL tokens in program-controlled vaults. Registration mints the initial supply and becomes unavailable after the first snapshot.
- Test settlement mint uses 6 decimals. Money calculations use integer minor units; coupon division floors only at the final minor unit. No floating-point settlement amounts.
- Coupon periods are calendar half-years and must match chain time. Each period can be paid once. The MVP does not support arrears, accrued interest, business-day calendars, taxes, or ex-coupon trading.
- Partial redemption must produce an integer number of bonds for every holder. Fractional results are rejected, not silently allocated.
- Snapshots capture on the current ledger/block date. Arbitrary historical snapshots are not supported. Demo time is explicitly separate from chain time.
- Maturity is enforced on-chain by its exact timestamp. Partial and coupon actions are unavailable after maturity. Redemption pays principal; a final coupon is a separate action.
- Changes to balances after a snapshot invalidate that snapshot via a revision counter. Two concurrent snapshots cannot both execute after one changes the bond state.
- Settlement and token burns share a single transaction, so failure rolls back all effects. Frontend approval always signs the captured action, with issuer authorization enforced by the program.
- Banking rails, KZT, KASE feeds, custody, real securities and production compliance are outside this prototype. This repository does not claim independently verified KASE track compliance.

## Solana build and deployment

The program uses Anchor 0.31.1 with a committed Cargo.lock. Standard supported Solana/Anchor environments can build with:

```sh
anchor build
```

Windows with official Solana platform-tools can use:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-program.ps1 -PlatformTools C:\path\to\platform-tools
```

The source currently references the undeployed public address `2ofjyfxxWxJRrt2xa2xEMbcn969Qp5qUW25MaVsmNuTg`. Private keys are not included in this repository. For a fresh clone, create the `.local` directory and generate a new program keypair before building:

```sh
mkdir .local
solana-keygen new --no-bip39-passphrase --outfile .local/paysim-program.json
solana address --keypair .local/paysim-program.json
```

Use that new public address to update `declare_id!` in `programs/paysim/src/lib.rs`, both entries in `Anchor.toml`, `DEFAULT_PROGRAM` in `src/protocol.ts`, and `.env.example`. Then rebuild the program. Keep private key files local and never reuse these disposable test keys on mainnet.

On a working host, create a disposable issuer keypair in `.local/issuer.json`, request devnet test SOL, and deploy explicitly to devnet:

```sh
solana-keygen new --no-bip39-passphrase --outfile .local/issuer.json
solana airdrop 2 --url devnet --keypair .local/issuer.json
solana program deploy target/deploy/paysim.so --program-id .local/paysim-program.json --keypair .local/issuer.json --url devnet
npm run setup:devnet
```

The deployment's required rent depends on binary size; the faucet may require retries or additional test SOL. Setup refuses mainnet, creates a test settlement mint and three holder wallets, mints bonds, funds the treasury, and writes public configuration to `.env.local`. Rerunning setup can replenish the test treasury to 200,000 tUSD. It does not reset existing action history.

Restart/rebuild the UI after setup. For browser execution, use a test wallet containing the registered issuer key. Never import a real funded wallet for this demo. Snapshot capture is an on-chain instruction and requires a wallet signature and test SOL; approval/execution is a second signature. A confirmed transaction failure is shown rather than recorded as success.

Default maturity is July 2028. For a fresh devnet test issuer only, `DEMO_MATURITY_SECONDS=300` creates a test instrument maturing in five minutes. Its actual maturity is displayed by the UI. Existing instruments cannot have their maturity changed.

## Chain integration test

On a working local validator, preload the built program. Replace `YOUR_PROGRAM_PUBLIC_KEY` with the same address configured in the program and client:

```sh
solana-test-validator --ledger .local/test-ledger --bpf-program YOUR_PROGRAM_PUBLIC_KEY target/deploy/paysim.so
npm run test:chain
```

The test creates disposable local accounts and checks the coupon, partial and final redemption, SPL supply, cash conservation, transaction size, wrong issuer, repeated execution, stale snapshots and maturity. It uses a short test maturity and may wait briefly for the local clock. The test has been prepared but has not executed successfully in this environment.

## Main files

- `src/App.tsx`, `src/styles.css`: responsive UI and workflow.
- `src/domain.ts`, `src/domain.test.ts`: pure calculation engine and demo ledger invariants.
- `src/protocol.ts`: explicit Anchor instruction encoding and account decoding.
- `src/chain.ts`: wallet signing, confirmed RPC reads, snapshots and settlement.
- `programs/paysim/src/lib.rs`: issuer authorization, immutable snapshots, token transfers and burns.
- `scripts/setup-devnet.ts`, `scripts/test-chain.ts`: test initialization and local integration verification.

Devnet deployment and successful end-to-end on-chain tests remain required before describing the blockchain MVP as complete.
