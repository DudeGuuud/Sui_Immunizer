import nacl from 'tweetnacl';

/**
 * Verifies an Ed25519 signature.
 * @param payload The original data that was signed (as a string).
 * @param signatureHex The signature in hex format.
 * @param publicKeyHex The vendor's public key in hex format.
 */
export function verifySignature(
    payload: string,
    signatureHex: string,
    publicKeyHex: string
): boolean {
    try {
        const message = Buffer.from(payload);
        const signature = Buffer.from(signatureHex, 'hex');
        const publicKey = Buffer.from(publicKeyHex, 'hex');

        return nacl.sign.detached.verify(
            new Uint8Array(message),
            new Uint8Array(signature),
            new Uint8Array(publicKey)
        );
    } catch (e) {
        console.error('Signature verification error:', e);
        return false;
    }
}
