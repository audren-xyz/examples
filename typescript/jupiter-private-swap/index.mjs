/**
 * Offline router-account mapping with illustrative, non-executable addresses.
 * Resolves escrow indices and strips outer signer flags. Does not generate a proof,
 * fetch swap instructions, calculate transaction size, sign or submit a transaction.
 * LIVE_QUOTE=1 fetches only a Jupiter quote; provider availability and policy apply.
 * Run: node typescript/jupiter-private-swap/index.mjs
 */

const AUDREN_PROGRAM_ID = 'AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Example SwapEscrow Shard #0 address for Pool #0 (`["audren_escrow", 0u32_le, 0u8]`)
// Derive deterministically via `audren_client::pda::derive_swap_escrow_pda(&AUDREN_PROGRAM_ID, 0, 0)`.
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

  // Only `swap_escrow` is signed by Audren via `invoke_signed`; strip any conflicting signer bit
  // from top-level tx accounts so the outer v1 tx only needs the fee payer signature.
  const outerAccounts = routerAccounts.map((a) => ({
    pubkey: a.pubkey,
    isSigner: false,
    isWritable: a.isWritable,
  }));

  return {
    indices: { escrowIdx, escrowInIdx, escrowOutIdx },
    outerAccounts,
  };
}

// Demonstrate preparing a sample Jupiter-style router instruction (works offline or live with LIVE_QUOTE=1)
const sampleEscrow = 'EscrowShard0PDA1111111111111111111111111111';
const sampleEscrowUsdcAta = 'EscrowUsdcATA111111111111111111111111111111';
const sampleEscrowWsolAta = 'EscrowWsolATA111111111111111111111111111111';

if (process.env.LIVE_QUOTE === '1') {
  const qs = new URLSearchParams({
    inputMint: USDC_MINT,
    outputMint: WSOL_MINT,
    amount: '10000000', // 10 USDC
    slippageBps: '50',
  });
  const response = await fetch(`${AGGREGATOR_API}/quote?${qs}`);
  if (!response.ok) throw new Error(`Quote request failed: HTTP ${response.status}`);
  const quote = await response.json();
  console.log('Live Jupiter quote:', {
    inAmount: quote.inAmount,
    outAmount: quote.outAmount,
    routeSteps: quote.routePlan?.length ?? 0,
  });
} else {
  const sampleRouterAccounts = [
    { pubkey: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', isSigner: false, isWritable: false },
    { pubkey: sampleEscrowUsdcAta, isSigner: false, isWritable: true },
    { pubkey: 'AMMVaultUsdc1111111111111111111111111111111', isSigner: false, isWritable: true },
    { pubkey: sampleEscrow, isSigner: true, isWritable: false },
    { pubkey: sampleEscrowWsolAta, isSigner: false, isWritable: true },
    { pubkey: 'AMMVaultWsol1111111111111111111111111111111', isSigner: false, isWritable: true },
  ];

  const prepared = prepareRouterAccountsForAudren(
    sampleRouterAccounts,
    sampleEscrow,
    sampleEscrowUsdcAta,
    sampleEscrowWsolAta,
  );

  console.log('Offline router-account mapping (no transaction submitted)');
  console.log({
    audrenProgramId: AUDREN_PROGRAM_ID,
    indices: prepared.indices,
    outerRouterAccountCount: prepared.outerAccounts.length,
    outerSigners: prepared.outerAccounts.filter((a) => a.isSigner).length,
  });
}
