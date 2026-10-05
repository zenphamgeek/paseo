#!/usr/bin/env bash
# ==============================================================================
# Zencode Brand Maintenance & Deployment Engine (brand.sh)
#
# Description:
#   Synchronizes, audits, and maintains Zencode Branding assets across all
#   workspaces (mobile/expo app, website, desktop app, and daemon web UI).
#
# Brand Source:
#   /home/zen/zencode/Zencode_Brand (or ZENCODE_BRAND_DIR)
#
# Primary Colors:
#   Mint:  #20E9C3
#   Navy:  #071225
#   White: #F8FAFC
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# Configuration & Paths
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}"
DEFAULT_BRAND_DIR="/home/zen/zencode/Zencode_Brand"
BRAND_DIR="${ZENCODE_BRAND_DIR:-${DEFAULT_BRAND_DIR}}"
BACKUP_DIR="${REPO_ROOT}/.brand_backups"

# Colors for CLI Output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ------------------------------------------------------------------------------
# Helper Functions
# ------------------------------------------------------------------------------
log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

log_header() {
    echo -e "\n${BOLD}${CYAN}=== $* ===${NC}"
}

verify_brand_dir() {
    if [[ ! -d "${BRAND_DIR}" ]]; then
        log_error "Zencode_Brand directory not found at: ${BRAND_DIR}"
        log_error "Please set ZENCODE_BRAND_DIR or ensure /home/zen/zencode/Zencode_Brand exists."
        exit 1
    fi
}

# ------------------------------------------------------------------------------
# Asset Synchronization Manifest
# Format: "SOURCE_RELATIVE_PATH -> TARGET_RELATIVE_PATH"
# ------------------------------------------------------------------------------
ASSET_PAIRS=(
    # --- Packages / App (Expo & Mobile & Web) ---
    "app-icons/dark/icon-1024.png:packages/app/assets/images/icon.png"
    "app-icons/transparent/icon-512.png:packages/app/assets/images/android-icon-foreground.png"
    "png/zencode-symbol-mint.png:packages/app/assets/images/splash-icon.png"
    "app-icons/transparent/icon-96.png:packages/app/assets/images/notification-icon.png"
    "favicon/favicon-48.png:packages/app/assets/images/favicon.png"
    "favicon/favicon-48.png:packages/app/assets/images/favicon-dark.png"
    "favicon/favicon-48.png:packages/app/assets/images/favicon-light.png"
    "favicon/favicon-48.png:packages/app/assets/images/favicon-dark-running.png"
    "favicon/favicon-48.png:packages/app/assets/images/favicon-light-running.png"
    "favicon/favicon-48.png:packages/app/assets/images/favicon-dark-attention.png"
    "favicon/favicon-48.png:packages/app/assets/images/favicon-light-attention.png"
    "favicon/favicon.svg:packages/app/assets/images/favicon.svg"
    "favicon/favicon.svg:packages/app/assets/images/favicon-dark.svg"
    "favicon/favicon.svg:packages/app/assets/images/favicon-light.svg"
    "favicon/favicon.svg:packages/app/assets/images/favicon-dark-running.svg"
    "favicon/favicon.svg:packages/app/assets/images/favicon-light-running.svg"
    "favicon/favicon.svg:packages/app/assets/images/favicon-dark-attention.svg"
    "favicon/favicon.svg:packages/app/assets/images/favicon-light-attention.svg"
    "svg/zencode-symbol-mint.svg:packages/app/assets/images/butterfly-green.svg"
    "svg/zencode-symbol-white.svg:packages/app/assets/images/butterfly-white.svg"

    # --- Packages / Website ---
    "favicon/favicon.ico:packages/website/public/favicon.ico"
    "favicon/favicon.svg:packages/website/public/favicon.svg"
    "svg/zencode-symbol-mint.svg:packages/website/public/logo.svg"
    "banners/zencode-banner-og.png:packages/website/public/og-image.png"
    "favicon/apple-touch-icon.png:packages/website/public/apple-touch-icon.png"
    "favicon/site.webmanifest:packages/website/public/site.webmanifest"

    # --- Packages / Desktop (Electron) ---
    "app-icons/dark/icon-512.png:packages/desktop/assets/icon.png"
    "app-icons/dark/icon-512.png:packages/desktop/assets/icon-dev.png"
    "favicon/favicon.ico:packages/desktop/assets/icon.ico"
    "app-icons/dark/icon-32.png:packages/desktop/assets/32x32.png"
    "app-icons/dark/icon-64.png:packages/desktop/assets/64x64.png"
    "app-icons/dark/icon-128.png:packages/desktop/assets/128x128.png"
    "app-icons/dark/icon-256.png:packages/desktop/assets/128x128@2x.png"
)

