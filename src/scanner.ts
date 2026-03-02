import * as fs from 'fs';
import * as path from 'path';
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import * as dotenv from 'dotenv';
dotenv.config();

const WORKSPACE = process.env.SCAN_WORKSPACE || process.cwd();
const PACKAGE_ID = process.env.IMMUNIZER_PACKAGE_ID || '0x0';
const SUI_NETWORK = (process.env.SUI_NETWORK as any) || 'testnet';

const client = new SuiClient({ url: getFullnodeUrl(SUI_NETWORK) });
const keypair = Ed25519Keypair.deriveKeypair(process.env.SUI_MNEMONIC!);

async function scanMoveFiles(dir: string): Promise<string[]> {
    let moveFiles: string[] = [];
    const IGNORE_DIRS = ['build', 'node_modules', 'venv', '.move', '.git'];

    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (!IGNORE_DIRS.includes(file)) {
                moveFiles = moveFiles.concat(await scanMoveFiles(fullPath));
            }
        } else if (file.endsWith('.move')) {
            moveFiles.push(fullPath);
        }
    }
    return moveFiles;
}

async function runAudit() {
    console.log(`🔍 [Security Scanner] Initializing scan for workspace: ${WORKSPACE}`);

    const targetFiles = await scanMoveFiles(WORKSPACE);
    console.log(`📂 Found ${targetFiles.length} Move files to audit.`);

    for (const file of targetFiles) {
        console.log(`🛡️  Auditing: ${file}...`);
        const content = fs.readFileSync(file, 'utf-8');

        // Example logic: Check for unprotected entry functions
        if (content.includes('public entry') && !content.includes('allow(lint(public_entry))')) {
            console.warn(`🚨 [VULN] Potential deprecated pattern in ${file}: Unprotected entry function.`);
            await logToSui(file, 'DEPRECATED_ENTRY_PATTERN');
        }
    }

    console.log('✅ [Security Scanner] Scan completed.');
}

async function logToSui(filePath: string, vulnType: string) {
    console.log(`🔗 Logging vulnerability [${vulnType}] to Sui for file: ${path.basename(filePath)}`);
    try {
        const tx = new Transaction();
        tx.moveCall({
            target: `${PACKAGE_ID}::alert::report_immunization`,
            arguments: [
                tx.pure.string(vulnType),
                tx.pure.u64(Date.now()),
            ],
        });
        const result = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx });
        console.log(`✅ Vulnerability anchored on-chain. TX: ${result.digest}`);
    } catch (e) {
        console.error('Sui Logging failed:', e);
    }
}

runAudit().catch(console.error);
