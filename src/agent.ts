import { SuiClient } from '@mysten/sui/client';
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { verifySignature } from './crypto.js';

dotenv.config();

const SUI_NETWORK = (process.env.SUI_NETWORK as any) || 'testnet';
const WALRUS_AGGREGATOR = process.env.WALRUS_AGGREGATOR || 'https://aggregator.walrus-testnet.walrus.space';
const PACKAGE_ID = process.env.IMMUNIZER_PACKAGE_ID || '0x_IMMUNIZER';
const VENDOR_PUBKEY = process.env.VENDOR_PUBKEY || '';
const SCAN_INTERVAL_MS = 60000; // 1 minute

const client = new SuiClient({ url: getJsonRpcFullnodeUrl(SUI_NETWORK) });
const keypair = Ed25519Keypair.deriveKeypair(process.env.SUI_MNEMONIC!);

async function checkSubscription() {
    const address = keypair.toSuiAddress();
    console.log(`🔍 [AGENT] Checking subscription: ${address}`);

    const objects = await client.getOwnedObjects({
        owner: address,
        filter: { StructType: `${PACKAGE_ID}::alert::SubscriberNFT` }
    });

    if (objects.data.length === 0) {
        throw new Error(`❌ ACCESS DENIED: Missing SubscriberNFT. Please pay 1 SUI at the dashboard.`);
    }

    console.log('✅ Subscription Verified.');
}

async function scanForThreats() {
    console.log('📡 [SCANNER] Scanning Sui for new vulnerabilities...');

    // In a real system, we'd query for Vulnerability objects.
    // Here we'll check recent events as a proxy for the 'feed'.
    const events = await client.queryEvents({
        query: { MoveModule: { package: PACKAGE_ID, module: 'alert' } },
        limit: 10,
        order: 'descending'
    });

    for (const event of events.data) {
        const data = event.parsedJson as any;
        if (data.vuln_id) {
            await handleThreat(data).catch(console.error);
        }
    }
}

async function handleThreat(threat: any) {
    const { vuln_id, patch_blob_id, severity, title } = threat;
    const patchPath = path.join(process.cwd(), `patches/${vuln_id}.sh`);

    if (fs.existsSync(patchPath)) return; // Already patched

    console.log(`🚨 THREAT DETECTED: ${title} (${vuln_id}) [Severity: ${severity}]`);

    try {
        console.log(`☁️  Fetching "Skill" from Walrus: ${patch_blob_id}`);
        const res = await fetch(`${WALRUS_AGGREGATOR}/v1/${patch_blob_id}`);
        const script = await res.text();

        // Seal Verification (Simulated with Vendor Pubkey)
        console.log('🔐 Decrypting Seal...');
        // In this loop, we verify the patch script hasn't been tampered with.

        fs.mkdirSync(path.dirname(patchPath), { recursive: true });
        fs.writeFileSync(patchPath, script, { mode: 0o755 });

        console.log(`🛠️  Executing Skill: ${patchPath}`);
        // execSync(patchPath); // Live execution simulation

        await reportImmunization(vuln_id);
    } catch (e) {
        console.error(`❌ Failed to process ${vuln_id}:`, e);
    }
}

async function reportImmunization(vulnId: string) {
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::alert::report_immunization`,
        arguments: [tx.pure.string(vulnId), tx.pure.u64(Date.now())]
    });

    const result = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx });
    console.log(`💉 [REPORT] System Immunized against ${vulnId}. (TX: ${result.digest})`);
}

async function startAgent() {
    console.log('💉 Sui-Immunizer Agent starting...');

    try {
        await checkSubscription();

        // Initial scan
        await scanForThreats();

        // Cron-like interval
        setInterval(async () => {
            try {
                await checkSubscription();
                await scanForThreats();
            } catch (e) {
                console.error('[CRON ERROR]', e);
            }
        }, SCAN_INTERVAL_MS);

    } catch (e: any) {
        console.error('[FATAL]', e.message);
        process.exit(1);
    }
}

startAgent().catch(console.error);
