/**
 * Audren v1.3.0 Example — Private Kamino Lending & Yield Vaults via `ExecViaEscrow` (`Tag 6`).
 *
 * Demonstrates building and verifying `ExecViaEscrow` (`Tag 6`) instructions through `@audren/sdk`
 * for two real Solana Mainnet single-call DeFi protocols (zero outer user signers — Audren's
 * sharded `audren_escrow` PDA signs via `invoke_signed`):
 *   1. Kamino Lending (`KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`) Main Market USDC Reserve:
 *      - Supply: `USDC -> cUSDC` (`depositReserveLiquidity` + zero-signer `refreshReserve` pre-ix)
 *      - Redeem: `cUSDC -> USDC` (`redeemReserveCollateral` + `refreshReserve` + `EXEC_FLAG_FEE_ON_OUTPUT`)
 *   2. Kamino Vaults (`KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd`) Prime USDC Vault:
 *      - Deposit: `USDC -> Prime USDC Shares` (`deposit`, remaining account `KLEND_USDC_RESERVE` writable)
 *      - Withdraw: `Prime USDC Shares -> USDC` (`withdrawFromAvailable` + `EXEC_FLAG_FEE_ON_OUTPUT`)
 *
 * Production notes:
 *   - Always generate a fresh 32-byte CSPRNG ephemeral secret per transaction (never reuse
 *     `prepareDynamicSwapMemo` keystreams across transactions).
 *   - Set `minAmountOut` to a real quoted slippage floor. When `feeOnOutput: true`, Audren checks
 *     net user output (`gross_out - relayerFeeAmount >= minAmountOut`), and the Groth16 circuit
 *     takes `relayerFeeAmount: 0n` (the fee is paid from output Token B rather than input Token A).
 *   - Pass any writable pubkeys from `preInstructions` in `extraWritablePubkeys` to BOTH
 *     `computeExecCtxHash` and `buildExecViaEscrowInstruction` so Solana's transaction-wide
 *     writability promotion matches on-chain `ctx_hash` bit-for-bit.
 *
 * Run (from `typescript/`):
 *   pnpm kamino-defi
 */

import assert from 'node:assert/strict';
import {
  AUDREN_PROGRAM_ID,
  CLASSIC_TOKEN_PROGRAM_ID,
  EXEC_FLAG_FEE_ON_OUTPUT,
  ROOT_RING_EPOCH,
  TAG_EXEC_VIA_ESCROW,
  base58Decode,
  buildExecViaEscrowInstruction,
  computeExecCtxHash,
  deriveAssetId,
  deriveAssociatedTokenAddressSync,
  deriveEscrowPdaSync,
  deriveKeysFromSeed,
  deriveRootsPdaSync,
  deriveStealthOwner,
  deriveVaultAuthPdaSync,
  frToBeBytes,
  prepareDynamicSwapMemo,
  prepareEscrowAccounts,
  recommendedExecViaEscrowCuLimit,
} from '@audren/sdk';

const POOL_ID = 0;
const SHARD_ID = 0;
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SYSVAR_INSTRUCTIONS = 'Sysvar1nstructions1111111111111111111111111';

// Kamino Lending Main Market (USDC Reserve)
const KLEND_PROGRAM_ID = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const KLEND_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
const KLEND_MAIN_MARKET_AUTH = '9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo';
const KLEND_SCOPE_PRICES = '3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH';
const KLEND_USDC_RESERVE = 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59';
const KLEND_USDC_SUPPLY_VAULT = 'Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6';
const KLEND_CUSDC_MINT = 'B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D';

