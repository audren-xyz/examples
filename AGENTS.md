# Audren Examples Engineering Guide (`AGENTS.md`)

Rules and conventions for adding or maintaining runnable integrations in `audren-xyz/examples`.

## Principles

- **Import the Real SDKs (Zero Hand-Rolled Constants):** Every example across Rust (`audren-client`), TypeScript (`@audren/sdk` + `@audren/sdk/prover`), Swift (`AudrenSDK`), and Kotlin (`xyz.audren.sdk`) must consume the official SDKs from [`audren-xyz/audren`](https://github.com/audren-xyz/audren). Never duplicate PDA seeds, account offsets, binary decoders, or `JUPITER_CPI_EXCLUDED_DEXES`.
- **Six Standardized Building Blocks & Byte-for-Byte 4-Language Parity:** Every language folder maintains a runnable offline `quickstart` covering the exact same 6 building blocks (`Keys`, `PDAs & Layouts`, `Memos & CompactWalletStore`, `BN254 Groth16 & Instructions`, `Mode 1 & Mode 2 Disclosure`, `Relayer & Escrow CPI`). All 4 quickstarts must emit **100% byte-for-byte identical stdout** against `spec/test-vectors.json` (`diff -u` enforced in CI on Linux & macOS).
- **Canonical Addresses:** Target the canonical Audren program (`AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3`) and Pool `#0` (`8CN7uxRdQGjuAaZQVVcHRZbptSzvgfUv7tg8EarLHztF`).
- **Environment-Driven Credentials:** Never hardcode private RPC URLs, API keys, seed phrases, or keypairs. Read RPC endpoints and signers from `SOLANA_RPC_URL` / `AUDREN_RPC_URL` and `AUDREN_KEYPAIR_PATH`.
- **Solana Transaction Version 1 (`0x81`):** Build, sign, and serialize Solana transactions using Transaction Version 1 (`0x81`, `4,096 B`, inline `TransactionConfig`).
- **Aligned Toolchain:** `rust-toolchain.toml` (`1.97.1`) matches `audren-xyz/audren`.

## Verification

Every push and PR runs `.github/workflows/ci.yml` across all 4 languages (`rust`, `typescript`, `swift`, `kotlin`).
