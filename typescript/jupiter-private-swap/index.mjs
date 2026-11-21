/**
 * Router-account mapping for Audren `SwapViaRouter` (`Tag 5`) using canonical Pool #0
 * `swap_escrow` shard 0 PDAs (`AJFrTGiSbJsiXfQA5cZQVF566NEU15yBYzLRTU7J2Hay`).
 * Resolves escrow indices and strips the outer signer flag from `swap_escrow` (which Audren
 * signs via `invoke_signed`). Does not generate a proof, sign, or submit a transaction.
 * `LIVE_QUOTE=1` fetches a PDA-CPI-compatible Jupiter quote (excluding top-level-only venues).
 *
 * Run:
 *   node typescript/jupiter-private-swap/index.mjs
 *   LIVE_QUOTE=1 node typescript/jupiter-private-swap/index.mjs
 */

const AUDREN_PROGRAM_ID = 'AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Canonical Pool #0 `swap_escrow` shard 0 PDA (`["audren_escrow", 0u32_le, 0u8]`)
// and its associated Classic SPL token accounts for USDC and WSOL.
const POOL_0_ESCROW_SHARD_0 = 'AJFrTGiSbJsiXfQA5cZQVF566NEU15yBYzLRTU7J2Hay';
const POOL_0_ESCROW_USDC_ATA = 'FQ7k6LoXRBwUFYrLKhmQfarznW6Xy2fFMGAF1CBPwrDr';
const POOL_0_ESCROW_WSOL_ATA = 'AYgqaqm7JNdxQMQWY4MAHwSWazDc9xtiBboUM7NMmLgJ';

// Venues whose on-chain programs reject or penalize wrapped PDA-CPI callers (`SwapViaRouter`).
const JUPITER_CPI_EXCLUDED_DEXES = [
  'Kipseli',
  'Quantum',
  'BisonFi',
  'BisonFi Predict',
  'BinaryFi',
  'Obsidian',
  'VaultLiquidUnstake',
  'Sanctum Prop S',
].join(',');

const AGGREGATOR_API = process.env.AGGREGATOR_API ?? 'https://lite-api.jup.ag/swap/v1';

/**
 * Prepare ANY external DEX router instruction for Audren `SwapViaRouter` (`Tag 5`).
 */
export function prepareRouterAccountsForAudren(
  routerAccounts,
  escrowAddress,
  escrowInAta,
  escrowOutAta,
) {
  const escrowIdx = routerAccounts.findIndex((a) => a.pubkey === escrowAddress);
  const escrowInIdx = routerAccounts.findIndex((a) => a.pubkey === escrowInAta);
  const escrowOutIdx = routerAccounts.findIndex((a) => a.pubkey === escrowOutAta);
  if (escrowIdx < 0 || escrowInIdx < 0 || escrowOutIdx < 0) {
    throw new Error(
      `Router account list missing escrow (${escrowIdx}), escrowIn (${escrowInIdx}), or escrowOut (${escrowOutIdx})`,
    );
  }

  // Only `swap_escrow` is signed by Audren via `invoke_signed`; strip its outer signer bit
  // while preserving any unexpected signer bit so integrators catch incompatible routes early.
  const outerAccounts = routerAccounts.map((a) => ({
    pubkey: a.pubkey,
    isSigner: a.pubkey === escrowAddress ? false : a.isSigner,
    isWritable: a.isWritable,
  }));

  return {
    indices: { escrowIdx, escrowInIdx, escrowOutIdx },
    outerAccounts,
  };
}

if (process.env.LIVE_QUOTE === '1') {
  const qs = new URLSearchParams({
    inputMint: USDC_MINT,
    outputMint: WSOL_MINT,
    amount: '10000000', // 10 USDC
    slippageBps: '50',
    maxAccounts: '28',
    excludeDexes: JUPITER_CPI_EXCLUDED_DEXES,
  });
  const response = await fetch(`${AGGREGATOR_API}/quote?${qs}`);
  if (!response.ok) throw new Error(`Quote request failed: HTTP ${response.status}`);
  const quote = await response.json();
  console.log('Live PDA-CPI-compatible Jupiter quote:', {
    escrowShard0: POOL_0_ESCROW_SHARD_0,
    inAmount: quote.inAmount,
    outAmount: quote.outAmount,
    routeSteps: quote.routePlan?.length ?? 0,
  });
} else {
  const sampleRouterAccounts = [
    { pubkey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', isSigner: false, isWritable: false },
    { pubkey: POOL_0_ESCROW_USDC_ATA, isSigner: false, isWritable: true },
    { pubkey: 'AMMVaultUsdc1111111111111111111111111111111', isSigner: false, isWritable: true },
    { pubkey: POOL_0_ESCROW_SHARD_0, isSigner: true, isWritable: false },
    { pubkey: POOL_0_ESCROW_WSOL_ATA, isSigner: false, isWritable: true },
    { pubkey: 'AMMVaultWsol1111111111111111111111111111111', isSigner: false, isWritable: true },
  ];

  const prepared = prepareRouterAccountsForAudren(
    sampleRouterAccounts,
    POOL_0_ESCROW_SHARD_0,
    POOL_0_ESCROW_USDC_ATA,
    POOL_0_ESCROW_WSOL_ATA,
  );

  console.log('Offline router-account mapping (no transaction submitted)');
  console.log({
    audrenProgramId: AUDREN_PROGRAM_ID,
    escrowShard0: POOL_0_ESCROW_SHARD_0,
    indices: prepared.indices,
    outerRouterAccountCount: prepared.outerAccounts.length,
    outerSigners: prepared.outerAccounts.filter((a) => a.isSigner).length,
  });
}