// Kamino Vaults (Prime USDC Vault)
const KVAULT_PROGRAM_ID = 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd';
const KVAULT_PRIME_USDC_STATE = '8AMY55aBV8JboErk4H4hzCsiApnxKxnFtpKi9t8qMTH';
const KVAULT_PRIME_USDC_TOKEN_VAULT = 'GnxZi2MeZ4Kp8icDGMje1SVMcT7H6q93N4nS7PRs6cj7';
const KVAULT_PRIME_USDC_AUTH = 'EYM1yuKbwvfDCEfqUTW4a9rJrpEEFg4dqtCd4mrs5kuj';
const KVAULT_PRIME_USDC_SHARES_MINT = 'FFC3xZPuie63y2iq7WFz8JQg9Dxa5E1kn8FDQpE3GJ31';
const KVAULT_GLOBAL_CONFIG = 'BKyTcUe6daNG8HbgBix2ugdRHbykG2dK9hPBBqhUyoEX';
const KVAULT_EVENT_AUTH = '24tHwQyJJ9akVXxnvkekGfAoeUJXXS7mE6kQNioNySsK';

// Anchor discriminators verified against on-chain Mainnet IDLs & confirmed txs
const DISC_KLEND_REFRESH_RESERVE = Uint8Array.from([2, 218, 138, 235, 79, 201, 25, 102]);
const DISC_KLEND_DEPOSIT_RESERVE_LIQUIDITY = Uint8Array.from([169, 201, 30, 126, 6, 205, 102, 68]);
const DISC_KLEND_REDEEM_RESERVE_COLLATERAL = Uint8Array.from([234, 117, 181, 125, 185, 142, 220, 29]);
const DISC_KVAULT_DEPOSIT = Uint8Array.from([242, 35, 198, 137, 82, 225, 242, 182]);
const DISC_KVAULT_WITHDRAW_FROM_AVAILABLE = Uint8Array.from([19, 131, 112, 155, 170, 220, 34, 57]);

const EXAMPLE_RELAYER = 'H2JcTKgrP5Hqj7v2hTuz5u6Tt1VB8yrznotT62hhp3vY';

function u64le(v) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
  return b;
}

