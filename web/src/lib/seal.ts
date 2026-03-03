/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Seal + Walrus integration utilities.
 *
 * All configuration is read from environment variables — no hardcoded values.
 * Exports three functions used by the frontend dashboard:
 *   encryptAndUpload       Seal-encrypt + Walrus PUT
 *   fetchAndDecrypt        Walrus GET + Seal decrypt
 *   createAndInitSessionKey  Build + sign a Seal SessionKey
 *
 * SealId convention (IMPORTANT):
 *   We use the VENDOR ADDRESS (0x…) as the Seal identity for every skill blob
 *   published by that vendor. This is stable, requires no extra event fields,
 *   and means all skills from the same vendor share the same Seal access key.
 *   Both encrypt and decrypt must use the same vendor address string.
 */

import { SealClient, SessionKey } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';

export type { SessionKey };

// ─── Config (all from env) ────────────────────────────────────────────────────

const WALRUS_PUBLISHER =
    process.env.NEXT_PUBLIC_WALRUS_PUBLISHER_URL ||
    'https://publisher.walrus-testnet.walrus.space';

const WALRUS_AGGREGATOR =
    process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ||
    'https://aggregator.walrus-testnet.walrus.space';

const STORAGE_EPOCHS = Number(process.env.NEXT_PUBLIC_WALRUS_STORAGE_EPOCHS) || 5;

// 2-of-2 threshold. Object IDs: https://seal-docs.wal.app
const SEAL_SERVER_CONFIGS = [
    {
        objectId: process.env.NEXT_PUBLIC_SEAL_KEY_SERVER_1 ||
            '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
        weight: 1,
    },
    {
        objectId: process.env.NEXT_PUBLIC_SEAL_KEY_SERVER_2 ||
            '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
        weight: 1,
    },
];

// ─── Internal helpers ─────────────────────────────────────────────────────────

function newSealClient(suiClient: any): SealClient {
    return new SealClient({
        suiClient,
        serverConfigs: SEAL_SERVER_CONFIGS,
        verifyKeyServers: false, // OK for testnet
    } as any);
}

/**
 * Upload raw bytes to Walrus. Returns blobId.
 * Uses native Fetch API (browser + Node.js compatible).
 */
async function walrusPut(data: Uint8Array): Promise<string> {
    const res = await fetch(
        `${WALRUS_PUBLISHER}/v1/blobs?epochs=${STORAGE_EPOCHS}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            // Cast to BodyInit — Uint8Array is valid but TS strict types need the cast
            body: data as unknown as BodyInit,
        },
    );
    if (!res.ok)
        throw new Error(`Walrus upload failed: ${res.status} ${res.statusText}`);

    const json = await res.json() as any;
    const blobId: string =
        json?.newlyCreated?.blobObject?.blobId ||
        json?.alreadyCertified?.blobId;

    if (!blobId) throw new Error('Walrus returned no blobId');
    return blobId;
}

async function walrusGet(blobId: string): Promise<Uint8Array> {
    const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
    if (!res.ok)
        throw new Error(`Walrus fetch failed: ${res.status} ${res.statusText}`);
    return new Uint8Array(await res.arrayBuffer());
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface EncryptUploadResult { blobId: string }

/**
 * Encrypt skill.md with Seal and upload to Walrus.
 * @param plaintext  skill.md markdown content
 * @param packageId  Immunizer package ID (0x…)
 * @param vendorAddress  Vendor's Sui address — used as Seal identity (MUST match decrypt)
 * @param suiClient  live @mysten/dapp-kit client
 * @param onProgress optional step callback for UI
 */
export async function encryptAndUpload(
    plaintext: string,
    packageId: string,
    vendorAddress: string,
    suiClient: any,
    onProgress?: (step: string) => void,
): Promise<EncryptUploadResult> {
    onProgress?.('Encrypting with Seal…');

    // Seal identity: raw bytes of the vendor address string
    const idBytes = new TextEncoder().encode(vendorAddress);

    const { encryptedObject } = await newSealClient(suiClient).encrypt({
        threshold: 2,
        packageId,
        id: idBytes as unknown as string, // Seal SDK types id as string, but accepts bytes
        data: new TextEncoder().encode(plaintext),
    });

    onProgress?.('Uploading to Walrus…');
    const blobId = await walrusPut(encryptedObject);
    onProgress?.('Uploaded ✓');
    return { blobId };
}

/** Sign args type matching @mysten/dapp-kit useSignPersonalMessage */
export type SignPersonalMessageFn = (
    args: { message: Uint8Array },
) => Promise<{ signature: string }>;

/**
 * Create a Seal SessionKey and sign it with the connected wallet.
 * Call once; cache the result for up to ttlMin minutes.
 */
export async function createAndInitSessionKey(
    address: string,
    packageId: string,
    suiClient: any,
    signFn: SignPersonalMessageFn,
): Promise<SessionKey> {
    const sk = await SessionKey.create({ address, packageId, ttlMin: 10, suiClient } as any);
    const msgBytes: Uint8Array = sk.getPersonalMessage();
    const { signature } = await signFn({ message: msgBytes });
    await sk.setPersonalMessageSignature(signature as string);
    return sk;
}

/**
 * Download an encrypted Walrus blob and Seal-decrypt it.
 * @param blobId         Walrus blob ID
 * @param vendorAddress  Vendor's Sui address (same value used during encryption)
 * @param packageId      Immunizer package ID
 * @param moduleFunc     Which seal_approve_* to call
 * @param nftObjectId    Subscriber or Vendor NFT object ID
 * @param sessionKey     Initialized SessionKey
 * @param suiClient      live client
 */
export async function fetchAndDecrypt(
    blobId: string,
    vendorAddress: string,
    packageId: string,
    moduleFunc: 'seal_approve_subscriber' | 'seal_approve_vendor',
    nftObjectId: string,
    sessionKey: SessionKey,
    suiClient: any,
): Promise<string> {
    const encrypted = await walrusGet(blobId);

    // Seal identity must match what was used during encryption
    const idBytes = new TextEncoder().encode(vendorAddress);

    const tx = new Transaction();
    tx.moveCall({
        target: `${packageId}::alert::${moduleFunc}`,
        // Move contract: seal_approve_subscriber(id: vector<u8>, nft: &SubscriberNFT, clock: &Clock)
        //                seal_approve_vendor(id: vector<u8>, nft: &VendorNFT)
        arguments: moduleFunc === 'seal_approve_subscriber'
            ? [tx.pure.vector('u8', Array.from(idBytes)), tx.object(nftObjectId), tx.object('0x6')]
            : [tx.pure.vector('u8', Array.from(idBytes)), tx.object(nftObjectId)],
    });
    const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

    const decrypted = await newSealClient(suiClient).decrypt({
        data: encrypted, sessionKey, txBytes,
    });
    return new TextDecoder().decode(decrypted);
}