# ------------------------------------------------------------------------------
# Action: Backup
# ------------------------------------------------------------------------------
cmd_backup() {
    log_header "Creating Brand Backup"
    local timestamp
    timestamp="$(date +%Y%m%d_%H%M%S)"
    local target_backup_dir="${BACKUP_DIR}/backup_${timestamp}"
    mkdir -p "${target_backup_dir}"

    local count=0
    for pair in "${ASSET_PAIRS[@]}"; do
        local target_file="${REPO_ROOT}/${pair#*:}"
        if [[ -f "${target_file}" ]]; then
            local rel_path="${pair#*:}"
            local dest="${target_backup_dir}/${rel_path}"
            mkdir -p "$(dirname "${dest}")"
            cp -p "${target_file}" "${dest}"
            ((count++)) || true
        fi
    done

    # Backup component and app config files if exist
    local logo_component="${REPO_ROOT}/packages/app/src/components/icons/paseo-logo.tsx"
    if [[ -f "${logo_component}" ]]; then
        mkdir -p "${target_backup_dir}/packages/app/src/components/icons"
        cp -p "${logo_component}" "${target_backup_dir}/packages/app/src/components/icons/paseo-logo.tsx"
    fi

    echo "${target_backup_dir}" > "${BACKUP_DIR}/latest"
    log_success "Backed up ${count} branding assets to: ${target_backup_dir}"
}

# ------------------------------------------------------------------------------
# Action: Restore
# ------------------------------------------------------------------------------
cmd_restore() {
    log_header "Restoring Previous Brand Backup"
    if [[ ! -f "${BACKUP_DIR}/latest" ]]; then
        log_error "No backup pointer found at ${BACKUP_DIR}/latest"
        exit 1
    fi

    local latest_backup
    latest_backup="$(cat "${BACKUP_DIR}/latest")"
    if [[ ! -d "${latest_backup}" ]]; then
        log_error "Backup directory ${latest_backup} does not exist"
        exit 1
    fi

    log_info "Restoring from: ${latest_backup}"
    local count=0
    while IFS= read -r -d '' file; do
        local rel_path="${file#${latest_backup}/}"
        local dest="${REPO_ROOT}/${rel_path}"
        mkdir -p "$(dirname "${dest}")"
        cp -p "${file}" "${dest}"
        ((count++)) || true
    done < <(find "${latest_backup}" -type f -print0)

    log_success "Restored ${count} assets from ${latest_backup}"
}

# ------------------------------------------------------------------------------
# Action: Update React Logo Component
# ------------------------------------------------------------------------------
update_react_logo_component() {
    log_info "Updating React Native Logo Component (PaseoLogo -> Zencode Symbol)..."
    local logo_file="${REPO_ROOT}/packages/app/src/components/icons/paseo-logo.tsx"
    local symbol_svg="${BRAND_DIR}/svg/zencode-symbol-mint.svg"

    if [[ ! -f "${symbol_svg}" ]]; then
        log_warn "Symbol SVG not found; skipping component vector update."
        return
    fi

    # Extract SVG path data 'd' attribute
    local path_d
    path_d=$(grep -o 'd="[^"]*"' "${symbol_svg}" | sed 's/d="//;s/"$//')

    cat << 'EOF' > "${logo_file}"
import Svg, { G, Path } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

interface PaseoLogoProps {
  size?: number;
  color?: string;
}

export function PaseoLogo({ size = 64, color }: PaseoLogoProps) {
  const { theme } = useUnistyles();
  const fill = color ?? theme.colors.foreground;

  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" fill="none">
      <G transform="translate(80 80) scale(1.1174603174603175)">
        <Path
          fill={fill}
          fillRule="evenodd"
EOF
    echo "          d=\"${path_d}\"" >> "${logo_file}"
    cat << 'EOF' >> "${logo_file}"
        />
      </G>
    </Svg>
  );
}

// Zencode branding alias for forward-compatibility
export { PaseoLogo as ZencodeLogo };
EOF

    log_success "Updated: packages/app/src/components/icons/paseo-logo.tsx"
}

# ------------------------------------------------------------------------------
# Action: Generate Desktop ICNS
# ------------------------------------------------------------------------------
generate_desktop_icns() {
    log_info "Generating macOS Desktop icon.icns via Python Pillow..."
    local source_png="${BRAND_DIR}/app-icons/dark/icon-1024.png"
    local target_icns="${REPO_ROOT}/packages/desktop/assets/icon.icns"

    if [[ -f "${source_png}" ]]; then
        python3 - << PYEOF
try:
    from PIL import Image
    img = Image.open("${source_png}")
    img.save("${target_icns}", format="ICNS")
    print("Desktop ICNS successfully built.")
except Exception as e:
    print(f"Warning: Failed to generate ICNS: {e}")
PYEOF
    fi
}

