# Sui-Immunizer (Automated Threat Response)

Track 1: Safety & Security Project.
A decentralized, autonomous "Digital Vaccine" system powered by Sui and Walrus.

## Concept
- **Vulnerability Alert**: Published on Sui (Event-based) with Ed25519 vendor signatures.
- **Fix Payload**: Hosted on Walrus (Immutable storage).
- **Immunizer Agent**: Background process that listens for alerts, fetches verified patches, and auto-patches the host.
- **Security Scanner**: Periodic auditor that identifies vulnerabilities and reports them on-chain.

## Features
- **Access Control**: Capability-based (Admin/Vendor) Move contract.
- **Real-time Response**: Event-driven architecture (no polling).
- **Cyber Dashboard**: Stunning Next.js frontend for monitoring global threats.
- **Automation**: Integrated Cron/Systemd support for Linux/OpenClaw.

## Setup
1. `npm install`
2. Configure `.env` (using `SUI_MNEMONIC`, `VENDOR_PUBKEY`, etc.)
3. Run Dashboard: `npm run dev`
4. Deploy Agent & Scanner: See [DEPLOYMENT.md](DEPLOYMENT.md)

## Flow
1. **Detection**: The Scanner finds a vulnerability and logs it to Sui.
2. **Action**: Vendor publishes a signed fix to Walrus and emits an Alert.
3. **Healing**: The Agent subscribes to the Alert, verifies the signature, and executes the patch.
4. **Monitoring**: View the real-time status on the Cyber-Security Dashboard.
