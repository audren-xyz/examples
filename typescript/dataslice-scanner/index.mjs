/**
 * Audren Example — Standard Solana RPC `dataSlice[64..1120]` Note Scanner using `@audren/sdk`.
 *
 * Uses zero-dependency `@audren/sdk` primitives (`derivePoolPda`, `deriveEpochPagePda`,
 * `decodePoolState`, `PAGE_SCAN_DATA_SLICE`, `fetchPageScanSlices`, `buildPageSubscribeWsPayload`,
 * `AudrenRelayClient`) — zero hand-rolled RPC filters, offsets, or decoders.
 *
 * Run (from `typescript/`):
 *   SOLANA_RPC_URL="https://your-solana-rpc" pnpm scan
 */

import {
  AUDREN_DEFAULT_RELAY_URL,
  AUDREN_PROGRAM_ID,
  AudrenRelayClient,
  PAGE_CAPACITY,
  PAGE_SCAN_DATA_SLICE,
  buildPageSubscribeWsPayload,
  decodePoolState,
  deriveEpochPagePda,
  derivePoolPda,
  fetchPageScanSlices,
} from '@audren/sdk';

const rpcUrl = process.env.SOLANA_RPC_URL ?? process.env.AUDREN_RPC_URL;
if (!rpcUrl) {
  console.error('Set SOLANA_RPC_URL (or AUDREN_RPC_URL) to a Solana Mainnet or Devnet RPC URL.');
  process.exit(1);
}

async function rpc(method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

// 1. Derive canonical Pool #0 PDA via @audren/sdk and decode live PoolState (192 B)
const { address: pool0Pda } = await derivePoolPda(0);
const poolAcc = await rpc('getAccountInfo', [
  pool0Pda,
  { encoding: 'base64', commitment: 'confirmed' },
]);
if (!poolAcc.value) {
  throw new Error(`Pool #0 (${pool0Pda}) not found on configured RPC`);
}
const pool = decodePoolState(Buffer.from(poolAcc.value.data[0], 'base64'));
console.log('=== Audren Pool #0 Live State ===');
console.log({
  programId: AUDREN_PROGRAM_ID,
  poolPda: pool0Pda,
  mode: pool.mode === 0 ? 'Permissionless' : 'InstitutionalAudited',
  paused: pool.paused,
  currentPageId: pool.currentPageId.toString(),
  totalNotes: pool.totalNotes.toString(),
  totalSpends: pool.totalSpends.toString(),
  activeLanes: pool.activeLanes,
});

// 2. Fetch all Pool #0 EpochPage scan slices (1,056 B each, ~83% less bandwidth) via @audren/sdk
const pageIds = [];
for (let id = 0n; id <= pool.currentPageId; id++) {
  pageIds.push(id);
}
const pagePdas = await Promise.all(
  pageIds.map(async (id) => (await deriveEpochPagePda(pool.poolId, id)).address),
);
const slices = await fetchPageScanSlices(rpcUrl, pagePdas, 'confirmed', AUDREN_PROGRAM_ID);

console.log(
  `\nFetched ${slices.filter(Boolean).length}/${pagePdas.length} EpochPage(s) via getMultipleAccounts ` +
    `dataSlice[${PAGE_SCAN_DATA_SLICE.offset}..${PAGE_SCAN_DATA_SLICE.offset + PAGE_SCAN_DATA_SLICE.length}] (${PAGE_SCAN_DATA_SLICE.length} B/page):`,
);
for (let i = 0; i < slices.length; i++) {
  const parsed = slices[i];
  if (!parsed) continue;
  let populated = 0;
  for (const eph of parsed.ephemeralPks) {
    if (eph.every((b) => b === 0)) break;
    populated++;
  }
  console.log(
    `  Page #${pageIds[i]} (${pagePdas[i]}) | populated_slots=${populated}/${PAGE_CAPACITY} | first_view_tags=[${Array.from(
      parsed.viewTags.subarray(0, Math.min(populated, 6)),
    )
      .map((b) => '0x' + b.toString(16).padStart(2, '0'))
      .join(', ')}]`,
  );
}

// 3. Emit exact Agave WebSocket programSubscribe payload via @audren/sdk
const wsPayload = buildPageSubscribeWsPayload(AUDREN_PROGRAM_ID, pool.poolId);
console.log('\n=== Real-Time Agave WebSocket programSubscribe Payload ===');
console.log(JSON.stringify(wsPayload, null, 2));

// 4. Query default Audren Privacy Relayer health/rent schedule via AudrenRelayClient
try {
  const relay = new AudrenRelayClient(process.env.AUDREN_RELAY_URL ?? AUDREN_DEFAULT_RELAY_URL);
  const info = await relay.getInfo('mainnet');
  console.log('\n=== Audren Privacy Relayer Info ===');
  console.log({
    relayUrl: relay.baseUrl,
    cluster: info.cluster,
    relayerPubkey: info.relayerPubkey,
    nullifierRentLamports: info.rentSchedule?.nullifierRentLamports ?? null,
  });
} catch (err) {
  console.log(`\n(Relayer info check skipped: ${err instanceof Error ? err.message : String(err)})`);
}
