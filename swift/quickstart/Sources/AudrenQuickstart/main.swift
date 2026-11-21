import AudrenSDK
import Foundation

// Audren Canonical 6-Building-Block Quickstart (Swift SDK — iOS 15+ / macOS 13+).
//
// Executes the exact same 6 building blocks mirrored across Rust, TypeScript, Swift, and Kotlin
// using native `AudrenSDK` backed by `crates/audren-ffi` (~50 ms native local ZK proving),
// producing 100% byte-for-byte identical stdout across all 4 official SDKs.
//
// Run (with sibling `../audren` built via `./scripts/build-mobile-sdks.sh bindings`):
//   cd swift/quickstart && swift run

private func hexToData(_ hex: String) -> Data {
    var data = Data(capacity: hex.count / 2)
    var idx = hex.startIndex
    while idx < hex.endIndex {
        let next = hex.index(idx, offsetBy: 2)
        data.append(UInt8(hex[idx..<next], radix: 16)!)
        idx = next
    }
    return data
}

private func dataToHex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

let usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
let wsolMint = "So11111111111111111111111111111111111111112"
let classicTokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"

let envRepo = ProcessInfo.processInfo.environment["AUDREN_REPO_DIR"]
let repoRoot = envRepo.map { URL(fileURLWithPath: $0) } ?? URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent() // AudrenQuickstart
    .deletingLastPathComponent() // Sources
    .deletingLastPathComponent() // quickstart
    .deletingLastPathComponent() // swift
    .deletingLastPathComponent() // examples
    .deletingLastPathComponent() // parent
    .appendingPathComponent("audren")

let vectorsUrl = repoRoot.appendingPathComponent("spec/test-vectors.json")
let raw = try Data(contentsOf: vectorsUrl)
let v = try JSONSerialization.jsonObject(with: raw) as! [String: Any]

let aliceJson = v["alice"] as! [String: Any]
let bobJson = v["bob"] as! [String: Any]
let pdasJson = v["pdas"] as! [String: Any]
let psJson = v["pool_state"] as! [String: Any]
let epJson = v["epoch_page"] as! [String: Any]
let audJson = v["auditor"] as! [String: Any]

// 1. KEYS — Master keys, sub-account #1, DeFi Session B_0, aud1… address & read-only Full Viewing Key
let pid = programId()
let aliceSeed = hexToData(aliceJson["seed_hex"] as! String)
let alice = try deriveKeysFromSeed(seed32: aliceSeed)
let aliceSub1 = try deriveSubaccountKeys(masterSeed32: aliceSeed, accountIndex: 1)
let aliceSession0 = try deriveDefiSessionKeypair(masterSeed32: aliceSeed, sessionIndex: 0)
let aliceFvk = try exportFullViewingKey(seed32: aliceSeed, accountIndex: 0)
let parsed = try parseAudrenAddress(encoded: alice.address)
precondition(parsed.spendPk == alice.spendPk)

print("[1/6 KEYS]")
print("  Program ID    : \(pid)")
print("  Alice aud1    : \(alice.address)")
print("  Subaccount #1 : \(aliceSub1.address)")
print("  DeFi Session 0: \(aliceSession0.address)")
print("  FVK view_pk   : \(aliceFvk.viewPkB58)")

// 2. PDAs & LAYOUTS — Canonical Pool #0 PDAs & binary decoders
let poolPda = try derivePoolPda(poolId: 0, programId: pid)
let page0Pda = try deriveEpochPagePda(poolId: 0, pageId: 0, programId: pid)
let solVaultPda = try deriveSolVaultPda(poolId: 0, programId: pid)
let escrow0Pda = try deriveEscrowPda(poolId: 0, shardId: 0, programId: pid)
let poolState = try decodePoolState(data: hexToData(psJson["raw_hex"] as! String))
let pageBytes = hexToData(epJson["page_hex"] as! String)
let hdr = try decodeEpochPageHeader(data: pageBytes)

print("[2/6 PDAs & LAYOUTS]")
print("  Pool #0 PDA   : \(poolPda.address) (total_notes=\(poolState.totalNotes))")
print("  EpochPage #0  : \(page0Pda.address) (count=\(hdr.count)/32)")
print("  SOL Vault     : \(solVaultPda.address)")
print("  Escrow #0     : \(escrow0Pda.address)")

