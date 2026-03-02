import { verifySignature } from './src/crypto.js';
import nacl from 'tweetnacl';

async function testCrypto() {
    console.log('🧪 Testing Ed25519 Signature Verification...');

    const keypair = nacl.sign.keyPair();
    const publicKeyHex = Buffer.from(keypair.publicKey).toString('hex');
    const payload = "test-vuln:patch-123:high";
    const message = Buffer.from(payload);
    const signature = nacl.sign.detached(new Uint8Array(message), keypair.secretKey);
    const signatureHex = Buffer.from(signature).toString('hex');

    const isValid = verifySignature(payload, signatureHex, publicKeyHex);
    console.log(`   Result: ${isValid ? '✅ PASS' : '❌ FAIL'}`);

    const isInvalid = verifySignature(payload, signatureHex, '00'.repeat(32));
    console.log(`   Invalid Key Check: ${!isInvalid ? '✅ PASS' : '❌ FAIL'}`);
}

testCrypto().catch(console.error);
