# Sui-Immunizer TODO List

## Current Status
- **Runtime**: Node.js (JavaScript)
- **Status**: Functional Demo (Mock Vulnerability)

## Mocked Components
- **Vulnerability**: Simulates a vulnerability with `mock_threat_event.json`.
- **Sui Interaction**: Watches local file (`mock_threat_event.json`) instead of `SuiClient.subscribeEvent()`.
- **Patch Verification**: Signature verification is faked (`console.log('✅ Signature Valid')`).

## Missing
- **Real Walrus Patches**: Needs a repository of verified scripts.
- **Frontend**: None. Console output only.
- **Move Contract**: No event emission logic.

## Roadmap
- [ ] **Sui Smart Contract**: Write `immunizer::publish_alert(vuln_id, blob_id)`.
- [ ] **Real Walrus Integration**: Fetch blobs via Walrus HTTP API.
- [ ] **Digital Signatures**: Use `TweetNaCl.js` or `ethers.js` to verify patch author signature before executing.
- [ ] **Real System Patches**: Actually execute `iptables` or similar commands (requires Root).
