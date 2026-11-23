/**
 * Audren v1 Example — Zero-Indexer Ordinary Solana RPC `CompactWalletStore` Scanner (`@audren/sdk`).
 *
 * Syncs `PoolState`, active `LaneTreeState` headers, `SubtreePage`, `MemoPage` (`10,240 B`, `96`
 * versioned `106 B` SoA memos/page), and `NullifierPage` PDAs in uniform batched `getMultipleAccounts`
 * calls using zero off-chain indexers (`privacyMode: 'strict'` default; pass `AUDREN_PRIVACY_MODE=fast`
 * for opt-in `[0..3,328]` SoA `dataSlice` pre-filtering on large catch-ups over a trusted RPC).
 *
 * Run (from `typescript/`):
 *   SOLANA_RPC_URL="https://your-solana-rpc" pnpm scan
 */

import { randomBytes } from 'node:crypto';
import {
  AUDREN_DEFAULT_RELAY_URL,
  AUDREN_PROGRAM_ID,
  AudrenRelayClient,
  CompactWalletStore,
  createSolanaRpcBatchFetcher,
  deriveKeysFromSeed,
  exportFullViewingKey,
  syncCompactStoreWithRpc,
} from '@audren/sdk';

const rpcUrl = process.env.SOLANA_RPC_URL ?? process.env.AUDREN_RPC_URL;
if (!rpcUrl) {
  console.error('Set SOLANA_RPC_URL (or AUDREN_RPC_URL) to a Solana Mainnet or Devnet RPC URL.');
  process.exit(1);
}

const seed = process.env.AUDREN_SEED_HEX
  ? new Uint8Array(Buffer.from(process.env.AUDREN_SEED_HEX, 'hex'))
  : new Uint8Array(randomBytes(32));

const keys = deriveKeysFromSeed(seed);
const fvk = exportFullViewingKey(keys);
const store = new CompactWalletStore(0, 0n);
const fetchBatch = createSolanaRpcBatchFetcher(rpcUrl, 'confirmed');

const privacyMode = process.env.AUDREN_PRIVACY_MODE === 'fast' ? 'fast' : 'strict';
const { pool, lanes, discoveredNotes } = await syncCompactStoreWithRpc({
  store,
  fvk,
  fetchBatch,
  privacyMode,
});

console.log('=== Audren v1 Pool #0 Ordinary-RPC Sync (Zero Indexer) ===');
console.log({
  programId: AUDREN_PROGRAM_ID,
  protocolVersion: pool.version,
  privacyMode,
  audrenAddress: keys.address,
  activeLanes: pool.activeLanes,
  paused: pool.paused,
  ckptInterval: pool.ckptInterval.toString(),
  maxCkptAge: pool.maxCkptAge.toString(),
  lanes: lanes.map((l) => ({
    laneId: l.laneId,
    nextLeaf: l.nextLeaf.toString(),
    nfCount: l.nfCount.toString(),
  })),
  discoveredNotes,
  unspentNotes: store.unspentNotes().length,
});

const cluster =
  process.env.AUDREN_CLUSTER === 'devnet' || process.env.AUDREN_CLUSTER === 'mainnet'
    ? process.env.AUDREN_CLUSTER
    : /devnet/i.test(rpcUrl)
      ? 'devnet'
      : 'mainnet';

try {
  const relay = new AudrenRelayClient(process.env.AUDREN_RELAY_URL ?? AUDREN_DEFAULT_RELAY_URL);
  const info = await relay.getInfo(cluster);
  console.log('\n=== Audren Privacy Relayer Info ===');
  console.log({
    relayUrl: relay.baseUrl,
    protocolVersion: info.protocolVersion,
    cluster: info.cluster,
    relayerPubkey: info.relayerPubkey,
    relayerShieldedAddress: info.relayerShieldedAddress ?? null,
  });
} catch (err) {
  console.log(`\n(Relayer info check skipped: ${err instanceof Error ? err.message : String(err)})`);
}
