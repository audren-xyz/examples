/**
 * Audren v1 Canonical 6-Building-Block Quickstart (TypeScript SDK — `@audren/sdk` + `@audren/sdk/prover` WASM).
 *
 * Runs completely offline (zero RPC required) against `spec/test-vectors.json` and emits
 * 100% byte-for-byte identical canonical stdout across Rust, TypeScript, Swift, and Kotlin.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ASSET_MODE_PRIVATE,
  ASSET_MODE_PUBLIC,
  AUDREN_DEFAULT_RELAY_URL,
  AUDREN_PROGRAM_ID,
  CLASSIC_TOKEN_PROGRAM_ID,
  CompactWalletStore,
  DEFAULT_ROOT_EPOCH_INTERVAL,
  JUPITER_CPI_EXCLUDED_DEXES,
  NUM_LANES,
  PROTOCOL_VERSION,
  ROOT_RING_EPOCH,
  SYSTEM_PROGRAM_ID,
  VK_ID_DEFAULT,
  WSOL_MINT,
  ZERO_HASHES_4ARY,
  base58Decode,
  base58Encode,
  buildDepositInstruction,
  buildHistoricalWitness4Ary,
  buildInitRootHistoryInstruction,
  buildTransactInstruction,
  computeExecCtxHash,
  computeSubtree256Root,
  computeSuperRoot4Ary,
  computeTransactCtxHash,
  decodeGlobalRootHistory,
  decodePoolState,
  deriveAssetId,
  deriveAssociatedTokenAddressSync,
  deriveDefiSessionKeypair,
  deriveEscrowPdaSync,
  deriveKeysFromSeed,
  deriveLanePdaSync,
  deriveNullifierPdaSync,
  derivePoolPdaSync,
  deriveRootsPdaSync,
  deriveStealthOwner,
  deriveSubaccountKeys,
  deriveUnwrapPdaSync,
  deriveVaultAuthPdaSync,
  encryptNoteMemo,
  exportFullViewingKey,
  frFromBeBytesStrict,
  frToBeBytes,
  parseAudrenAddress,
  poseidon4,
  prepareDynamicSwapMemo,
  tryDecryptAndVerifyMemo,
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

function findVectorsPath() {
  const candidates = [
    ...(process.env.AUDREN_REPO_DIR
      ? [resolve(process.env.AUDREN_REPO_DIR, 'spec/test-vectors.json')]
      : []),
    resolve(import.meta.dirname, '../../spec/test-vectors.json'),
    resolve(import.meta.dirname, '../../../audren/spec/test-vectors.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('spec/test-vectors.json not found; set AUDREN_REPO_DIR=/path/to/audren');
}
const v = JSON.parse(readFileSync(findVectorsPath(), 'utf8'));
const poolId = 0;

// 1. KEYS & COMPLIANCE (TEST VECTOR ONLY: never use deterministic seeds in production; use crypto.getRandomValues)
const aliceSeed = fromHex(v.alice.seed_hex);
const bobSeed = fromHex(v.bob.seed_hex);
const alice = deriveKeysFromSeed(aliceSeed);
const aliceSub1 = deriveSubaccountKeys(aliceSeed, 1);
const bob = deriveKeysFromSeed(bobSeed);
const sess0 = deriveDefiSessionKeypair(aliceSeed, 0);
const sess3 = deriveDefiSessionKeypair(aliceSeed, 3);
const fvk = exportFullViewingKey(alice);
const parsed = parseAudrenAddress(alice.address);
assert.equal(toHex(parsed.spendPk), v.alice.spend_pk_hex);
assert.equal(alice.address, v.alice.address);

console.log('[1/6 KEYS]');
console.log(`  Program ID    : ${AUDREN_PROGRAM_ID} (v${PROTOCOL_VERSION})`);
console.log(`  Alice aud1    : ${alice.address}`);
console.log(`  Subaccount #1 : ${aliceSub1.address}`);
console.log(`  DeFi Session 0: ${sess0.pubkeyBase58}`);
console.log(`  FVK nk        : ${toHex(fvk.nk)}`);

// 2. PDAs & ZERO-COPY LAYOUTS
const poolPda = derivePoolPdaSync(poolId).address;
const rootsPda = deriveRootsPdaSync(poolId).address;
const vaultAuthPda = deriveVaultAuthPdaSync(poolId).address;
const lane2Pda = deriveLanePdaSync(poolId, 2).address;
const escrow5Pda = deriveEscrowPdaSync(poolId, 5).address;
assert.equal(rootsPda, v.pdas.roots.address);
const poolState = decodePoolState(fromHex(v.pool_state.raw_hex));
const roots = decodeGlobalRootHistory(fromHex(v.root_history.raw_hex));

console.log('[2/6 PDAs & LAYOUTS]');
console.log(
  `  Pool #0 PDA   : ${poolPda} (active_lanes=${poolState.activeLanes}, root_epoch_interval=${poolState.rootEpochInterval})`,
);
console.log(
  `  Roots PDA     : ${rootsPda} (slot_cursor=${roots.slotCursor}, epoch_cursor=${roots.epochCursor}, lane2_leaves=${roots.stableLaneCounts[2]}, super_root=${toHex(roots.stableSuperRoot)})`,
);
console.log(`  Vault Auth    : ${vaultAuthPda}`);
console.log(`  Lane #2 PDA   : ${lane2Pda}`);
console.log(`  Escrow #5 PDA : ${escrow5Pda}`);

// 3. MEMOS & ZERO-INDEXER COMPACT STORE
const ephSec = fromHex(v.memo.eph_secret_hex);
const amount = BigInt(v.memo.amount);
const mintBytes = fromHex(v.memo.mint_hex);
const paymentId = fromHex(v.memo.payment_id_hex);
const { tweak, blinding, memo } = encryptNoteMemo(alice.viewPk, ephSec, amount, mintBytes, paymentId);
assert.equal(toHex(memo), v.memo.memo_106_hex);
const stealth = deriveStealthOwner(alice.spendPk, tweak);
const wsolAsset = deriveAssetId(base58Decode(WSOL_MINT));
const cmBe = fromHex(v.memo.commitment_hex);
const cmFr = frFromBeBytesStrict(cmBe);

const dec = tryDecryptAndVerifyMemo(fvk, memo, cmBe);
assert.ok(dec);
assert.equal(dec.amount, amount);
assert.equal(toHex(dec.paymentId), v.memo.payment_id_hex);

const nfSample = fromHex(v.pdas.nullifier_hex);
const nfPda = deriveNullifierPdaSync(poolId, nfSample).address;
const unwrapPda = deriveUnwrapPdaSync(poolId, nfSample).address;
const store = new CompactWalletStore(poolId, 0n);
assert.equal(store.poolId, 0);

console.log('[3/6 MEMOS & COMPACT STORE]');
console.log(
  `  Memo (106 B)  : ${toHex(memo).slice(0, 16)}... -> decrypted ${dec.amount} lamports (payment_id=${toHex(dec.paymentId)}, Poseidon verified)`,
);
console.log(`  Nullifier PDA : ${nfPda}`);
console.log(`  Unwrap PDA    : ${unwrapPda}`);
console.log(`  CompactStore  : initialized (pool_id=${store.poolId}, indexer=none)`);

// 4. BN254 GROTH16 WASM PROVER & INSTRUCTIONS
const ctxPriv = computeTransactCtxHash({
  poolId,
  vkId: VK_ID_DEFAULT,
  outLaneId: 2,
  outputMask: 0b111,
  assetMode: ASSET_MODE_PRIVATE,
  unwrapWsol: false,
  publicAssetId: new Uint8Array(32),
  publicAmountOut: 0n,
  relayerFeeAmount: 0n,
  memosBytes: memo,
});
assert.equal(toHex(frToBeBytes(ctxPriv)), v.ctx_hashes.transact_private_ctx_hash_hex);

const ctxWsol = computeTransactCtxHash({
  poolId,
  vkId: VK_ID_DEFAULT,
  outLaneId: 2,
  outputMask: 0,
  assetMode: ASSET_MODE_PUBLIC,
  unwrapWsol: true,
  recipient: sess0.pubkeyBase58,
  relayerFeeRecipient: sess3.pubkeyBase58,
  publicAssetId: frToBeBytes(wsolAsset),
  publicAmountOut: 1_000_000_000n,
  relayerFeeAmount: 5_000_000n,
  memosBytes: new Uint8Array(0),
});
assert.equal(toHex(frToBeBytes(ctxWsol)), v.ctx_hashes.transact_wsol_unwrap_ctx_hash_hex);

const usdcAsset = deriveAssetId(base58Decode(USDC_MINT));
const dynM = prepareDynamicSwapMemo(bob.viewPk, fromHex(v.memo.dyn_eph_secret_hex));
const ctxExec = computeExecCtxHash({
  poolId,
  vkId: VK_ID_DEFAULT,
  outLaneId: 1,
  escrowShard: 3,
  changeMask: 0b01,
  feeOnOutput: true,
  assetIn: frToBeBytes(usdcAsset),
  amountIn: 50_000_000n,
  relayerFeeAmount: 2_000_000n,
  relayerFeeRecipient: sess3.pubkeyBase58,
  assetOut: frToBeBytes(wsolAsset),
  minAmountOut: 400_000_000n,
  routerProg: base58Encode(new Uint8Array(32).fill(0x77)),
  routerAccounts: [
    { pubkey: base58Encode(new Uint8Array(32).fill(0x88)), isSigner: false, isWritable: true },
    { pubkey: base58Encode(new Uint8Array(32).fill(0x99)), isSigner: false, isWritable: false },
  ],
  extraWritablePubkeys: [],
  outStealthOwner: frToBeBytes(stealth),
  outBlinding: frToBeBytes(blinding),
  dynMemoHead: dynM.dynHead34,
  dynMemoMask: dynM.dynMask72,
  routerIxData: new Uint8Array([1, 2, 3, 4]),
  changeMemos: memo,
});
assert.equal(toHex(frToBeBytes(ctxExec)), v.ctx_hashes.exec_fee_on_output_ctx_hash_hex);

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
  laneRoots,
  laneLeafCount: 6n,
  finalizedSubtreeRoots: [],
  targetPageLeaves: leaves,
  frontierPageLeaves: leaves,
});

// TEST VECTOR ONLY: deterministic prover seed reproduces spec/test-vectors.json; omit seed32 (CSPRNG) in production.
const prover = await AudrenWasmProver.init();
const proved = prover.proveJoinsplit(
  {
    superRoot,
    txAssetId: wsolAsset,
    publicAssetId: 0n,
    publicAmountOut: 0n,
    relayerFeeAmount: 0n,
    ctxHash: ctxPriv,
    omitNf1: true,
    inputs: [
      {
        spendSk: alice.spendSk,
        tweak,
        assetId: wsolAsset,
        amount,
        blinding,
        isDummy: false,
        merklePath: path5,
      },
      dummyInputWitness(alice.spendSk, wsolAsset, 0x5555n),
    ],
    outputs: [
      {
        stealthOwner: deriveStealthOwner(bob.spendPk, 0x101n),
        assetId: wsolAsset,
        amount: 1_000_000n,
        blinding: 0x201n,
      },
      {
        stealthOwner: deriveStealthOwner(alice.spendPk, 0x102n),
        assetId: wsolAsset,
        amount: 500_000n,
        blinding: 0x202n,
      },
      dummyOutputWitness(wsolAsset, 0x203n),
    ],
  },
  new Uint8Array(32).fill(0x99),
);
assert.equal(toHex(proved.proof192), v.groth16.proof_192_hex);

const depIx = buildDepositInstruction({
  depositor: sess0.pubkeyBase58,
  poolId,
  laneId: 2,
  subPageSeq: 7n,
  rootPageSeq: 7n,
  memoPageSeq: 7n,
  nativeSol: true,
  feeFromAmount: true,
  amount,
  stealthOwner: stealth,
  blinding,
  memo,
});
const initRootsIx = buildInitRootHistoryInstruction({
  authority: sess0.pubkeyBase58,
  poolId,
  rootEpochInterval: DEFAULT_ROOT_EPOCH_INTERVAL,
  activeLanes: 4,
});
const rootRingIdx = roots.epochCursor;
// Canonical privacy-padded 3-output private Transact (`outputMask = 0b111`, 3 * 106 B memos).
const memos3 = new Uint8Array(memo.length * 3);
memos3.set(memo, 0);
memos3.set(memo, memo.length);
memos3.set(memo, memo.length * 2);
const txIx = buildTransactInstruction({
  payer: sess0.pubkeyBase58,
  poolId,
  vkId: VK_ID_DEFAULT,
  rootRingKind: ROOT_RING_EPOCH,
  rootRingIdx,
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
  memosBytes: memos3,
});

console.log('[4/6 INSTRUCTIONS & GROTH16]');
console.log(
  `  Deposit       : ${depIx.data.length} B (tag=${depIx.data[0]}, native_sol=true, fee_from_amount=true)`,
);
console.log(
  `  InitRootHist  : ${initRootsIx.data.length} B (tag=${initRootsIx.data[0]}, root_epoch_interval=${DEFAULT_ROOT_EPOCH_INTERVAL}, active_lanes=4)`,
);
console.log(
  `  Transact      : ${txIx.data.length} B (tag=${txIx.data[0]}, ring=${ROOT_RING_EPOCH}:${rootRingIdx}, proof=${proved.proof192.length} B Groth16, 1 Tx v1)`,
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
const escrowUsdcAta = deriveAssociatedTokenAddressSync(
  escrow5Pda,
  USDC_MINT,
  CLASSIC_TOKEN_PROGRAM_ID,
).address;
const escrowWsolAta = deriveAssociatedTokenAddressSync(
  escrow5Pda,
  WSOL_MINT,
  CLASSIC_TOKEN_PROGRAM_ID,
).address;

console.log('[6/6 RELAYER & ESCROW CPI]');
console.log(`  Default relay : ${AUDREN_DEFAULT_RELAY_URL}`);
console.log(`  Escrow #5 ATAs: usdc=${escrowUsdcAta}, wsol=${escrowWsolAta}`);
console.log(`  Excluded DEXes: ${JUPITER_CPI_EXCLUDED_DEXES.join(',')}`);
