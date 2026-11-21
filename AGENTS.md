# Audren Examples Engineering Guide (`AGENTS.md`)

Rules and conventions for adding or maintaining runnable integrations in `audren-xyz/examples`.

## Principles

- **Import the Real SDKs (Zero Hand-Rolled Constants):** Every example across Rust (`audren-client`), TypeScript (`@audren/sdk` + `@audren/sdk/prover`), Swift (`AudrenSDK`), and Kotlin (`xyz.audren.sdk`) must consume the official SDKs from [`audren-xyz/audren`](https://github.com/audren-xyz/audren). Never duplicate PDA seeds, account offsets, binary decoders, or `JUPITER_CPI_EXCLUDED_DEXES` by hand.
- **Six Standardized Building Blocks:** Every language folder maintains a runnable offline `quickstart` covering the exact same 6 building blocks (`keys`, `PDAs & layouts`, `dataSlice scanner`, `local ZK prover`, `disclosure & audit`, `relayer & router`).
- **Canonical Addresses:** Target the live Mainnet & Devnet Audren program (`AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3`) and canonical Pool `#0` (`5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G`) unless parameterized by environment variables.
- **Environment-Driven Credentials:** Never hardcode private RPC URLs, API keys, seed phrases, or keypairs. Read RPC endpoints and signers from `SOLANA_RPC_URL` / `AUDREN_RPC_URL` and `AUDREN_KEYPAIR_PATH`.
- **Solana Transaction Version 1 Only:** Always build, sign, and serialize Solana transactions using Transaction Version 1 (SIMD-0385 / `0x81`, 4,096 B limit, inline `TransactionConfig`). Never use legacy transactions or separate `ComputeBudgetInstruction`s.
- **Aligned Toolchain:** `rust-toolchain.toml` (`1.97.1`) matches `audren-xyz/audren`.

## Verification

Every push and PR runs `.github/workflows/ci.yml` across all 4 languages (`rust`, `typescript`, `swift`, `kotlin`).
