//! Audren Example 1 — End-to-End Shielded Transfer & Withdraw on Solana (Mainnet or Devnet).
//!
//! Demonstrates:
//! 1. Reading `PoolState` (`192 B`) for Pool #0 (`5Bvt5f5QMfsVb9TyX8bzkRMvAX6JSWwRtnymGveF9U3G`)
//! 2. Shielding `0.005 SOL` into an unlinkable stealth note (`Tag 2: Deposit`)
//! 3. Standard Solana RPC `getAccountInfo` `dataSlice[64..1120]` note discovery
//! 4. Building a Multi-Base Triptych (`m = 5`, 32-note ring) + Agave Bulletproof `Transfer`
//!    split via `ProofBuffer` (`Tag 8` + `Tag 9`), with every transaction strictly `<= 1,232 B` MTU
//!    and `100%` of buffer rent automatically refunded on execution
//! 5. Shielded `Withdraw` back to the payer wallet
//!
//! Run:
//! ```bash
//! AUDREN_RPC_URL="https://your-devnet-rpc" \
//! AUDREN_KEYPAIR_PATH="/path/to/keypair.json" \
//! cargo run --manifest-path rust/Cargo.toml -p audren-example-shielded-transfer
//! ```

use audren_client::{
    instructions::{
        build_buffered_execution, build_deposit, build_transfer, build_withdraw, AudrenInstruction,
    },
    keys::AudrenKeys,
    pda::{derive_epoch_page_pda, derive_pool_pda},
    prover::extract_ring_from_page,
    scanner::{decrypt_owned_note, scan_page_dataslice},
};
use audren_core::{
    layout::{PoolState, PAGE_SCAN_LEN, PAGE_SCAN_OFFSET},
    AUDREN_PROGRAM_ID, NATIVE_SOL_MINT,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::{rngs::StdRng, SeedableRng};
use serde_json::{json, Value};
use solana_address::Address;
use solana_compute_budget_interface::ComputeBudgetInstruction;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SOLANA_PACKET_MTU: usize = 1_232;

fn to_ix(ix: &AudrenInstruction) -> Instruction {
    Instruction {
        program_id: ix.program_id,
        accounts: ix
            .accounts
            .iter()
            .map(|m| AccountMeta {
                pubkey: m.pubkey,
                is_signer: m.is_signer,
                is_writable: m.is_writable,
            })
            .collect(),
        data: ix.data.clone(),
    }
}

fn rpc_call(url: &str, method: &str, params: Value) -> Value {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }).to_string();
    let out = Command::new("curl")
        .args([
            "-sS",
            "--max-time",
            "15",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-d",
            &body,
            url,
        ])
        .output()
        .expect("curl must be installed");
    assert!(out.status.success(), "RPC curl error: {}", String::from_utf8_lossy(&out.stderr));
    let resp: Value = serde_json::from_slice(&out.stdout).expect("valid JSON-RPC response");
    if let Some(err) = resp.get("error") {
        panic!("RPC {method} error: {err}");
    }
    resp["result"].clone()
}

fn get_account(url: &str, pubkey: &Address, slice: Option<(usize, usize)>) -> Option<Vec<u8>> {
    let mut cfg = json!({ "encoding": "base64", "commitment": "confirmed" });
    if let Some((offset, length)) = slice {
        cfg["dataSlice"] = json!({ "offset": offset, "length": length });
    }
    let res = rpc_call(url, "getAccountInfo", json!([pubkey.to_string(), cfg]));
    if res["value"].is_null() {
        return None;
    }
    Some(B64.decode(res["value"]["data"][0].as_str().unwrap()).unwrap())
}

