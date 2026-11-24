//! Audren v1.3.0 Offline Solana Transaction v1 (`0x81`) Zero-Crank Shielded Deposit Wire Builder (Rust SDK — `audren-client`).
//!
//! Compiles and signs a canonical Solana Transaction v1 (`0x81`, `4,096 B`, inline `TransactionConfig`)
//! with calibrated tight Compute Unit limits (`CU_LIMIT_DEPOSIT + k * CU_LIMIT_OPEN_PAGE`),
//! automatically prepending idempotent `OpenPage` (`Tag 2`) pre-instructions at page rollover /
//! `>= 90%` lookahead via `build_auto_open_page_ixs` ahead of unified `Deposit` (`Tag 3`,
//! `DEPOSIT_FLAG_NATIVE_SOL` -> atomic `SyncNative` WSOL + inline `GlobalRootHistory` update for
//! instant spendability on confirmation (~400ms today; ~150ms under Alpenglow) with zero cranks).
//!
//! Optionally pass `AUDREN_KEYPAIR_PATH=/path/to/keypair.json` to sign with an existing Solana
//! JSON keypair; otherwise a fresh ephemeral Ed25519 keypair is generated offline.

use std::collections::BTreeSet;
use std::fs;

use audren_client::{
    audren_circuits::note::derive_stealth_owner,
    audren_core::{
        AUDREN_PROGRAM_ID, CLASSIC_TOKEN_PROGRAM_ID, CU_LIMIT_DEPOSIT, CU_LIMIT_OPEN_PAGE,
        WSOL_MINT,
    },
    instructions::{
        build_auto_open_page_ixs, build_deposit, compute_page_rollovers, AudrenInstruction,
    },
    keys::{encrypt_note_memo, AudrenKeys},
    pda::{derive_ata, derive_lane_pda, derive_pool_pda, derive_roots_pda, derive_vault_auth_pda},
};
use base64::Engine as _;
use rand::RngCore;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::{
    v1::{Message as V1Message, TransactionConfig},
    Hash, VersionedMessage,
};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

fn to_sol_ix(ix: AudrenInstruction) -> Instruction {
    Instruction {
        program_id: Address::new_from_array(ix.program_id),
        accounts: ix
            .accounts
            .into_iter()
            .map(|a| AccountMeta {
                pubkey: Address::new_from_array(a.pubkey),
                is_signer: a.is_signer,
                is_writable: a.is_writable,
            })
            .collect(),
        data: ix.data,
    }
}

fn compile_v1_tx(
    payer: &Keypair,
    recent_blockhash: Hash,
    ixs: &[Instruction],
    cu_limit: u32,
) -> Vec<u8> {
    let config = TransactionConfig {
        compute_unit_limit: Some(cu_limit),
        loaded_accounts_data_size_limit: Some(64 * 1024 * 1024),
        priority_fee: Some(1_000),
        heap_size: None,
    };
    let msg = V1Message::try_compile_with_config(&payer.pubkey(), ixs, recent_blockhash, config)
        .expect("compile Solana Transaction v1 (0x81)");
    let tx = VersionedTransaction::try_new(VersionedMessage::V1(msg), &[payer]).expect("sign v1 tx");
    wincode::serialize(&tx).expect("serialize v1 wire bytes")
}

fn load_or_generate_payer() -> (Keypair, &'static str) {
    if let Ok(kp_path) = std::env::var("AUDREN_KEYPAIR_PATH") {
        let kp_bytes: Vec<u8> =
            serde_json::from_str(&fs::read_to_string(&kp_path).expect("read keypair"))
                .expect("parse keypair JSON");
        return (
            Keypair::try_from(kp_bytes.as_slice()).expect("valid keypair"),
            "AUDREN_KEYPAIR_PATH",
        );
    }
    (Keypair::new(), "ephemeral offline keypair")
}

fn main() {
    let (payer, payer_source) = load_or_generate_payer();
    let program_id = Address::new_from_array(AUDREN_PROGRAM_ID);
    let token_prog = Address::new_from_array(CLASSIC_TOKEN_PROGRAM_ID);
    let wsol_mint = Address::new_from_array(WSOL_MINT);
    let pool_id = 0u32;

    let mut seed = [0u8; 32];
    let mut eph = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut seed);
    rand::rngs::OsRng.fill_bytes(&mut eph);
    let alice = AudrenKeys::from_seed(&seed);

    let (pool_pda, _) = derive_pool_pda(&program_id, pool_id);
    let (roots_pda, _) = derive_roots_pda(&program_id, pool_id);
    let (vault_auth_pda, _) = derive_vault_auth_pda(&program_id, pool_id);
    let vault_wsol_ata = derive_ata(&vault_auth_pda, &token_prog, &wsol_mint);
    let (lane0_pda, _) = derive_lane_pda(&program_id, pool_id, 0);

    // Simulate a lane at 90%+ lookahead (leaf 250 of 256 in SubtreePage #0) to demonstrate
    // zero-crank inline auto-OpenPage prepending with calibrated tight CU limits.
    let next_leaf = 250u64;
    let nf_count = 0u64;
    let roll = compute_page_rollovers(next_leaf, 1, nf_count, 0);
    let auto_open_ixs = build_auto_open_page_ixs(
        program_id,
        payer.pubkey(),
        pool_id,
        0,
        next_leaf,
        nf_count,
        1,
        0,
        &BTreeSet::new(),
    )
    .expect("plan auto-OpenPage instructions");

    let amount = 1_000_000u64;
    let (tweak, blinding, memo_106) =
        encrypt_note_memo(&alice.view_pk, eph, amount, &WSOL_MINT).expect("valid recipient view_pk");
    let stealth = derive_stealth_owner(alice.spend_pk, tweak);

    let mut ixs: Vec<Instruction> = auto_open_ixs.into_iter().map(to_sol_ix).collect();
    let auto_open_count = ixs.len();
    ixs.push(to_sol_ix(build_deposit(
        program_id,
        payer.pubkey(),
        pool_id,
        wsol_mint,
        payer.pubkey(),
        vault_wsol_ata,
        token_prog,
        0,
        roll.out_sub_seq,
        roll.out_root_seq,
        roll.out_memo_seq,
        roll.next_sub_seq,
        roll.next_memo_seq,
        true,
        false,
        amount,
        stealth,
        blinding,
        &memo_106,
        &[],
    )));

    let cu_limit = CU_LIMIT_DEPOSIT + (auto_open_count as u32) * CU_LIMIT_OPEN_PAGE;
    let wire = compile_v1_tx(&payer, Hash::default(), &ixs, cu_limit);
    assert_eq!(wire[0], 0x81, "Solana Transaction v1 wire packet must begin with 0x81");
    let b64 = base64::engine::general_purpose::STANDARD.encode(&wire);

    println!("Payer           : {} ({payer_source})", payer.pubkey());
    println!("Program ID      : {program_id}");
    println!("Pool #0 PDA     : {pool_pda}");
    println!("Roots PDA       : {roots_pda} (inline GlobalRootHistory, 0 cranks)");
    println!("Vault WSOL ATA  : {vault_wsol_ata}");
    println!("Lane #0 PDA     : {lane0_pda}");
    println!(
        "Alice aud1      : {}",
        alice
            .address()
            .encode()
            .expect("encode valid aud1 address")
    );
    println!("Auto-OpenPage   : {auto_open_count} pre-ix(s) | Tight CU Limit: {cu_limit}");
    println!("V1 Tx Wire Size : {} bytes (0x{:02x} prefix)", wire.len(), wire[0]);
    println!("Payload Preview : {}...", &b64[..40]);
}
