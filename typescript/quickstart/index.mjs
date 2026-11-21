/**
 * Audren Canonical 6-Building-Block Quickstart (TypeScript SDK — `@audren/sdk` + `@audren/sdk/prover`).
 *
 * Runs completely offline (zero RPC required) and executes the exact same 6 building blocks
 * mirrored across Rust, TypeScript, Swift (iOS), and Kotlin (Android) against the shared
 * canonical `spec/test-vectors.json` conformance page — producing 100% byte-for-byte identical
 * stdout across all 4 official SDKs.
 *
 * Run (from `typescript/`):
 *   pnpm install && pnpm quickstart
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AUDREN_DEFAULT_RELAY_URL,
  AUDREN_PROGRAM_ID,
  CLASSIC_TOKEN_PROGRAM_ID,
  JUPITER_CPI_EXCLUDED_DEXES,
  PAGE_CAPACITY,
  PAGE_SCAN_DATA_SLICE,
  WSOL_MINT,
  base58Decode,
  decodePageHeader,
  decodePoolState,
  deriveAssociatedTokenAddress,
  deriveEpochPagePda,
  derivePoolPda,
  deriveSolVaultPda,
  deriveSwapEscrowPda,
  parseAudrenAddress,
  prepareRouterAccounts,
} from '@audren/sdk';
import {
  NATIVE_SOL_MINT,
  auditorDecryptNote,
  buildBufferedExecutionPlan,
  buildCloseProofBufferInstruction,
  buildDepositInstruction,
  buildTransferInstruction,
  buildWithdrawInstruction,
  createSelectiveDisclosureProof,
  deriveAuditorKeypair,
  deriveKeysFromSeed,
  deriveSubaccountKeys,
  exportFullViewingKey,
  extractRingFromPage,
  fromHex,
  scanEpochPage,
  scanEpochPageSpendable,
  scanPageScanSlice,
  toHex,
  verifySelectiveDisclosureOnPage,
  verifySelectiveDisclosureReceipt,
} from '@audren/sdk/prover';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const audrenRepo = process.env.AUDREN_REPO_DIR ?? resolve(import.meta.dirname, '../../../audren');
const vectors = JSON.parse(readFileSync(resolve(audrenRepo, 'spec/test-vectors.json'), 'utf8'));

// 1. KEYS — Master keys, sub-account #1, aud1… address & read-only Full Viewing Key
const aliceSeed = fromHex(vectors.alice.seed_hex);
const alice = await deriveKeysFromSeed(aliceSeed);
const aliceSub1 = await deriveSubaccountKeys(aliceSeed, 1);
const aliceFvk = exportFullViewingKey(alice);
const parsed = parseAudrenAddress(alice.address);
assert.equal(toHex(parsed.spendPk), vectors.alice.spend_pk_hex);

console.log('[1/6 KEYS]');
console.log(`  Program ID    : ${AUDREN_PROGRAM_ID}`);
console.log(`  Alice aud1    : ${alice.address}`);
console.log(`  Subaccount #1 : ${aliceSub1.address}`);
console.log(`  FVK view_pk   : ${aliceFvk.viewPkB58}`);

// 2. PDAs & LAYOUTS — Canonical Pool #0 PDAs & binary decoders
const poolPda = await derivePoolPda(0);
const page0Pda = await deriveEpochPagePda(0, 0n);
const solVaultPda = await deriveSolVaultPda(0);
const escrow0Pda = await deriveSwapEscrowPda(0, 0);
const poolState = decodePoolState(fromHex(vectors.pool_state.raw_hex));
const pageBytes = fromHex(vectors.epoch_page.page_hex);
const hdr = decodePageHeader(pageBytes);

console.log('[2/6 PDAs & LAYOUTS]');
console.log(`  Pool #0 PDA   : ${poolPda.address} (total_notes=${poolState.totalNotes})`);
console.log(`  EpochPage #0  : ${page0Pda.address} (count=${hdr.count}/${PAGE_CAPACITY})`);
console.log(`  SOL Vault     : ${solVaultPda.address}`);
console.log(`  Escrow #0     : ${escrow0Pda.address}`);

// 3. SCANNER — 1,056-byte dataSlice[64..1120] view-tag filter, read-only FVK & spendable decrypt
const slice = fromHex(vectors.epoch_page.scan_slice_hex);
const hits = await scanPageScanSlice(aliceFvk, slice);
assert.deepEqual(hits, [5]);

const [watchOnly] = await scanEpochPage(aliceFvk, pageBytes, 0);
assert.equal(watchOnly.nullifierPdaB58, undefined);
const [note] = await scanEpochPageSpendable(alice, pageBytes, 0);

console.log('[3/6 SCANNER]');
console.log(`  dataSlice     : offset=${PAGE_SCAN_DATA_SLICE.offset}, length=${PAGE_SCAN_DATA_SLICE.length} B -> matched slot ${hits[0]}`);
console.log(`  Read-only FVK : ${watchOnly.amount} lamports | NullifierPDA=none`);
console.log(`  Spendable note: ${note.amount} lamports | NullifierPDA=${note.nullifierPdaB58}`);

// 4. PROVER — Pure-TS Deposit, Transfer (m=5 Triptych + Bulletproofs U128), ProofBuffer, CloseProofBuffer & Withdraw
const payer = base58Decode(vectors.pdas.proof_buffer_authority);
const bobAddr = vectors.bob.address;
const ring = extractRingFromPage(pageBytes);

const { instructions: [depIx] } = await buildDepositInstruction({
  depositor: payer,
  poolId: 0,
  activePageId: 1n,
  recipient: bobAddr,
  mint: NATIVE_SOL_MINT,
  amount: 500_000n,
});
const { instruction: xferIx } = await buildTransferInstruction({
  payer,
  poolId: 0,
  outPageId: 1n,
  inputPageIds: [0n],
  ring,
  inputNote: note,
  secretIndex: note.slotIndex,
  recipient: bobAddr,
  changeAddr: alice.address,
  payAmount: 900_000n,
});
const bufPlan = await buildBufferedExecutionPlan(xferIx, 42n);
const closeBufIx = await buildCloseProofBufferInstruction({ payer, nonce: 42n });
const { instruction: wdIx } = await buildWithdrawInstruction({
  payer,
  poolId: 0,
  outPageId: 1n,
  inputPageIds: [0n],
  ring,
  inputNote: note,
  secretIndex: note.slotIndex,
  recipientAccount: payer,
  changeAddr: alice.address,
  amount: 1_000_000n,
});

assert.equal(depIx.data.length, 139);
assert.equal(xferIx.data.length, 2373);
assert.equal(closeBufIx.data.length, 1);
assert.equal(wdIx.data.length, 1966);

console.log('[4/6 PROVER]');
console.log(`  Deposit ix    : ${depIx.data.length} B (tag=${depIx.data[0]})`);
console.log(`  Transfer m=5  : ${xferIx.data.length} B (tag=${xferIx.data[0]}, ProofBuffer chunks=${bufPlan.uploadChunks.length}, CloseProofBuffer=${closeBufIx.data.length} B)`);
console.log(`  Withdraw ix   : ${wdIx.data.length} B (tag=${wdIx.data[0]})`);

// 5. DISCLOSURE & AUDIT — Mode 1 Selective Disclosure + Institutional Auditor ElGamal decrypt
const sd = createSelectiveDisclosureProof(note);
assert.equal((await verifySelectiveDisclosureReceipt(sd)).valid, true);
assert.equal((await verifySelectiveDisclosureOnPage(sd, pageBytes)).valid, true);
assert.equal((await verifySelectiveDisclosureOnPage({ ...sd, amount: BigInt(sd.amount) + 1n }, pageBytes)).valid, false);

const auditor = await deriveAuditorKeypair(fromHex(vectors.auditor.auditor_seed_hex));
const decrypted = auditorDecryptNote({
  auditorSk: auditor.auditorSk,
  s1: fromHex(vectors.auditor.elgamal_s1_hex),
  s2: fromHex(vectors.auditor.elgamal_s2_hex),
  m1: fromHex(vectors.auditor.elgamal_m1_hex),
  m2: fromHex(vectors.auditor.elgamal_m2_hex),
});
assert.equal(toHex(decrypted.spentStealthPk), vectors.auditor.expected_spent_pk_hex);
assert.equal(toHex(decrypted.assetGenerator), vectors.auditor.expected_asset_gen_hex);

console.log('[5/6 DISCLOSURE & AUDIT]');
console.log('  Mode 1 proof  : verified standalone & on-page (tampered rejected)');
console.log('  Auditor decrypt: spent stealth_pk & asset_generator verified');

// 6. RELAYER & ROUTER — Unified cross-SDK prepareRouterAccounts & AUDREN_DEFAULT_RELAY_URL
const { address: escrowInAta } = await deriveAssociatedTokenAddress(
  escrow0Pda.address,
  USDC_MINT,
  CLASSIC_TOKEN_PROGRAM_ID,
);
const { address: escrowOutAta } = await deriveAssociatedTokenAddress(
  escrow0Pda.address,
  WSOL_MINT,
  CLASSIC_TOKEN_PROGRAM_ID,
);
const prepared = await prepareRouterAccounts({
  poolId: 0,
  shardId: 0,
  inputMint: USDC_MINT,
  outputMint: WSOL_MINT,
  routerAccounts: [
    { pubkey: escrowInAta, isSigner: false, isWritable: true },
    { pubkey: escrowOutAta, isSigner: false, isWritable: true },
    { pubkey: escrow0Pda.address, isSigner: true, isWritable: false },
  ],
});
const outerSigners = prepared.accounts.filter((a) => a.isSigner).length;
assert.deepEqual([prepared.escrowIdx, prepared.escrowInIdx, prepared.escrowOutIdx], [2, 0, 1]);
assert.equal(outerSigners, 0);

console.log('[6/6 RELAYER & ROUTER]');
console.log(`  Default relay : ${AUDREN_DEFAULT_RELAY_URL}`);
console.log(`  Router escrow : idx=${prepared.escrowIdx}, in=${prepared.escrowInIdx}, out=${prepared.escrowOutIdx} (outer signers=${outerSigners})`);
console.log(`  Excluded DEXes: ${JUPITER_CPI_EXCLUDED_DEXES.join(',')}`);
