# Audren Examples Engineering Guide (`AGENTS.md`)

Rules and conventions for adding or maintaining runnable integrations in `audren-xyz/examples`.

## Principles

- **Runnable Standalone:** Every example must compile and execute cleanly without hidden workspace dependencies or undocumented setup steps.
- **Canonical Addresses:** Target the live Mainnet & Devnet Audren program (`AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3`) and canonical Pool `#0` (`5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G`) unless parameterized by environment variables.
- **Environment-Driven Credentials:** Never hardcode private RPC URLs, API keys, seed phrases, or keypairs. Read RPC endpoints and signers from `SOLANA_RPC_URL` / `AUDREN_RPC_URL` and `AUDREN_KEYPAIR_PATH`.
- **Zero Dependencies for JS/TS Examples:** Keep Node 20+ examples zero-dependency ESM (`.mjs`) using built-in `fetch` and `crypto`.
- **Solana Transaction Version 1 Only:** Always build, sign, and serialize Solana transactions using Transaction Version 1 (SIMD-0385 / `0x81`, 4,096 B limit, inline `TransactionConfig` compute budget via `v1::Message::try_compile_with_config` + `VersionedTransaction::try_new(VersionedMessage::V1(...))` + `wincode::serialize`). Never use legacy transactions or separate `ComputeBudgetInstruction`s.
- **Rust Toolchain:** Pinned in `rust-toolchain.toml` (`1.98.1`). Pull `audren-core` and `audren-client` from `https://github.com/audren-xyz/audren`.

## Verification

Before pushing changes:

```bash
cargo check --manifest-path rust/Cargo.toml --all-targets
node --check typescript/dataslice-scanner/index.mjs
node --check typescript/jupiter-private-swap/index.mjs
```

## Style

- Keep READMEs and code comments concise, present-tense, and focused on what integrators need to build and run each flow.
- Do not add changelog sections or historical notes to READMEs or source comments.