// 3. SCANNER — 1,056-byte dataSlice[64..1120] view-tag filter, read-only FVK & spendable decrypt
let sliceCfg = pageScanDataSlice()
let hits = try scanPageDataslice(
    pageId: 0,
    slice1056: hexToData(epJson["scan_slice_hex"] as! String),
    spendPk32: alice.spendPk,
    viewSk32: alice.viewSk
)
precondition(Array(hits) == [5])

let watchOnlyNotes = try scanEpochPage(
    poolId: 0,
    pageBytes: pageBytes,
    spendSk32: nil,
    spendPk32: alice.spendPk,
    viewSk32: alice.viewSk,
    programId: pid
)
precondition(watchOnlyNotes.count == 1 && watchOnlyNotes[0].nullifierPda == nil)

let notes = try scanEpochPage(
    poolId: 0,
    pageBytes: pageBytes,
    spendSk32: alice.spendSk,
    spendPk32: alice.spendPk,
    viewSk32: alice.viewSk,
    programId: pid
)
let note = notes[0]
let unwrapPda = try deriveUnwrapPda(poolId: 0, nullifier32: note.nullifier!, programId: pid)

print("[3/6 SCANNER]")
print("  dataSlice     : offset=\(sliceCfg.offset), length=\(sliceCfg.length) B -> matched slot \(hits[0])")
print("  Read-only FVK : \(watchOnlyNotes[0].amount) lamports | NullifierPDA=none")
print("  Spendable note: \(note.amount) lamports | NullifierPDA=\(note.nullifierPda ?? "")")
print("  Unwrap PDA    : \(unwrapPda.address)")

// 4. PROVER — Native ~50 ms Deposit, Transfer (m=5 Triptych + Bulletproofs U128), ProofBuffer, CloseProofBuffer & Withdraw
let payer = pdasJson["proof_buffer_authority"] as! String
let bobAddr = bobJson["address"] as! String

let depIx = try buildDepositInstruction(params: FfiDepositParams(
    programId: pid,
    depositor: payer,
    poolId: 0,
    activePageId: 1,
    recipientAddress: bobAddr,
    mint32: Data(repeating: 0, count: 32),
    grossAmount: 500_000,
    netAmount: netDepositAmount(grossAmount: 500_000, feeBps: 0, maxFee: 0),
    feeFromAmount: false,
    tokenProgram: nil,
    depositorAta: nil,
    vaultAta: nil
))
let xferIx = try buildTransferInstruction(params: FfiTransferParams(
    programId: pid,
    payer: payer,
    poolId: 0,
    outPageId: 1,
    inputPageIds: [0],
    inputPagesBytes: [pageBytes],
    inputNote: note,
    secretIndex: UInt32(note.slotIndex),
    recipientAddress: bobAddr,
    changeAddress: alice.address,
    payAmount: 900_000,
    auditorPk32: nil
))
let bufPlan = try buildBufferedExecutionPlan(nonce: 42, inner: xferIx)
let closeBufIx = try buildCloseProofBufferInstruction(programId: pid, payer: payer, nonce: 42)
let wdIx = try buildWithdrawInstruction(params: FfiWithdrawParams(
    programId: pid,
    payer: payer,
    poolId: 0,
    outPageId: 1,
    inputPageIds: [0],
    inputPagesBytes: [pageBytes],
    inputNote: note,
    secretIndex: UInt32(note.slotIndex),
    recipientAccount: payer,
    changeAddress: alice.address,
    amount: 1_000_000,
    relayerFee: 0,
    feeRecipient: nil,
    unwrapWsol: false,
    splTokenProgram: nil,
    auditorPk32: nil
))

precondition(depIx.data.count == 139)
precondition(xferIx.data.count == 2373)
precondition(closeBufIx.data.count == 1)
precondition(wdIx.data.count == 1973)