function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((acc, p) => acc + p.byteLength, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

const { address: rootsPda } = deriveRootsPdaSync(POOL_ID);
const { address: vaultAuthPda } = deriveVaultAuthPdaSync(POOL_ID);
const { address: escrowPda } = deriveEscrowPdaSync(POOL_ID, SHARD_ID);

const ata = (owner, mint) =>
  deriveAssociatedTokenAddressSync(owner, mint, CLASSIC_TOKEN_PROGRAM_ID).address;

const vaultUsdcAta = ata(vaultAuthPda, USDC_MINT);
const escrowUsdcAta = ata(escrowPda, USDC_MINT);
const vaultCUsdcAta = ata(vaultAuthPda, KLEND_CUSDC_MINT);
const escrowCUsdcAta = ata(escrowPda, KLEND_CUSDC_MINT);
const vaultSharesAta = ata(vaultAuthPda, KVAULT_PRIME_USDC_SHARES_MINT);
const escrowSharesAta = ata(escrowPda, KVAULT_PRIME_USDC_SHARES_MINT);
const relayerUsdcFeeAta = ata(EXAMPLE_RELAYER, USDC_MINT);

// Deterministic offline demo wallet & distinct per-flow ephemeral secrets
// (production callers MUST use 32-byte CSPRNG secrets per tx)
const demoSeed = new Uint8Array(32).fill(0x42);
const keys = deriveKeysFromSeed(demoSeed);
const makeDyn = (fillByte) => {
  const dyn = prepareDynamicSwapMemo(keys.viewPk, new Uint8Array(32).fill(fillByte));
  return {
    dyn,
    outStealthOwner: frToBeBytes(deriveStealthOwner(keys.spendPk, dyn.tweak)),
    outBlinding: frToBeBytes(dyn.blinding),
  };
};

// Placeholder proof/nullifier/commitment fields for offline instruction assembly verification
const dummyProof192 = new Uint8Array(192).fill(1);
const dummyField32 = (fillByte) => {
  const b = new Uint8Array(32);
  b[31] = fillByte;
  return b;
};

const assetUsdc = frToBeBytes(deriveAssetId(base58Decode(USDC_MINT)));
const assetCUsdc = frToBeBytes(deriveAssetId(base58Decode(KLEND_CUSDC_MINT)));
const assetPrimeShares = frToBeBytes(deriveAssetId(base58Decode(KVAULT_PRIME_USDC_SHARES_MINT)));

// Zero-signer pre-instruction required before KLend supply/redeem (base64 data matching relay.audren.xyz)
const klendRefreshReservePreIx = {
  programId: KLEND_PROGRAM_ID,
  accounts: [
    { pubkey: KLEND_USDC_RESERVE, isSigner: false, isWritable: true },
    { pubkey: KLEND_MAIN_MARKET, isSigner: false, isWritable: false },
    { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: KLEND_SCOPE_PRICES, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(DISC_KLEND_REFRESH_RESERVE).toString('base64'),
};
assert.equal(
  klendRefreshReservePreIx.accounts.filter((a) => a.isSigner).length,
  0,
  'refreshReserve pre-instruction must require zero signers',
);
assert.equal(Buffer.from(klendRefreshReservePreIx.data, 'base64').byteLength, 8);
const klendPreWritable = klendRefreshReservePreIx.accounts
  .filter((a) => a.isWritable)
  .map((a) => a.pubkey);

async function buildAndVerifyExecFlow({
  outLaneId,
  inMint,
  outMint,
  assetIn,
  assetOut,
  vaultInAta,
  vaultOutAta,
  escrowInAta,
  escrowOutAta,
  amountIn,
  minAmountOut,
  feeOnOutput,
  relayerFeeAmount,
  routerProg,
  routerIxData,
  routerAccounts,
  extraWritablePubkeys = [],
  ephFillByte,
}) {
  const prepared = await prepareEscrowAccounts({
    poolId: POOL_ID,
    shardId: SHARD_ID,
    inputMint: inMint,
    outputMint: outMint,
    actionAccounts: routerAccounts,
  });
  assert.equal(prepared.accounts.filter((a) => a.isSigner).length, 0);

  const { dyn, outStealthOwner, outBlinding } = makeDyn(ephFillByte);
  const ctxHash = computeExecCtxHash({
    poolId: POOL_ID,
    outLaneId,
    escrowShard: SHARD_ID,
    changeMask: 0,
    feeOnOutput,
    assetIn,
    amountIn,
    relayerFeeAmount,
    relayerFeeRecipient: relayerUsdcFeeAta,
    assetOut,
    minAmountOut,
    routerProg,
    routerAccounts,
    payer: EXAMPLE_RELAYER,
    escrowInAta,
    escrowOutAta,
    vaultInAta,
    vaultOutAta,
    extraWritablePubkeys,
    outStealthOwner,
    outBlinding,
    dynMemoHead: dyn.dynHead34,
    dynMemoMask: dyn.dynMask72,
    routerIxData,
    changeMemos: new Uint8Array(0),
  });

  const ix = buildExecViaEscrowInstruction({
    payer: EXAMPLE_RELAYER,
    poolId: POOL_ID,
    rootRingKind: ROOT_RING_EPOCH,
    rootRingIdx: 0,
    outLaneId,
    outSubSeq: 0n,
    outRootSeq: 0n,
    outMemoSeq: 0n,
    outNfSeq: 0n,
    escrowShard: SHARD_ID,
    changeMask: 0,
    feeOnOutput,
    inLeg: { mint: inMint, tokenProgram: CLASSIC_TOKEN_PROGRAM_ID },
    outLeg: { mint: outMint, tokenProgram: CLASSIC_TOKEN_PROGRAM_ID },
    relayerFeeRecipient: relayerUsdcFeeAta,
    proof192: dummyProof192,
    nf0: dummyField32(1),
    nf1: dummyField32(2),
    cm0: dummyField32(3),
    cm1: dummyField32(4),
    cm2: dummyField32(5),
    amountIn,
    minAmountOut,
    relayerFeeAmount,
    outStealthOwner,
    outBlinding,
    dynMemoHead: dyn.dynHead34,
    dynMemoMask: dyn.dynMask72,
    routerProg,
    routerIxData,
    routerAccounts,
    extraWritablePubkeys,
    changeMemos: new Uint8Array(0),
  });

  assert.equal(ix.data[0], TAG_EXEC_VIA_ESCROW);
  const flags = ix.data[9];
  assert.equal((flags & EXEC_FLAG_FEE_ON_OUTPUT) !== 0, feeOnOutput);
  assert.equal(
    ix.accounts.filter((a) => a.isSigner).length,
    1,
    'only the relayer fee payer may be an outer signer',
  );
  assert.equal(ix.accounts[0].pubkey, EXAMPLE_RELAYER);
  return { prepared, ctxHash, ix };
}

// 1a. Kamino Lending Supply (USDC -> cUSDC, input-leg USDC relayer fee)
const klendSupplyAmount = 2_500_000n;
const klendSupply = await buildAndVerifyExecFlow({
  outLaneId: 0,
  inMint: USDC_MINT,
  outMint: KLEND_CUSDC_MINT,
  assetIn: assetUsdc,
  assetOut: assetCUsdc,
  vaultInAta: vaultUsdcAta,
  vaultOutAta: vaultCUsdcAta,
  escrowInAta: escrowUsdcAta,
  escrowOutAta: escrowCUsdcAta,
  amountIn: klendSupplyAmount,
  minAmountOut: 1n,
  feeOnOutput: false,
  relayerFeeAmount: 200_000n,
  routerProg: KLEND_PROGRAM_ID,
  routerIxData: concatBytes(DISC_KLEND_DEPOSIT_RESERVE_LIQUIDITY, u64le(klendSupplyAmount)),
  routerAccounts: [
    { pubkey: escrowPda, isSigner: true, isWritable: false },
    { pubkey: KLEND_USDC_RESERVE, isSigner: false, isWritable: true },
    { pubkey: KLEND_MAIN_MARKET, isSigner: false, isWritable: false },
    { pubkey: KLEND_MAIN_MARKET_AUTH, isSigner: false, isWritable: false },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: KLEND_USDC_SUPPLY_VAULT, isSigner: false, isWritable: true },
    { pubkey: KLEND_CUSDC_MINT, isSigner: false, isWritable: true },
    { pubkey: escrowUsdcAta, isSigner: false, isWritable: true },
    { pubkey: escrowCUsdcAta, isSigner: false, isWritable: true },
    { pubkey: CLASSIC_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: CLASSIC_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_INSTRUCTIONS, isSigner: false, isWritable: false },
  ],
  extraWritablePubkeys: klendPreWritable,
  ephFillByte: 0x24,
});

// 1b. Kamino Lending Redeem (cUSDC -> USDC, EXEC_FLAG_FEE_ON_OUTPUT paying relayer in USDC)
const klendRedeemCollateral = 2_000_000n;
const klendRedeem = await buildAndVerifyExecFlow({
  outLaneId: 1,
  inMint: KLEND_CUSDC_MINT,
  outMint: USDC_MINT,
  assetIn: assetCUsdc,
  assetOut: assetUsdc,
  vaultInAta: vaultCUsdcAta,
  vaultOutAta: vaultUsdcAta,
  escrowInAta: escrowCUsdcAta,
  escrowOutAta: escrowUsdcAta,
  amountIn: klendRedeemCollateral,
  minAmountOut: 1n,
  feeOnOutput: true,
  relayerFeeAmount: 200_000n,
  routerProg: KLEND_PROGRAM_ID,
  routerIxData: concatBytes(DISC_KLEND_REDEEM_RESERVE_COLLATERAL, u64le(klendRedeemCollateral)),
  routerAccounts: [
    { pubkey: escrowPda, isSigner: true, isWritable: false },
    { pubkey: KLEND_MAIN_MARKET, isSigner: false, isWritable: false },
    { pubkey: KLEND_USDC_RESERVE, isSigner: false, isWritable: true },
    { pubkey: KLEND_MAIN_MARKET_AUTH, isSigner: false, isWritable: false },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: KLEND_CUSDC_MINT, isSigner: false, isWritable: true },
    { pubkey: KLEND_USDC_SUPPLY_VAULT, isSigner: false, isWritable: true },
    { pubkey: escrowCUsdcAta, isSigner: false, isWritable: true },
    { pubkey: escrowUsdcAta, isSigner: false, isWritable: true },
    { pubkey: CLASSIC_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: CLASSIC_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_INSTRUCTIONS, isSigner: false, isWritable: false },
  ],
  extraWritablePubkeys: klendPreWritable,
  ephFillByte: 0x25,
});

// 2a. Kamino Prime USDC Yield Vault Deposit (USDC -> Prime USDC shares)
const vaultDepositAmount = 2_500_000n;
const vaultDeposit = await buildAndVerifyExecFlow({
  outLaneId: 2,
  inMint: USDC_MINT,
  outMint: KVAULT_PRIME_USDC_SHARES_MINT,
  assetIn: assetUsdc,
  assetOut: assetPrimeShares,
  vaultInAta: vaultUsdcAta,
  vaultOutAta: vaultSharesAta,
  escrowInAta: escrowUsdcAta,
  escrowOutAta: escrowSharesAta,
  amountIn: vaultDepositAmount,
  minAmountOut: 1n,
  feeOnOutput: false,
  relayerFeeAmount: 200_000n,
  routerProg: KVAULT_PROGRAM_ID,
  routerIxData: concatBytes(DISC_KVAULT_DEPOSIT, u64le(vaultDepositAmount)),
  routerAccounts: [
    { pubkey: escrowPda, isSigner: true, isWritable: true },
    { pubkey: KVAULT_PRIME_USDC_STATE, isSigner: false, isWritable: true },
    { pubkey: KVAULT_PRIME_USDC_TOKEN_VAULT, isSigner: false, isWritable: true },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: KVAULT_PRIME_USDC_AUTH, isSigner: false, isWritable: false },
    { pubkey: KVAULT_PRIME_USDC_SHARES_MINT, isSigner: false, isWritable: true },
    { pubkey: escrowUsdcAta, isSigner: false, isWritable: true },
    { pubkey: escrowSharesAta, isSigner: false, isWritable: true },
    { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: CLASSIC_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: CLASSIC_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: KVAULT_EVENT_AUTH, isSigner: false, isWritable: false },
    { pubkey: KVAULT_PROGRAM_ID, isSigner: false, isWritable: false },
    // Remaining accounts (reserve MUST be writable for vault internal refresh)
    { pubkey: KLEND_USDC_RESERVE, isSigner: false, isWritable: true },
    { pubkey: KLEND_MAIN_MARKET, isSigner: false, isWritable: false },
  ],
  ephFillByte: 0x26,
});

