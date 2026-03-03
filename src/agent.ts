/**
 * Sui-Immunizer Agent — OpenClaw Integration
 *
 * Flow:
 *  1. Poll Sui for VulnerabilityAlert events (cronjob)
 *  2. Seal-decrypt skill.md from Walrus
 *  3. Notify user "正在执行免疫" via on-chain ImmunizationStarted event
 *  4. Pass skill.md to OpenClaw's runEmbeddedPiAgent() for AI-driven execution
 *  5. Report result on-chain: vulnerability_found=true/false + summary
 *
 * Run: bun src/agent.ts
 * Cron: see scripts/openclaw-cron.sh
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { SealClient, SessionKey } from '@mysten/seal';
// openclaw is installed on the subscriber's server at runtime
// @ts-expect-error — not installed yet, will be at deploy time
import { runEmbeddedPiAgent } from 'openclaw/agents/pi-embedded-runner.js';
import fetch from 'node-fetch';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────
const SUI_NETWORK = (process.env.SUI_NETWORK as 'testnet' | 'mainnet') || 'testnet';
const PACKAGE_ID = process.env.IMMUNIZER_PACKAGE_ID || '0x_IMMUNIZER';
const SCAN_INTERVAL = 60_000; // 1 minute polling

const WALRUS_AGGREGATOR = process.env.WALRUS_AGGREGATOR_URL
    || 'https://aggregator.walrus-testnet.walrus.space';

// OpenClaw workspace for this agent's sessions
const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE
    || path.join(process.env.HOME || '~', '.openclaw/workspace/immunizer');

// Notification channel sender key (e.g. user's WhatsApp number / Telegram ID)
const NOTIFY_SESSION_KEY = process.env.OPENCLAW_NOTIFY_SESSION_KEY || 'main:telegram:immunizer';

// ─── Seal Testnet Key Servers (Mysten Labs Open Mode) ─────────────────────────
// Override via SEAL_KEY_SERVER_1 / SEAL_KEY_SERVER_2 in .env
const SEAL_SERVER_CONFIGS = [
    {
        objectId: process.env.SEAL_KEY_SERVER_1 ||
            '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
        weight: 1,
    },
    {
        objectId: process.env.SEAL_KEY_SERVER_2 ||
            '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
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

let cachedSessionKey: SessionKey | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build and send a Sui transaction */
async function sendTx(buildFn: (tx: Transaction) => void): Promise<string> {
    const tx = new Transaction();
    buildFn(tx);
    const result = await suiClient.signAndExecuteTransaction({ signer: keypair, transaction: tx });
    return result.digest;
}

/** Emit ImmunizationStarted event so frontend/subscribers know we started */
async function notifyStarted(vulnId: string, title: string, vendor: string) {
    await sendTx((tx) => {
        tx.moveCall({
            target: `${PACKAGE_ID}::alert::report_immunization_started`,
            arguments: [
                tx.pure.string(vulnId),
                tx.pure.string(title),
                tx.pure.address(vendor),
                tx.pure.u64(BigInt(Date.now())),
            ],
        });
    });
}

/** Emit SystemImmunized event with final result */
async function notifyComplete(
    vulnId: string,
    vulnerabilityFound: boolean,
    summary: string,
) {
    await sendTx((tx) => {
        tx.moveCall({
            target: `${PACKAGE_ID}::alert::report_immunization`,
            arguments: [
                tx.pure.string(vulnId),
                tx.pure.u64(BigInt(Date.now())),
                tx.pure.bool(vulnerabilityFound),
                tx.pure.string(summary.slice(0, 500)), // cap at 500 chars
            ],
        });
    });
}

// ─── Seal SessionKey ──────────────────────────────────────────────────────────
async function getOrCreateSessionKey(): Promise<SessionKey> {
    if (cachedSessionKey) return cachedSessionKey;
    const sk = await SessionKey.create({
        address,
        packageId: PACKAGE_ID,
        ttlMin: 10,
        suiClient: suiClient as any,
    });
    const { signature } = await keypair.signPersonalMessage(sk.getPersonalMessage());
    await sk.setPersonalMessageSignature(signature);
    cachedSessionKey = sk;
    setTimeout(() => { cachedSessionKey = null; }, 9.5 * 60 * 1000);
    return sk;
}

