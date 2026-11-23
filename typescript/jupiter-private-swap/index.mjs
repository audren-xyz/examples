/**
 * Audren v1 Example — Isolated Escrow Account Mapping for `ExecViaEscrow` (`Tag 6`) using `@audren/sdk`.
 *
 * Derives canonical Pool #0 `audren_escrow` shard 0 PDA & Classic SPL ATAs, maps router accounts
 * cleanly with zero outer signers (Audren signs via `invoke_signed`), and prints synced `JUPITER_CPI_EXCLUDED_DEXES`.
 *
 * Run (from `typescript/`):
 *   pnpm swap-plan                  # offline escrow-account planning
 *   LIVE_QUOTE=1 pnpm swap-plan     # live Mainnet route via AudrenRelayClient
 */

import assert from 'node:assert/strict';
import {
  AUDREN_DEFAULT_RELAY_URL,
  AUDREN_PROGRAM_ID,
  AudrenRelayClient,
  CLASSIC_TOKEN_PROGRAM_ID,
  JUPITER_CPI_EXCLUDED_DEXES,
  WSOL_MINT,
  deriveAssociatedTokenAddressSync,
  deriveEscrowPdaSync,
  prepareEscrowAccounts,
} from '@audren/sdk';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const { address: escrowShard0 } = deriveEscrowPdaSync(0, 0);
const { address: escrowUsdcAta } = deriveAssociatedTokenAddressSync(
  escrowShard0,
  USDC_MINT,
  CLASSIC_TOKEN_PROGRAM_ID,
);
const { address: escrowWsolAta } = deriveAssociatedTokenAddressSync(
  escrowShard0,
  WSOL_MINT,
  CLASSIC_TOKEN_PROGRAM_ID,
);

if (process.env.LIVE_QUOTE === '1') {
  const relay = new AudrenRelayClient(process.env.AUDREN_RELAY_URL ?? AUDREN_DEFAULT_RELAY_URL);
  const quoteRes = await relay.quoteSwap({
    inputMint: USDC_MINT,
    outputMint: WSOL_MINT,
    amount: '10000000',
    slippageBps: 50,
    cluster: 'mainnet',
    shardId: 0,
    maxAccounts: 28,
  });
  const quoteObj = quoteRes.quote ?? quoteRes;
  const provider = String(quoteRes.provider ?? quoteObj.provider ?? 'jupiter');
  const swapRes = await relay.buildSwapInstructions({
    provider,
    quoteResponse: quoteObj.rawQuote ?? quoteObj,
    inputMint: USDC_MINT,
    outputMint: WSOL_MINT,
    cluster: 'mainnet',
    shardId: 0,
  });
  const prepared = await prepareEscrowAccounts({
    poolId: 0,
    shardId: 0,
    inputMint: USDC_MINT,
    outputMint: WSOL_MINT,
    actionAccounts: swapRes.swapInstruction.accounts,
  });
  const outerSigners = prepared.accounts.filter((a) => a.isSigner).length;
  assert.equal(outerSigners, 0);
  console.log('Live ExecViaEscrow route verified via @audren/sdk:', {
    provider,
    escrowPda: prepared.escrowPda,
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
  console.log('Offline ExecViaEscrow (Tag 6) account mapping via @audren/sdk:');
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