// 2b. Kamino Prime USDC Yield Vault Withdraw (Prime shares -> USDC, EXEC_FLAG_FEE_ON_OUTPUT)
const vaultWithdrawShares = 2_300_000n;
const vaultWithdraw = await buildAndVerifyExecFlow({
  outLaneId: 3,
  inMint: KVAULT_PRIME_USDC_SHARES_MINT,
  outMint: USDC_MINT,
  assetIn: assetPrimeShares,
  assetOut: assetUsdc,
  vaultInAta: vaultSharesAta,
  vaultOutAta: vaultUsdcAta,
  escrowInAta: escrowSharesAta,
  escrowOutAta: escrowUsdcAta,
  amountIn: vaultWithdrawShares,
  minAmountOut: 1n,
  feeOnOutput: true,
  relayerFeeAmount: 200_000n,
  routerProg: KVAULT_PROGRAM_ID,
  routerIxData: concatBytes(DISC_KVAULT_WITHDRAW_FROM_AVAILABLE, u64le(vaultWithdrawShares)),
  routerAccounts: [
    { pubkey: escrowPda, isSigner: true, isWritable: false },
    { pubkey: KVAULT_PRIME_USDC_STATE, isSigner: false, isWritable: true },
    { pubkey: KVAULT_GLOBAL_CONFIG, isSigner: false, isWritable: false },
    { pubkey: KVAULT_PRIME_USDC_TOKEN_VAULT, isSigner: false, isWritable: true },
    { pubkey: KVAULT_PRIME_USDC_AUTH, isSigner: false, isWritable: false },
    { pubkey: escrowUsdcAta, isSigner: false, isWritable: true },
    { pubkey: USDC_MINT, isSigner: false, isWritable: true },
    { pubkey: escrowSharesAta, isSigner: false, isWritable: true },
    { pubkey: KVAULT_PRIME_USDC_SHARES_MINT, isSigner: false, isWritable: true },
    { pubkey: CLASSIC_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: CLASSIC_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: KLEND_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: KVAULT_EVENT_AUTH, isSigner: false, isWritable: false },
    { pubkey: KVAULT_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: KLEND_USDC_RESERVE, isSigner: false, isWritable: true },
    { pubkey: KLEND_MAIN_MARKET, isSigner: false, isWritable: false },
  ],
  ephFillByte: 0x27,
});

