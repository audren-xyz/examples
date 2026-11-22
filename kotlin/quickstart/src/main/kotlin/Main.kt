import org.json.JSONObject
import xyz.audren.sdk.*
import java.io.File

private fun hexToBytes(hex: String): ByteArray =
    ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }

private fun bytesToHex(bytes: ByteArray): String =
    bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }

private fun base58Encode32(byteVal: Int): String {
    val alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    val digits = mutableListOf(0)
    repeat(32) {
        var carry = byteVal and 0xff
        for (j in digits.indices) {
            carry += digits[j] shl 8
            digits[j] = carry % 58
            carry /= 58
        }
        while (carry > 0) {
            digits.add(carry % 58)
            carry /= 58
        }
    }
    return digits.reversed().map { alphabet[it] }.joinToString("")
}

private const val CLASSIC_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
private const val USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
private const val WSOL_MINT = "So11111111111111111111111111111111111111112"
private const val SYSTEM_PROGRAM_ID = "11111111111111111111111111111111"

fun main() {
    val audrenRepo = System.getenv("AUDREN_REPO_DIR")
        ?: File("../../../audren").canonicalPath
    val v = JSONObject(File("$audrenRepo/spec/test-vectors.json").readText())

    val pid = canonicalProgramId()
    val poolId = 0u

    // 1. KEYS & COMPLIANCE
    val aliceJson = v.getJSONObject("alice")
    val aliceSeed = hexToBytes(aliceJson.getString("seed_hex"))
    val alice = deriveKeysFromSeed(aliceSeed)
    val aliceSub1 = deriveSubaccountKeys(aliceSeed, 1u)
    val sess0 = deriveDefiSessionKeypair(aliceSeed, 0u)
    val sess3 = deriveDefiSessionKeypair(aliceSeed, 3u)
    val fvk = exportFullViewingKey(aliceSeed)
    val decodedAddr = decodeAudrenAddress(alice.address)
    check(bytesToHex(decodedAddr[0]) == aliceJson.getString("spend_pk_hex"))

    println("[1/6 KEYS]")
    println("  Program ID    : $pid (v${protocolVersion()})")
    println("  Alice aud1    : ${alice.address}")
    println("  Subaccount #1 : ${aliceSub1.address}")
    println("  DeFi Session 0: ${sess0.pubkeyB58}")
    println("  FVK nk        : ${bytesToHex(fvk.nk)}")

    // 2. PDAs & ZERO-COPY LAYOUTS
    val poolPda = derivePoolPda(pid, poolId).address
    val solVaultPda = deriveSolVaultPda(pid, poolId).address
    val vaultAuthPda = deriveVaultAuthPda(pid, poolId).address
    val lane2Pda = deriveLanePda(pid, poolId, 2u).address
    val escrow5Pda = deriveEscrowPda(pid, poolId, 5u).address
    val ps = decodePoolStateAccount(hexToBytes(v.getJSONObject("pool_state").getString("raw_hex")))
    val ck = decodeRootCheckpointAccount(hexToBytes(v.getString("checkpoint_raw_hex")))

    println("[2/6 PDAs & LAYOUTS]")
    println("  Pool #0 PDA   : $poolPda (active_lanes=${ps.activeLanes}, ckpt_interval=${ps.ckptInterval})")
    println("  SOL Vault     : $solVaultPda")
    println("  Vault Auth    : $vaultAuthPda")
    println("  Lane #2 PDA   : $lane2Pda")
    println("  Escrow #5 PDA : $escrow5Pda")
    println("  Checkpoint #13: slot_idx=${ck.slotIdx}, lane2_leaves=${ck.laneCounts[2]}, super_root=${bytesToHex(ck.superRoot)}")

    // 3. MEMOS & ZERO-INDEXER COMPACT STORE
    val memoJson = v.getJSONObject("memo")
    val amount = memoJson.getLong("amount").toULong()
    val mintBytes = hexToBytes(memoJson.getString("mint_hex"))
    val enc = encryptNoteMemo(
        alice.spendPk,
        alice.viewPk,
        hexToBytes(memoJson.getString("eph_secret_hex")),
        amount,
        mintBytes
    )
    val cmBe = hexToBytes(memoJson.getString("commitment_hex"))
    val dec = decryptAndVerifyMemoEntry(fvk, enc.memo90, cmBe)
        ?: error("FVK memo decrypt failed")
    check(dec.amount == amount)

    val nfSample = hexToBytes(v.getJSONObject("pdas").getString("nullifier_hex"))
    val nfPda = deriveNullifierPda(pid, poolId, nfSample).address
    val unwrapPda = deriveUnwrapPda(pid, poolId, nfSample).address
    val storeJson = compactStoreNewJson(poolId, 0uL)
    check(storeJson.isNotEmpty())

    println("[3/6 MEMOS & COMPACT STORE]")
    println("  Memo (90 B)   : ${bytesToHex(enc.memo90).substring(0, 16)}... -> decrypted ${dec.amount} lamports (Poseidon verified)")
    println("  Nullifier PDA : $nfPda")
    println("  Unwrap PDA    : $unwrapPda")
    println("  CompactStore  : initialized (pool_id=$poolId, indexer=none)")

    // 4. BN254 GROTH16 & INSTRUCTIONS
    val assetIds = v.getJSONObject("asset_ids")
    val ctxPriv = computeJoinsplitCtxHashFfi(
        FfiJoinSplitCtxHashParams(
            programId = pid,
            poolId = poolId,
            outLaneId = 2u,
            outputMask = 7u,
            assetMode = 0u,
            unwrapWsol = false,
            recipient = null,
            relayerFeeRecipient = null,
            publicAssetId = ByteArray(32),
            publicAmountOut = 0uL,
            relayerFeeAmount = 0uL,
            memosBytes = enc.memo90
        )
    )
    val ctxWsol = computeJoinsplitCtxHashFfi(
        FfiJoinSplitCtxHashParams(
            programId = pid,
            poolId = poolId,
            outLaneId = 2u,
            outputMask = 0u,
            assetMode = 2u,
            unwrapWsol = true,
            recipient = sess0.pubkeyB58,
            relayerFeeRecipient = sess3.pubkeyB58,
            publicAssetId = hexToBytes(assetIds.getString("wsol_asset_id_hex")),
            publicAmountOut = 1_000_000_000uL,
            relayerFeeAmount = 5_000_000uL,
            memosBytes = ByteArray(0)
        )
    )
    val dynM = prepareDynamicSwapMemo(
        hexToBytes(v.getJSONObject("bob").getString("view_pk_hex")),
        ByteArray(32) { 0x44 }
    )
    val ctxExec = computeExecCtxHashFfi(
        FfiExecCtxHashParams(
            programId = pid,
            poolId = poolId,
            outLaneId = 1u,
            escrowShard = 3u,
            changeMask = 1u,
            inKind = 1u,
            outKind = 0u,
            feeOnOutput = true,
            assetIn = hexToBytes(assetIds.getString("usdc_asset_id_hex")),
            amountIn = 50_000_000uL,
            relayerFeeAmount = 2_000_000uL,
            relayerFeeRecipient = sess3.pubkeyB58,
            assetOut = hexToBytes(assetIds.getString("native_sol_asset_id_hex")),
            minAmountOut = 400_000_000uL,
            routerProg = base58Encode32(0x77),
            routerAccounts = listOf(
                FfiAccountMeta(base58Encode32(0x88), false, true),
                FfiAccountMeta(base58Encode32(0x99), false, false)
            ),
            outStealthOwner = enc.stealthOwner,
            outBlinding = enc.blinding,
            dynMemoHead = dynM.dynHead34,
            dynMask56 = dynM.dynMask56,
            routerIxData = byteArrayOf(1, 2, 3, 4),
            changeMemos = enc.memo90
        )
    )

    // Real 192-byte BN254 Groth16 proof via native UniFFI `proveJoinsplitWitnessBytes`
    val zeroHashes = listOf(
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
        "16e195c570f224cc86219527096fa55516cc9ee1b96764dd263db0884983fdaf"
    )
    fun u64Le(x: Long): ByteArray = ByteArray(8) { i -> ((x ushr (i * 8)) and 0xff).toByte() }
    fun u64Be32(x: Long): ByteArray = ByteArray(32).also { b ->
        for (i in 0 until 8) b[24 + i] = ((x ushr ((7 - i) * 8)) and 0xff).toByte()
    }
    val g16 = v.getJSONObject("groth16")
    val solAsset = hexToBytes(assetIds.getString("native_sol_asset_id_hex"))
    val w = java.io.ByteArrayOutputStream(4611)
    w.write(hexToBytes(g16.getString("super_root_hex")))
    w.write(solAsset)
    w.write(ByteArray(32))
    w.write(u64Le(0L))
    w.write(u64Le(0L))
    w.write(ctxPriv)
    w.write(1) // omit_nf1 = true

    // Input 0: real note at lane 2, leaf 5
    w.write(alice.spendSk)
    w.write(enc.tweak)
    w.write(solAsset)
    w.write(u64Le(memoJson.getLong("amount")))
    w.write(enc.blinding)
    w.write(0) // is_dummy = false
    val pos = ByteArray(20)
    pos[0] = 1
    pos[1] = 1
    pos[18] = 2
    w.write(pos)
    for (zh in zeroHashes) {
        val z = hexToBytes(zh)
        repeat(3) { w.write(z) }
    }

    // Input 1: dummy
    w.write(alice.spendSk)
    w.write(ByteArray(32))
    w.write(solAsset)
    w.write(u64Le(0L))
    w.write(u64Be32(0x5555L))
    w.write(1) // is_dummy = true
    w.write(ByteArray(20 + 20 * 3 * 32))

    // Outputs 0, 1, 2
    w.write(hexToBytes("297407e33a8667d5d8235b00a22b34f66113f3d1b9c5486704f12647a0ee1041"))
    w.write(solAsset)
    w.write(u64Le(1_000_000L))
    w.write(u64Be32(0x201L))

    w.write(hexToBytes("20944e988ecb9bf1ad2edbbc8b782ff1695fcd197058948fdf9ef6426fa55528"))
    w.write(solAsset)
    w.write(u64Le(500_000L))
    w.write(u64Be32(0x202L))

    w.write(ByteArray(32))
    w.write(solAsset)
    w.write(u64Le(0L))
    w.write(u64Be32(0x203L))

    val witnessBytes = w.toByteArray()
    check(witnessBytes.size == 4611)
    val proved = proveJoinsplitWitnessBytes(witnessBytes, ByteArray(32) { 0x99.toByte() })
    check(bytesToHex(proved.proof192) == g16.getString("proof_192_hex"))
    check(bytesToHex(proved.nf0) == g16.getString("nf0_hex"))
    check(bytesToHex(proved.publicInputHash) == g16.getString("public_input_hash_hex"))

    val depIx = buildDepositSolIx(
        FfiDepositSolParams(
            programId = pid,
            depositor = sess0.pubkeyB58,
            poolId = poolId,
            laneId = 2u,
            subPageSeq = 7uL,
            rootPageSeq = 7uL,
            memoPageSeq = 7uL,
            feeFromAmount = true,
            amount = amount,
            stealthOwner = enc.stealthOwner,
            blinding = enc.blinding,
            memo90 = enc.memo90
        )
    )
    val proof192 = proved.proof192
    val jsIx = buildJoinsplitIx(
        FfiJoinSplitParams(
            programId = pid,
            payer = sess0.pubkeyB58,
            poolId = poolId,
            vkId = 0u,
            ckptSlotIdx = 13u,
            outLaneId = 2u,
            outSubSeq = 7uL,
            outRootSeq = 7uL,
            outMemoSeq = 7uL,
            outNfSeq = 7uL,
            outputMask = 7u,
            assetMode = 0u,
            unwrapWsol = false,
            splMint = null,
            splVaultAta = null,
            splTokenProg = null,
            proof192 = proof192,
            nf0 = proved.nf0,
            nf1 = proved.nf1,
            cm0 = proved.cm0,
            cm1 = proved.cm1,
            cm2 = proved.cm2,
            publicAmountOut = 0uL,
            relayerFeeAmount = 0uL,
            recipient = SYSTEM_PROGRAM_ID,
            relayerFeeRecipient = SYSTEM_PROGRAM_ID,
            memosBytes = enc.memo90
        )
    )

    println("[4/6 INSTRUCTIONS & GROTH16]")
    println("  DepositSol    : ${depIx.data.size} B (tag=${depIx.data[0].toInt() and 0xff}, fee_from_amount=true)")
    println("  JoinSplit     : ${jsIx.data.size} B (tag=${jsIx.data[0].toInt() and 0xff}, proof=${proof192.size} B Groth16, 1 Tx v1)")
    println("  ctx_hash priv : ${bytesToHex(ctxPriv)}")
    println("  ctx_hash wsol : ${bytesToHex(ctxWsol)}")
    println("  ctx_hash exec : ${bytesToHex(ctxExec)}")

    // 5. DISCLOSURE & COMPLIANCE
    val sd = FfiSelectiveDisclosureProof(
        poolId = 0u,
        laneId = 2u,
        leafIndex = 5uL,
        stealthOwner = enc.stealthOwner,
        mint = mintBytes,
        amount = amount,
        blinding = enc.blinding,
        commitment = cmBe
    )
    check(verifySelectiveDisclosureProof(sd, cmBe))
    check(!verifySelectiveDisclosureProof(sd.copy(amount = amount + 1uL), cmBe))

    println("[5/6 DISCLOSURE & COMPLIANCE]")
    println("  Mode 1 proof  : verified against on-chain leaf (tampered rejected)")
    println("  Mode 2 FVK    : read-only (spend_pk + nk + view_sk + view_pk, zero spend authority)")

    // 6. RELAYER & ESCROW CPI
    val escrowUsdcAta = deriveAta(escrow5Pda, CLASSIC_TOKEN_PROGRAM, USDC_MINT)
    val escrowWsolAta = deriveAta(escrow5Pda, CLASSIC_TOKEN_PROGRAM, WSOL_MINT)

    println("[6/6 RELAYER & ESCROW CPI]")
    println("  Default relay : ${defaultRelayUrl()}")
    println("  Escrow #5 ATAs: usdc=$escrowUsdcAta, wsol=$escrowWsolAta")
    println("  Excluded DEXes: ${jupiterCpiExcludedDexes().joinToString(",")}")
}
