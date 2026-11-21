//! Audren Canonical 6-Building-Block Quickstart (Rust SDK — `audren-client`).
//!
//! Runs completely offline (zero RPC required) and demonstrates the exact same 6 building blocks
//! mirrored across the Rust, TypeScript, Swift (iOS), and Kotlin (Android) examples:
//!   1. Keys          — master spend/view keys, isolated sub-account #1, `aud1…` address, FVK, asset generators
//!   2. PDAs & Layout — canonical Pool #0 PDAs & `EpochPage` header decoding
//!   3. Scanner       — 1,056-byte `dataSlice[64..1120]` view-tag filter & note decryption
//!   4. Prover        — local `Deposit`, `Transfer (m=5)` Triptych + Bulletproofs, `ProofBuffer`, `Withdraw`
//!   5. Disclosure    — Mode 1 Selective Disclosure verify (standalone & on-page) + Auditor ElGamal decrypt
//!   6. Relayer & DEX — canonical `JUPITER_CPI_EXCLUDED_DEXES` & `relay.audren.xyz`
//!
//! Run:
//!   cargo run --manifest-path rust/Cargo.toml -p audren-example-quickstart

use audren_client::{
    instructions::{build_buffered_execution, build_deposit, build_transfer, build_withdraw},
    keys::{
        prepare_shielded_note, AudrenAddress, AudrenKeys, AuditorKeypair, SelectiveDisclosureProof,
    },
    pda::{derive_epoch_page_pda, derive_pool_pda, derive_sol_vault_pda, derive_swap_escrow_pda},
    prover::{asset_generator, compress, decompress, extract_ring_from_page},
    router::JUPITER_CPI_EXCLUDED_DEXES,
    scanner::{decrypt_owned_note, scan_page_dataslice},
};
use audren_core::{
    layout::{write_page_note, PageHeader, PAGE_CAPACITY, PAGE_LEN, PAGE_SCAN_LEN, PAGE_SCAN_OFFSET},
    AUDREN_PROGRAM_ID, NATIVE_SOL_MINT, PROTOCOL_VERSION,
};
use curve25519_dalek::{constants::RISTRETTO_BASEPOINT_POINT, scalar::Scalar};
use rand::{rngs::StdRng, SeedableRng};
use solana_address::Address;

