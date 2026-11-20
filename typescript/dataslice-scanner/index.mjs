/**
 * Audren Example — Standard Solana RPC `dataSlice[64..1120]` Note Scanner.
 *
 * Reads live Audren Pool #0 (`5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G`) directly
 * from any standard Solana JSON-RPC endpoint (Mainnet or Devnet) with zero external
 * npm dependencies.
 *
 * Run:
 *   SOLANA_RPC_URL="https://your-solana-rpc" node typescript/dataslice-scanner/index.mjs
 */

const AUDREN_PROGRAM_ID = 'AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3';
const POOL_0_PDA = '5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G';
const PAGE_LEN = 6_240;
const PAGE_SCAN_OFFSET = 64;
const PAGE_SCAN_LEN = 1_056; // 32 view_tags + 32 * 32-byte ephemeral pubkeys

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

function decodePoolState(buf) {
  const magic = buf.subarray(0, 8).toString('ascii');
  if (magic !== 'AUDRNPL1') throw new Error(`Unexpected PoolState magic: ${magic}`);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    magic,
    version: buf[8],
    mode: buf[10] === 0 ? 'Permissionless' : 'InstitutionalAudited',
    paused: buf[11] !== 0,
    poolId: view.getUint32(12, true),
    currentPageId: view.getBigUint64(16, true),
    totalNotes: view.getBigUint64(24, true),
    totalSpends: view.getBigUint64(32, true),
    pageRentFeeLamports: view.getBigUint64(40, true),
  };
}

// 1. Fetch & decode live PoolState (192 B)
const poolAcc = await rpc('getAccountInfo', [
  POOL_0_PDA,
  { encoding: 'base64', commitment: 'confirmed' },
]);
if (!poolAcc.value) {
  throw new Error(`Pool #0 (${POOL_0_PDA}) not found on ${rpcUrl}`);
}
const pool = decodePoolState(Buffer.from(poolAcc.value.data[0], 'base64'));
console.log('=== Audren Pool #0 Live State ===');
console.log({
  programId: AUDREN_PROGRAM_ID,
  poolPda: POOL_0_PDA,
  mode: pool.mode,
  paused: pool.paused,
  currentPageId: pool.currentPageId.toString(),
  totalNotes: pool.totalNotes.toString(),
  totalSpends: pool.totalSpends.toString(),
  pageRentFeeCapLamports: pool.pageRentFeeLamports.toString(),
});

// 2. Discover EpochPages for Pool #0 with a single dataSlice[64..1120] call (83% bandwidth savings!)
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
      { memcmp: { offset: 0, bytes: Buffer.from('AUDRNPG1').toString('base64'), encoding: 'base64' } },
      { memcmp: { offset: 12, bytes: poolIdFilter.toString('base64'), encoding: 'base64' } },
    ],
  },
]);

console.log(`\nScanned ${pages.length} EpochPage(s) using 1,056 B dataSlice per page:`);
for (const p of pages) {
  const slice = Buffer.from(p.account.data[0], 'base64');
  const viewTags = slice.subarray(0, 32);
  let populated = 0;
  for (let slot = 0; slot < 32; slot++) {
    const eph = slice.subarray(32 + slot * 32, 32 + (slot + 1) * 32);
    if (eph.every((b) => b === 0)) break;
    populated++;
  }
  console.log(
    `  Page ${p.pubkey} | populated_slots=${populated}/32 | first_view_tags=[${Array.from(
      viewTags.subarray(0, Math.min(populated, 6)),
    )
      .map((b) => '0x' + b.toString(16).padStart(2, '0'))
      .join(', ')}]`,
  );
}

// 3. Emit exact Agave 4.4+ WebSocket programSubscribe payload for real-time note streaming
const wsPayload = {
  jsonrpc: '2.0',
  id: 1,
  method: 'programSubscribe',
  params: [
    AUDREN_PROGRAM_ID,
    {
      encoding: 'base64',
      commitment: 'confirmed',
      dataSlice: { offset: PAGE_SCAN_OFFSET, length: PAGE_SCAN_LEN },
      filters: [
        { dataSize: PAGE_LEN },
        { memcmp: { offset: 0, bytes: Buffer.from('AUDRNPG1').toString('base64'), encoding: 'base64' } },
        { memcmp: { offset: 12, bytes: poolIdFilter.toString('base64'), encoding: 'base64' } },
      ],
    },
  ],
};
console.log('\n=== Real-Time Agave WebSocket programSubscribe Payload ===');
console.log(JSON.stringify(wsPayload, null, 2));
