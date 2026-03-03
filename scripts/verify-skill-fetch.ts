import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SealClient, SessionKey } from '@mysten/seal';
import { Transaction } from '@mysten/sui/transactions';
import { fromHex } from '@mysten/bcs';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────
const SUI_NETWORK = (process.env.SUI_NETWORK as 'testnet' | 'mainnet') || 'testnet';
const PACKAGE_ID = process.env.IMMUNIZER_PACKAGE_ID!;
const WALRUS_AGGREGATOR = process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space';
const SKILL_OBJECT_ID = '0x914bea627a0196d3adf6b2c54fd41d51f2adfc97cd71f1aa84394a5fb388f052';

const SEAL_SERVER_CONFIGS = [
    {
        objectId: process.env.SEAL_KEY_SERVER_1 || '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
        weight: 1,
    },
    {
        objectId: process.env.SEAL_KEY_SERVER_2 || '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
        weight: 1,
    },
];

// ─── Clients ──────────────────────────────────────────────────────────────────
const suiClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(SUI_NETWORK), network: SUI_NETWORK });
const keypair = Ed25519Keypair.deriveKeypair(process.env.SUI_MNEMONIC!);
const address = keypair.toSuiAddress();

const sealClient = new SealClient({
    suiClient: suiClient as any,
    serverConfigs: SEAL_SERVER_CONFIGS,
    verifyKeyServers: false,
} as any);

async function verifyAndFetch() {
    console.log(`📍 Using Address: ${address}`);
    console.log(`🔍 1. Fetching SkillBlob Object: ${SKILL_OBJECT_ID}...`);

    try {
        const objRes = await suiClient.getObject({
            id: SKILL_OBJECT_ID,
            options: { showContent: true, showType: true }
        });

        if (objRes.error || !objRes.data) {
            console.error('❌ Error fetching object:', objRes.error);
            return;
        }

        const fields = (objRes.data.content as any).fields;
        const blobId = fields.blob_id;
        const vendor = fields.vendor;
        console.log(`   ✅ Walrus Blob ID: ${blobId}`);
        console.log(`   ✅ Vendor Address: ${vendor}`);

        // 2. Fetch from Walrus
        console.log(`🌐 2. Fetching Encrypted Blob from Walrus Aggregator...`);
        const walrusRes = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
        if (!walrusRes.ok) {
            console.error(`❌ Walrus fetch failed: ${walrusRes.status}`);
            return;
        }
        const encryptedData = new Uint8Array(await walrusRes.arrayBuffer());
        console.log(`   ✅ Fetched ${encryptedData.length} encrypted bytes.`);

        // 3. Find Authorization NFT
        console.log(`🎫 3. Searching for SubscriberNFT or VendorNFT to authorize decryption...`);
        const owned = await suiClient.getOwnedObjects({
            owner: address,
            filter: {
                MatchAny: [
                    { StructType: `${PACKAGE_ID}::alert::SubscriberNFT` },
                    { StructType: `${PACKAGE_ID}::alert::VendorNFT` },
                ],
            },
            options: { showType: true }
        });

        if (!owned.data.length) {
            console.warn('   ⚠️ No Authorization NFT found for this account. Cannot attempt decryption.');
            console.log('   💡 Only authorized subscribers or the vendor themselves can decrypt.');
            return;
        }

        const nftId = owned.data[0].data!.objectId;
        const isSubscriber = owned.data[0].data!.type!.includes('SubscriberNFT');
        console.log(`   ✅ Using NFT: ${nftId} (${isSubscriber ? 'Subscriber' : 'Vendor'})`);

        // 4. Decrypt via Seal
        console.log(`🔐 4. Decrypting via Seal protocol...`);

        // Setup SessionKey
        const sk = await SessionKey.create({
            address,
            packageId: PACKAGE_ID,
            ttlMin: 10,
            suiClient: suiClient as any,
        });
        const { signature } = await keypair.signPersonalMessage(sk.getPersonalMessage());
        await sk.setPersonalMessageSignature(signature);

        // Build seal_approve TX
        const idBytes = Array.from(fromHex(vendor));
        const approveFunc = isSubscriber ? 'seal_approve_subscriber' : 'seal_approve_vendor';
        const tx = new Transaction();
        tx.moveCall({
            target: `${PACKAGE_ID}::alert::${approveFunc}`,
            arguments: [
                tx.pure.vector('u8', idBytes),
                tx.object(nftId),
                ...(isSubscriber ? [tx.object('0x6')] : []),
            ],
        });
        const txBytes = await tx.build({ client: suiClient as any, onlyTransactionKind: true });

        // Decrypt
        const decrypted = await sealClient.decrypt({ data: encryptedData, sessionKey: sk, txBytes });
        const markdown = new TextDecoder().decode(decrypted);

        console.log('\x1b[32m🎉 SUCCESS! Skill decrypted successfully:\x1b[0m');
        console.log('--- CONTENT START ---');
        console.log(markdown.slice(0, 500) + (markdown.length > 500 ? '...' : ''));
        console.log('--- CONTENT END ---');

    } catch (e) {
        console.error('❌ Fatal error during verification:', e);
    }
}

verifyAndFetch();
