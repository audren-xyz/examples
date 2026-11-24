import Foundation
import AudrenSDK

private struct KeyVector: Decodable {
    let seed_hex: String
    let spend_pk_hex: String
    let nk_hex: String
    let view_pk_hex: String
    let address: String
}
private struct DefiSessionVector: Decodable {
    let pubkey_b58: String
}
private struct PdaAddressVector: Decodable {
    let address: String
    let bump: UInt8
}
private struct PdaVectors: Decodable {
    let nullifier_hex: String
    let roots: PdaAddressVector
}
private struct AssetIdVectors: Decodable {
    let wsol_asset_id_hex: String
    let usdc_asset_id_hex: String
}
private struct MemoVector: Decodable {
    let eph_secret_hex: String
    let amount: UInt64
    let mint_hex: String
    let payment_id_hex: String
    let commitment_hex: String
    let memo_106_hex: String
    let dyn_eph_secret_hex: String
}
private struct CtxHashVectors: Decodable {
    let transact_private_ctx_hash_hex: String
    let transact_wsol_unwrap_ctx_hash_hex: String
    let exec_fee_on_output_ctx_hash_hex: String
}
private struct Groth16Vector: Decodable {
    let super_root_hex: String
    let out0_stealth_owner_hex: String
    let out1_stealth_owner_hex: String
    let nf0_hex: String
    let nf1_hex: String
    let cm0_hex: String
    let cm1_hex: String
    let cm2_hex: String
    let public_input_hash_hex: String
    let proof_192_hex: String
}
private struct PoolStateVector: Decodable {
    let raw_hex: String
}
private struct RootHistoryVector: Decodable {
    let raw_hex: String
    let default_epoch_interval: UInt64
}
private struct ConformanceVectors: Decodable {
    let alice: KeyVector
    let alice_sub1: KeyVector
    let bob: KeyVector
    let defi_session_0: DefiSessionVector
    let defi_session_3: DefiSessionVector
    let asset_ids: AssetIdVectors
    let pdas: PdaVectors
    let memo: MemoVector
    let ctx_hashes: CtxHashVectors
    let groth16: Groth16Vector
    let pool_state: PoolStateVector
    let root_history: RootHistoryVector
}

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

private func base58Encode32(_ byte: UInt8) -> String {
    let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
    var digits: [Int] = [0]
    for _ in 0..<32 {
        var carry = Int(byte)
        for j in 0..<digits.count {
            carry += digits[j] << 8
            digits[j] = carry % 58
            carry /= 58
        }
        while carry > 0 {
            digits.append(carry % 58)
            carry /= 58
        }
    }
    return String(digits.reversed().map { alphabet[$0] })
}

private let classicTokenProg = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
private let usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
private let wsolMint = "So11111111111111111111111111111111111111112"
private let systemProgramId = "11111111111111111111111111111111"
private let rootRingEpoch: UInt8 = 1

private let examplesRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .deletingLastPathComponent()
private let specUrl: URL = {
    let fm = FileManager.default
    var candidates: [URL] = []
    if let envDir = ProcessInfo.processInfo.environment["AUDREN_REPO_DIR"], !envDir.isEmpty {
        candidates.append(URL(fileURLWithPath: envDir).appendingPathComponent("spec/test-vectors.json"))
    }
    candidates.append(examplesRoot.appendingPathComponent("spec/test-vectors.json"))
    candidates.append(examplesRoot.deletingLastPathComponent().appendingPathComponent("audren/spec/test-vectors.json"))
    for url in candidates where fm.fileExists(atPath: url.path) {
        return url
    }
    fatalError("Missing spec/test-vectors.json; clone sibling audren repo or set AUDREN_REPO_DIR=/path/to/audren")
}()
private let v = try JSONDecoder().decode(ConformanceVectors.self, from: Data(contentsOf: specUrl))

let pid = canonicalProgramId()
let poolId: UInt32 = 0

