#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# OpenNova Installer
# https://opennova.dev/install
#
# Usage:
#   curl -fsSL https://opennova.dev/install | bash
#   bash install.sh
#   NOVA_WORKSPACE=~/my-nova bash install.sh
# ─────────────────────────────────────────────────────────────

REQUIRED_NODE_VERSION=20
DEFAULT_WORKSPACE="$HOME/.nova"
CONSOLE_URL="http://localhost:3838/setup"
SERVICE_LABEL="dev.opennova.daemon"

# ─── Color & output helpers ──────────────────────────────────

setup_colors() {
  if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    RESET='\033[0m'
  else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    BOLD=''
    RESET=''
  fi
}

info()  { printf "${BLUE}::${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${RESET} %s\n" "$*" >&2; }
error() { printf "${RED}✗${RESET} %s\n" "$*" >&2; }
fatal() { error "$@"; exit 1; }

is_interactive() {
  [[ -t 0 ]]
}

# ─── Platform detection ──────────────────────────────────────

detect_platform() {
  case "$(uname -s)" in
    Darwin) PLATFORM="macos" ;;
    Linux)  PLATFORM="linux" ;;
    *)      fatal "Unsupported platform: $(uname -s). OpenNova supports macOS and Linux." ;;
  esac
}

# ─── Step 1: Check / install Node.js ─────────────────────────

check_node() {
  info "Checking Node.js..."

  if command -v node &>/dev/null; then
    local node_version
    node_version=$(node -v | sed 's/^v//' | cut -d. -f1)
    if [[ "$node_version" -ge "$REQUIRED_NODE_VERSION" ]]; then
      ok "Node.js $(node -v) found"
      return 0
    else
      warn "Node.js $(node -v) found, but >= v${REQUIRED_NODE_VERSION} is required"
    fi
  else
    warn "Node.js not found"
  fi

  install_node
}

install_node() {
  info "Installing Node.js via nvm..."

  # Install nvm if not present
  if ! command -v nvm &>/dev/null && [[ ! -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
    info "Installing nvm..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi

  # Source nvm
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"

  if ! command -v nvm &>/dev/null; then
    fatal "Failed to install nvm. Please install Node.js >= ${REQUIRED_NODE_VERSION} manually:
  https://nodejs.org/"
  fi

  nvm install "$REQUIRED_NODE_VERSION"
  nvm use "$REQUIRED_NODE_VERSION"

  if ! command -v node &>/dev/null; then
    fatal "Node.js installation failed. Please install Node.js >= ${REQUIRED_NODE_VERSION} manually:
  https://nodejs.org/"
  fi

  ok "Node.js $(node -v) installed via nvm"
}

# ─── Step 2: Install OpenNova ─────────────────────────────────

install_opennova() {
  info "Installing OpenNova..."

  # Check if already installed and up to date
  if command -v nova &>/dev/null; then
    local current_version
    current_version=$(nova --version 2>/dev/null || echo "unknown")
    ok "OpenNova already installed (${current_version}), upgrading..."
  fi

  # Try npm install -g without sudo
  if npm install -g opennova 2>/dev/null; then
    ok "OpenNova installed ($(nova --version 2>/dev/null || echo ""))"
    return 0
  fi

  # If that failed, fix the global prefix
  warn "Global npm directory not writable, configuring user-local prefix..."

  local npm_prefix="$HOME/.npm-global"
  mkdir -p "$npm_prefix"
  npm config set prefix "$npm_prefix"

  # Add to PATH for this session
  export PATH="$npm_prefix/bin:$PATH"

  # Persist PATH addition in shell profile
  local shell_profile
  shell_profile="$(detect_shell_profile)"
  local path_line="export PATH=\"$npm_prefix/bin:\$PATH\""

  if [[ -n "$shell_profile" ]] && ! grep -qF "$npm_prefix/bin" "$shell_profile" 2>/dev/null; then
    printf '\n# npm global path (added by OpenNova installer)\n%s\n' "$path_line" >> "$shell_profile"
    info "Added npm global path to ${shell_profile}"
  fi

  npm install -g opennova || fatal "Failed to install OpenNova. Please check npm permissions."

  ok "OpenNova installed ($(nova --version 2>/dev/null || echo ""))"
}

detect_shell_profile() {
  local shell_name
  shell_name="$(basename "${SHELL:-bash}")"
  case "$shell_name" in
    zsh)  echo "$HOME/.zshrc" ;;
    bash)
      if [[ -f "$HOME/.bash_profile" ]]; then
        echo "$HOME/.bash_profile"
      else
        echo "$HOME/.bashrc"
      fi
      ;;
    *)    echo "$HOME/.profile" ;;
  esac
}

# ─── Step 3: Ask workspace location ──────────────────────────