fn send_and_confirm(url: &str, payer: &Keypair, ixs: &[Instruction], cu_limit: u32, label: &str) -> String {
    let mut all = vec![
        ComputeBudgetInstruction::set_compute_unit_limit(cu_limit),
        ComputeBudgetInstruction::set_compute_unit_price(50_000),
    ];
    all.extend_from_slice(ixs);
    let bh_str = rpc_call(url, "getLatestBlockhash", json!([{"commitment": "confirmed"}]))["value"]
        ["blockhash"]
        .as_str()
        .unwrap()
        .to_string();
    let bh: [u8; 32] = bs58::decode(&bh_str).into_vec().unwrap().try_into().unwrap();
    let tx = Transaction::new(&[payer], Message::new(&all, Some(&payer.pubkey())), bh.into());
    let wire = bincode::serialize(&tx).unwrap();
    assert!(wire.len() <= SOLANA_PACKET_MTU, "{label}: {} B > 1,232 B MTU", wire.len());

    let b64 = B64.encode(&wire);
    let sig = rpc_call(
        url,
        "sendTransaction",
        json!([b64, {"encoding": "base64", "preflightCommitment": "confirmed", "maxRetries": 5}]),
    )
    .as_str()
    .unwrap()
    .to_string();

    for attempt in 0..45 {
        let st = rpc_call(url, "getSignatureStatuses", json!([[&sig], {"searchTransactionHistory": true}]));
        if let Some(entry) = st["value"][0].as_object() {
            if let Some(err) = entry.get("err") {
                if !err.is_null() {
                    panic!("{label} failed ({sig}): {err}");
                }
            }
            if matches!(
                entry.get("confirmationStatus").and_then(|v| v.as_str()),
                Some("confirmed" | "finalized")
            ) {
                println!("[OK] {label} ({} B) -> {sig}", wire.len());
                return sig;
            }
        } else if attempt > 0 && attempt % 5 == 0 {
            let _ = rpc_call(
                url,
                "sendTransaction",
                json!([b64, {"encoding": "base64", "skipPreflight": true}]),
            );
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    panic!("confirmation timeout for {label} ({sig})");
}

fn main() {
    let rpc_url = std::env::var("AUDREN_RPC_URL")
        .expect("set AUDREN_RPC_URL to a Solana Mainnet or Devnet RPC URL");
    let kp_path = std::env::var("AUDREN_KEYPAIR_PATH")
        .expect("set AUDREN_KEYPAIR_PATH to a Solana keypair JSON path");

    let kp_bytes: Vec<u8> =
        serde_json::from_str(&std::fs::read_to_string(&kp_path).expect("read keypair"))
            .expect("parse keypair JSON");
    let payer = Keypair::try_from(kp_bytes.as_slice()).expect("valid Solana keypair");
    let program_id = Address::new_from_array(AUDREN_PROGRAM_ID);
    let pool_id = 0u32;
    let (pool_pda, _) = derive_pool_pda(&program_id, pool_id);

    let pool_bytes = get_account(&rpc_url, &pool_pda, None)
        .expect("Pool #0 not found on target cluster");
    let pool = PoolState::decode(&pool_bytes).expect("decode PoolState");
    println!(
        "Pool #0 ({pool_pda}) | active_page={} | total_notes={} | total_spends={}",
        pool.current_page_id, pool.total_notes, pool.total_spends
    );

    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as u64;
    let mut rng = StdRng::seed_from_u64(now);
    let mut alice_seed = [0u8; 32];
    alice_seed[..8].copy_from_slice(&now.to_le_bytes());
    alice_seed[8] = 0xA1;
    let mut bob_seed = [0u8; 32];
    bob_seed[..8].copy_from_slice(&now.to_le_bytes());
    bob_seed[8] = 0xB2;
    let alice = AudrenKeys::from_seed(&alice_seed);
    let bob = AudrenKeys::from_seed(&bob_seed);

    let amount = 5_000_000u64; // 0.005 SOL
    let page_id = pool.current_page_id;
    let (page_pda, _) = derive_epoch_page_pda(&program_id, pool_id, page_id);

    // 1. Shield SOL into Alice's stealth address
    let (dep_ix, _) = build_deposit(
        program_id,
        payer.pubkey(),
        pool_id,
        page_id,
        &alice.address(),
        NATIVE_SOL_MINT,
        amount,
        None,
        &mut rng,
    )
    .unwrap();
    send_and_confirm(&rpc_url, &payer, &[to_ix(&dep_ix)], 120_000, "Deposit(0.005 SOL)");

    // 2. Scan EpochPage via standard RPC dataSlice[64..1120].
    let slice = get_account(&rpc_url, &page_pda, Some((PAGE_SCAN_OFFSET, PAGE_SCAN_LEN))).unwrap();
    let alice_fvk = alice.full_viewing_key();
    let hits = scan_page_dataslice(&alice_fvk, page_id, &slice).unwrap();
    let page_full = get_account(&rpc_url, &page_pda, None).unwrap();
    let alice_note = decrypt_owned_note(
        &alice_fvk,
        Some(&alice),
        &program_id,
        pool_id,
        &page_full,
        hits[0].slot_index,
        None,
    )
    .unwrap()
    .expect("Alice note decrypted");
    println!("Pure-RPC dataSlice recovered Alice note at slot {}: {} lamports", alice_note.slot_index, alice_note.amount);

    // 3. Shielded Transfer -> Bob via ProofBuffer (all txs <= 1,232 B, 100% rent refund)
    let ring = extract_ring_from_page(&page_full).unwrap();
    let (xfer_ix, _, _) = build_transfer(
        program_id,
        payer.pubkey(),
        pool_id,
        page_id,
        &[page_id],
        &ring,
        &alice_note,
        alice_note.slot_index,
        &bob.address(),
        &alice.address(),
        amount,
        None,
        &[],
        &mut rng,
    )
    .unwrap();
    let xfer_plan = build_buffered_execution(&xfer_ix, now).unwrap();
    for (i, chunk_ix) in xfer_plan.upload_chunks.iter().enumerate() {
        send_and_confirm(&rpc_url, &payer, &[to_ix(chunk_ix)], 80_000, &format!("Transfer chunk {i}"));
    }
    send_and_confirm(&rpc_url, &payer, &[to_ix(&xfer_plan.execute)], 900_000, "ExecBuffered(Transfer)");

    // 4. Bob scans & withdraws 100% back to payer
    let slice2 = get_account(&rpc_url, &page_pda, Some((PAGE_SCAN_OFFSET, PAGE_SCAN_LEN))).unwrap();
    let bob_fvk = bob.full_viewing_key();
    let bob_hits = scan_page_dataslice(&bob_fvk, page_id, &slice2).unwrap();
    let page_full_2 = get_account(&rpc_url, &page_pda, None).unwrap();
    let bob_note = decrypt_owned_note(
        &bob_fvk,
        Some(&bob),
        &program_id,
        pool_id,
        &page_full_2,
        bob_hits[0].slot_index,
        None,
    )
    .unwrap()
    .expect("Bob note decrypted");

    let ring2 = extract_ring_from_page(&page_full_2).unwrap();
    let (wd_ix, _) = build_withdraw(
        program_id,
        payer.pubkey(),
        pool_id,
        page_id,
        &[page_id],
        &ring2,
        &bob_note,
        bob_note.slot_index,
        payer.pubkey(),
        &bob.address(),
        amount,
        None,
        None,
        &mut rng,
    )
    .unwrap();
    let wd_plan = build_buffered_execution(&wd_ix, now + 1).unwrap();
    for (i, chunk_ix) in wd_plan.upload_chunks.iter().enumerate() {
        send_and_confirm(&rpc_url, &payer, &[to_ix(chunk_ix)], 80_000, &format!("Withdraw chunk {i}"));
    }
    send_and_confirm(&rpc_url, &payer, &[to_ix(&wd_plan.execute)], 600_000, "ExecBuffered(Full Withdraw)");
    println!("Done: 0.005 SOL shielded, transferred privately, and returned 100%.");
}
