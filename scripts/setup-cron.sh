#!/bin/bash

# Sui-Immunizer: Cronjob Setup Script
# Automatically schedules the scanner to run every hour.

PROJECT_ROOT=$(pwd)
SCANNER_PATH="$PROJECT_ROOT/src/scanner.ts"
LOG_DIR="$PROJECT_ROOT/logs"
LOG_FILE="$LOG_DIR/scanner.log"
BUN_PATH=$(which bun)

if [ -z "$BUN_PATH" ]; then
    echo "❌ Error: 'bun' not found in PATH. Please install Bun first."
    exit 1
fi

mkdir -p "$LOG_DIR"

# Define the cron command
# Runs every hour (0 * * * *)
CRON_CMD="0 * * * * cd $PROJECT_ROOT && $BUN_PATH run $SCANNER_PATH >> $LOG_FILE 2>&1"

# Check if the cronjob already exists
(crontab -l 2>/dev/null | grep -F "$SCANNER_PATH") && {
    echo "ℹ️  Cronjob already exists. Updating..."
    (crontab -l | grep -vF "$SCANNER_PATH"; echo "$CRON_CMD") | crontab -
} || {
    echo "🚀 Installing new cronjob..."
    (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
}

echo "✅ Cronjob scheduled successfully."
echo "📜 Logs will be available at: $LOG_FILE"
echo "🔍 You can manually trigger a scan now with: bun run src/scanner.ts"
