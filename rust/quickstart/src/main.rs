//! Audren Canonical 6-Building-Block Quickstart (Rust SDK — `audren-client`).
//!
//! Runs completely offline (zero RPC required) and executes the exact same 6 building blocks
//! mirrored across the Rust, TypeScript, Swift (iOS), and Kotlin (Android) examples:
//!   1. Keys          — master spend/view keys, isolated sub-account #1, `aud1…` address, FVK
//!   2. PDAs & Layout — canonical Pool #0 PDAs, `PoolState` & `EpochPage` header decoding
//!   3. Scanner       — 1,056-byte `dataSlice[64..1120]` view-tag filter, read-only FVK & spendable decrypt
//!   4. Prover        — local `Deposit`, `Transfer (m=5)` Triptych + Bulletproofs, `ProofBuffer`, `CloseProofBuffer`, `Withdraw`
//!   5. Disclosure    — Mode 1 Selective Disclosure verify (+ tampered rejection) + Auditor ElGamal decrypt
//!   6. Relayer & DEX — `DEFAULT_RELAY_URL`, `prepare_router_accounts`, `JUPITER_CPI_EXCLUDED_DEXES`
//!
//! When `audren` is cloned beside `examples` (or `AUDREN_REPO_DIR` is set), loads the shared
//! `spec/test-vectors.json` fixture so stdout is 100% byte-for-byte identical across all 4 SDKs.
//! Otherwise synthesizes an equivalent offline fixture so `cargo run` always succeeds standalone.
//!
//! Run:
//!   cargo run --manifest-path rust/Cargo.toml -p audren-example-quickstart

use std::path::PathBuf;
use std::str::FromStr;

use audren_client::{
    instructions::{
        build_buffered_execution, build_close_proof_buffer, build_deposit, build_transfer,
        build_withdraw, extract_transfer_auditor_ciphertexts, AudrenAccountMeta,
    },
    keys::{
        prepare_shielded_note, AudrenAddress, AudrenKeys, AuditorKeypair,
        SelectiveDisclosureProof,
    },
    pda::{
        derive_ata, derive_epoch_page_pda, derive_escrow_pda, derive_pool_pda,
        derive_sol_vault_pda, derive_unwrap_pda,
    },
    prover::{asset_generator, extract_ring_from_page},
    router::{prepare_escrow_accounts, DEFAULT_RELAY_URL, JUPITER_CPI_EXCLUDED_DEXES},
    scanner::{decrypt_owned_note, scan_page_dataslice},
};
use audren_core::{
    layout::{
        write_page_note, PageHeader, PoolState, PAGE_CAPACITY, PAGE_LEN, PAGE_SCAN_LEN,
        PAGE_SCAN_OFFSET,
    },
    AUDREN_PROGRAM_ID, CLASSIC_TOKEN_PROGRAM_ID, NATIVE_SOL_MINT, PROTOCOL_VERSION,
};
use rand::{rngs::StdRng, SeedableRng};
use solana_address::Address;

const USDC_MINT_B58: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL_MINT_B58: &str = "So11111111111111111111111111111111111111112";

fn decode_hex(hex: &str) -> Vec<u8> {
    assert!(hex.len() % 2 == 0, "odd hex length");
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("valid hex byte"))
        .collect()
}

fn decode_hex_32(hex: &str) -> [u8; 32] {
    decode_hex(hex).try_into().expect("expected 32-byte hex")
}

