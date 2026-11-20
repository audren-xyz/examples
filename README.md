# Audren Examples

Runnable Rust and TypeScript integrations targeting the live Audren sBPFv3 program deployed identically on Solana Mainnet-Beta and Devnet:

- **Program ID:** `AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3`
- **Canonical Pool `#0` (`Permissionless`) PDA:** `5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G`
- **Core Protocol & SDKs:** [`audren-xyz/audren`](https://github.com/audren-xyz/audren)

## Examples

| Path | Language | What it demonstrates |
| --- | --- | --- |
| [`rust/shielded-transfer`](./rust/shielded-transfer) | Rust | Live pure-RPC `dataSlice[64..1120]` scan, `Deposit`, `ProofBuffer`-chunked Multi-Base Triptych + Agave Bulletproof `Transfer` (`<= 1,232 B` MTU), and `Withdraw` |
| [`rust/institutional-audit`](./rust/institutional-audit) | Rust | `PoolMode::InstitutionalAudited` proof generation (`(S_1, S_2)` + `(M_1, M_2)`), per-tx `SelectiveDisclosureProof`, and `AuditorKeypair` decryption |
| [`typescript/dataslice-scanner`](./typescript/dataslice-scanner) | JavaScript / Node 20+ | Zero-dependency Solana RPC `getAccountInfo` (`PoolState` decode), `getMultipleAccounts` `dataSlice[64..1120]` batch scan, and `programSubscribe` WS payload |
| [`typescript/jupiter-private-swap`](./typescript/jupiter-private-swap) | JavaScript / Node 20+ | Router-agnostic `SwapViaRouter` (`Tag 5`) integration with Jupiter v6 `/quote` + `/swap-instructions` (works with Orca, Raydium, Meteora, Phoenix, or custom routers) |

## Quickstart

### TypeScript / Node (Zero dependencies)

```bash
# Inspect live Pool #0 and scan EpochPage dataSlice[64..1120]
SOLANA_RPC_URL="https://your-solana-rpc" node typescript/dataslice-scanner/index.mjs

# Quote a private swap route targeting Audren swap_escrow shard #0
node typescript/jupiter-private-swap/index.mjs
```

### Rust

```bash
# Run offline institutional audit & selective disclosure verification
cargo run --manifest-path rust/Cargo.toml -p audren-example-institutional-audit

# Run full shielded SOL deposit -> dataSlice scan -> Transfer -> Withdraw on Devnet or Mainnet
AUDREN_RPC_URL="https://your-devnet-rpc" \
AUDREN_KEYPAIR_PATH="/path/to/keypair.json" \
cargo run --manifest-path rust/Cargo.toml -p audren-example-shielded-transfer
```
