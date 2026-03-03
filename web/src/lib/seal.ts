/**
 * Seal + Walrus Integration Utilities
 *
 * Provides:
 * - encryptAndUpload: Seal-encrypt data, upload to Walrus, return blobId
 * - fetchAndDecrypt: Download from Walrus, Seal-decrypt using SessionKey
 * - createAndInitSessionKey: Build + initialize a SessionKey with wallet signature
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { SealClient, SessionKey } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';

// Re-export SessionKey so pages don't need to import directly from @mysten/seal
export type { SessionKey };

// ─── Seal Testnet Key Servers (Mysten Labs Open Mode) ─────────────────────────
// Object IDs from https://seal-docs.wal.app/Pricing
const SEAL_SERVER_CONFIGS = [
    { objectId: '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', weight: 1 },
    { objectId: '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8', weight: 1 },
];

export const WALRUS_PUBLISHER_URL =
    process.env.NEXT_PUBLIC_WALRUS_PUBLISHER_URL ||
    'https://publisher.walrus-testnet.walrus.space';

export const WALRUS_AGGREGATOR_URL =
    process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ||
    'https://aggregator.walrus-testnet.walrus.space';

const STORAGE_EPOCHS = 5;

// ─── Seal Client Factory ──────────────────────────────────────────────────────

function newSealClient(suiClient: any): SealClient {
    return new SealClient({
        suiClient,
        serverConfigs: SEAL_SERVER_CONFIGS,
        verifyKeyServers: false,
    } as any);
}

// ─── Encryption + Walrus Upload ───────────────────────────────────────────────

export interface EncryptUploadResult {
    blobId: string;
}

/**
 * Encrypt skill.md content with Seal and upload to Walrus.
 *
 * @param plaintext  - The skill.md markdown content
 * @param packageId  - The Immunizer package ID (0x-prefixed hex)
 * @param sealId     - The Seal identity: VendorNFT objectId used as the key namespace
 * @param suiClient  - Any Sui client instance (SuiClient from @mysten/sui/client)
 * @param onProgress - Optional progress callback
 */
export async function encryptAndUpload(
    plaintext: string,
    packageId: string,
    sealId: string,
    suiClient: any,
    onProgress?: (step: string) => void,
): Promise<EncryptUploadResult> {
    onProgress?.('Encrypting with Seal...');

    const sealClient = newSealClient(suiClient);
    const data = new TextEncoder().encode(plaintext);

    const { encryptedObject } = await sealClient.encrypt({
        threshold: 2,
        packageId,
        id: sealId,
        data,
    });

    onProgress?.('Uploading to Walrus...');

    const response = await fetch(
        `${WALRUS_PUBLISHER_URL}/v1/blobs?epochs=${STORAGE_EPOCHS}`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: encryptedObject,
        },
    );

    if (!response.ok) {
        throw new Error(`Walrus upload failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as any;
    const blobId: string =
        result?.newlyCreated?.blobObject?.blobId ||
        result?.alreadyCertified?.blobId;

    if (!blobId) {
        throw new Error('Walrus upload succeeded but no blobId returned');
    }

    onProgress?.('Encrypted blob uploaded to Walrus ✓');
    return { blobId };
}

// ─── Session Key Creation ─────────────────────────────────────────────────────

export type SignPersonalMessageFn = (
    args: { message: Uint8Array },
) => Promise<{ signature: string }>;

/**
 * Create and initialize a Seal SessionKey using a wallet signature.
 * The wallet prompts the user to sign once; the key is valid for ttlMin minutes.
 */
export async function createAndInitSessionKey(
    address: string,
    packageId: string,
    suiClient: any,
    signFn: SignPersonalMessageFn,
): Promise<SessionKey> {
    const sessionKey = await SessionKey.create({
        address,
        packageId,
        ttlMin: 10,
        suiClient,
    });

    const message = sessionKey.getPersonalMessage();
    const { signature } = await signFn({ message });
    await sessionKey.setPersonalMessageSignature(signature);

    return sessionKey;
}

// ─── Walrus Download + Seal Decrypt ──────────────────────────────────────────

/**
 * Download encrypted bytes from Walrus, then Seal-decrypt them.
 *
 * @param blobId      - Walrus blob ID
 * @param sealId      - The Seal identity used during encryption (the VendorNFT objectId)
 * @param packageId   - Immunizer package ID
 * @param moduleFunc  - Which seal_approve function to call
 * @param nftObjectId - The SubscriberNFT or VendorNFT object ID to pass as Move argument
 * @param sessionKey  - Initialized Seal SessionKey
 * @param suiClient   - Sui RPC client
 */
export async function fetchAndDecrypt(
    blobId: string,
    sealId: string,
    packageId: string,
    moduleFunc: 'seal_approve_subscriber' | 'seal_approve_vendor',
    nftObjectId: string,
    sessionKey: SessionKey,
    suiClient: any,
): Promise<string> {
    // 1. Fetch encrypted bytes from Walrus
    const response = await fetch(`${WALRUS_AGGREGATOR_URL}/v1/blobs/${blobId}`);
    if (!response.ok) {
        throw new Error(`Walrus fetch failed: ${response.status} ${response.statusText}`);
    }
    const encryptedBytes = new Uint8Array(await response.arrayBuffer());

    // 2. Build the seal_approve transaction
    const tx = new Transaction();
    tx.moveCall({
        target: `${packageId}::alert::${moduleFunc}`,
        arguments:
            moduleFunc === 'seal_approve_subscriber'
                ? [
                    tx.pure.string(sealId),  // id: the Seal identity bytes
                    tx.object(nftObjectId),
                    tx.object('0x6'),         // Clock (shared object)
                ]
                : [
                    tx.pure.string(sealId),
                    tx.object(nftObjectId),
                ],
    });

    const txBytes = await tx.build({
        client: suiClient,
        onlyTransactionKind: true,
    });

    // 3. Seal decrypt
    const sealClient = newSealClient(suiClient);
    const decryptedBytes = await sealClient.decrypt({
        data: encryptedBytes,
        sessionKey,
        txBytes,
    });

    return new TextDecoder().decode(decryptedBytes);
}
