/**
 * Audren Example — Escrow Account Mapping for `ExecViaEscrow` (`Tag 5`) using `@audren/sdk`.
 *
 * Uses `@audren/sdk`'s unified `prepareEscrowAccounts` (matching Rust, Swift, and Kotlin 1-to-1)
 * to derive canonical Pool #0 `swap_escrow` shard 0 PDAs + ATAs, resolve `(escrowIdx, escrowInIdx,
 * escrowOutIdx)`, and strip the outer signer flag on `swap_escrow` (Audren signs via `invoke_signed`).
 * Works identically for any stateless Token A -> Token B Solana DeFi CPI (DEX aggregators/AMMs,
 * lending supply minting kTokens, yield vaults, liquid staking pools, perp LP, or RWAs).
 *
 * Run (from `typescript/`):
 *   pnpm swap-plan                  # offline escrow-account planning
 *   LIVE_QUOTE=1 pnpm swap-plan     # live Mainnet route via AudrenRelayClient (or AGGREGATOR_API)
 */

import assert from 'node:assert/strict';

import {
  AUDREN_DEFAULT_RELAY_URL,
  AUDREN_PROGRAM_ID,
  AudrenRelayClient,
  CLASSIC_TOKEN_PROGRAM_ID,
  JUPITER_CPI_EXCLUDED_DEXES,
  WSOL_MINT,
  deriveAssociatedTokenAddress,
  deriveEscrowPda,
  fetchAggregatorPrivateSwapRoute,
  prepareEscrowAccounts,
} from '@audren/sdk';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Derive canonical Pool #0 swap_escrow shard 0 PDA & Classic SPL ATAs via @audren/sdk
const { address: escrowShard0 } = await deriveEscrowPda(0, 0);
const { address: escrowUsdcAta } = await deriveAssociatedTokenAddress(
  escrowShard0,
  USDC_MINT,
  CLASSIC_TOKEN_PROGRAM_ID,
);
const { address: escrowWsolAta } = await deriveAssociatedTokenAddress(
  escrowShard0,
  WSOL_MINT,
  CLASSIC_TOKEN_PROGRAM_ID,
);

if (process.env.LIVE_QUOTE === '1') {
  let provider = 'jupiter';
  let inAmount;
  let outAmount;
  let routerProgramId;
  let routerAccounts;

  if (process.env.AGGREGATOR_API) {
    // Direct Jupiter-compatible aggregator API via @audren/sdk's fetchAggregatorPrivateSwapRoute
    const { quote, swap } = await fetchAggregatorPrivateSwapRoute(
      process.env.AGGREGATOR_API,
      {
        inputMint: USDC_MINT,
        outputMint: WSOL_MINT,
        amount: '10000000', // 10 USDC
        slippageBps: 50,
        maxAccounts: 28,
      },
      escrowShard0,
    );
    inAmount = String(quote.inAmount);
    outAmount = String(quote.outAmount);
    routerProgramId = swap.swapInstruction.programId;
    routerAccounts = swap.swapInstruction.accounts;
  } else {
    // Default stateless Audren Privacy Relayer (relay.audren.xyz) via @audren/sdk's AudrenRelayClient
    const relay = new AudrenRelayClient(process.env.AUDREN_RELAY_URL ?? AUDREN_DEFAULT_RELAY_URL);
    const quoteRes = await relay.quoteSwap({
      inputMint: USDC_MINT,
      outputMint: WSOL_MINT,
      amount: '10000000', // 10 USDC
      slippageBps: 50,
      cluster: 'mainnet',
      shardId: 0,
      maxAccounts: 28,
    });
    const quoteObj = quoteRes.quote ?? quoteRes;
    provider = String(quoteRes.provider ?? quoteObj.provider ?? 'jupiter');
    inAmount = String(quoteObj.inAmount);
    outAmount = String(quoteObj.outAmount);
    const swapRes = await relay.buildSwapInstructions({
      provider,
      quoteResponse: quoteObj.rawQuote ?? quoteObj,
      inputMint: USDC_MINT,
      outputMint: WSOL_MINT,
      cluster: 'mainnet',
      shardId: 0,
    });
    routerProgramId = swapRes.swapInstruction.programId;
    routerAccounts = swapRes.swapInstruction.accounts;
  }

  const prepared = await prepareEscrowAccounts({
    poolId: 0,
    shardId: 0,
    inputMint: USDC_MINT,
    outputMint: WSOL_MINT,
    actionAccounts: routerAccounts,
  });
  const outerSigners = prepared.accounts.filter((a) => a.isSigner).length;
  assert.equal(outerSigners, 0, 'swap_escrow external signer flag must be stripped for Audren CPI');

  console.log('Live PDA-CPI-compatible private swap route verified via @audren/sdk:');
  console.log({
    provider,
    routerProgramId,
    escrowPda: prepared.escrowPda,
    inAmount,
    outAmount,
    escrowIdx: prepared.escrowIdx,
    escrowInIdx: prepared.escrowInIdx,
    escrowOutIdx: prepared.escrowOutIdx,
    outerRouterAccountCount: prepared.accounts.length,
    outerSigners,
    excludedDexesCount: JUPITER_CPI_EXCLUDED_DEXES.length,
  });
} else {
  const sampleRouterAccounts = [
    { pubkey: CLASSIC_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: escrowUsdcAta, isSigner: false, isWritable: true },
    { pubkey: 'AMMVaultUsdc1111111111111111111111111111111', isSigner: false, isWritable: true },
    { pubkey: escrowShard0, isSigner: true, isWritable: false },
    { pubkey: escrowWsolAta, isSigner: false, isWritable: true },
    { pubkey: 'AMMVaultWsol1111111111111111111111111111111', isSigner: false, isWritable: true },
  ];

  const prepared = await prepareEscrowAccounts({
    poolId: 0,
    shardId: 0,
    inputMint: USDC_MINT,
    outputMint: WSOL_MINT,
    actionAccounts: sampleRouterAccounts,
  });
  const outerSigners = prepared.accounts.filter((a) => a.isSigner).length;
  assert.equal(outerSigners, 0);

  console.log('Offline ExecViaEscrow account mapping via @audren/sdk (no transaction submitted)');
  console.log({
    audrenProgramId: AUDREN_PROGRAM_ID,
    escrowPda: prepared.escrowPda,
    escrowInAta: prepared.escrowInAta,
    escrowOutAta: prepared.escrowOutAta,
    escrowIdx: prepared.escrowIdx,
    escrowInIdx: prepared.escrowInIdx,
    escrowOutIdx: prepared.escrowOutIdx,
    outerRouterAccountCount: prepared.accounts.length,
    outerSigners,
    excludedDexesCount: JUPITER_CPI_EXCLUDED_DEXES.length,
  });
}
