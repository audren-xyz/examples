/**
 * Audren Canonical 6-Building-Block Quickstart (TypeScript SDK — `@audren/sdk` + `@audren/sdk/prover` WASM).
 *
 * Runs completely offline (zero RPC required) against `spec/test-vectors.json` and emits
 * 100% byte-for-byte identical canonical stdout across Rust, TypeScript, Swift, and Kotlin.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ASSET_MODE_PRIVATE,
  ASSET_MODE_SPL,
  AUDREN_DEFAULT_RELAY_URL,
  AUDREN_PROGRAM_ID,
  CLASSIC_TOKEN_PROGRAM_ID,
  CompactWalletStore,
  JUPITER_CPI_EXCLUDED_DEXES,
  NATIVE_SOL_MINT_BYTES,
  NUM_LANES,
  PROTOCOL_VERSION,
  SYSTEM_PROGRAM_ID,
  WSOL_MINT,
  ZERO_HASHES_4ARY,
  base58Decode,
  base58Encode,
  buildDepositSolInstruction,
  buildHistoricalWitness4Ary,
  buildJoinsplitInstruction,
  computeExecCtxHash,
  computeJoinsplitCtxHash,
  computeSubtree256Root,
  computeSuperRoot4Ary,
  decodeAudrenAddress,
  decodePoolState,
  decodeRootCheckpoint,
  deriveAssetId,
  deriveAssociatedTokenAddressSync,
  deriveDefiSessionKeypair,
  deriveEscrowPdaSync,
  deriveKeysFromSeed,
  deriveLanePdaSync,
  deriveNullifierPdaSync,
  derivePoolPdaSync,
  deriveSolVaultPdaSync,
  deriveStealthOwner,
  deriveSubaccountKeys,
  deriveUnwrapPdaSync,
  deriveVaultAuthPdaSync,
  encryptNoteMemo,
  exportFullViewingKey,
  frFromBeBytesStrict,
  frToBeBytes,
  poseidon4,
  prepareDynamicSwapMemo,
  tryDecryptAndVerifyMemo90,
  verifySelectiveDisclosureProof,
} from '@audren/sdk';
import {
  AudrenWasmProver,
  dummyInputWitness,
  dummyOutputWitness,
} from '@audren/sdk/prover';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const toHex = (b) => Buffer.from(b).toString('hex');
const fromHex = (h) => new Uint8Array(Buffer.from(h, 'hex'));

const audrenRepo = process.env.AUDREN_REPO_DIR ?? resolve(import.meta.dirname, '../../../audren');
const v = JSON.parse(readFileSync(resolve(audrenRepo, 'spec/test-vectors.json'), 'utf8'));
const poolId = 0;

// 1. KEYS & COMPLIANCE
const aliceSeed = fromHex(v.alice.seed_hex);
const bobSeed = fromHex(v.bob.seed_hex);
const alice = deriveKeysFromSeed(aliceSeed);
const aliceSub1 = deriveSubaccountKeys(aliceSeed, 1);
const bob = deriveKeysFromSeed(bobSeed);
const sess0 = deriveDefiSessionKeypair(aliceSeed, 0);
const sess3 = deriveDefiSessionKeypair(aliceSeed, 3);
const fvk = exportFullViewingKey(alice);
const parsed = decodeAudrenAddress(alice.address);
assert.equal(toHex(parsed.spendPk), v.alice.spend_pk_hex);

console.log('[1/6 KEYS]');
console.log(`  Program ID    : ${AUDREN_PROGRAM_ID} (v${PROTOCOL_VERSION})`);
console.log(`  Alice aud1    : ${alice.address}`);
console.log(`  Subaccount #1 : ${aliceSub1.address}`);
console.log(`  DeFi Session 0: ${sess0.pubkeyBase58}`);
console.log(`  FVK nk        : ${toHex(fvk.nk)}`);

// 2. PDAs & ZERO-COPY LAYOUTS
const poolPda = derivePoolPdaSync(poolId).address;
const solVaultPda = deriveSolVaultPdaSync(poolId).address;
const vaultAuthPda = deriveVaultAuthPdaSync(poolId).address;
const lane2Pda = deriveLanePdaSync(poolId, 2).address;
const escrow5Pda = deriveEscrowPdaSync(poolId, 5).address;
const poolState = decodePoolState(fromHex(v.pool_state.raw_hex));
const ckpt = decodeRootCheckpoint(fromHex(v.checkpoint_raw_hex));

console.log('[2/6 PDAs & LAYOUTS]');
console.log(
  `  Pool #0 PDA   : ${poolPda} (active_lanes=${poolState.activeLanes}, ckpt_interval=${poolState.ckptInterval})`,
);
console.log(`  SOL Vault     : ${solVaultPda}`);
console.log(`  Vault Auth    : ${vaultAuthPda}`);
console.log(`  Lane #2 PDA   : ${lane2Pda}`);
console.log(`  Escrow #5 PDA : ${escrow5Pda}`);
console.log(
  `  Checkpoint #13: slot_idx=${ckpt.slotIdx}, lane2_leaves=${ckpt.laneCounts[2]}, super_root=${toHex(ckpt.superRoot)}`,
);

// 3. MEMOS & ZERO-INDEXER COMPACT STORE
const ephSec = fromHex(v.memo.eph_secret_hex);
const amount = BigInt(v.memo.amount);
const mintBytes = fromHex(v.memo.mint_hex);
const { tweak, blinding, memo90 } = encryptNoteMemo(alice.viewPk, ephSec, amount, mintBytes);
const stealth = deriveStealthOwner(alice.spendPk, tweak);
const solAsset = deriveAssetId(NATIVE_SOL_MINT_BYTES);
const cmBe = fromHex(v.memo.commitment_hex);
const cmFr = frFromBeBytesStrict(cmBe);

const dec = tryDecryptAndVerifyMemo90(fvk, memo90, cmBe);
assert.ok(dec);
assert.equal(dec.amount, amount);

const nfSample = fromHex(v.pdas.nullifier_hex);
const nfPda = deriveNullifierPdaSync(poolId, nfSample).address;
const unwrapPda = deriveUnwrapPdaSync(poolId, nfSample).address;
const store = new CompactWalletStore(poolId, 0n);
assert.equal(store.poolId, 0);

console.log('[3/6 MEMOS & COMPACT STORE]');
console.log(
  `  Memo (90 B)   : ${toHex(memo90).slice(0, 16)}... -> decrypted ${dec.amount} lamports (Poseidon verified)`,
);
console.log(`  Nullifier PDA : ${nfPda}`);
console.log(`  Unwrap PDA    : ${unwrapPda}`);
console.log(`  CompactStore  : initialized (pool_id=${store.poolId}, indexer=none)`);

// 4. BN254 GROTH16 WASM PROVER & INSTRUCTIONS
const ctxPriv = computeJoinsplitCtxHash({
  poolId,
  outLaneId: 2,
  outputMask: 0b111,
  assetMode: ASSET_MODE_PRIVATE,
  unwrapWsol: false,
  publicAssetId: new Uint8Array(32),
  publicAmountOut: 0n,
  relayerFeeAmount: 0n,
  memosBytes: memo90,
});
const wsolAsset = deriveAssetId(base58Decode(WSOL_MINT));
const ctxWsol = computeJoinsplitCtxHash({
  poolId,
  outLaneId: 2,
  outputMask: 0,
  assetMode: ASSET_MODE_SPL,
  unwrapWsol: true,
  recipient: sess0.pubkeyBase58,
  relayerFeeRecipient: sess3.pubkeyBase58,
  publicAssetId: frToBeBytes(wsolAsset),
  publicAmountOut: 1_000_000_000n,
  relayerFeeAmount: 5_000_000n,
  memosBytes: new Uint8Array(0),
});
const usdcAsset = deriveAssetId(base58Decode(USDC_MINT));
const dynM = prepareDynamicSwapMemo(bob.viewPk, new Uint8Array(32).fill(0x44));
const ctxExec = computeExecCtxHash({
  poolId,
  outLaneId: 1,
  escrowShard: 3,
  changeMask: 0b01,
  inKind: 1,
  outKind: 0,
  feeOnOutput: true,
  assetIn: frToBeBytes(usdcAsset),
  amountIn: 50_000_000n,
  relayerFeeAmount: 2_000_000n,
  relayerFeeRecipient: sess3.pubkeyBase58,
  assetOut: frToBeBytes(solAsset),
  minAmountOut: 400_000_000n,
  routerProg: base58Encode(new Uint8Array(32).fill(0x77)),
  routerAccounts: [
    { pubkey: base58Encode(new Uint8Array(32).fill(0x88)), isSigner: false, isWritable: true },
    { pubkey: base58Encode(new Uint8Array(32).fill(0x99)), isSigner: false, isWritable: false },
  ],
  outStealthOwner: frToBeBytes(stealth),
  outBlinding: frToBeBytes(blinding),
  dynMemoHead: dynM.dynHead34,
  dynMask56: dynM.dynMask56,
  routerIxData: new Uint8Array([1, 2, 3, 4]),
  changeMemos: memo90,
});

// Real 192-byte BN254 Groth16 proof in WASM verified byte-for-byte against spec/test-vectors.json
const leaves = [0n, 0n, 0n, 0n, 0n, cmFr];
let lroot = computeSubtree256Root(leaves, 6);
for (let h = 4; h < 18; h++) {
  lroot = poseidon4(lroot, ZERO_HASHES_4ARY[h], ZERO_HASHES_4ARY[h], ZERO_HASHES_4ARY[h]);
}
const laneRoots = new Array(NUM_LANES).fill(ZERO_HASHES_4ARY[18]);
laneRoots[2] = lroot;
const superRoot = computeSuperRoot4Ary(laneRoots);
const path5 = buildHistoricalWitness4Ary({
  laneId: 2,
  targetLeafIdx: 5n,
  ckptLaneRoots: laneRoots,
  ckptLaneLeafCount: 6n,
  finalizedSubtreeRoots: [],
  targetPageLeaves: leaves,
  frontierPageLeaves: leaves,
});

const prover = await AudrenWasmProver.init();
const proved = prover.proveJoinsplit(
  {
    superRoot,
    txAssetId: solAsset,
    publicAssetId: 0n,
    publicAmountOut: 0n,
    relayerFeeAmount: 0n,
    ctxHash: ctxPriv,
    omitNf1: true,
    inputs: [
      {
        spendSk: alice.spendSk,
        tweak,
        assetId: solAsset,
        amount,
        blinding,
        isDummy: false,
        merklePath: path5,
      },
      dummyInputWitness(alice.spendSk, solAsset, 0x5555n),
    ],
    outputs: [
      {
        stealthOwner: deriveStealthOwner(bob.spendPk, 0x101n),
        assetId: solAsset,
        amount: 1_000_000n,
        blinding: 0x201n,
      },
      {
        stealthOwner: deriveStealthOwner(alice.spendPk, 0x102n),
        assetId: solAsset,
        amount: 500_000n,
        blinding: 0x202n,
      },
      dummyOutputWitness(solAsset, 0x203n),
    ],
  },
  new Uint8Array(32).fill(0x99),
);
assert.equal(toHex(proved.proof192), v.groth16.proof_192_hex);

const depIx = buildDepositSolInstruction({
  depositor: sess0.pubkeyBase58,
  poolId,
  laneId: 2,
  subPageSeq: 7n,
  rootPageSeq: 7n,
  memoPageSeq: 7n,
  feeFromAmount: true,
  amount,
  stealthOwner: stealth,
  blinding,
  memo90,
});
const jsIx = buildJoinsplitInstruction({
  payer: sess0.pubkeyBase58,
  poolId,
  ckptSlotIdx: 13,
  outLaneId: 2,
  outSubSeq: 7n,
  outRootSeq: 7n,
  outMemoSeq: 7n,
  outNfSeq: 7n,
  outputMask: 0b111,
  assetMode: ASSET_MODE_PRIVATE,
  unwrapWsol: false,
  proof192: proved.proof192,
  nf0: proved.nf0,
  nf1: proved.nf1,
  cm0: proved.cm0,
  cm1: proved.cm1,
  cm2: proved.cm2,
  publicAmountOut: 0n,
  relayerFeeAmount: 0n,
  recipient: SYSTEM_PROGRAM_ID,
  relayerFeeRecipient: SYSTEM_PROGRAM_ID,
  memosBytes: memo90,
});

console.log('[4/6 INSTRUCTIONS & GROTH16]');
console.log(`  DepositSol    : ${depIx.data.length} B (tag=${depIx.data[0]}, fee_from_amount=true)`);
console.log(
  `  JoinSplit     : ${jsIx.data.length} B (tag=${jsIx.data[0]}, proof=${proved.proof192.length} B Groth16, 1 Tx v1)`,
);
console.log(`  ctx_hash priv : ${toHex(frToBeBytes(ctxPriv))}`);
console.log(`  ctx_hash wsol : ${toHex(frToBeBytes(ctxWsol))}`);
console.log(`  ctx_hash exec : ${toHex(frToBeBytes(ctxExec))}`);

// 5. DISCLOSURE & COMPLIANCE
const sd = {
  poolId: 0,
  laneId: 2,
  leafIndex: 5n,
  stealthOwner: frToBeBytes(stealth),
  mint: mintBytes,
  amount,
  blinding: frToBeBytes(blinding),
  commitment: cmBe,
};
assert.equal(verifySelectiveDisclosureProof(sd, cmBe), true);
assert.equal(verifySelectiveDisclosureProof({ ...sd, amount: amount + 1n }, cmBe), false);

console.log('[5/6 DISCLOSURE & COMPLIANCE]');
console.log('  Mode 1 proof  : verified against on-chain leaf (tampered rejected)');
console.log('  Mode 2 FVK    : read-only (spend_pk + nk + view_sk + view_pk, zero spend authority)');

// 6. RELAYER & ESCROW CPI
const escrowUsdcAta = deriveAssociatedTokenAddressSync(escrow5Pda, USDC_MINT, CLASSIC_TOKEN_PROGRAM_ID).address;
const escrowWsolAta = deriveAssociatedTokenAddressSync(escrow5Pda, WSOL_MINT, CLASSIC_TOKEN_PROGRAM_ID).address;

console.log('[6/6 RELAYER & ESCROW CPI]');
console.log(`  Default relay : ${AUDREN_DEFAULT_RELAY_URL}`);
console.log(`  Escrow #5 ATAs: usdc=${escrowUsdcAta}, wsol=${escrowWsolAta}`);
console.log(`  Excluded DEXes: ${JUPITER_CPI_EXCLUDED_DEXES.join(',')}`);
