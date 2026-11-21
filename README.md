<p>
  <a href="https://audren.xyz">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/audren-xyz/audren/main/assets/brand/audren-wordmark-dark.svg" />
      <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/audren-xyz/audren/main/assets/brand/audren-wordmark-light.svg" />
      <img alt="Audren — Private money on Solana" src="https://raw.githubusercontent.com/audren-xyz/audren/main/assets/brand/audren-wordmark-light.svg" height="52" />
    </picture>
  </a>
</p>

# Audren Examples

Runnable Rust and TypeScript integrations targeting the live Audren program on Solana Mainnet and Devnet using **Solana Transaction Version 1 (SIMD-0385, `0x81`, 4,096 B, inline `TransactionConfig`)**:

- **Program ID:** `AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3`
- **Canonical Pool `#0` (`Permissionless`) PDA:** `5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G`
- **Core Protocol & SDKs:** [`audren-xyz/audren`](https://github.com/audren-xyz/audren)

## Examples

| Path | Runtime | What it demonstrates |
| --- | --- | --- |
| [`rust/shielded-transfer`](./rust/shielded-transfer) | Rust | Single-tx Solana v1 (`0x81`, 4,096 B) `Deposit`, Multi-Base Triptych + Agave Bulletproof `Transfer`, `dataSlice[64..1120]` note discovery, and `Withdraw` (zero legacy transactions) |
| [`rust/institutional-audit`](./rust/institutional-audit) | Rust | `PoolMode::InstitutionalAudited` proof generation (`(S_1, S_2)` + `(M_1, M_2)`), per-tx `SelectiveDisclosureProof`, and offline `AuditorKeypair` decryption |
| [`typescript/jupiter-private-swap`](./typescript/jupiter-private-swap) | Node 20+ (Zero deps) | Offline router-account planning with illustrative addresses; optional live Jupiter quote only. No proof, swap-instruction fetch, signature or transaction submission |
| [`typescript/dataslice-scanner`](./typescript/dataslice-scanner) | Node 20+ (Zero deps) | Standard Solana RPC `getAccountInfo` (`PoolState` decode), `getProgramAccounts` discovery with `dataSlice[64..1120]`, and `programSubscribe` WebSocket payload |

## Quickstart

### Node 20+ (Zero dependencies)

```bash
# Offline router-account mapping; sample addresses are not executable accounts
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

## Scope and safety

The scanner prints a WebSocket subscription payload; it does not open a subscription or decrypt private notes. The Jupiter example does not execute a private swap or measure transaction cost. Use the [protocol Rust client](https://github.com/audren-xyz/audren/tree/main/crates/client) for proof generation and the [TypeScript package](https://github.com/audren-xyz/audren/tree/main/packages/sdk) for reusable transaction helpers.

The live Rust lifecycle submits transactions and spends network fees. Use a dedicated Devnet key and configured RPC provider. Never commit either. Audren is pre-audit and upgradeable; deposits, withdrawals and DEX trades retain public visibility boundaries.
