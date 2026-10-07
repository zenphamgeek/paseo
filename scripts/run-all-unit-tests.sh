#!/usr/bin/env bash
set -e

# ==============================================================================
# ZENCODE ALL-FEATURE PARALLEL UNIT TEST RUNNER
# Harnesses concurrent execution across Monorepo workspaces for maximum speed.
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BOLD}${CYAN}===============================================================================${NC}"
echo -e "${BOLD}${CYAN}⚡ ZENCODE MULTI-WORKSPACE PARALLEL UNIT TEST SUITE${NC}"
echo -e "${BOLD}${CYAN}===============================================================================${NC}"
echo -e "Started at: $(date -u +"%Y-%m-%dT%H:%M:%SZ")\n"

TMP_DIR=$(mktemp -d -t zencode-tests-XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

START_TIME=$(date +%s)

echo -e "${YELLOW}🚀 Launching test suites concurrently across workspaces...${NC}"

# 1. Desktop Browser Automation & Stealth Anti-Bot Suite
(
  DESKTOP_START=$(date +%s)
  if npm --prefix packages/desktop run test src/features/browser-automation/ src/features/browser-webviews/ > "$TMP_DIR/desktop.log" 2>&1; then
    DESKTOP_DUR=$(( $(date +%s) - DESKTOP_START ))
    echo "SUCCESS $DESKTOP_DUR" > "$TMP_DIR/desktop.status"
  else
    echo "FAILED" > "$TMP_DIR/desktop.status"
  fi
) &
PID_DESKTOP=$!

# 2. Server Fleet, Swarm, Analytics, Self-Healing, and Browser Tools Suite
(
  SERVER_START=$(date +%s)
  if npx --prefix packages/server vitest run \
      src/server/browser-tools/ \
      src/server/fleet/ \
      src/server/telemetry/ \
      src/server/self-healing/ > "$TMP_DIR/server.log" 2>&1; then
    SERVER_DUR=$(( $(date +%s) - SERVER_START ))
    echo "SUCCESS $SERVER_DUR" > "$TMP_DIR/server.status"
  else
    echo "FAILED" > "$TMP_DIR/server.status"
  fi
) &
PID_SERVER=$!

# 3. App UI, Stores, Audio, and Side Panel Automation Suite
(
  APP_START=$(date +%s)
  if npm --prefix packages/app run test \
      src/desktop/browser/automation/handler.test.ts \
      src/screens/fleet/modal-gpu-swarm-ui.test.ts \
      src/screens/fleet/service-app-icon.test.ts \
      src/stores/conversation-telegram-store.test.ts \
      src/components/fleet-execution-label.test.ts \
      src/utils/vibe-audio.test.ts > "$TMP_DIR/app.log" 2>&1; then
    APP_DUR=$(( $(date +%s) - APP_START ))
    echo "SUCCESS $APP_DUR" > "$TMP_DIR/app.status"
  else
    echo "FAILED" > "$TMP_DIR/app.status"
  fi
) &
PID_APP=$!

# Wait for all background test processes to complete
wait $PID_DESKTOP
wait $PID_SERVER
wait $PID_APP

TOTAL_DURATION=$(( $(date +%s) - START_TIME ))

echo -e "\n${BOLD}--- TEST SUITE EXECUTION SUMMARY ---${NC}"

ALL_PASSED=true

# Check Desktop results
if grep -q "SUCCESS" "$TMP_DIR/desktop.status" 2>/dev/null; then
  DUR=$(awk '{print $2}' "$TMP_DIR/desktop.status")
  echo -e "  [${GREEN}✓ PASSED${NC}] packages/desktop (Browser Automation & Stealth Anti-Bot) - ${DUR}s"
else
  ALL_PASSED=false
  echo -e "  [${RED}✗ FAILED${NC}] packages/desktop"
  cat "$TMP_DIR/desktop.log" | tail -n 25
fi

# Check Server results
if grep -q "SUCCESS" "$TMP_DIR/server.status" 2>/dev/null; then
  DUR=$(awk '{print $2}' "$TMP_DIR/server.status")
  echo -e "  [${GREEN}✓ PASSED${NC}] packages/server (Fleet, Swarm, Analytics, Self-Healing, Tools) - ${DUR}s"
else
  ALL_PASSED=false
  echo -e "  [${RED}✗ FAILED${NC}] packages/server"
  cat "$TMP_DIR/server.log" | tail -n 25
fi

# Check App results
if grep -q "SUCCESS" "$TMP_DIR/app.status" 2>/dev/null; then
  DUR=$(awk '{print $2}' "$TMP_DIR/app.status")
  echo -e "  [${GREEN}✓ PASSED${NC}] packages/app (Side Panel Handler, GPU UI, Stores, Vibe Audio) - ${DUR}s"
else
  ALL_PASSED=false
  echo -e "  [${RED}✗ FAILED${NC}] packages/app"
  cat "$TMP_DIR/app.log" | tail -n 25
fi

echo -e "-------------------------------------------------------------------------------"
if [ "$ALL_PASSED" = true ]; then
  echo -e "${BOLD}${GREEN}🎉 ALL 14 FEATURE TEST SUITES PASSED IN ${TOTAL_DURATION}s! READY FOR RELEASE.${NC}\n"
  exit 0
else
  echo -e "${BOLD}${RED}❌ SOME SUITES FAILED. SEE LOGS ABOVE.${NC}\n"
  exit 1
fi
