# Audren Examples Engineering Guide (`AGENTS.md`)

Rules and conventions for adding or maintaining runnable integrations in `audren-xyz/examples`.

## Principles

- **Import the Real SDKs (Zero Hand-Rolled Constants):** Every example across Rust (`audren-client`), TypeScript (`@audren/sdk` + `@audren/sdk/prover`), Swift (`AudrenSDK`), and Kotlin (`xyz.audren.sdk`) must consume the official SDKs from [`audren-xyz/audren`](https://github.com/audren-xyz/audren) (`v1.3.0`). Never duplicate PDA seeds, account offsets, binary decoders, CU limit constants, or `JUPITER_CPI_EXCLUDED_DEXES`.
- **Six Standardized Building Blocks & Byte-for-Byte 4-Language Parity:** Every language folder maintains a runnable offline `quickstart` covering the exact same 6 building blocks (`Keys`, `PDAs & Layouts` including `GlobalRootHistory`, `Memos & CompactWalletStore`, `BN254 Groth16 & Instructions` including `InitRootHistory` & dual-ring `Transact`, `Mode 1 & Mode 2 Disclosure`, `Relayer & Escrow CPI`). All 4 quickstarts must emit **100% byte-for-byte identical stdout** against `spec/test-vectors.json` (`diff -u` enforced in CI on Linux & macOS).
- **Zero-Crank Architecture & Calibrated Tight CU Limits:** Use inline `GlobalRootHistory` (`audren_roots`), auto-`OpenPage` (`planAutoOpenPages` / `buildAutoOpenPageInstructions` / `build_auto_open_page_ixs`), and calibrated tight CU budgets (`45k` InitPool, `75k` InitLane / InitRootHistory, `40k` OpenPage, `75k` Deposit / `140k` T22 Hook, `165k` Full Exit w/ read-only `roots`, `255k` Withdraw / `295k` T22 Hook, `235k` Private 2in/3out, `285k` base `ExecViaEscrow` + router CPI).
- **Canonical Addresses:** Target the canonical Audren v1 program (`AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3`), Pool `#0` (`5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G`), `GlobalRootHistory` `#0` (`249YJTuRtiKAnh346Tc18kF9bHrktdrTzyJMtvUKUgC7`, bump `254`), Vault Authority `#0` (`3aMtBvVMatfBvoBWQaTxCPwQ2SWyW5ejceVgLFTtk2WF`), and frozen Pool `#0` ALTs (Mainnet `Db1aWwM1Tat54Pm3fHdAwYxL6jDWWJzfe3MUR28M3nZ6`, Devnet `A5FrkN6y3AcMh6fdyp489gTUhPFvVuhmyHTLN3H8esBe`).
- **Environment-Driven Credentials:** Never hardcode private RPC URLs, API keys, seed phrases, or keypairs. Read RPC endpoints and signers from `SOLANA_RPC_URL` / `AUDREN_RPC_URL` and `AUDREN_KEYPAIR_PATH`.
- **Solana Transaction Version 1 (`0x81`):** Build, sign, and serialize Solana transactions using Transaction Version 1 (`0x81`, `4,096 B`, inline `TransactionConfig`).
- **Aligned Toolchain:** `rust-toolchain.toml` (`1.97.1`) matches `audren-xyz/audren`.

## Verification

Every push and PR runs `.github/workflows/ci.yml` across all 4 languages (`rust`, `typescript`, `swift`, `kotlin`).