// 1. KEYS & COMPLIANCE
let aliceSeed = hexToData(v.alice.seed_hex)
let alice = try deriveKeysFromSeed(seed: aliceSeed)
let aliceSub1 = try deriveSubaccountKeys(seed: aliceSeed, accountIndex: 1)
let sess0 = try deriveDefiSessionKeypair(seed: aliceSeed, sessionIndex: 0)
let sess3 = try deriveDefiSessionKeypair(seed: aliceSeed, sessionIndex: 3)
let fvk = try exportFullViewingKey(seed: aliceSeed)
let decodedAddr = try decodeAudrenAddress(encoded: alice.address)
precondition(dataToHex(decodedAddr[0]) == v.alice.spend_pk_hex)
precondition(alice.address == v.alice.address)

print("[1/6 KEYS]")
print("  Program ID    : \(pid) (v\(protocolVersion()))")
print("  Alice aud1    : \(alice.address)")
print("  Subaccount #1 : \(aliceSub1.address)")
print("  DeFi Session 0: \(sess0.pubkeyB58)")
print("  FVK nk        : \(dataToHex(fvk.nk))")

// 2. PDAs & ZERO-COPY LAYOUTS
let poolPda = try derivePoolPda(programId: pid, poolId: poolId).address
let rootsPda = try deriveRootsPda(programId: pid, poolId: poolId).address
let vaultAuthPda = try deriveVaultAuthPda(programId: pid, poolId: poolId).address
let lane2Pda = try deriveLanePda(programId: pid, poolId: poolId, laneId: 2).address
let escrow5Pda = try deriveEscrowPda(programId: pid, poolId: poolId, shardId: 5).address
precondition(rootsPda == v.pdas.roots.address)
let ps = try decodePoolStateAccount(data: hexToData(v.pool_state.raw_hex))
let roots = try decodeGlobalRootHistoryAccount(data: hexToData(v.root_history.raw_hex))

print("[2/6 PDAs & LAYOUTS]")
print("  Pool #0 PDA   : \(poolPda) (active_lanes=\(ps.activeLanes), root_epoch_interval=\(ps.rootEpochInterval))")
print("  Roots PDA     : \(rootsPda) (slot_cursor=\(roots.slotCursor), epoch_cursor=\(roots.epochCursor), lane2_leaves=\(roots.stableLaneCounts[2]), super_root=\(dataToHex(roots.stableSuperRoot)))")
print("  Vault Auth    : \(vaultAuthPda)")
print("  Lane #2 PDA   : \(lane2Pda)")
print("  Escrow #5 PDA : \(escrow5Pda)")

// 3. MEMOS & ZERO-INDEXER COMPACT STORE
let amount = v.memo.amount
let mintBytes = hexToData(v.memo.mint_hex)
let paymentId = hexToData(v.memo.payment_id_hex)
let enc = try encryptNoteMemo(
    recipientSpendPk: alice.spendPk,
    recipientViewPk: alice.viewPk,
    ephSecret: hexToData(v.memo.eph_secret_hex),
    amount: amount,
    mint: mintBytes,
    paymentId: paymentId
)
precondition(dataToHex(enc.memo106) == v.memo.memo_106_hex)
let cmBe = hexToData(v.memo.commitment_hex)
guard let dec = try decryptAndVerifyMemoEntry(fvk: fvk, memo106: enc.memo106, onchainCommitment: cmBe) else {
    fatalError("FVK memo decrypt failed")
}
precondition(dec.amount == amount)
precondition(dec.paymentId == paymentId)

let nfSample = hexToData(v.pdas.nullifier_hex)
let nfPda = try deriveNullifierPda(programId: pid, poolId: poolId, nullifier: nfSample).address
let unwrapPda = try deriveUnwrapPda(programId: pid, poolId: poolId, nf0: nfSample).address
let storeJson = try compactStoreNewJson(poolId: poolId, birthdaySlot: 0)
precondition(!storeJson.isEmpty)

print("[3/6 MEMOS & COMPACT STORE]")
print("  Memo (106 B)  : \(dataToHex(enc.memo106).prefix(16))... -> decrypted \(dec.amount) lamports (payment_id=\(dataToHex(dec.paymentId)), Poseidon verified)")
print("  Nullifier PDA : \(nfPda)")
print("  Unwrap PDA    : \(unwrapPda)")
print("  CompactStore  : initialized (pool_id=\(poolId), indexer=none)")

