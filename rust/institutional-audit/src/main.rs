//! Audren Example 2 — Institutional Auditability (`PoolMode::InstitutionalAudited`) & Selective Disclosure.
//!
//! Runs completely offline (zero RPC required) using ONLY official `audren-client` SDK helpers
//! (zero hand-sliced instruction bytes, zero manual ring construction, zero manual receipt encoding):
//! 1. Generating a verifiable `InstitutionalAudited` transfer proof containing ElGamal
//!    ciphertexts `(S_1, S_2)` (encrypting spent note `P_l`) and `(M_1, M_2)` (encrypting `G_mint`)
//!    bound mathematically inside the on-chain Triptych + DLEQ verification equations
//! 2. Extracting `(S_1, S_2, M_1, M_2)` via `extract_transfer_auditor_ciphertexts` and decrypting
//!    the exact spent note pubkey `P_l` and exact hidden mint `G_mint` using `AuditorKeypair`
//! 3. Generating and independently verifying a Mode 1 per-transaction `SelectiveDisclosureProof`
//!    (both standalone and anchored on-page, plus verifying tampered receipts are rejected)
//!    without revealing the user's spending key or viewing key for any other transaction
//!
//! Run:
//! ```bash
//! cargo run --manifest-path rust/Cargo.toml -p audren-example-institutional-audit
//! ```

use audren_client::{
    instructions::{build_transfer, extract_transfer_auditor_ciphertexts},
    keys::{prepare_shielded_note, AudrenKeys, AuditorKeypair, SelectiveDisclosureProof},
    prover::{asset_generator, extract_ring_from_page},
    scanner::{decrypt_owned_note, OwnedNote},
};
use audren_core::{
    instruction::triptych_proof_len,
    layout::{write_page_note, PageHeader, PAGE_LEN},
    AUDREN_PROGRAM_ID, NATIVE_SOL_MINT, PROTOCOL_VERSION,
};
use rand::{rngs::StdRng, SeedableRng};
use solana_address::Address;

fn main() {
    let mut rng = StdRng::seed_from_u64(0xA0D1_7001);
    let program_id = Address::new_from_array(AUDREN_PROGRAM_ID);
    let payer = Address::new_from_array([0x11; 32]);
    let pool_id = 1u32;

    // 1. Setup Alice, Bob, and Institutional Compliance Auditor
    let alice = AudrenKeys::from_seed(&[0xAA; 32]);
    let bob = AudrenKeys::from_seed(&[0xBB; 32]);
    let auditor = AuditorKeypair::from_seed(&[0xCC; 32]);

    // 2. Construct an EpochPage with Alice's shielded 250 USDC note in slot 0
    //    (using Solana Mainnet USDC mint address)
    let usdc_mint: [u8; 32] = Address::from_str_const("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
        .to_bytes();
    let prepared = prepare_shielded_note(
        &alice.address(),
        usdc_mint,
        250_000_000, // 250.00 USDC
        true,
        None,
        true,
        *b"INV-042",
        &mut rng,
    )
    .unwrap();

    let mut page_bytes = vec![0u8; PAGE_LEN];
    PageHeader {
        version: PROTOCOL_VERSION,
        bump: 255,
        closed: false,
        count: 1,
        pool_id,
        page_id: 0,
        created_slot: 1,
        closed_slot: 0,
    }
    .encode(&mut page_bytes)
    .unwrap();
    write_page_note(&mut page_bytes, 0, &prepared.entry).unwrap();

    // Recover Alice's OwnedNote via standard SDK decryption
    let alice_note: OwnedNote = decrypt_owned_note(
        &alice.full_viewing_key(),
        Some(&alice),
        &program_id,
        pool_id,
        &page_bytes,
        0,
        None,
    )
    .unwrap()
    .expect("decrypt Alice USDC note");

    // 3. Build an InstitutionalAudited Transfer (100 USDC -> Bob, 150 USDC change -> Alice)
    let ring = extract_ring_from_page(&page_bytes).unwrap();
    let (xfer_ix, note_pay, _note_chg) = build_transfer(
        program_id,
        payer,
        pool_id,
        0,
        &[0],
        &ring,
        &alice_note,
        0,
        &bob.address(),
        &alice.address(),
        100_000_000,
        Some(auditor.auditor_pk),
        &[],
        &mut rng,
    )
    .unwrap();

    // 4. Extract `(S_1, S_2, M_1, M_2)` via official SDK parser and decrypt with `AuditorKeypair`
    let (s1, s2, m1, m2) = extract_transfer_auditor_ciphertexts(&xfer_ix.data)
        .expect("extract audited transfer ciphertexts");
    let base_triptych_len = triptych_proof_len(5, false).unwrap();
    let full_triptych_len = triptych_proof_len(5, true).unwrap();

    let decrypted_pk = auditor.decrypt_spent_pubkey(&s1, &s2).unwrap();
    let decrypted_mint_gen = auditor.decrypt_asset_generator(&m1, &m2).unwrap();
    assert_eq!(decrypted_pk, prepared.entry.stealth_pk);
    assert_eq!(decrypted_mint_gen, asset_generator(&usdc_mint));
    assert_ne!(decrypted_mint_gen, asset_generator(&NATIVE_SOL_MINT));

    println!("[AUDITOR DECRYPTION VERIFIED]");
    println!(
        "  Audited Triptych size : {} B (base {} B + {} B ElGamal extension)",
        full_triptych_len,
        base_triptych_len,
        full_triptych_len - base_triptych_len
    );
    println!("  Recovered spent P_l   : matches Alice's slot-0 stealth pubkey 100%");
    println!("  Recovered hidden mint : matches USDC generator G_USDC (not SOL)");

    // 5. Mode 1 Selective Disclosure Proof (Alice proves Bob received 100 USDC without exposing any other tx!)
    write_page_note(&mut page_bytes, 1, &note_pay.entry).unwrap();
    let mut disclosure = SelectiveDisclosureProof::from_prepared_note(0, 1, &note_pay);
    assert!(disclosure.verify().unwrap(), "standalone selective disclosure must verify");
    assert!(
        disclosure.verify_against_page(&page_bytes).unwrap(),
        "on-page selective disclosure must verify"
    );

    // Tampered amount must be rejected
    disclosure.amount += 1;
    assert!(
        !disclosure.verify_against_page(&page_bytes).unwrap(),
        "tampered selective disclosure must be rejected"
    );

    println!("[SELECTIVE DISCLOSURE VERIFIED]");
    println!(
        "  Third-party verified 100.00 USDC payment to stealth note {} (standalone + on-page, tampered rejected) with ZERO key exposure!",
        disclosure.stealth_pk_b58
    );
}