fn find_vectors_path() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("AUDREN_REPO_DIR") {
        let p = PathBuf::from(dir).join("spec/test-vectors.json");
        if p.is_file() {
            return Some(p);
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for rel in [
        "../../../audren/spec/test-vectors.json",
        "../../audren/spec/test-vectors.json",
    ] {
        let p = manifest_dir.join(rel);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

struct Fixture {
    alice_seed: [u8; 32],
    bob_address: AudrenAddress,
    payer: Address,
    pool_total_notes: u64,
    page_bytes: Vec<u8>,
    scan_slice: Vec<u8>,
    auditor_seed: [u8; 32],
    elgamal_s1: [u8; 32],
    elgamal_s2: [u8; 32],
    elgamal_m1: [u8; 32],
    elgamal_m2: [u8; 32],
    expected_spent_pk: [u8; 32],
    expected_asset_gen: [u8; 32],
}

fn load_or_build_fixture(program_id: &Address, pool_id: u32, rng: &mut StdRng) -> Fixture {
    if let Some(path) = find_vectors_path() {
        let raw = std::fs::read_to_string(&path).expect("read spec/test-vectors.json");
        let v: serde_json::Value = serde_json::from_str(&raw).expect("parse spec/test-vectors.json");
        let pool_state = PoolState::decode(&decode_hex(v["pool_state"]["raw_hex"].as_str().unwrap()))
            .expect("decode PoolState");
        let page_bytes = decode_hex(v["epoch_page"]["page_hex"].as_str().unwrap());
        let scan_slice = decode_hex(v["epoch_page"]["scan_slice_hex"].as_str().unwrap());
        return Fixture {
            alice_seed: decode_hex_32(v["alice"]["seed_hex"].as_str().unwrap()),
            bob_address: AudrenAddress::from_str(v["bob"]["address"].as_str().unwrap()).unwrap(),
            payer: Address::from_str(v["pdas"]["proof_buffer_authority"].as_str().unwrap()).unwrap(),
            pool_total_notes: pool_state.total_notes,
            page_bytes,
            scan_slice,
            auditor_seed: decode_hex_32(v["auditor"]["auditor_seed_hex"].as_str().unwrap()),
            elgamal_s1: decode_hex_32(v["auditor"]["elgamal_s1_hex"].as_str().unwrap()),
            elgamal_s2: decode_hex_32(v["auditor"]["elgamal_s2_hex"].as_str().unwrap()),
            elgamal_m1: decode_hex_32(v["auditor"]["elgamal_m1_hex"].as_str().unwrap()),
            elgamal_m2: decode_hex_32(v["auditor"]["elgamal_m2_hex"].as_str().unwrap()),
            expected_spent_pk: decode_hex_32(v["auditor"]["expected_spent_pk_hex"].as_str().unwrap()),
            expected_asset_gen: decode_hex_32(
                v["auditor"]["expected_asset_gen_hex"].as_str().unwrap(),
            ),
        };
    }

    // Standalone offline fallback (when `examples` is cloned without sibling `../audren`).
    let alice_seed = [0x11u8; 32];
    let bob_seed = [0x22u8; 32];
    let auditor_seed = [0x99u8; 32];
    let alice = AudrenKeys::from_seed(&alice_seed);
    let bob = AudrenKeys::from_seed(&bob_seed);
    let auditor = AuditorKeypair::from_seed(&auditor_seed);
    let payer = Address::new_from_array([0x55u8; 32]);
    let (_, page0_bump) = derive_epoch_page_pda(program_id, pool_id, 0);

    let mut page_bytes = vec![0u8; PAGE_LEN];
    PageHeader {
        version: PROTOCOL_VERSION,
        bump: page0_bump,
        closed: true,
        count: PAGE_CAPACITY as u8,
        pool_id,
        page_id: 0,
        created_slot: 472_228_607,
        closed_slot: 472_228_900,
    }
    .encode(&mut page_bytes)
    .unwrap();

    for slot in 0..PAGE_CAPACITY {
        let recipient = if slot == 5 {
            alice.address()
        } else {
            bob.address()
        };
        let amount = if slot == 5 { 1_500_000 } else { 250_000 };
        let prepared =
            prepare_shielded_note(&recipient, NATIVE_SOL_MINT, amount, true, None, true, *b"QUICK00", rng)
                .unwrap();
        write_page_note(&mut page_bytes, slot, &prepared.entry).unwrap();
    }

    let note = decrypt_owned_note(
        &alice.full_viewing_key(),
        Some(&alice),
        program_id,
        pool_id,
        &page_bytes,
        5,
        None,
    )
    .unwrap()
    .unwrap();
    let ring = extract_ring_from_page(&page_bytes).unwrap();
    let (audited_ix, _, _) = build_transfer(
        *program_id,
        payer,
        pool_id,
        1,
        &[0],
        &ring,
        &note,
        5,
        &bob.address(),
        &alice.address(),
        900_000,
        Some(auditor.auditor_pk),
        &[],
        rng,
    )
    .unwrap();
    let (s1, s2, m1, m2) = extract_transfer_auditor_ciphertexts(&audited_ix.data).unwrap();
    let scan_slice = page_bytes[PAGE_SCAN_OFFSET..PAGE_SCAN_OFFSET + PAGE_SCAN_LEN].to_vec();

    Fixture {
        alice_seed,
        bob_address: bob.address(),
        payer,
        pool_total_notes: 128,
        page_bytes,
        scan_slice,
        auditor_seed,
        elgamal_s1: s1,
        elgamal_s2: s2,
        elgamal_m1: m1,
        elgamal_m2: m2,
        expected_spent_pk: note.stealth_pk,
        expected_asset_gen: asset_generator(&NATIVE_SOL_MINT),
    }
}

fn main() {
    let mut rng = StdRng::seed_from_u64(0x4155_4452_454E);
    let program_id = Address::new_from_array(AUDREN_PROGRAM_ID);
    let pool_id = 0u32;
    let fx = load_or_build_fixture(&program_id, pool_id, &mut rng);

    // 1. KEYS — Master keys, sub-account #1, DeFi Session B_0, aud1… address & read-only Full Viewing Key
    let alice = AudrenKeys::from_seed(&fx.alice_seed);
    let alice_sub1 = AudrenKeys::from_seed_subaccount(&fx.alice_seed, 1);
    let alice_session0 = AudrenKeys::derive_defi_session_keypair(&fx.alice_seed, 0);
    let alice_fvk = alice.full_viewing_key();
    let parsed: AudrenAddress = alice.address().to_string().parse().unwrap();
    assert_eq!(parsed.spend_pk, alice.spend_pk);

    println!("[1/6 KEYS]");
    println!("  Program ID    : {program_id}");
    println!("  Alice aud1    : {}", alice.address());
    println!("  Subaccount #1 : {}", alice_sub1.address());
    println!("  DeFi Session 0: {}", alice_session0.address);
    println!("  FVK view_pk   : {}", alice_fvk.to_export().view_pk_b58);

    // 2. PDAs & LAYOUTS — Canonical Pool #0 PDAs & binary decoders
    let (pool_pda, _) = derive_pool_pda(&program_id, pool_id);
    let (page0_pda, _) = derive_epoch_page_pda(&program_id, pool_id, 0);
    let (sol_vault_pda, _) = derive_sol_vault_pda(&program_id, pool_id);
    let (escrow0_pda, _) = derive_escrow_pda(&program_id, pool_id, 0);
    let hdr = PageHeader::decode(&fx.page_bytes).unwrap();

    println!("[2/6 PDAs & LAYOUTS]");
    println!("  Pool #0 PDA   : {pool_pda} (total_notes={})", fx.pool_total_notes);
    println!("  EpochPage #0  : {page0_pda} (count={}/{})", hdr.count, PAGE_CAPACITY);
    println!("  SOL Vault     : {sol_vault_pda}");
    println!("  Escrow #0     : {escrow0_pda}");

    // 3. SCANNER — 1,056-byte dataSlice[64..1120] view-tag filter, read-only FVK & spendable decrypt
    let hits = scan_page_dataslice(&alice_fvk, 0, &fx.scan_slice).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].slot_index, 5);

    let watch_only =
        decrypt_owned_note(&alice_fvk, None, &program_id, pool_id, &fx.page_bytes, 5, None)
            .unwrap()
            .expect("read-only FVK decrypt");
    assert!(watch_only.nullifier_pda.is_none());

    let note = decrypt_owned_note(
        &alice_fvk,
        Some(&alice),
        &program_id,
        pool_id,
        &fx.page_bytes,
        5,
        None,
    )
    .unwrap()
    .expect("spendable Alice note");
    let (unwrap_pda, _) = derive_unwrap_pda(&program_id, pool_id, &note.nullifier.unwrap());

    println!("[3/6 SCANNER]");
    println!(
        "  dataSlice     : offset={PAGE_SCAN_OFFSET}, length={PAGE_SCAN_LEN} B -> matched slot {}",
        hits[0].slot_index
    );
    println!(
        "  Read-only FVK : {} lamports | NullifierPDA=none",
        watch_only.amount
    );
    println!(
        "  Spendable note: {} lamports | NullifierPDA={}",
        note.amount,
        note.nullifier_pda.unwrap()
    );
    println!("  Unwrap PDA    : {unwrap_pda}");

    // 4. PROVER — Deposit, Transfer (m=5 Triptych + Bulletproofs U128), ProofBuffer, CloseProofBuffer & Withdraw
    let ring = extract_ring_from_page(&fx.page_bytes).unwrap();
    let (dep_ix, _) = build_deposit(
        program_id,
        fx.payer,
        pool_id,
        1,
        &fx.bob_address,
        NATIVE_SOL_MINT,
        500_000,
        None,
        &mut rng,
    )
    .unwrap();
    let (xfer_ix, _, _) = build_transfer(
        program_id,
        fx.payer,
        pool_id,
        1,
        &[0],
        &ring,
        &note,
        5,
        &fx.bob_address,
        &alice.address(),
        900_000,
        None,
        &[],
        &mut rng,
    )
    .unwrap();
    let buf_plan = build_buffered_execution(&xfer_ix, 42).unwrap();
    let close_buf_ix = build_close_proof_buffer(program_id, fx.payer, 42);
    let (wd_ix, _) = build_withdraw(
        program_id,
        fx.payer,
        pool_id,
        1,
        &[0],
        &ring,
        &note,
        5,
        fx.payer,
        &alice.address(),
        1_000_000,
        None,
        None,
        &mut rng,
    )
    .unwrap();

    assert_eq!(dep_ix.data.len(), 139);
    assert_eq!(xfer_ix.data.len(), 2373);
    assert_eq!(close_buf_ix.data.len(), 1);
    assert_eq!(wd_ix.data.len(), 1973);

    println!("[4/6 PROVER]");
    println!("  Deposit ix    : {} B (tag={})", dep_ix.data.len(), dep_ix.data[0]);
    println!(
        "  Transfer m=5  : {} B (tag={}, ProofBuffer chunks={}, CloseProofBuffer={} B)",
        xfer_ix.data.len(),
        xfer_ix.data[0],
        buf_plan.upload_chunks.len(),
        close_buf_ix.data.len()
    );
    println!("  Withdraw ix   : {} B (tag={})", wd_ix.data.len(), wd_ix.data[0]);

    // 5. DISCLOSURE & AUDIT — Mode 1 Selective Disclosure + Institutional Auditor ElGamal decrypt
    let mut sd = SelectiveDisclosureProof::from_owned_note(&note);
    assert!(sd.verify().unwrap());
    assert!(sd.verify_against_page(&fx.page_bytes).unwrap());
    sd.amount += 1;
    assert!(!sd.verify_against_page(&fx.page_bytes).unwrap());

    let auditor = AuditorKeypair::from_seed(&fx.auditor_seed);
    assert_eq!(
        auditor.decrypt_spent_pubkey(&fx.elgamal_s1, &fx.elgamal_s2).unwrap(),
        fx.expected_spent_pk
    );
    assert_eq!(
        auditor.decrypt_asset_generator(&fx.elgamal_m1, &fx.elgamal_m2).unwrap(),
        fx.expected_asset_gen
    );

    println!("[5/6 DISCLOSURE & AUDIT]");
    println!("  Mode 1 proof  : verified standalone & on-page (tampered rejected)");
    println!("  Auditor decrypt: spent stealth_pk & asset_generator verified");

    // 6. RELAYER & ESCROW CPI — Unified cross-SDK prepare_escrow_accounts & DEFAULT_RELAY_URL
    let token_prog = Address::new_from_array(CLASSIC_TOKEN_PROGRAM_ID);
    let usdc_mint = Address::from_str(USDC_MINT_B58).unwrap();
    let wsol_mint = Address::from_str(WSOL_MINT_B58).unwrap();
    let escrow_in_ata = derive_ata(&escrow0_pda, &token_prog, &usdc_mint);
    let escrow_out_ata = derive_ata(&escrow0_pda, &token_prog, &wsol_mint);
    let prepared = prepare_escrow_accounts(
        &program_id,
        pool_id,
        0,
        &usdc_mint,
        &wsol_mint,
        &token_prog,
        &token_prog,
        &[
            AudrenAccountMeta { pubkey: escrow_in_ata, is_signer: false, is_writable: true },
            AudrenAccountMeta { pubkey: escrow_out_ata, is_signer: false, is_writable: true },
            AudrenAccountMeta { pubkey: escrow0_pda, is_signer: true, is_writable: false },
        ],
    )
    .unwrap();
    let outer_signers = prepared.accounts.iter().filter(|a| a.is_signer).count();
    assert_eq!((prepared.escrow_idx, prepared.escrow_in_idx, prepared.escrow_out_idx), (2, 0, 1));
    assert_eq!(outer_signers, 0);

    println!("[6/6 RELAYER & ESCROW CPI]");
    println!("  Default relay : {DEFAULT_RELAY_URL}");
    println!(
        "  Escrow CPI    : idx={}, in={}, out={} (outer signers={outer_signers})",
        prepared.escrow_idx, prepared.escrow_in_idx, prepared.escrow_out_idx
    );
    println!("  Excluded DEXes: {JUPITER_CPI_EXCLUDED_DEXES}");
}
