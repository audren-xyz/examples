//! Audren Offline Solana Transaction v1 (`0x81`) Shielded Deposit Wire Builder (Rust SDK — `audren-client`).
//!
//! Compiles and signs a canonical Solana Transaction v1 (`0x81`, `4,096 B`, inline `TransactionConfig`)
//! bundling `OpenPage` (`SubtreePage`, `SubtreeRootPage`, `MemoPage`), `DepositSol`, and
//! `PublishCheckpoint` into a single `wincode`-serialized wire packet ready for RPC submission.
//!
//! Optionally pass `AUDREN_KEYPAIR_PATH=/path/to/keypair.json` to sign with an existing Solana
//! JSON keypair; otherwise a fresh ephemeral Ed25519 keypair is generated offline.

use std::fs;

use audren_client::{
    audren_circuits::note::derive_stealth_owner,
    audren_core::{
        instruction::{OPEN_PAGE_KIND_MEMO, OPEN_PAGE_KIND_SUBROOT, OPEN_PAGE_KIND_SUBTREE},
        AUDREN_PROGRAM_ID, NATIVE_SOL_MINT,
    },
    instructions::{build_deposit_sol, build_open_page, build_publish_checkpoint, AudrenInstruction},
    keys::{encrypt_note_memo, AudrenKeys},
    pda::{derive_lane_pda, derive_pool_pda},
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
    let pool_id = 0u32;

    let mut seed = [0u8; 32];
    let mut eph = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut seed);
    rand::rngs::OsRng.fill_bytes(&mut eph);
    let alice = AudrenKeys::from_seed(&seed);

    let (pool_pda, _) = derive_pool_pda(&program_id, pool_id);
    let (lane0_pda, _) = derive_lane_pda(&program_id, pool_id, 0);

    let amount = 1_000_000u64;
    let (tweak, blinding, memo_90) = encrypt_note_memo(&alice.view_pk, eph, amount, &NATIVE_SOL_MINT);
    let stealth = derive_stealth_owner(alice.spend_pk, tweak);

    let ixs = vec![
        to_sol_ix(build_open_page(program_id, payer.pubkey(), OPEN_PAGE_KIND_SUBTREE, pool_id, 0, 0)),
        to_sol_ix(build_open_page(program_id, payer.pubkey(), OPEN_PAGE_KIND_SUBROOT, pool_id, 0, 0)),
        to_sol_ix(build_open_page(program_id, payer.pubkey(), OPEN_PAGE_KIND_MEMO, pool_id, 0, 0)),
        to_sol_ix(build_deposit_sol(
            program_id,
            payer.pubkey(),
            pool_id,
            0,
            0,
            0,
            0,
            None,
            None,
            false,
            amount,
            stealth,
            blinding,
            &memo_90,
        )),
        to_sol_ix(build_publish_checkpoint(program_id, payer.pubkey(), pool_id, 0, 4)),
    ];

    let wire = compile_v1_tx(&payer, Hash::default(), &ixs, 250_000);
    assert_eq!(wire[0], 0x81, "Solana Transaction v1 wire packet must begin with 0x81");
    let b64 = base64::engine::general_purpose::STANDARD.encode(&wire);

    println!("Payer           : {} ({payer_source})", payer.pubkey());
    println!("Program ID      : {program_id}");
    println!("Pool #0 PDA     : {pool_pda}");
    println!("Lane #0 PDA     : {lane0_pda}");
    println!("Alice aud1      : {}", alice.address().encode());
    println!("V1 Tx Wire Size : {} bytes (0x{:02x} prefix)", wire.len(), wire[0]);
    println!("Payload Preview : {}...", &b64[..40]);
}
