module immunizer::alert;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::object::{Self, UID};
use sui::sui::SUI;
use sui::transfer;
use sui::vec_set::{Self, VecSet};

// --- Errors ---
const EInsufficientFunds: u64 = 0;
const EAlreadyRegistered: u64 = 1;
const EExpired: u64 = 2;

// --- Capabilities & NFTs ---

public struct AdminCap has key, store {
    id: UID,
}

public struct Registry has key {
    id: UID,
    subscription_price: u64,
    subscription_duration_ms: u64,
    balance: Balance<SUI>,
}

public struct VendorRegistry has key {
    id: UID,
    vendors: VecSet<address>,
}

public struct VendorNFT has key, store {
    id: UID,
    name: String,
    description: String,
}

public struct SubscriberNFT has key, store {
    id: UID,
    user_name: String,
    expiry_ms: u64, // 0 means no expiry
}

/// SkillBlob: on-chain index of an encrypted Seal skill blob on Walrus.
/// Title is public (browsable); blob_id points to Seal-encrypted content on Walrus.
public struct SkillBlob has key, store {
    id: UID,
    vuln_id: String,
    title: String, // Public: visible to everyone
    description: String, // Public: short summary
    severity: u8,
    blob_id: String, // Walrus blob ID (content is Seal-encrypted)
    vendor: address,
    created_at_ms: u64,
}

// --- Events ---

public struct VulnerabilityAlert has copy, drop {
    skill_blob_id: address,
    vendor: address,
    vuln_id: String,
    title: String,
    severity: u8,
    blob_id: String, // Walrus blob ID so subscribers can fetch & decrypt
}

public struct VendorRegistered has copy, drop {
    vendor: address,
    name: String,
}

/// Emitted immediately when agent starts processing a vulnerability
public struct ImmunizationStarted has copy, drop {
    node_id: address,
    vuln_id: String,
    title: String,
    vendor: address,
    timestamp_ms: u64,
}

/// Emitted after all skill steps have completed
public struct SystemImmunized has copy, drop {
    node_id: address,
    vuln_id: String,
    timestamp_ms: u64,
    /// true  = vulnerability was confirmed present and patched
    /// false = system was already healthy, no action needed
    vulnerability_found: bool,
    step_summary: String, // human-readable result summary
}

// --- Init ---

fun init(ctx: &mut TxContext) {
    transfer::transfer(
        AdminCap {
            id: object::new(ctx),
        },
        ctx.sender(),
    );

    transfer::share_object(Registry {
        id: object::new(ctx),
        subscription_price: 1000000000, // 1 SUI default
        subscription_duration_ms: 30 * 24 * 60 * 60 * 1000, // 30 days
        balance: balance::zero(),
    });

    transfer::share_object(VendorRegistry {
        id: object::new(ctx),
        vendors: vec_set::empty(),
    });
}

// --- Access Control ---

/// seal_approve: Called by Seal key servers to verify decryption access.
/// The caller must present a valid SubscriberNFT or VendorNFT.
/// For SubscriberNFT: checks expiry (0 = permanent, >0 = must not be expired).
/// The `id` parameter is the Seal identity bytes (ignored here; policy is NFT-based).
entry fun seal_approve_subscriber(
    id: vector<u8>,
    subscriber_nft: &SubscriberNFT,
    clock: &Clock,
    _ctx: &TxContext,
) {
    let _ = id;
    // If expiry is set, check it has not passed
    if (subscriber_nft.expiry_ms > 0) {
        assert!(clock.timestamp_ms() <= subscriber_nft.expiry_ms, EExpired);
    };
}

/// Vendors can also decrypt their own skills (for management / re-encryption).
entry fun seal_approve_vendor(id: vector<u8>, _vendor_nft: &VendorNFT, _ctx: &TxContext) {
    let _ = id;
    // Having a VendorNFT is sufficient for vendor access
}

// --- Functions ---

public fun register_vendor(
    _admin: &AdminCap,
    registry: &mut VendorRegistry,
    name: String,
    description: String,
    recipient: address,
    ctx: &mut TxContext,
) {
    assert!(!vec_set::contains(&registry.vendors, &recipient), EAlreadyRegistered);
    vec_set::insert(&mut registry.vendors, recipient);

    transfer::transfer(
        VendorNFT {
            id: object::new(ctx),
            name,
            description,
        },
        recipient,
    );

    event::emit(VendorRegistered {
        vendor: recipient,
        name,
    });
}

public fun subscribe(
    registry: &mut Registry,
    payment: Coin<SUI>,
    user_name: String,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(coin::value(&payment) >= registry.subscription_price, EInsufficientFunds);

    let paid_balance = coin::into_balance(payment);
    balance::join(&mut registry.balance, paid_balance);

    let expiry_ms = clock.timestamp_ms() + registry.subscription_duration_ms;

    transfer::transfer(
        SubscriberNFT {
            id: object::new(ctx),
            user_name,
            expiry_ms,
        },
        ctx.sender(),
    );
}

/// publish_skill: Vendor publishes a Seal-encrypted skill blob on-chain.
/// The blob_id points to Seal-encrypted content on Walrus.
/// Title and description are PUBLIC (browsable by anyone).
/// Only holders of SubscriberNFT or VendorNFT can decrypt via seal_approve_*.
public fun publish_skill(
    _vendor_nft: &VendorNFT,
    vuln_id: String,
    title: String,
    description: String,
    severity: u8,
    blob_id: String,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let skill_blob = SkillBlob {
        id: object::new(ctx),
        vuln_id,
        title,
        description,
        severity,
        blob_id,
        vendor: ctx.sender(),
        created_at_ms: clock.timestamp_ms(),
    };

    let skill_blob_id = object::uid_to_address(&skill_blob.id);

    event::emit(VulnerabilityAlert {
        skill_blob_id,
        vendor: ctx.sender(),
        vuln_id: skill_blob.vuln_id,
        title: skill_blob.title,
        severity: skill_blob.severity,
        blob_id: skill_blob.blob_id,
    });

    transfer::share_object(skill_blob);
}

/// Called by agent when it begins executing a skill
public fun report_immunization_started(
    vuln_id: String,
    title: String,
    vendor: address,
    timestamp_ms: u64,
    ctx: &TxContext,
) {
    event::emit(ImmunizationStarted {
        node_id: ctx.sender(),
        vuln_id,
        title,
        vendor,
        timestamp_ms,
    });
}

/// Called by agent after all skill steps have finished
public fun report_immunization(
    vuln_id: String,
    timestamp_ms: u64,
    vulnerability_found: bool,
    step_summary: String,
    ctx: &TxContext,
) {
    event::emit(SystemImmunized {
        node_id: ctx.sender(),
        vuln_id,
        timestamp_ms,
        vulnerability_found,
        step_summary,
    });
}

public fun set_price(_admin: &AdminCap, registry: &mut Registry, new_price: u64) {
    registry.subscription_price = new_price;
}

public fun withdraw_fees(_admin: &AdminCap, registry: &mut Registry, ctx: &mut TxContext) {
    let amount = balance::value(&registry.balance);
    let fees = coin::take(&mut registry.balance, amount, ctx);
    transfer::public_transfer(fees, ctx.sender());
}
