/**
 * Audren Canonical 6-Building-Block Quickstart (TypeScript SDK — `@audren/sdk` + `@audren/sdk/prover`).
 *
 * Runs completely offline (zero RPC required) and executes the exact same 6 building blocks
 * mirrored across Rust, TypeScript, Swift (iOS), and Kotlin (Android) against the shared
 * canonical `spec/test-vectors.json` conformance page.
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
  JUPITER_CPI_EXCLUDED_DEXES,
  PAGE_CAPACITY,
  PAGE_SCAN_LEN,
  PAGE_SCAN_OFFSET,
  base58Decode,
  decodePageHeader,
  decodePoolState,
  deriveEpochPagePda,
  derivePoolPda,
  deriveSolVaultPda,
  deriveSwapEscrowPda,
  parseAudrenAddress,
} from '@audren/sdk';
import {
  NATIVE_SOL_MINT,
  auditorDecryptNote,
  buildBufferedExecutionPlan,
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
  parseAudrenAddress as parseProverAddress,
  scanEpochPageSpendable,
  scanPageScanSlice,
  toHex,
  verifySelectiveDisclosureOnPage,
  verifySelectiveDisclosureReceipt,
} from '@audren/sdk/prover';

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

// 3. SCANNER — 1,056-byte dataSlice[64..1120] view-tag filter & note decryption
const slice = fromHex(vectors.epoch_page.scan_slice_hex);
const hits = await scanPageScanSlice(alice, slice);
assert.deepEqual(hits, [5]);
const [note] = await scanEpochPageSpendable(alice, pageBytes, 0);

console.log('[3/6 SCANNER]');
console.log(`  dataSlice     : offset=${PAGE_SCAN_OFFSET}, length=${PAGE_SCAN_LEN} B -> matched slot ${hits[0]}`);
console.log(`  Owned note    : ${note.amount} lamports | NullifierPDA=${note.nullifierPdaB58}`);

// 4. PROVER — Pure-TS Deposit, Transfer (m=5 Triptych + Bulletproofs U128), ProofBuffer & Withdraw
const payer = base58Decode(vectors.pdas.proof_buffer_authority);
const bobAddr = parseProverAddress(vectors.bob.address);
const aliceAddr = parseProverAddress(alice.address);
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
  changeAddr: aliceAddr,
  payAmount: 900_000n,
});
const bufPlan = await buildBufferedExecutionPlan(xferIx, 42n);
const { instruction: wdIx } = await buildWithdrawInstruction({
  payer,
  poolId: 0,
  outPageId: 1n,
  inputPageIds: [0n],
  ring,
  inputNote: note,
  secretIndex: note.slotIndex,
  recipientAccount: payer,
  changeAddr: aliceAddr,
  amount: 1_000_000n,
});

console.log('[4/6 PROVER]');
console.log(`  Deposit ix    : ${depIx.data.length} B (tag=${depIx.data[0]})`);
console.log(`  Transfer m=5  : ${xferIx.data.length} B (tag=${xferIx.data[0]}, ProofBuffer chunks=${bufPlan.uploadChunks.length})`);
console.log(`  Withdraw ix   : ${wdIx.data.length} B (tag=${wdIx.data[0]})`);

// 5. DISCLOSURE & AUDIT — Mode 1 Selective Disclosure + Institutional Auditor ElGamal decrypt
const sd = createSelectiveDisclosureProof(note);
assert.equal((await verifySelectiveDisclosureReceipt(sd)).valid, true);
assert.equal((await verifySelectiveDisclosureOnPage(sd, pageBytes)).valid, true);
assert.equal((await verifySelectiveDisclosureOnPage({ ...sd, amount: sd.amount + 1 }, pageBytes)).valid, false);

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

// 6. RELAYER & ROUTER
console.log('[6/6 RELAYER & ROUTER]');
console.log(`  Default relay : ${AUDREN_DEFAULT_RELAY_URL}`);
console.log(`  Excluded DEXes: ${JUPITER_CPI_EXCLUDED_DEXES.join(',')}`);
