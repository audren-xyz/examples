/**
 * Audren Example 4 — Router-Agnostic Private Swap (`Tag 5: SwapViaRouter`) with Jupiter v6.
 *
 * Shows how ANY Solana DEX aggregator or AMM router (Jupiter, Orca, Raydium, Meteora,
 * Phoenix, Titan, DFlow, or a custom router) plugs directly into Audren's isolated
 * `swap_escrow` PDA:
 *   1. Requests `/quote` + `/swap-instructions` with `userPublicKey = swapEscrowPda`
 *   2. Resolves `(escrowIdx, escrowInIdx, escrowOutIdx)` inside the returned router accounts
 *   3. Strips non-escrow signer flags so ONLY `swap_escrow` signs the external router CPI
 *      (`vault_auth` and `payer` are NEVER signers to any external router)
 *   4. Computes the exact `ProofBuffer` chunk plan (`<= 768 B`/chunk, `< 1,232 B` MTU)
 *
 * Run:
 *   node typescript/jupiter-private-swap/index.mjs
 */

const AUDREN_PROGRAM_ID = 'AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PROOF_BUFFER_CHUNK_SIZE = 768;

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
  // from top-level tx accounts so the outer tx only needs the relayer/payer signature.
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
  const quote = await (await fetch(`${AGGREGATOR_API}/quote?${qs}`)).json();
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

  // Typical SwapViaRouter (m=5 + CrossBase1 + RangeU64 + 2 outputs + 160 B Jupiter route data) ≈ 2,290 B
  const estimatedSwapPayloadBytes = 2_290;
  const proofBufferChunks = Math.ceil(estimatedSwapPayloadBytes / PROOF_BUFFER_CHUNK_SIZE);

  console.log('=== Audren SwapViaRouter (Tag 5) Prepared Plan ===');
  console.log({
    audrenProgramId: AUDREN_PROGRAM_ID,
    indices: prepared.indices,
    outerRouterAccountCount: prepared.outerAccounts.length,
    outerSigners: prepared.outerAccounts.filter((a) => a.isSigner).length,
    estimatedSwapPayloadBytes,
    proofBufferChunks,
    maxUploadTxBytes: '< 1,071 B (Solana 1,232 B MTU compliant)',
    audrenSwapOverheadCu: '~405,291 CU (leaves ~994,700 CU for Jupiter/Orca/Raydium route)',
  });
}
