//! Audren v1 Canonical 6-Building-Block Quickstart (Rust SDK — `audren-client`).
//!
//! Runs completely offline (zero RPC required) against `spec/test-vectors.json` and emits
//! 100% byte-for-byte identical canonical stdout across Rust, TypeScript, Swift, and Kotlin.

use std::path::PathBuf;
use std::str::FromStr;

use ark_bn254::Fr;
use audren_client::{
    audren_circuits::{
        joinsplit::{JoinSplit4AryCircuit, JoinSplitInputWitness, JoinSplitOutputWitness},
        merkle::{
            build_historical_witness_4ary, compute_subtree_256_root, compute_super_root_4ary,
            zero_hashes_4ary, MerklePath4Ary,
        },
        note::{derive_asset_id, derive_stealth_owner},
        poseidon::{fr_from_be_bytes_strict, fr_to_be_bytes, poseidon4},
    },
    audren_core::{
        instruction::{ASSET_MODE_PRIVATE, ASSET_MODE_PUBLIC, VK_ID_DEFAULT},
        layout::{MEMO_CT_LEN, MEMO_ENTRY_WIRE_LEN, MEMO_PAYMENT_ID_LEN},
        AUDREN_PROGRAM_ID, CLASSIC_TOKEN_PROGRAM_ID, DEFAULT_ROOT_EPOCH_INTERVAL, NUM_LANES,
        PROTOCOL_VERSION, ROOT_RING_EPOCH, WSOL_MINT,
    },
    instructions::{
        build_deposit, build_init_root_history, build_transact, compute_exec_ctx_hash,
        compute_transact_ctx_hash, AudrenAccountMeta,
    },
    keys::{
        encrypt_note_memo_with_payment_id, prepare_dynamic_swap_memo,
        try_decrypt_and_verify_memo_entry, AudrenAddress, AudrenKeys, SelectiveDisclosureProof,
    },
    pda::{
        derive_ata, derive_escrow_pda, derive_lane_pda, derive_nullifier_pda, derive_pool_pda,
        derive_roots_pda, derive_unwrap_pda, derive_vault_auth_pda,
    },
    prover::AudrenProver,
    router::{DEFAULT_RELAY_URL, JUPITER_CPI_EXCLUDED_DEXES},
    scanner::{decode_global_root_history, decode_pool_state},
    store::CompactWalletStore,
};
use solana_address::Address;

const USDC_MINT_B58: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

fn decode_hex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("valid hex"))
        .collect()
}

fn decode_hex_arr<const N: usize>(hex: &str) -> [u8; N] {
    decode_hex(hex).try_into().expect("exact hex array length")
}

fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn find_vectors_path() -> PathBuf {
    if let Ok(dir) = std::env::var("AUDREN_REPO_DIR") {
        let p = PathBuf::from(dir).join("spec/test-vectors.json");
        if p.is_file() {
            return p;
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for rel in [
        "../../../audren/spec/test-vectors.json",
        "../../audren/spec/test-vectors.json",
    ] {
        let p = manifest_dir.join(rel);
        if p.is_file() {
            return p;
        }
    }
    panic!("spec/test-vectors.json not found; set AUDREN_REPO_DIR=/path/to/audren");
}

fn main() {
    let raw = std::fs::read_to_string(find_vectors_path()).expect("read spec/test-vectors.json");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("parse JSON");

    let program_id = Address::new_from_array(AUDREN_PROGRAM_ID);
    let token_prog = Address::new_from_array(CLASSIC_TOKEN_PROGRAM_ID);
    let wsol_mint = Address::new_from_array(WSOL_MINT);
    let pool_id = 0u32;

    // 1. KEYS & COMPLIANCE
    let alice_seed = decode_hex_arr::<32>(v["alice"]["seed_hex"].as_str().unwrap());
    let bob_seed = decode_hex_arr::<32>(v["bob"]["seed_hex"].as_str().unwrap());
    let alice = AudrenKeys::from_seed(&alice_seed);
    let alice_sub1 = AudrenKeys::from_seed_subaccount(&alice_seed, 1);
    let bob = AudrenKeys::from_seed(&bob_seed);
    let sess0 = AudrenKeys::derive_defi_session_keypair(&alice_seed, 0);
    let sess3 = AudrenKeys::derive_defi_session_keypair(&alice_seed, 3);
    let sess0_addr = Address::new_from_array(sess0.pubkey);
    let sess3_addr = Address::new_from_array(sess3.pubkey);
    let fvk = alice.full_viewing_key();
    let alice_addr_str = alice.address().encode().expect("encode valid aud1 address");
    let parsed = AudrenAddress::decode(&alice_addr_str).unwrap();
    assert_eq!(parsed.spend_pk, fr_to_be_bytes(&alice.spend_pk));
    assert_eq!(alice_addr_str, v["alice"]["address"].as_str().unwrap());

    println!("[1/6 KEYS]");
    println!("  Program ID    : {program_id} (v{PROTOCOL_VERSION})");
    println!("  Alice aud1    : {alice_addr_str}");
    println!(
        "  Subaccount #1 : {}",
        alice_sub1
            .address()
            .encode()
            .expect("encode valid subaccount aud1 address")
    );
    println!("  DeFi Session 0: {sess0_addr}");
    println!("  FVK nk        : {}", to_hex(&fvk.nk));

    // 2. PDAs & ZERO-COPY LAYOUTS
    let (pool_pda, _) = derive_pool_pda(&program_id, pool_id);
    let (roots_pda, _) = derive_roots_pda(&program_id, pool_id);
    let (vault_auth_pda, _) = derive_vault_auth_pda(&program_id, pool_id);
    let (lane2_pda, _) = derive_lane_pda(&program_id, pool_id, 2);
    let (escrow5_pda, _) = derive_escrow_pda(&program_id, pool_id, 5);
    assert_eq!(
        roots_pda.to_string(),
        v["pdas"]["roots"]["address"].as_str().unwrap()
    );
    let pool_state = decode_pool_state(&decode_hex(v["pool_state"]["raw_hex"].as_str().unwrap()))
        .expect("decode PoolState");
    let roots = decode_global_root_history(&decode_hex(
        v["root_history"]["raw_hex"].as_str().unwrap(),
    ))
    .expect("decode GlobalRootHistory");

    println!("[2/6 PDAs & LAYOUTS]");
    println!(
        "  Pool #0 PDA   : {pool_pda} (active_lanes={}, root_epoch_interval={})",
        pool_state.active_lanes, pool_state.root_epoch_interval
    );
    println!(
        "  Roots PDA     : {roots_pda} (slot_cursor={}, epoch_cursor={}, lane2_leaves={}, super_root={})",
        roots.slot_cursor,
        roots.epoch_cursor,
        roots.stable_lane_counts[2],
        to_hex(&roots.stable_super_root)
    );
    println!("  Vault Auth    : {vault_auth_pda}");
    println!("  Lane #2 PDA   : {lane2_pda}");
    println!("  Escrow #5 PDA : {escrow5_pda}");

    // 3. MEMOS & ZERO-INDEXER COMPACT STORE
    let eph_sec = decode_hex_arr::<32>(v["memo"]["eph_secret_hex"].as_str().unwrap());
    let amount = v["memo"]["amount"].as_u64().unwrap();
    let mint_bytes = decode_hex_arr::<32>(v["memo"]["mint_hex"].as_str().unwrap());
    let payment_id =
        decode_hex_arr::<MEMO_PAYMENT_ID_LEN>(v["memo"]["payment_id_hex"].as_str().unwrap());
    let (tweak, blinding, memo_106) =
        encrypt_note_memo_with_payment_id(&alice.view_pk, eph_sec, amount, &mint_bytes, payment_id)
            .expect("valid recipient view_pk");
    assert_eq!(to_hex(&memo_106), v["memo"]["memo_106_hex"].as_str().unwrap());
    let stealth = derive_stealth_owner(alice.spend_pk, tweak);
    let wsol_asset = derive_asset_id(&WSOL_MINT);
    let cm_be = decode_hex_arr::<32>(v["memo"]["commitment_hex"].as_str().unwrap());
    let cm_fr = fr_from_be_bytes_strict(&cm_be).unwrap();

    let vt = [memo_106[0], memo_106[1]];
    let epk: [u8; 32] = memo_106[2..34].try_into().unwrap();
    let ct: [u8; MEMO_CT_LEN] = memo_106[34..MEMO_ENTRY_WIRE_LEN].try_into().unwrap();
    let dec = try_decrypt_and_verify_memo_entry(&fvk, vt, &epk, &ct, &cm_be)
        .expect("FVK memo decrypt + Poseidon commitment check");
    assert_eq!(dec.amount, amount);
    assert_eq!(dec.payment_id, payment_id);

    let nf_sample = decode_hex_arr::<32>(v["pdas"]["nullifier_hex"].as_str().unwrap());
    let (nf_pda, _) = derive_nullifier_pda(&program_id, pool_id, &nf_sample);
    let (unwrap_pda, _) = derive_unwrap_pda(&program_id, pool_id, &nf_sample);
    let store = CompactWalletStore::new(pool_id, 0);
    assert_eq!(store.pool_id, 0);

    println!("[3/6 MEMOS & COMPACT STORE]");
    println!(
        "  Memo (106 B)  : {}... -> decrypted {} lamports (payment_id={}, Poseidon verified)",
        &to_hex(&memo_106)[..16],
        dec.amount,
        to_hex(&dec.payment_id),
    );
    println!("  Nullifier PDA : {nf_pda}");
    println!("  Unwrap PDA    : {unwrap_pda}");
    println!(
        "  CompactStore  : initialized (pool_id={}, indexer=none)",
        store.pool_id
    );

    // 4. BN254 GROTH16 PROVER & INSTRUCTIONS
    let ctx_priv = compute_transact_ctx_hash(
        &program_id,
        pool_id,
        VK_ID_DEFAULT,
        2,
        0b111,
        ASSET_MODE_PRIVATE,
        false,
        None,
        None,
        &[0u8; 32],
        0,
        0,
        &memo_106,
    );
    assert_eq!(
        to_hex(&fr_to_be_bytes(&ctx_priv)),
        v["ctx_hashes"]["transact_private_ctx_hash_hex"]
            .as_str()
            .unwrap()
    );

    let ctx_wsol = compute_transact_ctx_hash(
        &program_id,
        pool_id,
        VK_ID_DEFAULT,
        2,
        0,
        ASSET_MODE_PUBLIC,
        true,
        Some(&sess0_addr),
        Some(&sess3_addr),
        &fr_to_be_bytes(&wsol_asset),
        1_000_000_000,
        5_000_000,
        &[],
    );
    assert_eq!(
        to_hex(&fr_to_be_bytes(&ctx_wsol)),
        v["ctx_hashes"]["transact_wsol_unwrap_ctx_hash_hex"]
            .as_str()
            .unwrap()
    );

    let usdc_mint = Address::from_str(USDC_MINT_B58).unwrap();
    let usdc_asset = derive_asset_id(&usdc_mint.to_bytes());
    let dyn_eph = decode_hex_arr::<32>(v["memo"]["dyn_eph_secret_hex"].as_str().unwrap());
    let (_, _, dyn_head, dyn_mask) =
        prepare_dynamic_swap_memo(&bob.view_pk, dyn_eph).expect("valid bob view_pk");
    let ctx_exec = compute_exec_ctx_hash(
        &program_id,
        pool_id,
        VK_ID_DEFAULT,
        1,
        3,
        0b01,
        true,
        &fr_to_be_bytes(&usdc_asset),
        50_000_000,
        2_000_000,
        Some(&sess3_addr),
        &fr_to_be_bytes(&wsol_asset),
        400_000_000,
        &Address::new_from_array([0x77u8; 32]),
        &[
            AudrenAccountMeta::writable(Address::new_from_array([0x88u8; 32]), false),
            AudrenAccountMeta::readonly(Address::new_from_array([0x99u8; 32]), false),
        ],
        &[],
        &fr_to_be_bytes(&stealth),
        &fr_to_be_bytes(&blinding),
        &dyn_head,
        &dyn_mask,
        &[1, 2, 3, 4],
        &memo_106,
    );
    assert_eq!(
        to_hex(&fr_to_be_bytes(&ctx_exec)),
        v["ctx_hashes"]["exec_fee_on_output_ctx_hash_hex"]
            .as_str()
            .unwrap()
    );

    // Real 192-byte BN254 Groth16 proof verified byte-for-byte against spec/test-vectors.json
    let leaves = [
        Fr::from(0u64),
        Fr::from(0u64),
        Fr::from(0u64),
        Fr::from(0u64),
        Fr::from(0u64),
        cm_fr,
    ];
    let zh = zero_hashes_4ary();
    let mut lroot = compute_subtree_256_root(&leaves, 6);
    for z in zh.iter().take(18).skip(4) {
        lroot = poseidon4(lroot, *z, *z, *z);
    }
    let mut lane_roots = [zh[18]; NUM_LANES];
    lane_roots[2] = lroot;
    let super_root = compute_super_root_4ary(&lane_roots);
    let path5 = build_historical_witness_4ary(2, 5, &lane_roots, 6, &[], &leaves, Some(&leaves));
    let circuit = JoinSplit4AryCircuit::new_with_options(
        super_root,
        wsol_asset,
        Fr::from(0u64),
        0,
        0,
        ctx_priv,
        true,
        [
            JoinSplitInputWitness {
                spend_sk: alice.spend_sk,
                tweak,
                asset_id: wsol_asset,
                amount,
                blinding,
                is_dummy: false,
                merkle_path: path5,
            },
            JoinSplitInputWitness {
                spend_sk: alice.spend_sk,
                tweak: Fr::from(0u64),
                asset_id: wsol_asset,
                amount: 0,
                blinding: Fr::from(0x5555u64),
                is_dummy: true,
                merkle_path: MerklePath4Ary::default(),
            },
        ],
        [
            JoinSplitOutputWitness {
                stealth_owner: derive_stealth_owner(bob.spend_pk, Fr::from(0x101u64)),
                asset_id: wsol_asset,
                amount: 1_000_000,
                blinding: Fr::from(0x201u64),
            },
            JoinSplitOutputWitness {
                stealth_owner: derive_stealth_owner(alice.spend_pk, Fr::from(0x102u64)),
                asset_id: wsol_asset,
                amount: 500_000,
                blinding: Fr::from(0x202u64),
            },
            JoinSplitOutputWitness::dummy(wsol_asset, Fr::from(0x203u64)),
        ],
    );
    let prover = AudrenProver::from_canonical_pk();
    let proved = prover.prove_with_seed(circuit, [0x99u8; 32]);
    assert_eq!(
        to_hex(&proved.proof_192),
        v["groth16"]["proof_192_hex"].as_str().unwrap()
    );

    let vault_wsol_ata = derive_ata(&vault_auth_pda, &token_prog, &wsol_mint);
    let dep_ix = build_deposit(
        program_id,
        sess0_addr,
        pool_id,
        wsol_mint,
        sess0_addr,
        vault_wsol_ata,
        token_prog,
        2,
        7,
        7,
        7,
        None,
        None,
        true,
        true,
        amount,
        stealth,
        blinding,
        &memo_106,
        &[],
    );
    let init_roots_ix = build_init_root_history(
        program_id,
        sess0_addr,
        pool_id,
        DEFAULT_ROOT_EPOCH_INTERVAL,
        4,
    );
    let root_ring_idx = roots.epoch_cursor as u8;
    let tx_ix = build_transact(
        program_id,
        sess0_addr,
        pool_id,
        VK_ID_DEFAULT,
        ROOT_RING_EPOCH,
        root_ring_idx,
        2,
        7,
        7,
        7,
        7,
        0b001,
        ASSET_MODE_PRIVATE,
        false,
        None,
        (None, None, None),
        &proved.proof_192,
        &proved.nf0,
        &proved.nf1,
        &proved.cm0,
        &proved.cm1,
        &proved.cm2,
        0,
        0,
        Address::new_from_array([0u8; 32]),
        Address::new_from_array([0u8; 32]),
        &memo_106,
        &[],
    );

    println!("[4/6 INSTRUCTIONS & GROTH16]");
    println!(
        "  Deposit       : {} B (tag={}, native_sol=true, fee_from_amount=true)",
        dep_ix.data.len(),
        dep_ix.data[0]
    );
    println!(
        "  InitRootHist  : {} B (tag={}, root_epoch_interval={}, active_lanes=4)",
        init_roots_ix.data.len(),
        init_roots_ix.data[0],
        DEFAULT_ROOT_EPOCH_INTERVAL
    );
    println!(
        "  Transact      : {} B (tag={}, ring={}:{}, proof={} B Groth16, 1 Tx v1)",
        tx_ix.data.len(),
        tx_ix.data[0],
        ROOT_RING_EPOCH,
        root_ring_idx,
        proved.proof_192.len()
    );
    println!("  ctx_hash priv : {}", to_hex(&fr_to_be_bytes(&ctx_priv)));
    println!("  ctx_hash wsol : {}", to_hex(&fr_to_be_bytes(&ctx_wsol)));
    println!("  ctx_hash exec : {}", to_hex(&fr_to_be_bytes(&ctx_exec)));

    // 5. DISCLOSURE & COMPLIANCE
    let mut sd = SelectiveDisclosureProof {
        pool_id: 0,
        lane_id: 2,
        leaf_index: 5,
        stealth_owner: fr_to_be_bytes(&stealth),
        mint: mint_bytes,
        amount,
        blinding: fr_to_be_bytes(&blinding),
        commitment: cm_be,
    };
    assert!(sd.verify_against_leaf(&cm_be));
    sd.amount += 1;
    assert!(!sd.verify_against_leaf(&cm_be));

    println!("[5/6 DISCLOSURE & COMPLIANCE]");
    println!("  Mode 1 proof  : verified against on-chain leaf (tampered rejected)");
    println!("  Mode 2 FVK    : read-only (spend_pk + nk + view_sk + view_pk, zero spend authority)");

    // 6. RELAYER & ESCROW CPI
    let escrow_usdc_ata = derive_ata(&escrow5_pda, &token_prog, &usdc_mint);
    let escrow_wsol_ata = derive_ata(&escrow5_pda, &token_prog, &wsol_mint);

    println!("[6/6 RELAYER & ESCROW CPI]");
    println!("  Default relay : {DEFAULT_RELAY_URL}");
    println!("  Escrow #5 ATAs: usdc={escrow_usdc_ata}, wsol={escrow_wsol_ata}");
    println!("  Excluded DEXes: {}", JUPITER_CPI_EXCLUDED_DEXES.join(","));
}
