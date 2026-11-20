# Audren Examples

Runnable Rust and TypeScript integrations targeting the live Audren program on Solana Mainnet-Beta and Devnet using **Solana Transaction Version 1 (SIMD-0385, `0x81`, 4,096 B, inline `TransactionConfig`)**:

- **Program ID:** `AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3`
- **Canonical Pool `#0` (`Permissionless`) PDA:** `5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G`
- **Core Protocol & SDKs:** [`audren-xyz/audren`](https://github.com/audren-xyz/audren)

## Examples

| Path | Runtime | What it demonstrates |
| --- | --- | --- |
| [`rust/shielded-transfer`](./rust/shielded-transfer) | Rust | Single-tx Solana v1 (`0x81`, 4,096 B) `Deposit`, Multi-Base Triptych + Agave Bulletproof `Transfer`, `dataSlice[64..1120]` note discovery, and `Withdraw` (zero legacy transactions) |
| [`rust/institutional-audit`](./rust/institutional-audit) | Rust | `PoolMode::InstitutionalAudited` proof generation (`(S_1, S_2)` + `(M_1, M_2)`), per-tx `SelectiveDisclosureProof`, and offline `AuditorKeypair` decryption |
| [`typescript/jupiter-private-swap`](./typescript/jupiter-private-swap) | Node 20+ (Zero deps) | Router-agnostic `SwapViaRouter` (`Tag 5`) single-tx Solana v1 integration with Jupiter v6 `/quote` + `/swap-instructions` (applicable to Orca, Raydium, Meteora, Phoenix, or custom routers) |
| [`typescript/dataslice-scanner`](./typescript/dataslice-scanner) | Node 20+ (Zero deps) | Standard Solana RPC `getAccountInfo` (`PoolState` decode), `getMultipleAccounts` `dataSlice[64..1120]` batch scanning, and `programSubscribe` WebSocket payload |

## Quickstart

### Node 20+ (Zero dependencies)

```bash
# Quote & plan a single-tx Solana v1 private swap targeting Audren swap_escrow shard #0
node typescript/jupiter-private-swap/index.mjs

# Inspect live Pool #0 and scan EpochPage dataSlice[64..1120]
SOLANA_RPC_URL="https://your-solana-rpc" node typescript/dataslice-scanner/index.mjs
```

### Rust

```bash
# Run offline institutional audit & selective disclosure verification
cargo run --manifest-path rust/Cargo.toml -p audren-example-institutional-audit

# Run full shielded SOL deposit -> transfer -> withdraw lifecycle via Solana v1 transactions
AUDREN_RPC_URL="https://your-devnet-rpc" \
AUDREN_KEYPAIR_PATH="/path/to/keypair.json" \
cargo run --manifest-path rust/Cargo.toml -p audren-example-shielded-transfer
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