// ─── Subscription Check ───────────────────────────────────────────────────────
async function checkSubscription(): Promise<{ nftId: string; isSubscriber: boolean }> {
    const owned = await suiClient.getOwnedObjects({
        owner: address,
        filter: {
            MatchAny: [
                { StructType: `${PACKAGE_ID}::alert::SubscriberNFT` },
                { StructType: `${PACKAGE_ID}::alert::VendorNFT` },
            ],
        },
        options: { showType: true },
    });
    if (!owned.data.length) throw new Error('❌ No SubscriberNFT or VendorNFT found for agent address.');
    const isSubscriber = owned.data.some((o: any) => o.data?.type?.includes('SubscriberNFT'));
    return { nftId: owned.data[0].data!.objectId!, isSubscriber };
}

// ─── Seal Decrypt ─────────────────────────────────────────────────────────────
async function decryptSkill(
    blobId: string,
    sealId: string,
    nftId: string,
    isSubscriber: boolean,
): Promise<string> {
    // 1. Fetch from Walrus
    const res = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
    if (!res.ok) throw new Error(`Walrus fetch failed: ${res.status}`);
    const encrypted = new Uint8Array(await res.arrayBuffer() as ArrayBuffer);

    // 2. Build seal_approve TX
    const sk = await getOrCreateSessionKey();
    const approveFunc = isSubscriber ? 'seal_approve_subscriber' : 'seal_approve_vendor';
    const tx = new Transaction();
    tx.moveCall({
        target: `${PACKAGE_ID}::alert::${approveFunc}`,
        arguments: [
            tx.pure.string(sealId),
            tx.object(nftId),
            ...(isSubscriber ? [tx.object('0x6')] : []),
        ],
    });
    const txBytes = await tx.build({ client: suiClient as any, onlyTransactionKind: true });

    // 3. Decrypt
    const decrypted = await sealClient.decrypt({ data: encrypted, sessionKey: sk, txBytes });
    return new TextDecoder().decode(decrypted);
}

// ─── OpenClaw Execution ───────────────────────────────────────────────────────

/**
 * Dispatch the decrypted skill.md to OpenClaw's embedded AI agent.
 * The agent will read the tutorial, check if the vulnerability exists,
 * apply fixes, and return a text summary.
 */
async function executeSkillWithAI(
    skillText: string,
    vulnId: string,
    workspaceDir: string,
): Promise<{ vulnerabilityFound: boolean; summary: string }> {
    const agentDir = path.join(workspaceDir, '.immunizer-agent');
    fs.mkdirSync(agentDir, { recursive: true });

    const sessionFile = path.join(agentDir, `${vulnId}-session.jsonl`);

    // Craft the immunization prompt
    const prompt = `
You are an automated security immunization agent running on a protected server.
You have just received the following vulnerability detection and remediation guide from a trusted security vendor.

Your job:
1. Read the guide carefully.
2. Check if this vulnerability EXISTS on this system using the described detection method.
3. If the vulnerability IS present: apply the remediation steps described.
4. Report your findings concisely at the end.

--- SKILL.MD BEGINS ---
${skillText}
--- SKILL.MD ENDS ---

After completing all steps, output a final summary starting with either:
- "VULNERABILITY CONFIRMED AND PATCHED:" followed by what you found and fixed.
- "SYSTEM HEALTHY:" followed by evidence that the vulnerability does not apply.
`.trim();

    let summary = '';
    let vulnerabilityFound = false;

    await runEmbeddedPiAgent({
        sessionId: `immunizer-${vulnId}`,
        sessionKey: NOTIFY_SESSION_KEY,
        sessionFile,
        workspaceDir,
        config: {}, // picks up ~/.openclaw/openclaw.json automatically
        prompt,
        provider: (process.env.OPENCLAW_PROVIDER as any) || 'anthropic',
        model: process.env.OPENCLAW_MODEL || 'claude-sonnet-4-20250514',
        timeoutMs: 5 * 60 * 1000, // 5 minute timeout
        runId: `immunizer-${vulnId}-${Date.now()}`,
        onBlockReply: async (payload: { text: string }) => {
            summary += payload.text + '\n';
            // Detect from agent's final summary whether vuln was found
            if (/VULNERABILITY CONFIRMED/i.test(payload.text)) {
                vulnerabilityFound = true;
            }
        },
    });

    return { vulnerabilityFound, summary: summary.trim() };
}

