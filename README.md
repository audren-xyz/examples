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

Standardized, runnable examples across all **4 official Audren SDKs — Rust, TypeScript, Swift (iOS/macOS), and Kotlin (Android/JVM)** — speaking the exact same **6 building blocks** (`keys`, `PDAs & layouts`, `dataSlice scanner`, `local ZK prover`, `disclosure & audit`, `relayer & router`) and importing the real SDK packages directly with zero hand-rolled constants or byte offsets.

- **Program ID:** `AUDRBK6kVkQoEGm3EB7swd34SUPqrHZeNEkB5vZWVSv3`
- **Canonical Pool `#0` (`Permissionless`) PDA:** `5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G`
- **Core Protocol & 4 Official SDKs:** [`audren-xyz/audren`](https://github.com/audren-xyz/audren)
- **Canonical Conformance Vectors:** [`spec/test-vectors.json`](https://github.com/audren-xyz/audren/blob/main/spec/test-vectors.json)

## Standardized 6-Building-Block Quickstarts (All 4 Languages)

Every language folder contains a `quickstart` executing the identical 6-step flow offline (keys + sub-accounts + FVK → Pool #0 PDAs & decoders → `dataSlice[64..1120]` scan + decrypt → real `Deposit`, `Transfer m=5`, `ProofBuffer`, `Withdraw` local proofs → Mode 1 Selective Disclosure & Auditor decrypt → Relayer & DEX config):

| Language | Quickstart Path | Official SDK Consumed | Additional Examples |
| --- | --- | --- | --- |
| **Rust** | [`rust/quickstart`](./rust/quickstart) | `audren-client` + `audren-core` (pinned git rev) | [`rust/shielded-transfer`](./rust/shielded-transfer) (live Solana v1 lifecycle), [`rust/institutional-audit`](./rust/institutional-audit) |
| **TypeScript** | [`typescript/quickstart`](./typescript/quickstart) | `@audren/sdk` + `@audren/sdk/prover` | [`typescript/dataslice-scanner`](./typescript/dataslice-scanner) (live RPC/WS), [`typescript/jupiter-private-swap`](./typescript/jupiter-private-swap) |
| **Swift (iOS / macOS)** | [`swift/quickstart`](./swift/quickstart) | `AudrenSDK` (`packages/swift` via UniFFI) | — |
| **Kotlin (Android / JVM)** | [`kotlin/quickstart`](./kotlin/quickstart) | `xyz.audren.sdk` (`packages/kotlin` via UniFFI + JNA) | — |

## Quickstart

Clone `audren` beside `examples` (so TypeScript, Swift, and Kotlin consume the exact SDKs from source without package-registry lock-in):

```bash
git clone https://github.com/audren-xyz/audren.git
git clone https://github.com/audren-xyz/examples.git
```

### 1. Rust (`audren-client`)

```bash
# Offline 6-building-block quickstart (keys, PDAs, scan, Triptych+Bulletproof proofs, disclosure)
cargo run --manifest-path examples/rust/Cargo.toml -p audren-example-quickstart

# Offline institutional audit & selective disclosure verification
cargo run --manifest-path examples/rust/Cargo.toml -p audren-example-institutional-audit

# Live Devnet/Mainnet Solana v1 lifecycle (Deposit -> Transfer -> Withdraw)
AUDREN_RPC_URL="https://your-devnet-rpc" \
AUDREN_KEYPAIR_PATH="/path/to/keypair.json" \
cargo run --manifest-path examples/rust/Cargo.toml -p audren-example-shielded-transfer
```

### 2. TypeScript (`@audren/sdk` + `@audren/sdk/prover`)

```bash
pnpm --dir audren/packages/sdk install --frozen-lockfile && pnpm --dir audren/packages/sdk build
pnpm --dir examples/typescript install

# Offline 6-building-block quickstart (pure-TS Ristretto255 + Triptych + Bulletproofs)
pnpm --dir examples/typescript quickstart

# Offline SwapViaRouter account planner (set LIVE_QUOTE=1 for a live Jupiter quote)
pnpm --dir examples/typescript swap-plan

# Live Pool #0 & EpochPage dataSlice[64..1120] RPC scanner
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

> Override the sibling `../audren` path at any time with `AUDREN_REPO_DIR=/path/to/audren`.

## Scope and safety

The live Rust `shielded-transfer` example submits Solana Transaction v1 (`0x81`) transactions and spends network fees. Use a dedicated Devnet key and configured RPC provider, and never commit secrets. Audren is pre-audit and upgradeable; deposits, withdrawals, and external DEX legs retain public visibility boundaries.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
