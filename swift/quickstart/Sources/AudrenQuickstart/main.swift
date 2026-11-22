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
private struct PdaVectors: Decodable {
    let nullifier_hex: String
}
private struct AssetIdVectors: Decodable {
    let native_sol_asset_id_hex: String
    let wsol_asset_id_hex: String
    let usdc_asset_id_hex: String
}
private struct MemoVector: Decodable {
    let eph_secret_hex: String
    let amount: UInt64
    let mint_hex: String
    let commitment_hex: String
    let memo_90_hex: String
}
private struct Groth16Vector: Decodable {
    let nf0_hex: String
    let nf1_hex: String
    let cm0_hex: String
    let cm1_hex: String
    let cm2_hex: String
    let proof_192_hex: String
}
private struct PoolStateVector: Decodable {
    let raw_hex: String
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
    let groth16: Groth16Vector
    let pool_state: PoolStateVector
    let checkpoint_raw_hex: String
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

private let audrenRepo = ProcessInfo.processInfo.environment["AUDREN_REPO_DIR"]
    ?? URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("audren").path
private let specUrl = URL(fileURLWithPath: audrenRepo).appendingPathComponent("spec/test-vectors.json")
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

print("[1/6 KEYS]")
print("  Program ID    : \(pid) (v\(protocolVersion()))")
print("  Alice aud1    : \(alice.address)")
print("  Subaccount #1 : \(aliceSub1.address)")
print("  DeFi Session 0: \(sess0.pubkeyB58)")
print("  FVK nk        : \(dataToHex(fvk.nk))")

// 2. PDAs & ZERO-COPY LAYOUTS
let poolPda = try derivePoolPda(programId: pid, poolId: poolId).address
let solVaultPda = try deriveSolVaultPda(programId: pid, poolId: poolId).address
let vaultAuthPda = try deriveVaultAuthPda(programId: pid, poolId: poolId).address
let lane2Pda = try deriveLanePda(programId: pid, poolId: poolId, laneId: 2).address
let escrow5Pda = try deriveEscrowPda(programId: pid, poolId: poolId, shardId: 5).address
let ps = try decodePoolStateAccount(data: hexToData(v.pool_state.raw_hex))
let ck = try decodeRootCheckpointAccount(data: hexToData(v.checkpoint_raw_hex))

print("[2/6 PDAs & LAYOUTS]")
print("  Pool #0 PDA   : \(poolPda) (active_lanes=\(ps.activeLanes), ckpt_interval=\(ps.ckptInterval))")
print("  SOL Vault     : \(solVaultPda)")
print("  Vault Auth    : \(vaultAuthPda)")
print("  Lane #2 PDA   : \(lane2Pda)")
print("  Escrow #5 PDA : \(escrow5Pda)")
print("  Checkpoint #13: slot_idx=\(ck.slotIdx), lane2_leaves=\(ck.laneCounts[2]), super_root=\(dataToHex(ck.superRoot))")

// 3. MEMOS & ZERO-INDEXER COMPACT STORE
let amount = v.memo.amount
let mintBytes = hexToData(v.memo.mint_hex)
let enc = try encryptNoteMemo(
    recipientSpendPk: alice.spendPk,
    recipientViewPk: alice.viewPk,
    ephSecret: hexToData(v.memo.eph_secret_hex),
    amount: amount,
    mint: mintBytes
)
let cmBe = hexToData(v.memo.commitment_hex)
guard let dec = try decryptAndVerifyMemoEntry(fvk: fvk, memo90: enc.memo90, onchainCommitment: cmBe) else {
    fatalError("FVK memo decrypt failed")
}
precondition(dec.amount == amount)

let nfSample = hexToData(v.pdas.nullifier_hex)
let nfPda = try deriveNullifierPda(programId: pid, poolId: poolId, nullifier: nfSample).address
let unwrapPda = try deriveUnwrapPda(programId: pid, poolId: poolId, nf0: nfSample).address
let storeJson = try compactStoreNewJson(poolId: poolId, birthdaySlot: 0)
precondition(!storeJson.isEmpty)

print("[3/6 MEMOS & COMPACT STORE]")
print("  Memo (90 B)   : \(dataToHex(enc.memo90).prefix(16))... -> decrypted \(dec.amount) lamports (Poseidon verified)")
print("  Nullifier PDA : \(nfPda)")
print("  Unwrap PDA    : \(unwrapPda)")
print("  CompactStore  : initialized (pool_id=\(poolId), indexer=none)")

// 4. BN254 GROTH16 & INSTRUCTIONS
let ctxPriv = try computeJoinsplitCtxHashFfi(params: FfiJoinSplitCtxHashParams(
    programId: pid,
    poolId: poolId,
    outLaneId: 2,
    outputMask: 0b111,
    assetMode: 0,
    unwrapWsol: false,
    recipient: nil,
    relayerFeeRecipient: nil,
    publicAssetId: Data(repeating: 0, count: 32),
    publicAmountOut: 0,
    relayerFeeAmount: 0,
    memosBytes: enc.memo90
))
let ctxWsol = try computeJoinsplitCtxHashFfi(params: FfiJoinSplitCtxHashParams(
    programId: pid,
    poolId: poolId,
    outLaneId: 2,
    outputMask: 0,
    assetMode: 2,
    unwrapWsol: true,
    recipient: sess0.pubkeyB58,
    relayerFeeRecipient: sess3.pubkeyB58,
    publicAssetId: hexToData(v.asset_ids.wsol_asset_id_hex),
    publicAmountOut: 1_000_000_000,
    relayerFeeAmount: 5_000_000,
    memosBytes: Data()
))
let dynM = try prepareDynamicSwapMemo(
    recipientViewPk: hexToData(v.bob.view_pk_hex),
    ephSecret: Data(repeating: 0x44, count: 32)
)
let ctxExec = try computeExecCtxHashFfi(params: FfiExecCtxHashParams(
    programId: pid,
    poolId: poolId,
    outLaneId: 1,
    escrowShard: 3,
    changeMask: 0b01,
    inKind: 1,
    outKind: 0,
    feeOnOutput: true,
    assetIn: hexToData(v.asset_ids.usdc_asset_id_hex),
    amountIn: 50_000_000,
    relayerFeeAmount: 2_000_000,
    relayerFeeRecipient: sess3.pubkeyB58,
    assetOut: hexToData(v.asset_ids.native_sol_asset_id_hex),
    minAmountOut: 400_000_000,
    routerProg: base58Encode32(0x77),
    routerAccounts: [
        FfiAccountMeta(pubkeyB58: base58Encode32(0x88), isSigner: false, isWritable: true),
        FfiAccountMeta(pubkeyB58: base58Encode32(0x99), isSigner: false, isWritable: false),
    ],
    outStealthOwner: enc.stealthOwner,
    outBlinding: enc.blinding,
    dynMemoHead: dynM.dynHead34,
    dynMask56: dynM.dynMask56,
    routerIxData: Data([1, 2, 3, 4]),
    changeMemos: enc.memo90
))

let depIx = try buildDepositSolIx(params: FfiDepositSolParams(
    programId: pid,
    depositor: sess0.pubkeyB58,
    poolId: poolId,
    laneId: 2,
    subPageSeq: 7,
    rootPageSeq: 7,
    memoPageSeq: 7,
    feeFromAmount: true,
    amount: amount,
    stealthOwner: enc.stealthOwner,
    blinding: enc.blinding,
    memo90: enc.memo90
))
let proof192 = hexToData(v.groth16.proof_192_hex)
let jsIx = try buildJoinsplitIx(params: FfiJoinSplitParams(
    programId: pid,
    payer: sess0.pubkeyB58,
    poolId: poolId,
    vkId: 0,
    ckptSlotIdx: 13,
    outLaneId: 2,
    outSubSeq: 7,
    outRootSeq: 7,
    outMemoSeq: 7,
    outNfSeq: 7,
    outputMask: 0b111,
    assetMode: 0,
    unwrapWsol: false,
    splMint: nil,
    splVaultAta: nil,
    splTokenProg: nil,
    proof192: proof192,
    nf0: hexToData(v.groth16.nf0_hex),
    nf1: hexToData(v.groth16.nf1_hex),
    cm0: hexToData(v.groth16.cm0_hex),
    cm1: hexToData(v.groth16.cm1_hex),
    cm2: hexToData(v.groth16.cm2_hex),
    publicAmountOut: 0,
    relayerFeeAmount: 0,
    recipient: systemProgramId,
    relayerFeeRecipient: systemProgramId,
    memosBytes: enc.memo90
))

print("[4/6 INSTRUCTIONS & GROTH16]")
print("  DepositSol    : \(depIx.data.count) B (tag=\(depIx.data[0]), fee_from_amount=true)")
print("  JoinSplit     : \(jsIx.data.count) B (tag=\(jsIx.data[0]), proof=\(proof192.count) B Groth16, 1 Tx v1)")
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