console.log('Audren v1.3.0 Private Kamino Lending & Yield Vault ExecViaEscrow (Tag 6) verified:');
console.log({
  audrenProgramId: AUDREN_PROGRAM_ID,
  rootsPda,
  escrowPda,
  kaminoLending: {
    programId: KLEND_PROGRAM_ID,
    preIx: 'refreshReserve (0 signers, base64)',
    supplyIxBytes: klendSupply.ix.data.byteLength,
    supplyAccounts: klendSupply.prepared.accounts.length,
    supplyCtxHashHex: Buffer.from(frToBeBytes(klendSupply.ctxHash)).toString('hex'),
    redeemIxBytes: klendRedeem.ix.data.byteLength,
    redeemAccounts: klendRedeem.prepared.accounts.length,
    redeemFeeOnOutputFlagSet: (klendRedeem.ix.data[9] & EXEC_FLAG_FEE_ON_OUTPUT) !== 0,
    redeemCtxHashHex: Buffer.from(frToBeBytes(klendRedeem.ctxHash)).toString('hex'),
    recommendedCuLimit: recommendedExecViaEscrowCuLimit({ routerCuLimit: 200_000 }),
  },
  kaminoVault: {
    programId: KVAULT_PROGRAM_ID,
    vaultState: KVAULT_PRIME_USDC_STATE,
    sharesMint: KVAULT_PRIME_USDC_SHARES_MINT,
    depositIxBytes: vaultDeposit.ix.data.byteLength,
    depositAccounts: vaultDeposit.prepared.accounts.length,
    depositCtxHashHex: Buffer.from(frToBeBytes(vaultDeposit.ctxHash)).toString('hex'),
    withdrawIxBytes: vaultWithdraw.ix.data.byteLength,
    withdrawAccounts: vaultWithdraw.prepared.accounts.length,
    withdrawFeeOnOutputFlagSet: (vaultWithdraw.ix.data[9] & EXEC_FLAG_FEE_ON_OUTPUT) !== 0,
    withdrawCtxHashHex: Buffer.from(frToBeBytes(vaultWithdraw.ctxHash)).toString('hex'),
    recommendedCuLimit: recommendedExecViaEscrowCuLimit({ routerCuLimit: 250_000 }),
  },
});
