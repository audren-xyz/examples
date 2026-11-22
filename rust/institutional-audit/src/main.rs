//! Audren Example — Mode 1 Selective Disclosure & Mode 2 Read-Only FullViewingKey Audit.

use audren_client::{
    audren_circuits::{
        note::{compute_note_commitment, derive_asset_id, derive_stealth_owner},
        poseidon::fr_to_be_bytes,
    },
    audren_core::NATIVE_SOL_MINT,
    keys::{
        encrypt_note_memo, try_decrypt_and_verify_memo_entry, AudrenKeys, SelectiveDisclosureProof,
    },
};
use rand::{rngs::StdRng, RngCore, SeedableRng};

fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn main() {
    let mut rng = StdRng::seed_from_u64(0x4155_4452_454E_0002);
    let mut treasury_seed = [0u8; 32];
    let mut eph_secret = [0u8; 32];
    rng.fill_bytes(&mut treasury_seed);
    rng.fill_bytes(&mut eph_secret);

    let treasury = AudrenKeys::from_seed(&treasury_seed);
    let fvk = treasury.full_viewing_key();
    let amount = 250_000_000u64;
    let (tweak, blinding, memo_90) = encrypt_note_memo(&treasury.view_pk, eph_secret, amount, &NATIVE_SOL_MINT);
    let stealth = derive_stealth_owner(treasury.spend_pk, tweak);
    let asset_id = derive_asset_id(&NATIVE_SOL_MINT);
    let cm_fr = compute_note_commitment(stealth, asset_id, amount, blinding);
    let cm_be = fr_to_be_bytes(&cm_fr);

    let vt = [memo_90[0], memo_90[1]];
    let epk: [u8; 32] = memo_90[2..34].try_into().unwrap();
    let ct: [u8; 56] = memo_90[34..90].try_into().unwrap();
    let dec = try_decrypt_and_verify_memo_entry(&fvk, vt, &epk, &ct, &cm_be)
        .expect("FVK decrypts & Poseidon-verifies inbound note");
    assert_eq!(dec.amount, amount);
    let global_leaf_idx = (1u64 << 36) | 42u64;
    let nf = fvk.real_nullifier(cm_fr, global_leaf_idx).unwrap();

    println!("=== Audren Institutional Audit & Selective Disclosure ===");
    println!("Mode 2 FVK (read-only): nk={}... (0 spend capability)", &to_hex(&fvk.nk)[..16]);
    println!("Mode 2 Inbound Note   : {} lamports | cm={}...", dec.amount, &to_hex(&cm_be)[..16]);
    println!("Mode 2 Outbound Track : nf={}... (matched against NullifierPage)", &to_hex(&nf)[..16]);

    let mut receipt = SelectiveDisclosureProof {
        pool_id: 0,
        lane_id: 1,
        leaf_index: 42,
        stealth_owner: fr_to_be_bytes(&stealth),
        mint: NATIVE_SOL_MINT,
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
