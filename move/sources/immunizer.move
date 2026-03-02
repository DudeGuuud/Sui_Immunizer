module immunizer::alert;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::object::{Self, UID};
use sui::sui::SUI;
use sui::transfer;
use sui::vec_set::{Self, VecSet};

// --- Errors ---
const EInsufficientFunds: u64 = 0;
const EAlreadyRegistered: u64 = 1;

// --- Capabilities & NFTs ---

public struct AdminCap has key, store {
    id: UID,
}

public struct Registry has key {
    id: UID,
    subscription_price: u64,
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
    expiry_ms: u64,
}

public struct Vulnerability has key, store {
    id: UID,
    vuln_id: String,
    title: String,
    severity: u8,
    patch_blob_id: String, // Encrypted "Seal" blob ID
    vendor: address,
}

// --- Events ---

public struct VulnerabilityAlert has copy, drop {
    vendor: address,
    vuln_id: String,
    title: String,
    severity: u8,
}

public struct VendorRegistered has copy, drop {
    vendor: address,
    name: String,
}

public struct SystemImmunized has copy, drop {
    node_id: address,
    vuln_id: String,
    timestamp_ms: u64,
}

// --- Init ---

fun init(ctx: &mut TxContext) {
    transfer::transfer(
        AdminCap {
            id: object::new(ctx),
        },
        tx_context::sender(ctx),
    );

    transfer::share_object(Registry {
        id: object::new(ctx),
        subscription_price: 1000000000, // 1 SUI default
        balance: balance::zero(),
    });

    transfer::share_object(VendorRegistry {
        id: object::new(ctx),
        vendors: vec_set::empty(),
    });
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
    ctx: &mut TxContext,
) {
    assert!(coin::value(&payment) >= registry.subscription_price, EInsufficientFunds);

    let paid_balance = coin::into_balance(payment);
    balance::join(&mut registry.balance, paid_balance);

    transfer::transfer(
        SubscriberNFT {
            id: object::new(ctx),
            user_name,
            expiry_ms: 0, // Placeholder for expiry logic
        },
        tx_context::sender(ctx),
    );
}

public fun publish_vulnerability(
    _vendor_nft: &VendorNFT,
    vuln_id: String,
    title: String,
    severity: u8,
    patch_blob_id: String,
    ctx: &mut TxContext,
) {
    let vulnerability = Vulnerability {
        id: object::new(ctx),
        vuln_id,
        title,
        severity,
        patch_blob_id,
        vendor: tx_context::sender(ctx),
    };

    event::emit(VulnerabilityAlert {
        vendor: tx_context::sender(ctx),
        vuln_id,
        title,
        severity,
    });

    transfer::share_object(vulnerability);
}

public fun report_immunization(vuln_id: String, timestamp_ms: u64, ctx: &mut TxContext) {
    event::emit(SystemImmunized {
        node_id: tx_context::sender(ctx),
        vuln_id,
        timestamp_ms,
    });
}

public fun set_price(_admin: &AdminCap, registry: &mut Registry, new_price: u64) {
    registry.subscription_price = new_price;
}

public fun withdraw_fees(_admin: &AdminCap, registry: &mut Registry, ctx: &mut TxContext) {
    let amount = balance::value(&registry.balance);
    let fees = coin::take(&mut registry.balance, amount, ctx);
    transfer::public_transfer(fees, tx_context::sender(ctx));
}
