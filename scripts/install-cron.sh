#!/usr/bin/env bash
# =============================================================================
# Sui-Immunizer OpenClaw Cronjob Setup
#
# This script installs a system crontab entry that runs the Sui-Immunizer
# agent every minute. The agent polls the Sui blockchain for new
# VulnerabilityAlert events, decrypts skills via Seal, and dispatches them
# to OpenClaw for AI-driven immunization.
#
# Usage:
#   chmod +x scripts/install-cron.sh
#   ./scripts/install-cron.sh
#
# Manual run (no cron):
#   cd /path/to/sui-immunizer && bun src/agent.ts
# =============================================================================

set -e

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${AGENT_DIR}/logs"
LOG_FILE="${LOG_DIR}/immunizer.log"
ENV_FILE="${AGENT_DIR}/.env"

mkdir -p "$LOG_DIR"

# Validate environment
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env file not found at $AGENT_DIR/.env"
    echo "   Copy .env.example and fill in your values."
    exit 1
fi

if [ -z "$SUI_MNEMONIC" ] && ! grep -q "SUI_MNEMONIC" "$ENV_FILE"; then
    echo "⚠️  WARNING: SUI_MNEMONIC not set in .env"
fi

# Build the cron command
CRON_CMD="* * * * * cd ${AGENT_DIR} && bun src/agent.ts >> ${LOG_FILE} 2>&1"

# Check if already installed
if crontab -l 2>/dev/null | grep -q "sui-immunizer\|immunizer/src/agent"; then
    echo "✅ Cron already installed. Current entry:"
    crontab -l | grep -E "immunizer|agent"
    exit 0
fi

# Install
(crontab -l 2>/dev/null || true; echo "# sui-immunizer - runs every minute"; echo "$CRON_CMD") | crontab -

echo "✅ Cron installed:"
echo "   $CRON_CMD"
echo ""
echo "📋 Monitor logs:"
echo "   tail -f $LOG_FILE"
echo ""
echo "🗑️  To remove:"
echo "   crontab -l | grep -v immunizer | crontab -"
