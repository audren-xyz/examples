//! Audren Example 2 — Institutional Auditability (`PoolMode::InstitutionalAudited`) & Selective Disclosure.
//!
//! Runs completely offline (zero RPC required) to demonstrate:
//! 1. Generating a verifiable `InstitutionalAudited` transfer proof containing ElGamal
//!    ciphertexts `(S_1, S_2)` (encrypting spent note `P_l`) and `(M_1, M_2)` (encrypting `G_mint`)
//!    bound mathematically inside the on-chain Triptych + DLEQ verification equations
//! 2. Decrypting the exact spent note pubkey `P_l` and exact hidden mint `G_mint` using `AuditorKeypair`
//! 3. Generating and independently verifying a Mode 1 per-transaction `SelectiveDisclosureProof`
//!    without revealing the user's spending key or viewing key for any other transaction
//!
//! Run:
//! ```bash
//! cargo run --manifest-path rust/Cargo.toml -p audren-example-institutional-audit
//! ```

use audren_client::{
    instructions::build_transfer,
    keys::{prepare_shielded_note, AudrenKeys, AuditorKeypair, SelectiveDisclosureProof},
    prover::{asset_generator, RingSlotWitness, IDENTITY},
    scanner::{decrypt_owned_note, OwnedNote},
};
use audren_core::{
    instruction::{triptych_proof_len, AUDITOR_ASSET_PROOF_LEN, NOTE_WIRE_LEN},
    layout::{write_page_note, PageHeader, PAGE_CAPACITY, PAGE_LEN},
    AUDREN_PROGRAM_ID, NATIVE_SOL_MINT,
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
    let hdr = PageHeader {
        version: 1,
        bump: 255,
        closed: false,
        count: 1,
        pool_id,
        page_id: 0,
        created_slot: 1,
        closed_slot: 0,
    };
    hdr.encode(&mut page_bytes).unwrap();
    write_page_note(&mut page_bytes, 0, &prepared.entry).unwrap();

    // Recover Alice's OwnedNote via standard decryption
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
    let mut ring = Vec::with_capacity(PAGE_CAPACITY);
    ring.push(RingSlotWitness {
        stealth_pk: prepared.entry.stealth_pk,
        asset_tag: prepared.entry.asset_tag,
        commitment: prepared.entry.commitment,
    });
    for _ in 1..PAGE_CAPACITY {
        ring.push(RingSlotWitness {
            stealth_pk: IDENTITY,
            asset_tag: IDENTITY,
            commitment: IDENTITY,
        });
    }

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

    // 4. Parse `(S_1, S_2)` from the Triptych audited extension and `(M_1, M_2)` from the auditor asset proof
    // Wire layout of Transfer (`xfer_ix.data`):
    // tag(1) | m(1) | pay_note(193) | chg_note(193) | c_pay(32) | c_chg(32) |
    // triptych(1345) | cross_base_2(256) | range_u128(736) | pq_len(2) | pq_env(0) | auditor_asset(192)
    let triptych_off = 2 + 2 * NOTE_WIRE_LEN + 64;
    let base_triptych_len = triptych_proof_len(5, false).unwrap();
    let full_triptych_len = triptych_proof_len(5, true).unwrap();
    let s1: [u8; 32] = xfer_ix.data[triptych_off + base_triptych_len..triptych_off + base_triptych_len + 32]
        .try_into()
        .unwrap();
    let s2: [u8; 32] =
        xfer_ix.data[triptych_off + base_triptych_len + 32..triptych_off + base_triptych_len + 64]
            .try_into()
            .unwrap();

    let auditor_asset_off = xfer_ix.data.len() - AUDITOR_ASSET_PROOF_LEN;
    let m1: [u8; 32] = xfer_ix.data[auditor_asset_off..auditor_asset_off + 32].try_into().unwrap();
    let m2: [u8; 32] = xfer_ix.data[auditor_asset_off + 32..auditor_asset_off + 64].try_into().unwrap();

    let decrypted_pk = auditor.decrypt_spent_pubkey(&s1, &s2).unwrap();
    let decrypted_mint_gen = auditor.decrypt_asset_generator(&m1, &m2).unwrap();
    assert_eq!(decrypted_pk, prepared.entry.stealth_pk);
    assert_eq!(decrypted_mint_gen, asset_generator(&usdc_mint));
    assert_ne!(decrypted_mint_gen, asset_generator(&NATIVE_SOL_MINT));

    println!("[AUDITOR DECRYPTION VERIFIED]");
    println!("  Audited Triptych size : {} B (base {} B + 416 B ElGamal extension)", full_triptych_len, base_triptych_len);
    println!("  Recovered spent P_l   : matches Alice's slot-0 stealth pubkey 100%");
    println!("  Recovered hidden mint : matches USDC generator G_USDC (not SOL)");

    // 5. Mode 1 Selective Disclosure Proof (Alice proves Bob received 100 USDC without exposing any other tx!)
    let disclosure = SelectiveDisclosureProof {
        version: 1,
        page_id: 0,
        slot_index: 1,
        stealth_pk_b58: Address::new_from_array(note_pay.entry.stealth_pk).to_string(),
        asset_tag_b58: Address::new_from_array(note_pay.entry.asset_tag).to_string(),
        commitment_b58: Address::new_from_array(note_pay.entry.commitment).to_string(),
        mint_b58: Address::new_from_array(usdc_mint).to_string(),
        amount: 100_000_000,
        asset_blinding_b58: Address::new_from_array(note_pay.asset_blinding.to_bytes()).to_string(),
        value_blinding_b58: Address::new_from_array(note_pay.value_blinding.to_bytes()).to_string(),
    };
    assert!(disclosure.verify().unwrap(), "selective disclosure must verify");
    println!("[SELECTIVE DISCLOSURE VERIFIED]");
    println!("  Third-party verified 100.00 USDC payment to stealth note {} with ZERO key exposure!", disclosure.stealth_pk_b58);
}
