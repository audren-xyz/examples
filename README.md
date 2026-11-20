# Audren Examples

Runnable Rust and TypeScript integrations targeting the live Audren program on Solana Mainnet-Beta and Devnet:

- **Program ID:** `AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3`
- **Canonical Pool `#0` (`Permissionless`) PDA:** `5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G`
- **Core Protocol & SDKs:** [`audren-xyz/audren`](https://github.com/audren-xyz/audren)

## Examples

| Path | Runtime | What it demonstrates |
| --- | --- | --- |
| [`rust/shielded-transfer`](./rust/shielded-transfer) | Rust | Shielded `Deposit`, `ProofBuffer`-chunked Multi-Base Triptych + Agave Bulletproof `Transfer` (`<= 1,232 B` MTU), `dataSlice[64..1120]` note discovery, and `Withdraw` |
| [`rust/institutional-audit`](./rust/institutional-audit) | Rust | `PoolMode::InstitutionalAudited` proof generation (`(S_1, S_2)` + `(M_1, M_2)`), per-tx `SelectiveDisclosureProof`, and offline `AuditorKeypair` decryption |
| [`typescript/jupiter-private-swap`](./typescript/jupiter-private-swap) | Node 20+ (Zero deps) | Router-agnostic `SwapViaRouter` (`Tag 5`) integration with Jupiter v6 `/quote` + `/swap-instructions` (applicable to Orca, Raydium, Meteora, Phoenix, or custom routers) |
| [`typescript/dataslice-scanner`](./typescript/dataslice-scanner) | Node 20+ (Zero deps) | Standard Solana RPC `getAccountInfo` (`PoolState` decode), `getMultipleAccounts` `dataSlice[64..1120]` batch scanning, and `programSubscribe` WebSocket payload |

## Quickstart

### Node 20+ (Zero dependencies)

```bash
# Quote a private swap route targeting Audren swap_escrow shard #0
node typescript/jupiter-private-swap/index.mjs

# Inspect live Pool #0 and scan EpochPage dataSlice[64..1120]
SOLANA_RPC_URL="https://your-solana-rpc" node typescript/dataslice-scanner/index.mjs
```

### Rust

```bash
# Run offline institutional audit & selective disclosure verification
cargo run --manifest-path rust/Cargo.toml -p audren-example-institutional-audit

# Run full shielded SOL deposit -> transfer -> withdraw lifecycle on Devnet or Mainnet
AUDREN_RPC_URL="https://your-devnet-rpc" \
AUDREN_KEYPAIR_PATH="/path/to/keypair.json" \
cargo run --manifest-path rust/Cargo.toml -p audren-example-shielded-transfer
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