// ─── Handle Threat ────────────────────────────────────────────────────────────
async function handleThreat(event: {
    vuln_id: string;
    title: string;
    vendor: string;
    severity: number;
    blob_id: string;
    skill_blob_id: string;
    nftId: string;
    isSubscriber: boolean;
}) {
    const { vuln_id, title, vendor, severity, blob_id, skill_blob_id, nftId, isSubscriber } = event;
    const workspaceDir = path.join(OPENCLAW_WORKSPACE, vuln_id);

    // Skip already handled
    const doneFile = path.join(workspaceDir, '.done');
    if (fs.existsSync(doneFile)) return;

    console.log(`\n🚨 THREAT: [Severity ${severity}] ${title} (${vuln_id})`);
    console.log(`   Vendor: ${vendor}`);

    // 1. Notify chain: starting
    console.log('📡 Emitting ImmunizationStarted event on Sui...');
    await notifyStarted(vuln_id, title, vendor).catch(console.warn);

    // 2. Decrypt skill from Walrus
    console.log('🔐 Decrypting skill from Walrus via Seal...');
    const skillText = await decryptSkill(blob_id, skill_blob_id, nftId, isSubscriber);
    console.log(`✅ Skill decrypted (${skillText.length} chars)`);

    // 3. Save raw skill for audit
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, 'skill.md'), skillText);

    // 4. Run via OpenClaw AI
    console.log('🤖 Dispatching to OpenClaw AI agent...');
    const { vulnerabilityFound, summary } = await executeSkillWithAI(skillText, vuln_id, workspaceDir);

    // 5. Log result
    const status = vulnerabilityFound
        ? '🛡️  VULNERABILITY CONFIRMED AND PATCHED'
        : '✅  SYSTEM HEALTHY — No further action needed';
    console.log(`\n${status}`);
    console.log(summary);

    // 6. Report on-chain
    console.log('⛓️  Writing immunization result to Sui...');
    await notifyComplete(vuln_id, vulnerabilityFound, summary);

    // 7. Mark done
    fs.writeFileSync(doneFile, new Date().toISOString());
    console.log(`💉 Immunization complete for ${vuln_id}`);
}

// ─── Scan Chain ───────────────────────────────────────────────────────────────
async function scanAndImmunize() {
    const { nftId, isSubscriber } = await checkSubscription();
    console.log(`📡 [${new Date().toISOString()}] Scanning Sui for new vulnerabilities...`);

    const events = await suiClient.queryEvents({
        query: { MoveModule: { package: PACKAGE_ID, module: 'alert' } },
        limit: 20,
        order: 'descending',
    });

    for (const event of events.data) {
        const data = event.parsedJson as {
            vuln_id?: string;
            title?: string;
            vendor?: string;
            severity?: number;
            blob_id?: string;
            patch_blob_id?: string;
            skill_blob_id?: string;
        };
        if (!data.vuln_id) continue;
        const blobId = data.blob_id || data.patch_blob_id;
        if (!blobId) continue;

        await handleThreat({
            vuln_id: data.vuln_id,
            title: data.title || 'Unknown Vulnerability',
            vendor: data.vendor || '0x0',
            severity: data.severity || 0,
            blob_id: blobId,
            skill_blob_id: data.skill_blob_id || data.vuln_id,
            nftId,
            isSubscriber,
        }).catch((e) => console.error(`[ERROR] handleThreat(${data.vuln_id}):`, e));
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('💉 Sui-Immunizer Agent (OpenClaw Edition) starting...');
    console.log(`📍 Sui Address : ${address}`);
    console.log(`🌐 Network     : ${SUI_NETWORK}`);
    console.log(`📁 Workspace   : ${OPENCLAW_WORKSPACE}`);

    fs.mkdirSync(OPENCLAW_WORKSPACE, { recursive: true });

    await scanAndImmunize();

    setInterval(async () => {
        await scanAndImmunize().catch((e) => console.error('[CRON ERROR]', e));
    }, SCAN_INTERVAL);
}

main().catch((e) => {
    console.error('[FATAL]', e);
    process.exit(1);
});
