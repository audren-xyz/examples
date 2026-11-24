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

<p>
  <a href="https://github.com/audren-xyz/examples/actions/workflows/ci.yml"><img src="https://github.com/audren-xyz/examples/actions/workflows/ci.yml/badge.svg" alt="CI — 4-Language Parity" /></a>
  <a href="https://github.com/audren-xyz/audren/actions/workflows/ci.yml"><img src="https://github.com/audren-xyz/audren/actions/workflows/ci.yml/badge.svg" alt="Audren Core & SDKs CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-434039" alt="Apache-2.0 License" /></a>
  <a href="https://audren.xyz/developers/"><img src="https://img.shields.io/badge/docs-audren.xyz%2Fdevelopers-C83E2B" alt="Developers Docs" /></a>
</p>

Standardized, runnable examples across all **4 official Audren SDKs — Rust, TypeScript (`@audren/sdk` + WASM prover), Swift (iOS/macOS), and Kotlin (Android/JVM)** — executing the exact same **6 building blocks** (Keys, BIP-350 Bech32m `aud1...` addresses & `DefiSessionKeypair`, 12 PDAs including inline dual-ring `GlobalRootHistory` & zero-copy decoders, versioned `106 B` SoA memos & zero-indexer `CompactWalletStore`, `192 B` BN254 Groth16 & 9 instructions with zero-crank auto-`OpenPage` and tight CU limits in a single Transaction v1, Mode 1 Selective Disclosure & Mode 2 `FullViewingKey`, and Relayer / `ExecViaEscrow` CPI) and verified in CI for **100% byte-for-byte canonical stdout parity across all 4 languages**.

- **Program ID:** `AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3` (`PROTOCOL_VERSION = 1`, release `1.3.0`)
- **Canonical Pool `#0` PDA (`audren_pool`):** `5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G`
- **Canonical `GlobalRootHistory` `#0` PDA (`audren_roots`):** `249YJTuRtiKAnh346Tc18kF9bHrktdrTzyJMtvUKUgC7` (bump `254`, `10,216 B` `AUD1RT01` dual-ring instant spendability on `~150ms` Alpenglow confirmation, zero cranks)
- **Canonical Vault Authority `#0` PDA (`audren_vault_auth`):** `3aMtBvVMatfBvoBWQaTxCPwQ2SWyW5ejceVgLFTtk2WF`
- **Canonical Pool `#0` ALTs (`73` entries, frozen):** Mainnet `CJgLKw3FTErb3MhmkphyMv28gBxmqSfjfATXypabmL3A` · Devnet `7bwvhuVsmjjXJ1ZPMw2RQpkdwnYKy7upobbdV4FKrCry`
- **Core Protocol & 4 Official SDKs:** [`audren-xyz/audren`](https://github.com/audren-xyz/audren)
- **Canonical Conformance Vectors:** [`spec/test-vectors.json`](https://github.com/audren-xyz/audren/blob/main/spec/test-vectors.json)

## Standardized 6-Building-Block Quickstarts (All 4 Languages)

| Language | Quickstart Path | Official SDK Consumed | Additional Examples |
| --- | --- | --- | --- |
| **Rust** | [`rust/quickstart`](./rust/quickstart) | `audren-client` + `audren-core` | [`rust/shielded-transfer`](./rust/shielded-transfer) (zero-crank auto-`OpenPage` + Transaction v1 `0x81` with tight CU limits), [`rust/institutional-audit`](./rust/institutional-audit) (Mode 1 & Mode 2) |
| **TypeScript** | [`typescript/quickstart`](./typescript/quickstart) | `@audren/sdk` + `@audren/sdk/prover` (WASM) | [`typescript/dataslice-scanner`](./typescript/dataslice-scanner) (zero-indexer `CompactWalletStore` + `GlobalRootHistory` RPC sync), [`typescript/jupiter-private-swap`](./typescript/jupiter-private-swap) (`ExecViaEscrow` Tag 6 + tight CU limits) |
| **Swift (iOS / macOS)** | [`swift/quickstart`](./swift/quickstart) | `AudrenSDK` (`packages/swift` via UniFFI) | — |
| **Kotlin (Android / JVM)** | [`kotlin/quickstart`](./kotlin/quickstart) | `xyz.audren.sdk` (`packages/kotlin` via UniFFI + JNA) | — |

## Quickstart

Clone `audren` beside `examples`:

```bash
git clone https://github.com/audren-xyz/audren.git
git clone https://github.com/audren-xyz/examples.git
```

### 1. Rust (`audren-client`)

```bash
cargo run --release --manifest-path examples/rust/Cargo.toml -p audren-example-quickstart
cargo run --manifest-path examples/rust/Cargo.toml -p audren-example-institutional-audit
cargo run --manifest-path examples/rust/Cargo.toml -p audren-example-shielded-transfer
```

### 2. TypeScript (`@audren/sdk` + `@audren/sdk/prover` WASM)

```bash
pnpm --dir audren/packages/sdk install --frozen-lockfile && pnpm --dir audren/packages/sdk build
pnpm --dir examples/typescript install
pnpm --dir examples/typescript quickstart
pnpm --dir examples/typescript swap-plan
SOLANA_RPC_URL="https://your-solana-rpc" pnpm --dir examples/typescript scan
```

### 3. Swift (iOS 15+ / macOS 13+ — `AudrenSDK`)

```bash
(cd audren && ./scripts/build-mobile-sdks.sh bindings)
(cd examples/swift/quickstart && swift run)
```

### 4. Kotlin (Android API 24+ / JVM 21+ — `xyz.audren.sdk`)

```bash
(cd audren && ./scripts/build-mobile-sdks.sh bindings)
(cd examples/kotlin/quickstart && gradle run)
```

> Override the sibling `../audren` path for `spec/test-vectors.json` and Swift/Kotlin local SDK resolution with `AUDREN_REPO_DIR=/path/to/audren` (TypeScript `package.json` resolves `file:../../audren/packages/sdk`, and Rust examples depend on `audren-xyz/audren` via Cargo git).

## Scope and safety

Audren verifies proofs under the BGM17 Groth16 ceremony keys anchored to the official Hermez Perpetual Powers of Tau (54 contributions plus a beacon) plus Audren's verifiable Phase-2 ceremony (two Audren-generated contributions plus a live drand Quicknet & Solana Mainnet beacon, `ceremony/transcript.json`), and remains pre-audit with mutable upgrade authority pending independent security review. Unified deposits (`Deposit`, Tag 3, supporting Native SOL via `SyncNative` WSOL as well as Classic SPL & Token-2022 with inline `GlobalRootHistory` updates), public withdrawals (`Transact`, Tag 5, `ASSET_MODE_PUBLIC` + optional `WITHDRAW_FLAG_UNWRAP_WSOL`), external DeFi CPI calls (`ExecViaEscrow`, Tag 6), and stateful positions opened by deterministic `DefiSessionKeypair` wallets remain observable on Solana.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