print("[4/6 PROVER]")
print("  Deposit ix    : \(depIx.data.count) B (tag=\(depIx.data[0]))")
print("  Transfer m=5  : \(xferIx.data.count) B (tag=\(xferIx.data[0]), ProofBuffer chunks=\(bufPlan.uploadChunks.count), CloseProofBuffer=\(closeBufIx.data.count) B)")
print("  Withdraw ix   : \(wdIx.data.count) B (tag=\(wdIx.data[0]))")

// 5. DISCLOSURE & AUDIT — Mode 1 Selective Disclosure + Institutional Auditor ElGamal decrypt
let sd = createSelectiveDisclosureProof(note: note)
let sdValid = try verifySelectiveDisclosureProof(proof: sd)
let sdOnPage = try verifySelectiveDisclosureOnPage(proof: sd, pageBytes: pageBytes)
let tamperedSd = FfiSelectiveDisclosureProof(
    version: sd.version,
    pageId: sd.pageId,
    slotIndex: sd.slotIndex,
    stealthPkB58: sd.stealthPkB58,
    assetTagB58: sd.assetTagB58,
    commitmentB58: sd.commitmentB58,
    mintB58: sd.mintB58,
    amount: sd.amount + 1,
    assetBlindingB58: sd.assetBlindingB58,
    valueBlindingB58: sd.valueBlindingB58
)
let tamperedValid = try verifySelectiveDisclosureOnPage(proof: tamperedSd, pageBytes: pageBytes)
precondition(sdValid && sdOnPage && !tamperedValid)

let aud = try deriveAuditorKeypair(seed32: hexToData(audJson["auditor_seed_hex"] as! String))
let dec = try auditorDecryptNote(
    auditorSk32: aud.auditorSk,
    s132: hexToData(audJson["elgamal_s1_hex"] as! String),
    s232: hexToData(audJson["elgamal_s2_hex"] as! String),
    m132: hexToData(audJson["elgamal_m1_hex"] as! String),
    m232: hexToData(audJson["elgamal_m2_hex"] as! String)
)
precondition(dataToHex(dec.spentStealthPk) == (audJson["expected_spent_pk_hex"] as! String))
precondition(dataToHex(dec.assetGenerator) == (audJson["expected_asset_gen_hex"] as! String))

print("[5/6 DISCLOSURE & AUDIT]")
print("  Mode 1 proof  : verified standalone & on-page (tampered rejected)")
print("  Auditor decrypt: spent stealth_pk & asset_generator verified")

// 6. RELAYER & ESCROW CPI — Unified cross-SDK prepareEscrowAccounts & defaultRelayUrl
let escrowInAta = try deriveAssociatedTokenAddress(
    ownerB58: escrow0Pda.address,
    mintB58: usdcMint,
    tokenProgramB58: classicTokenProgram
)
let escrowOutAta = try deriveAssociatedTokenAddress(
    ownerB58: escrow0Pda.address,
    mintB58: wsolMint,
    tokenProgramB58: classicTokenProgram
)
let prepared = try prepareEscrowAccounts(
    poolId: 0,
    shardId: 0,
    inputMintB58: usdcMint,
    outputMintB58: wsolMint,
    inputTokenProgramB58: classicTokenProgram,
    outputTokenProgramB58: classicTokenProgram,
    actionAccounts: [
        FfiAccountMeta(pubkey: escrowInAta, isSigner: false, isWritable: true),
        FfiAccountMeta(pubkey: escrowOutAta, isSigner: false, isWritable: true),
        FfiAccountMeta(pubkey: escrow0Pda.address, isSigner: true, isWritable: false),
    ],
    programId: pid
)
let outerSigners = prepared.accounts.filter { $0.isSigner }.count
precondition(prepared.escrowIdx == 2 && prepared.escrowInIdx == 0 && prepared.escrowOutIdx == 1)
precondition(outerSigners == 0)

print("[6/6 RELAYER & ESCROW CPI]")
print("  Default relay : \(defaultRelayUrl())")
print("  Escrow CPI    : idx=\(prepared.escrowIdx), in=\(prepared.escrowInIdx), out=\(prepared.escrowOutIdx) (outer signers=\(outerSigners))")
print("  Excluded DEXes: \(jupiterCpiExcludedDexes().joined(separator: ","))")
