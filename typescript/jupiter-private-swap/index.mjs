/**
 * Audren Example — Router-Account Mapping for `SwapViaRouter` (`Tag 5`) using `@audren/sdk`.
 *
 * Derives canonical Pool #0 `swap_escrow` shard 0 PDAs + ATAs via `@audren/sdk`, resolves escrow
 * indices via `resolveRouterEscrowIndices`, and strips the outer signer flag via
 * `prepareRouterAccountsForAudren` (Audren signs `swap_escrow` via `invoke_signed`).
 *
 * Run (from `typescript/`):
 *   pnpm swap-plan
 *   LIVE_QUOTE=1 pnpm swap-plan
 */

import {
  AUDREN_PROGRAM_ID,
  CLASSIC_TOKEN_PROGRAM_ID,
  JUPITER_CPI_EXCLUDED_DEXES,
  WSOL_MINT,
  deriveAssociatedTokenAddress,
  deriveSwapEscrowPda,
  prepareRouterAccountsForAudren,
  resolveRouterEscrowIndices,
} from '@audren/sdk';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const AGGREGATOR_API = process.env.AGGREGATOR_API ?? 'https://lite-api.jup.ag/swap/v1';

// Derive canonical Pool #0 swap_escrow shard 0 PDA & Classic SPL ATAs via @audren/sdk
const { address: escrowShard0 } = await deriveSwapEscrowPda(0, 0);
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
  const qs = new URLSearchParams({
    inputMint: USDC_MINT,
    outputMint: WSOL_MINT,
    amount: '10000000', // 10 USDC
    slippageBps: '50',
    maxAccounts: '28',
    excludeDexes: JUPITER_CPI_EXCLUDED_DEXES.join(','),
  });
  const response = await fetch(`${AGGREGATOR_API}/quote?${qs}`);
  if (!response.ok) throw new Error(`Quote request failed: HTTP ${response.status}`);
  const quote = await response.json();
  console.log('Live PDA-CPI-compatible Jupiter quote:', {
    escrowShard0,
    inAmount: quote.inAmount,
    outAmount: quote.outAmount,
    routeSteps: quote.routePlan?.length ?? 0,
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

  const indices = resolveRouterEscrowIndices(
    sampleRouterAccounts,
    escrowShard0,
    escrowUsdcAta,
    escrowWsolAta,
  );
  const outerAccounts = prepareRouterAccountsForAudren(sampleRouterAccounts, escrowShard0);

  console.log('Offline router-account mapping via @audren/sdk (no transaction submitted)');
  console.log({
    audrenProgramId: AUDREN_PROGRAM_ID,
    escrowShard0,
    escrowUsdcAta,
    escrowWsolAta,
    indices,
    outerRouterAccountCount: outerAccounts.length,
    outerSigners: outerAccounts.filter((a) => a.isSigner).length,
    excludedDexesCount: JUPITER_CPI_EXCLUDED_DEXES.length,
  });
}
