#!/usr/bin/env bash
# ==============================================================================
# Zencode Launcher & Control Center (zencode.sh)
#
# Quick commands to access and interact with Zencode:
#   ./zencode.sh ui       - Start Zencode Daemon with Web UI (http://127.0.0.1:6768)
#   ./zencode.sh pair     - Get instant Web Pairing link & QR code
#   ./zencode.sh status   - Check running Daemon and active port status
#   ./zencode.sh fleet    - Check 15 Swarm Fleet nodes and quotas
#   ./zencode.sh cli ...  - Execute CLI commands (e.g. ./zencode.sh cli ls)
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}"

BOLD='\033[1m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_banner() {
    echo -e "${BOLD}${CYAN}"
    echo "  ███████╗███████╗███╗   ██╗ ██████╗ ██████╗ ██████╗ ███████╗"
    echo "  ╚══███╔╝██╔════╝████╗  ██║██╔════╝██╔═══██╗██╔══██╗██╔════╝"
    echo "    ███╔╝ █████╗  ██╔██╗ ██║██║     ██║   ██║██║  ██║█████╗  "
    echo "   ███╔╝  ██╔══╝  ██║╚██╗██║██║     ██║   ██║██║  ██║██╔══╝  "
    echo "  ███████╗███████╗██║ ╚████║╚██████╗╚██████╔╝██████╔╝███████╗"
    echo "  ╚══════╝╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝"
    echo -e "         Autonomous AI Swarm & Pair-Programming Engine${NC}\n"
}

cmd_ui() {
    print_banner
    echo -e "${GREEN}[*] Starting Zencode Daemon with Web UI...${NC}"
    echo -e "${BLUE}[*] Web Dashboard will be available at:${NC} ${BOLD}http://127.0.0.1:6768${NC}\n"
    export PASEO_WEB_UI_ENABLED=true
    export PASEO_LISTEN="127.0.0.1:6768"
    exec "${REPO_ROOT}/scripts/dev-daemon.sh"
}

cmd_pair() {
    print_banner
    echo -e "${GREEN}[*] Generating Pairing QR Code and Connection Link...${NC}"
    node "${REPO_ROOT}/packages/cli/bin/paseo" pair
}

cmd_status() {
    print_banner
    echo -e "${GREEN}[*] Querying Zencode Daemon Status...${NC}"
    node "${REPO_ROOT}/packages/cli/bin/paseo" status
}

cmd_fleet() {
    print_banner
    echo -e "${GREEN}[*] Querying Zencode Swarm Fleet (15 Nodes)...${NC}"
    if curl -s -f http://127.0.0.1:6768/api/fleet/nodes >/dev/null 2>&1; then
        curl -s http://127.0.0.1:6768/api/fleet/nodes | jq . 2>/dev/null || curl -s http://127.0.0.1:6768/api/fleet/nodes
    elif curl -s -f http://127.0.0.1:6767/api/fleet/nodes >/dev/null 2>&1; then
        curl -s http://127.0.0.1:6767/api/fleet/nodes | jq . 2>/dev/null || curl -s http://127.0.0.1:6767/api/fleet/nodes
    else
        echo -e "${YELLOW}[!] Zencode Daemon is not running on 6768 or 6767.${NC}"
        echo "Run './zencode.sh ui' to start the daemon."
    fi
}

cmd_cli() {
    exec node "${REPO_ROOT}/packages/cli/bin/paseo" "$@"
}

cmd_help() {
    print_banner
    echo "Usage: ./zencode.sh [command]"
    echo ""
    echo "Commands:"
    echo "  ui             Start Zencode Daemon with Web UI on http://127.0.0.1:6768"
    echo "  pair           Print Web pairing QR code and instant browser pairing URL"
    echo "  status         Display running daemon status and connection info"
    echo "  fleet          Query 15 Fleet nodes state, load, and quotas"
    echo "  cli [args...]  Run CLI commands directly (e.g. ./zencode.sh cli ls)"
    echo "  help           Show this help message"
    echo ""
}

case "${1:-ui}" in
    ui)
        cmd_ui
        ;;
    pair)
        cmd_pair
        ;;
    status)
        cmd_status
        ;;
    fleet)
        cmd_fleet
        ;;
    cli)
        shift
        cmd_cli "$@"
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        cmd_cli "$@"
        ;;
esac
