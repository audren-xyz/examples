//! Audren v1 Example — Mode 1 Selective Disclosure & Mode 2 Read-Only FullViewingKey Audit.

use audren_client::{
    audren_circuits::{
        note::{compute_note_commitment, derive_asset_id, derive_stealth_owner},
        poseidon::fr_to_be_bytes,
    },
    audren_core::{
        layout::{MEMO_CT_LEN, MEMO_ENTRY_WIRE_LEN, MEMO_PAYMENT_ID_LEN},
        WSOL_MINT,
    },
    keys::{
        encrypt_note_memo_with_payment_id, try_decrypt_and_verify_memo_entry, AudrenKeys,
        SelectiveDisclosureProof,
    },
};
use rand::{rngs::StdRng, RngCore, SeedableRng};

fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn main() {
    let mut rng = StdRng::seed_from_u64(0x4155_4452_454E_0001);
    let mut treasury_seed = [0u8; 32];
    let mut eph_secret = [0u8; 32];
    rng.fill_bytes(&mut treasury_seed);
    rng.fill_bytes(&mut eph_secret);

    let treasury = AudrenKeys::from_seed(&treasury_seed);
    let fvk = treasury.full_viewing_key();
    let amount = 250_000_000u64;
    let invoice_id: [u8; MEMO_PAYMENT_ID_LEN] = *b"INV-2026-00042";
    let (tweak, blinding, memo_106) = encrypt_note_memo_with_payment_id(
        &treasury.view_pk,
        eph_secret,
        amount,
        &WSOL_MINT,
        invoice_id,
    )
    .expect("valid recipient view_pk");
    let stealth = derive_stealth_owner(treasury.spend_pk, tweak);
    let asset_id = derive_asset_id(&WSOL_MINT);
    let cm_fr = compute_note_commitment(stealth, asset_id, amount, blinding);
    let cm_be = fr_to_be_bytes(&cm_fr);

    let vt = [memo_106[0], memo_106[1]];
    let epk: [u8; 32] = memo_106[2..34].try_into().unwrap();
    let ct: [u8; MEMO_CT_LEN] = memo_106[34..MEMO_ENTRY_WIRE_LEN].try_into().unwrap();
    let dec = try_decrypt_and_verify_memo_entry(&fvk, vt, &epk, &ct, &cm_be)
        .expect("FVK decrypts & Poseidon-verifies inbound note");
    assert_eq!(dec.amount, amount);
    assert_eq!(dec.payment_id, invoice_id);
    let global_leaf_idx = (1u64 << 36) | 42u64;
    let nf = fvk.real_nullifier(cm_fr, global_leaf_idx).unwrap();

    println!("=== Audren v1 Institutional Audit & Selective Disclosure ===");
    println!(
        "Mode 2 FVK (read-only): nk={}... (0 spend capability)",
        &to_hex(&fvk.nk)[..16]
    );
    println!(
        "Mode 2 Inbound Note   : {} lamports | payment_id={} | cm={}...",
        dec.amount,
        std::str::from_utf8(&dec.payment_id).unwrap(),
        &to_hex(&cm_be)[..16]
    );
    println!(
        "Mode 2 Outbound Track : nf={}... (matched against NullifierPage)",
        &to_hex(&nf)[..16]
    );

    let mut receipt = SelectiveDisclosureProof {
        pool_id: 0,
        lane_id: 1,
        leaf_index: 42,
        stealth_owner: fr_to_be_bytes(&stealth),
        mint: WSOL_MINT,
        amount,
        blinding: fr_to_be_bytes(&blinding),
        commitment: cm_be,
    };
    assert!(receipt.verify_against_leaf(&cm_be), "genuine receipt must pass");
    println!("Mode 1 Genuine Receipt: VALID (reveals only leaf #42, 0 unrelated history)");

    receipt.amount += 1;
    assert!(!receipt.verify_against_leaf(&cm_be), "tampered receipt must fail");
    println!("Mode 1 Tampered (+1)  : REJECTED");
}
