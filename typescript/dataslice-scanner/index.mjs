/**
 * Audren Example — Standard Solana RPC `dataSlice[64..1120]` Note Scanner using `@audren/sdk`.
 *
 * Uses zero-dependency `@audren/sdk` primitives (`derivePoolPda`, `decodePoolState`,
 * `PAGE_SCAN_OFFSET`, `PAGE_SCAN_LEN`, `buildPageSubscribeWsPayload`) — zero hand-coded offsets.
 *
 * Run (from `typescript/`):
 *   SOLANA_RPC_URL="https://your-solana-rpc" pnpm scan
 */

import {
  AUDREN_PROGRAM_ID,
  PAGE_LEN,
  PAGE_MAGIC,
  PAGE_OFF_POOL_ID,
  PAGE_SCAN_LEN,
  PAGE_SCAN_OFFSET,
  buildPageSubscribeWsPayload,
  decodePageScanSlice,
  decodePoolState,
  derivePoolPda,
} from '@audren/sdk';

const rpcUrl = process.env.SOLANA_RPC_URL;
if (!rpcUrl) {
  console.error('Set SOLANA_RPC_URL to a Solana Mainnet or Devnet RPC URL.');
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

// 2. Discover EpochPages for Pool #0 using 1,056 B dataSlice[64..1120] (~83% bandwidth savings)
const poolIdFilter = Buffer.alloc(4);
poolIdFilter.writeUInt32LE(pool.poolId, 0);
const pages = await rpc('getProgramAccounts', [
  AUDREN_PROGRAM_ID,
  {
    encoding: 'base64',
    commitment: 'confirmed',
    dataSlice: { offset: PAGE_SCAN_OFFSET, length: PAGE_SCAN_LEN },
    filters: [
      { dataSize: PAGE_LEN },
      { memcmp: { offset: 0, bytes: Buffer.from(PAGE_MAGIC).toString('base64'), encoding: 'base64' } },
      { memcmp: { offset: PAGE_OFF_POOL_ID, bytes: poolIdFilter.toString('base64'), encoding: 'base64' } },
    ],
  },
]);

console.log(`\nScanned ${pages.length} EpochPage(s) using ${PAGE_SCAN_LEN} B dataSlice per page:`);
for (const p of pages) {
  const parsed = decodePageScanSlice(Buffer.from(p.account.data[0], 'base64'));
  let populated = 0;
  for (const eph of parsed.ephemeralPks) {
    if (eph.every((b) => b === 0)) break;
    populated++;
  }
  console.log(
    `  Page ${p.pubkey} | populated_slots=${populated}/32 | first_view_tags=[${Array.from(
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