// 4. BN254 GROTH16 & INSTRUCTIONS
let wsolAsset = hexToData(v.asset_ids.wsol_asset_id_hex)
let ctxPriv = try computeTransactCtxHashFfi(params: FfiTransactCtxHashParams(
    programId: pid,
    poolId: poolId,
    vkId: 0,
    outLaneId: 2,
    outputMask: 0b111,
    assetMode: 0,
    unwrapWsol: false,
    recipient: nil,
    relayerFeeRecipient: nil,
    publicAssetId: Data(repeating: 0, count: 32),
    publicAmountOut: 0,
    relayerFeeAmount: 0,
    memosBytes: enc.memo106
))
precondition(dataToHex(ctxPriv) == v.ctx_hashes.transact_private_ctx_hash_hex)

let ctxWsol = try computeTransactCtxHashFfi(params: FfiTransactCtxHashParams(
    programId: pid,
    poolId: poolId,
    vkId: 0,
    outLaneId: 2,
    outputMask: 0,
    assetMode: 1,
    unwrapWsol: true,
    recipient: sess0.pubkeyB58,
    relayerFeeRecipient: sess3.pubkeyB58,
    publicAssetId: wsolAsset,
    publicAmountOut: 1_000_000_000,
    relayerFeeAmount: 5_000_000,
    memosBytes: Data()
))
precondition(dataToHex(ctxWsol) == v.ctx_hashes.transact_wsol_unwrap_ctx_hash_hex)

let dynM = try prepareDynamicSwapMemo(
    recipientViewPk: hexToData(v.bob.view_pk_hex),
    ephSecret: hexToData(v.memo.dyn_eph_secret_hex)
)
let ctxExec = try computeExecCtxHashFfi(params: FfiExecCtxHashParams(
    programId: pid,
    poolId: poolId,
    vkId: 0,
    outLaneId: 1,
    escrowShard: 3,
    changeMask: 0b01,
    feeOnOutput: true,
    assetIn: hexToData(v.asset_ids.usdc_asset_id_hex),
    amountIn: 50_000_000,
    relayerFeeAmount: 2_000_000,
    relayerFeeRecipient: sess3.pubkeyB58,
    assetOut: wsolAsset,
    minAmountOut: 400_000_000,
    routerProg: base58Encode32(0x77),
    routerAccounts: [
        FfiAccountMeta(pubkeyB58: base58Encode32(0x88), isSigner: false, isWritable: true),
        FfiAccountMeta(pubkeyB58: base58Encode32(0x99), isSigner: false, isWritable: false),
    ],
    extraWritablePubkeys: [],
    outStealthOwner: enc.stealthOwner,
    outBlinding: enc.blinding,
    dynMemoHead: dynM.dynHead34,
    dynMask72: dynM.dynMask72,
    routerIxData: Data([1, 2, 3, 4]),
    changeMemos: enc.memo106
))
precondition(dataToHex(ctxExec) == v.ctx_hashes.exec_fee_on_output_ctx_hash_hex)