ask_workspace() {
  # Allow override via env var
  if [[ -n "${NOVA_WORKSPACE:-}" ]]; then
    WORKSPACE="$NOVA_WORKSPACE"
    info "Using workspace from NOVA_WORKSPACE: ${WORKSPACE}"
    return 0
  fi

  WORKSPACE="$DEFAULT_WORKSPACE"

  if ! is_interactive; then
    info "Non-interactive mode, using default workspace: ${WORKSPACE}"
    return 0
  fi

  # Check for existing workspace
  if [[ -d "$DEFAULT_WORKSPACE" ]]; then
    warn "Existing workspace found at ${DEFAULT_WORKSPACE}"
    printf "${BOLD}Continue with existing workspace? [Y/n]${RESET} "
    read -r response
    if [[ "$response" =~ ^[Nn] ]]; then
      printf "${BOLD}Workspace path [${DEFAULT_WORKSPACE}]:${RESET} "
      read -r custom_path
      WORKSPACE="${custom_path:-$DEFAULT_WORKSPACE}"
    fi
    return 0
  fi

  printf "${BOLD}Workspace path [${DEFAULT_WORKSPACE}]:${RESET} "
  read -r custom_path
  WORKSPACE="${custom_path:-$DEFAULT_WORKSPACE}"
}

# ─── Step 4 & 5: Create workspace + download embedding model ─

create_workspace() {
  # Expand tilde if present
  WORKSPACE="${WORKSPACE/#\~/$HOME}"

  info "Initializing workspace at ${WORKSPACE}..."

  nova init --workspace "$WORKSPACE" --non-interactive

  # Ensure logs directory exists for service output
  mkdir -p "${WORKSPACE}/logs"

  ok "Workspace initialized at ${WORKSPACE}"
}

# ─── Step 6: Register system service ─────────────────────────

register_service() {
  info "Registering system service..."

  local nova_bin
  nova_bin="$(command -v nova)"

  case "$PLATFORM" in
    macos) register_launchd "$nova_bin" ;;
    linux) register_systemd "$nova_bin" ;;
  esac
}

register_launchd() {
  local nova_bin="$1"
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_path="${plist_dir}/${SERVICE_LABEL}.plist"

  mkdir -p "$plist_dir"

  cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nova_bin}</string>
    <string>daemon</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NOVA_WORKSPACE</key>
    <string>${WORKSPACE}</string>
    <key>PATH</key>
    <string>${PATH}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${WORKSPACE}/logs/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>${WORKSPACE}/logs/daemon.err</string>
</dict>
</plist>
PLIST

  ok "Launchd plist created at ${plist_path}"
}

register_systemd() {
  local nova_bin="$1"
  local unit_dir="$HOME/.config/systemd/user"
  local unit_path="${unit_dir}/opennova.service"

  mkdir -p "$unit_dir"

  cat > "$unit_path" <<UNIT
[Unit]
Description=OpenNova Daemon
After=network.target

[Service]
Type=simple
Environment=NOVA_WORKSPACE=${WORKSPACE}
Environment=PATH=${PATH}
ExecStart=${nova_bin} daemon
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT

  systemctl --user daemon-reload
  systemctl --user enable opennova

  ok "Systemd user service created at ${unit_path}"
}

# ─── Step 7: Start daemon ────────────────────────────────────

start_daemon() {
  info "Starting daemon..."

  case "$PLATFORM" in
    macos)
      local plist_path="$HOME/Library/LaunchAgents/${SERVICE_LABEL}.plist"

      # Unload first if already loaded (idempotent)
      launchctl bootout "gui/$(id -u)/${SERVICE_LABEL}" 2>/dev/null || true

      launchctl load "$plist_path"
      ;;
    linux)
      systemctl --user start opennova
      ;;
  esac

  # Wait for daemon to be ready
  info "Waiting for daemon to start..."
  local attempts=0
  local max_attempts=30
  while [[ $attempts -lt $max_attempts ]]; do
    if curl -sf http://localhost:3838/api/health &>/dev/null; then
      ok "Daemon running"
      return 0
    fi
    sleep 1
    attempts=$((attempts + 1))
  done

  warn "Daemon may still be starting. Check: nova status"
}

# ─── Step 8: Open browser ────────────────────────────────────

open_browser() {
  case "$PLATFORM" in
    macos)
      open "$CONSOLE_URL" 2>/dev/null || true
      ;;
    linux)
      xdg-open "$CONSOLE_URL" 2>/dev/null || true
      ;;
  esac
}

# ─── Step 9: Print summary ───────────────────────────────────

print_summary() {
  printf "\n"
  printf "${GREEN}✓${RESET} OpenNova installed\n"
  printf "${GREEN}✓${RESET} Workspace created at ${BOLD}${WORKSPACE}${RESET}\n"
  printf "${GREEN}✓${RESET} Daemon registered (auto-starts on boot)\n"
  printf "${GREEN}✓${RESET} Daemon running\n"
  printf "\n"
  printf "  Continue setup at: ${BOLD}${CONSOLE_URL}${RESET}\n"
  printf "\n"
  printf "  To stop:  ${BOLD}nova stop${RESET}\n"
  printf "  To start: ${BOLD}nova start${RESET}\n"
  printf "\n"
}

# ─── Main ─────────────────────────────────────────────────────

main() {
  setup_colors
  detect_platform

  printf "\n"
  printf "${BOLD}OpenNova Installer${RESET}\n"
  printf "\n"

  check_node
  install_opennova
  ask_workspace
  create_workspace
  register_service
  start_daemon
  open_browser
  print_summary
}

main "$@"