fn main() {
    let mut rng = StdRng::seed_from_u64(0x4155_4452_454E);
    let program_id = Address::new_from_array(AUDREN_PROGRAM_ID);
    let pool_id = 0u32;

    // 1. KEYS — Master keys, sub-account #1, aud1… address & read-only Full Viewing Key
    let alice_seed = [0x11u8; 32];
    let bob_seed = [0x22u8; 32];
    let alice = AudrenKeys::from_seed(&alice_seed);
    let alice_sub1 = AudrenKeys::from_seed_subaccount(&alice_seed, 1);
    let alice_fvk = alice.full_viewing_key();
    let bob = AudrenKeys::from_seed(&bob_seed);
    let parsed = AudrenAddress::from_base58(&alice.address().to_base58()).unwrap();
    assert_eq!(parsed.spend_pk, alice.spend_pk);
    let sol_gen = asset_generator(&NATIVE_SOL_MINT);

    println!("[1/6 KEYS]");
    println!("  Program ID    : {program_id}");
    println!("  Alice aud1    : {}", alice.address().to_base58());
    println!("  Subaccount #1 : {}", alice_sub1.address().to_base58());
    println!("  FVK view_pk   : {}", alice_fvk.to_export().view_pk_b58);

    // 2. PDAs & LAYOUTS — Canonical Pool #0 PDAs & synthetic 32-note EpochPage
    let (pool_pda, _) = derive_pool_pda(&program_id, pool_id);
    let (page0_pda, page0_bump) = derive_epoch_page_pda(&program_id, pool_id, 0);
    let (sol_vault_pda, _) = derive_sol_vault_pda(&program_id, pool_id);
    let (escrow0_pda, _) = derive_swap_escrow_pda(&program_id, pool_id, 0);

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
        let recipient = if slot == 5 { alice.address() } else { bob.address() };
        let amount = if slot == 5 { 1_500_000 } else { 250_000 };
        let prepared =
            prepare_shielded_note(&recipient, NATIVE_SOL_MINT, amount, true, None, true, *b"QUICK00", &mut rng)
                .unwrap();
        write_page_note(&mut page_bytes, slot, &prepared.entry).unwrap();
    }
    let hdr = PageHeader::decode(&page_bytes).unwrap();
    println!("[2/6 PDAs & LAYOUTS]");
    println!("  Pool #0 PDA   : {pool_pda}");
    println!("  EpochPage #0  : {page0_pda} (count={}/{})", hdr.count, PAGE_CAPACITY);
    println!("  SOL Vault     : {sol_vault_pda}");
    println!("  Escrow #0     : {escrow0_pda}");

    // 3. SCANNER — 1,056-byte dataSlice[64..1120] view-tag filter & note decryption
    let slice = &page_bytes[PAGE_SCAN_OFFSET..PAGE_SCAN_OFFSET + PAGE_SCAN_LEN];
    let hits = scan_page_dataslice(&alice_fvk, 0, slice).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].slot_index, 5);

    let note = decrypt_owned_note(&alice_fvk, Some(&alice), &program_id, pool_id, &page_bytes, 5, None)
        .unwrap()
        .expect("decrypt Alice note");
    println!("[3/6 SCANNER]");
    println!("  dataSlice     : offset={PAGE_SCAN_OFFSET}, length={PAGE_SCAN_LEN} B -> matched slot {}", hits[0].slot_index);
    println!("  Owned note    : {} lamports | NullifierPDA={}", note.amount, note.nullifier_pda.unwrap());

    // 4. PROVER — Deposit, Transfer (m=5 Triptych + Bulletproofs U128), ProofBuffer & Withdraw
    let payer = Address::new_from_array([0x55u8; 32]);
    let ring = extract_ring_from_page(&page_bytes).unwrap();

    let (dep_ix, _) = build_deposit(program_id, payer, pool_id, 1, &bob.address(), NATIVE_SOL_MINT, 500_000, None, &mut rng).unwrap();
    let (xfer_ix, _, _) = build_transfer(
        program_id, payer, pool_id, 1, &[0], &ring, &note, 5, &bob.address(), &alice.address(), 900_000, None, &[], &mut rng,
    )
    .unwrap();
    let buf_plan = build_buffered_execution(&xfer_ix, 42).unwrap();
    let (wd_ix, _) = build_withdraw(
        program_id, payer, pool_id, 1, &[0], &ring, &note, 5, payer, &alice.address(), 1_000_000, None, None, &mut rng,
    )
    .unwrap();

    println!("[4/6 PROVER]");
    println!("  Deposit ix    : {} B (tag={})", dep_ix.data.len(), dep_ix.data[0]);
    println!("  Transfer m=5  : {} B (tag={}, ProofBuffer chunks={})", xfer_ix.data.len(), xfer_ix.data[0], buf_plan.upload_chunks.len());
    println!("  Withdraw ix   : {} B (tag={})", wd_ix.data.len(), wd_ix.data[0]);

    // 5. DISCLOSURE & AUDIT — Mode 1 Selective Disclosure + Institutional Auditor ElGamal decrypt
    let mut sd = SelectiveDisclosureProof {
        version: 1,
        page_id: note.page_id,
        slot_index: note.slot_index as u8,
        stealth_pk_b58: bs58::encode(&note.stealth_pk).into_string(),
        asset_tag_b58: bs58::encode(&note.asset_tag).into_string(),
        commitment_b58: bs58::encode(&note.commitment).into_string(),
        mint_b58: bs58::encode(&note.mint).into_string(),
        amount: note.amount,
        asset_blinding_b58: bs58::encode(note.asset_blinding.to_bytes()).into_string(),
        value_blinding_b58: bs58::encode(note.value_blinding.to_bytes()).into_string(),
    };
    assert!(sd.verify().unwrap());
    assert!(sd.verify_against_page(&page_bytes).unwrap());
    sd.amount += 1;
    assert!(!sd.verify_against_page(&page_bytes).unwrap());

    let auditor = AuditorKeypair::from_seed(&[0x99u8; 32]);
    let r = Scalar::from(777_777u64);
    let s1 = compress(&(r * RISTRETTO_BASEPOINT_POINT));
    let s2 = compress(&(decompress(&note.stealth_pk).unwrap() + r * decompress(&auditor.auditor_pk).unwrap()));
    let m1 = compress(&(r * RISTRETTO_BASEPOINT_POINT));
    let m2 = compress(&(decompress(&sol_gen).unwrap() + r * decompress(&auditor.auditor_pk).unwrap()));
    assert_eq!(auditor.decrypt_spent_pubkey(&s1, &s2).unwrap(), note.stealth_pk);
    assert_eq!(auditor.decrypt_asset_generator(&m1, &m2).unwrap(), sol_gen);

    println!("[5/6 DISCLOSURE & AUDIT]");
    println!("  Mode 1 proof  : verified standalone & on-page (tampered rejected)");
    println!("  Auditor decrypt: spent stealth_pk & asset_generator verified");

    // 6. RELAYER & ROUTER
    println!("[6/6 RELAYER & ROUTER]");
    println!("  Default relay : https://relay.audren.xyz");
    println!("  Excluded DEXes: {JUPITER_CPI_EXCLUDED_DEXES}");
}