// Real 192-byte BN254 Groth16 proof via native UniFFI `proveJoinsplitWitnessBytes`
let zeroHashes = [
    "0000000000000000000000000000000000000000000000000000000000000000",
    "0532fd436e19c70e51209694d9c215250937921b8b79060488c1206db73e9946",
    "1ea8dbbca1ca3a574b1b871aad1e8bc47571c7e11a99a6fb25f3f19d4bfad32c",
    "1b98ec5a992cd3688e655aef8674386f4e84f0a442eaab4840427e359c214dd2",
    "0fd83a3939005974d559c13c652a31942ffd61cab9a038e04239af96cafaee14",
    "11eb54967ae25ce42205223461cda9dbb1a1811db38b71e404d1fd94c9627777",
    "1c682a99981cf10a215d2788721e0ca060ddc0932cbb04c903eee3bd899dcfc0",
    "2b3de1ae8e72d64a5cb03934061e3fd03789273f370e32d576ae54b4cbeca719",
    "1b64ed0dc55f80f1f3da256b451baf16110fc268311a13fe903f87945b734861",
    "06efb4c4a55b0225fd1088d357b2432f422b0593015c57980e373ecef9029c72",
    "262138dff44f5352d2d7ec48461c771444a6c00c761a3263735d0a99143a51f1",
    "07ea118d86ace14a8eaa26fc18b36fefe7d5f5b00e0eb9ebfd1c88f37131c178",
    "0c2a4af81a2cd78159ce2f3d7ee05367fc5b3c3e1becea2a86d1e66dd27ffb7f",
    "1a953a710c22f79c369c976fc9981ffdbfe236695297fec65886e645e6fa2884",
    "16b0c5e286286eb6c4774ad6292b4f0bdc5b36cb7890b27544268892ae255e0d",
    "2dd7186449cc82702fb8f2d7fa86e0095263f8afb521e1976f499e67a0d7cbb8",
    "151399c724e17408a7a43cdadba2fc000da9339c56e4d49c6cdee6c4356fbc68",
    "1905d56dc6be6157b64b80d21a207b96e862aea4b68f4674ce4c1b7db4a8bc2e",
    "16d33ae1e54afb1453fc544206899ddf3e1a5bdc7f6d8993550aa6876a380319",
    "16e195c570f224cc86219527096fa55516cc9ee1b96764dd263db0884983fdaf",
]
func u64Le(_ x: UInt64) -> Data {
    var le = x.littleEndian
    return Data(bytes: &le, count: 8)
}
func u64Be32(_ x: UInt64) -> Data {
    var be = x.bigEndian
    return Data(repeating: 0, count: 24) + Data(bytes: &be, count: 8)
}
var witness = Data(capacity: 4611)
witness.append(hexToData(v.groth16.super_root_hex))
witness.append(wsolAsset)
witness.append(Data(repeating: 0, count: 32))
witness.append(u64Le(0))
witness.append(u64Le(0))
witness.append(ctxPriv)
witness.append(1) // omit_nf1 = true

// Input 0: real note at lane 2, leaf 5
witness.append(alice.spendSk)
witness.append(enc.tweak)
witness.append(wsolAsset)
witness.append(u64Le(amount))
witness.append(enc.blinding)
witness.append(0) // is_dummy = false
var pos = [UInt8](repeating: 0, count: 20)
pos[0] = 1
pos[1] = 1
pos[18] = 2
witness.append(contentsOf: pos)
for zh in zeroHashes {
    let z = hexToData(zh)
    witness.append(z)
    witness.append(z)
    witness.append(z)
}

// Input 1: dummy
witness.append(alice.spendSk)
witness.append(Data(repeating: 0, count: 32))
witness.append(wsolAsset)
witness.append(u64Le(0))
witness.append(u64Be32(0x5555))
witness.append(1) // is_dummy = true
witness.append(Data(repeating: 0, count: 20 + 20 * 3 * 32))

// Outputs 0, 1, 2
witness.append(hexToData(v.groth16.out0_stealth_owner_hex))
witness.append(wsolAsset)
witness.append(u64Le(1_000_000))
witness.append(u64Be32(0x201))

witness.append(hexToData(v.groth16.out1_stealth_owner_hex))
witness.append(wsolAsset)
witness.append(u64Le(500_000))
witness.append(u64Be32(0x202))

witness.append(Data(repeating: 0, count: 32))
witness.append(wsolAsset)
witness.append(u64Le(0))
witness.append(u64Be32(0x203))
precondition(witness.count == 4611)

let proved = try proveJoinsplitWitnessBytes(witness4611: witness, seed32: Data(repeating: 0x99, count: 32))
precondition(dataToHex(proved.proof192) == v.groth16.proof_192_hex)
precondition(dataToHex(proved.nf0) == v.groth16.nf0_hex)
precondition(dataToHex(proved.publicInputHash) == v.groth16.public_input_hash_hex)

