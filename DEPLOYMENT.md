# Suite-Immunizer Deployment Guide (OpenClaw/Linux)

This guide explains how to deploy and automate the Sui-Immunizer system as a background digital guard.

## Architecture
- **Agent (`src/agent.ts`)**: A persistent process that subscribes to Sui events and executes patches in real-time.
- **Scanner (`src/scanner.ts`)**: A periodic task that audits the local workspace for vulnerabilities.
- **Dashboard (`dashboard/`)**: A Next.js frontend for monitoring global threats and unit status.

---

## 1. Prerequisites
- **Bun**: `curl -fsSL https://bun.sh/install | bash`
- **Sui CLI**: Installed and configured for `testnet`.
- **Environment**: Create a `.env` file in the root directory:
  ```env
  SUI_NETWORK=testnet
  SUI_MNEMONIC="your mnemonic here"
  IMMUNIZER_PACKAGE_ID="0x..."
  VENDOR_PUBKEY="hex_public_key"
  WALRUS_AGGREGATOR="https://aggregator.walrus-testnet.walrus.space"
  ```

---

## 2. Deploying the Agent (Systemd)
To ensure the reactive agent stays alive after reboots, create a systemd service:

1. Create `/etc/systemd/system/sui-immunizer.service`:
   ```ini
   [Unit]
   Description=Sui-Immunizer Reactive Agent
   After=network.target

   [Service]
   Type=simple
   User=linuxuser
   WorkingDirectory=/home/linuxuser/openclaw/workspace/sui-immunizer
   ExecStart=/usr/local/bin/bun run src/agent.ts
   Restart=on-failure
   EnvironmentFile=/home/linuxuser/openclaw/workspace/sui-immunizer/.env

   [Install]
   WantedBy=multi-user.target
   ```
2. Enable and start:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable sui-immunizer
   sudo systemctl start sui-immunizer
   ```

---

## 3. Automating the Scanner (Cronjob)
The scanner should run periodically to proactive discover "Zero-Day" patterns.

Run the provided setup script:
```bash
./scripts/setup-cron.sh
```
This will schedule `src/scanner.ts` to run every hour.

---

## 4. Launching the Dashboard
Build and serve the tech-style monitoring interface:

```bash
# In the project root
bun run dev
```
The dashboard will be available at `http://localhost:3000`.

---

## 5. Security Best Practices
- **Root Ports**: If the agent needs to patch `iptables` or system configs, the service should run as `root` (use with CAUTION).
- **Isolation**: It is recommended to run the agent in a dedicated container with mount points to the audited workspace.
