import org.json.JSONObject
import xyz.audren.sdk.*
import java.io.File

/**
 * Audren Canonical 6-Building-Block Quickstart (Kotlin SDK — Android API 24+ / JVM 21+).
 *
 * Executes the exact same 6 building blocks mirrored across Rust, TypeScript, Swift, and Kotlin
 * using native `xyz.audren.sdk` backed by `crates/audren-ffi` (~50 ms native local ZK proving).
 *
 * Run (with sibling `../audren` built via `./scripts/build-mobile-sdks.sh bindings`):
 *   cd kotlin/quickstart && gradle run
 */
private fun hexToBytes(hex: String): ByteArray =
    ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }

private fun bytesToHex(bytes: ByteArray): String =
    bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }

fun main() {
    val audrenRepo = System.getenv("AUDREN_REPO_DIR")
        ?: File("../../../audren").canonicalPath
    val v = JSONObject(File("$audrenRepo/spec/test-vectors.json").readText())

    val aliceJson = v.getJSONObject("alice")
    val bobJson = v.getJSONObject("bob")
    val pdasJson = v.getJSONObject("pdas")
    val psJson = v.getJSONObject("pool_state")
    val epJson = v.getJSONObject("epoch_page")
    val audJson = v.getJSONObject("auditor")

    // 1. KEYS — Master keys, sub-account #1, aud1… address & read-only Full Viewing Key
    val pid = programId()
    val aliceSeed = hexToBytes(aliceJson.getString("seed_hex"))
    val alice = deriveKeysFromSeed(aliceSeed)
    val aliceSub1 = deriveSubaccountKeys(aliceSeed, 1u)
    val aliceFvk = exportFullViewingKey(aliceSeed, 0u)
    val parsed = parseAudrenAddress(alice.address)
    check(parsed.spendPk.contentEquals(alice.spendPk))

    println("[1/6 KEYS]")
    println("  Program ID    : $pid")
    println("  Alice aud1    : ${alice.address}")
    println("  Subaccount #1 : ${aliceSub1.address}")
    println("  FVK view_pk   : ${aliceFvk.viewPkB58}")

    // 2. PDAs & LAYOUTS — Canonical Pool #0 PDAs & binary decoders
    val poolPda = derivePoolPda(0u, pid)
    val page0Pda = deriveEpochPagePda(0u, 0uL, pid)
    val solVaultPda = deriveSolVaultPda(0u, pid)
    val escrow0Pda = deriveSwapEscrowPda(0u, 0u, pid)
    val poolState = decodePoolState(hexToBytes(psJson.getString("raw_hex")))
    val pageBytes = hexToBytes(epJson.getString("page_hex"))
    val hdr = decodeEpochPageHeader(pageBytes)

    println("[2/6 PDAs & LAYOUTS]")
    println("  Pool #0 PDA   : ${poolPda.address} (total_notes=${poolState.totalNotes})")
    println("  EpochPage #0  : ${page0Pda.address} (count=${hdr.count}/32)")
    println("  SOL Vault     : ${solVaultPda.address}")
    println("  Escrow #0     : ${escrow0Pda.address}")

    // 3. SCANNER — 1,056-byte dataSlice[64..1120] view-tag filter & note decryption
    val sliceCfg = pageScanDataSlice()
    val hits = scanPageDataslice(
        0uL,
        hexToBytes(epJson.getString("scan_slice_hex")),
        alice.spendPk,
        alice.viewSk,
    )
    check(hits.size == 1 && hits[0].toInt() == 5)
    val note = scanEpochPage(0u, pageBytes, alice.spendSk, alice.spendPk, alice.viewSk, pid).first()

    println("[3/6 SCANNER]")
    println("  dataSlice     : offset=${sliceCfg.offset}, length=${sliceCfg.length} B -> matched slot ${hits[0]}")
    println("  Owned note    : ${note.amount} lamports | NullifierPDA=${note.nullifierPda}")

    // 4. PROVER — Native ~50 ms Deposit, Transfer (m=5 Triptych + Bulletproofs U128), ProofBuffer & Withdraw
    val payer = pdasJson.getString("proof_buffer_authority")
    val bobAddr = bobJson.getString("address")

    val depIx = buildDepositInstruction(
        FfiDepositParams(
            programId = pid,
            depositor = payer,
            poolId = 0u,
            activePageId = 1uL,
            recipientAddress = bobAddr,
            mint32 = ByteArray(32),
            grossAmount = 500_000uL,
            netAmount = 500_000uL,
            tokenProgram = null,
            depositorAta = null,
            vaultAta = null,
        ),
    )
    val xferIx = buildTransferInstruction(
        FfiTransferParams(
            programId = pid,
            payer = payer,
            poolId = 0u,
            outPageId = 1uL,
            inputPageIds = listOf(0uL),
            inputPagesBytes = listOf(pageBytes),
            inputNote = note,
            secretIndex = note.slotIndex.toUInt(),
            recipientAddress = bobAddr,
            changeAddress = alice.address,
            payAmount = 900_000uL,
            auditorPk32 = null,
        ),
    )
    val bufPlan = buildBufferedExecutionPlan(42uL, xferIx)
    val wdIx = buildWithdrawInstruction(
        FfiWithdrawParams(
            programId = pid,
            payer = payer,
            poolId = 0u,
            outPageId = 1uL,
            inputPageIds = listOf(0uL),
            inputPagesBytes = listOf(pageBytes),
            inputNote = note,
            secretIndex = note.slotIndex.toUInt(),
            recipientAccount = payer,
            changeAddress = alice.address,
            amount = 1_000_000uL,
            splTokenProgram = null,
            auditorPk32 = null,
        ),
    )

    println("[4/6 PROVER]")
    println("  Deposit ix    : ${depIx.data.size} B (tag=${depIx.data[0]})")
    println("  Transfer m=5  : ${xferIx.data.size} B (tag=${xferIx.data[0]}, ProofBuffer chunks=${bufPlan.uploadChunks.size})")
    println("  Withdraw ix   : ${wdIx.data.size} B (tag=${wdIx.data[0]})")

    // 5. DISCLOSURE & AUDIT — Mode 1 Selective Disclosure + Institutional Auditor ElGamal decrypt
    val sd = createSelectiveDisclosureProof(note)
    check(verifySelectiveDisclosureProof(sd))
    check(verifySelectiveDisclosureOnPage(sd, pageBytes))
    check(!verifySelectiveDisclosureOnPage(sd.copy(amount = sd.amount + 1uL), pageBytes))

    val aud = deriveAuditorKeypair(hexToBytes(audJson.getString("auditor_seed_hex")))
    val dec = auditorDecryptNote(
        aud.auditorSk,
        hexToBytes(audJson.getString("elgamal_s1_hex")),
        hexToBytes(audJson.getString("elgamal_s2_hex")),
        hexToBytes(audJson.getString("elgamal_m1_hex")),
        hexToBytes(audJson.getString("elgamal_m2_hex")),
    )
    check(bytesToHex(dec.spentStealthPk) == audJson.getString("expected_spent_pk_hex"))
    check(bytesToHex(dec.assetGenerator) == audJson.getString("expected_asset_gen_hex"))

    println("[5/6 DISCLOSURE & AUDIT]")
    println("  Mode 1 proof  : verified standalone & on-page (tampered rejected)")
    println("  Auditor decrypt: spent stealth_pk & asset_generator verified")

    // 6. RELAYER & ROUTER
    println("[6/6 RELAYER & ROUTER]")
    println("  Default relay : ${defaultRelayUrl()}")
    println("  Excluded DEXes: ${jupiterCpiExcludedDexes().joinToString(",")}")
}