let vaultWsolAta = try deriveAta(owner: vaultAuthPda, tokenProgram: classicTokenProg, mint: wsolMint)
let depIx = try buildDepositIx(params: FfiDepositParams(
    programId: pid,
    depositor: sess0.pubkeyB58,
    poolId: poolId,
    mint: wsolMint,
    sourceAccount: sess0.pubkeyB58,
    vaultAta: vaultWsolAta,
    tokenProg: classicTokenProg,
    laneId: 2,
    subPageSeq: 7,
    rootPageSeq: 7,
    memoPageSeq: 7,
    nextSubSeq: nil,
    nextMemoSeq: nil,
    nativeSol: true,
    feeFromAmount: true,
    amount: amount,
    stealthOwner: enc.stealthOwner,
    blinding: enc.blinding,
    memo106: enc.memo106,
    transferHookAccounts: []
))
let initRootsIx = try buildInitRootHistoryIx(
    programId: pid,
    authority: sess0.pubkeyB58,
    poolId: poolId,
    rootEpochInterval: v.root_history.default_epoch_interval,
    activeLanes: 4
)
let proof192 = proved.proof192
let rootRingIdx = UInt8(roots.epochCursor)
let txIx = try buildTransactIx(params: FfiTransactParams(
    programId: pid,
    payer: sess0.pubkeyB58,
    poolId: poolId,
    vkId: 0,
    rootRingKind: rootRingEpoch,
    rootRingIdx: rootRingIdx,
    outLaneId: 2,
    outSubSeq: 7,
    outRootSeq: 7,
    outMemoSeq: 7,
    outNfSeq: 7,
    nextSubSeq: nil,
    nextMemoSeq: nil,
    nextNfSeq: nil,
    outputMask: 0b001,
    assetMode: 0,
    unwrapWsol: false,
    publicMint: nil,
    publicVaultAta: nil,
    publicTokenProg: nil,
    proof192: proof192,
    nf0: proved.nf0,
    nf1: proved.nf1,
    cm0: proved.cm0,
    cm1: proved.cm1,
    cm2: proved.cm2,
    publicAmountOut: 0,
    relayerFeeAmount: 0,
    recipient: systemProgramId,
    relayerFeeRecipient: systemProgramId,
    memosBytes: enc.memo106,
    transferHookAccounts: []
))

print("[4/6 INSTRUCTIONS & GROTH16]")
print("  Deposit       : \(depIx.data.count) B (tag=\(depIx.data[0]), native_sol=true, fee_from_amount=true)")
print("  InitRootHist  : \(initRootsIx.data.count) B (tag=\(initRootsIx.data[0]), root_epoch_interval=\(v.root_history.default_epoch_interval), active_lanes=4)")
print("  Transact      : \(txIx.data.count) B (tag=\(txIx.data[0]), ring=\(rootRingEpoch):\(rootRingIdx), proof=\(proof192.count) B Groth16, 1 Tx v1)")
print("  ctx_hash priv : \(dataToHex(ctxPriv))")
print("  ctx_hash wsol : \(dataToHex(ctxWsol))")
print("  ctx_hash exec : \(dataToHex(ctxExec))")

// 5. DISCLOSURE & COMPLIANCE
let sd = FfiSelectiveDisclosureProof(
    poolId: 0,
    laneId: 2,
    leafIndex: 5,
    stealthOwner: enc.stealthOwner,
    mint: mintBytes,
    amount: amount,
    blinding: enc.blinding,
    commitment: cmBe
)
let sdOk = try verifySelectiveDisclosureProof(proof: sd, onchainSubtreeLeaf: cmBe)
precondition(sdOk)
let sdTampered = FfiSelectiveDisclosureProof(
    poolId: 0,
    laneId: 2,
    leafIndex: 5,
    stealthOwner: enc.stealthOwner,
    mint: mintBytes,
    amount: amount + 1,
    blinding: enc.blinding,
    commitment: cmBe
)
let sdTamperedOk = try verifySelectiveDisclosureProof(proof: sdTampered, onchainSubtreeLeaf: cmBe)
precondition(!sdTamperedOk)

print("[5/6 DISCLOSURE & COMPLIANCE]")
print("  Mode 1 proof  : verified against on-chain leaf (tampered rejected)")
print("  Mode 2 FVK    : read-only (spend_pk + nk + view_sk + view_pk, zero spend authority)")

// 6. RELAYER & ESCROW CPI
let escrowUsdcAta = try deriveAta(owner: escrow5Pda, tokenProgram: classicTokenProg, mint: usdcMint)
let escrowWsolAta = try deriveAta(owner: escrow5Pda, tokenProgram: classicTokenProg, mint: wsolMint)

print("[6/6 RELAYER & ESCROW CPI]")
print("  Default relay : \(defaultRelayUrl())")
print("  Escrow #5 ATAs: usdc=\(escrowUsdcAta), wsol=\(escrowWsolAta)")
print("  Excluded DEXes: \(jupiterCpiExcludedDexes().joined(separator: ","))")