# ------------------------------------------------------------------------------
# Action: Apply Branding Assets
# ------------------------------------------------------------------------------
cmd_apply() {
    verify_brand_dir
    log_header "Applying Zencode Brand Assets"

    # Step 1: Run automatic backup
    cmd_backup

    # Step 2: Copy image assets
    local applied=0
    for pair in "${ASSET_PAIRS[@]}"; do
        local src_rel="${pair%%:*}"
        local dst_rel="${pair#*:}"
        local src="${BRAND_DIR}/${src_rel}"
        local dst="${REPO_ROOT}/${dst_rel}"

        if [[ ! -f "${src}" ]]; then
            log_warn "Source missing: ${src_rel}"
            continue
        fi

        mkdir -p "$(dirname "${dst}")"
        cp -f "${src}" "${dst}"
        ((applied++)) || true
    done
    log_success "Synced ${applied} brand assets to repository."

    # Step 3: Update React component
    update_react_logo_component

    # Step 4: Generate desktop ICNS
    generate_desktop_icns

    log_header "Zencode Branding Successfully Applied!"
    echo -e "Run ${BOLD}./brand.sh check${NC} to verify integrity across all workspaces."
}

# ------------------------------------------------------------------------------
# Action: Check / Audit Integrity
# ------------------------------------------------------------------------------
cmd_check() {
    verify_brand_dir
    log_header "Auditing Zencode Brand Assets"

    local total=0
    local matched=0
    local diverged=0
    local missing=0

    printf "%-55s %-12s\n" "TARGET ASSET" "STATUS"
    printf "%-55s %-12s\n" "-------------------------------------------------------" "------------"

    for pair in "${ASSET_PAIRS[@]}"; do
        local src_rel="${pair%%:*}"
        local dst_rel="${pair#*:}"
        local src="${BRAND_DIR}/${src_rel}"
        local dst="${REPO_ROOT}/${dst_rel}"
        ((total++)) || true

        if [[ ! -f "${dst}" ]]; then
            printf "%-55s ${RED}%-12s${NC}\n" "${dst_rel}" "MISSING"
            ((missing++)) || true
            continue
        fi

        if [[ ! -f "${src}" ]]; then
            printf "%-55s ${YELLOW}%-12s${NC}\n" "${dst_rel}" "NO_SOURCE"
            continue
        fi

        local hash_src
        local hash_dst
        hash_src=$(sha256sum "${src}" | cut -d' ' -f1)
        hash_dst=$(sha256sum "${dst}" | cut -d' ' -f1)

        if [[ "${hash_src}" == "${hash_dst}" ]]; then
            printf "%-55s ${GREEN}%-12s${NC}\n" "${dst_rel}" "MATCHED"
            ((matched++)) || true
        else
            printf "%-55s ${YELLOW}%-12s${NC}\n" "${dst_rel}" "DIVERGED"
            ((diverged++)) || true
        fi
    done

    echo "-------------------------------------------------------------------"
    echo -e "Total: ${total} | Matched: ${GREEN}${matched}${NC} | Diverged: ${YELLOW}${diverged}${NC} | Missing: ${RED}${missing}${NC}"

    if [[ ${diverged} -eq 0 && ${missing} -eq 0 ]]; then
        log_success "Brand Audit: 100% Brand Compliant!"
        return 0
    else
        log_warn "Brand Audit: Assets require sync. Run './brand.sh apply' to update."
        return 1
    fi
}

# ------------------------------------------------------------------------------
# Action: Clean Build Caches
# ------------------------------------------------------------------------------
cmd_clean() {
    log_header "Cleaning Build & Icon Caches"
    local dirs_to_clean=(
        "${REPO_ROOT}/packages/app/.expo"
        "${REPO_ROOT}/packages/app/dist"
        "${REPO_ROOT}/packages/website/.output"
        "${REPO_ROOT}/packages/website/dist"
        "${REPO_ROOT}/packages/server/dist/server/web-ui"
    )

    for dir in "${dirs_to_clean[@]}"; do
        if [[ -d "${dir}" ]]; then
            log_info "Removing cache: ${dir}"
            rm -rf "${dir}"
        fi
    done
    log_success "Build caches cleaned. Next build will consume fresh brand assets."
}

# ------------------------------------------------------------------------------
# Help Menu
# ------------------------------------------------------------------------------
cmd_help() {
    echo -e "${BOLD}Zencode Brand Maintenance Engine${NC}"
    echo -e "Usage: ./brand.sh [COMMAND]\n"
    echo "Commands:"
    echo "  apply      Synchronize all brand assets, update React components, and build ICNS"
    echo "  check      Audit codebase branding against Zencode_Brand kit"
    echo "  backup     Create a timestamped archive of current repo brand assets"
    echo "  restore    Restore repository assets from the latest backup"
    echo "  clean      Purge frontend and expo build caches to force brand reload"
    echo "  help       Display this help menu"
    echo ""
    echo "Environment Variables:"
    echo "  ZENCODE_BRAND_DIR   Custom path to Zencode_Brand (Default: /home/zen/zencode/Zencode_Brand)"
}

# ------------------------------------------------------------------------------
# Main Dispatcher
# ------------------------------------------------------------------------------
case "${1:-apply}" in
    apply)
        cmd_apply
        ;;
    check|audit)
        cmd_check
        ;;
    backup)
        cmd_backup
        ;;
    restore)
        cmd_restore
        ;;
    clean)
        cmd_clean
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        log_error "Unknown command: ${1}"
        cmd_help
        exit 1
        ;;
esac
