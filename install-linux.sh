#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

MODE="auto"
INSTALL_SYSTEMD=false
RUN_CHECK_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --docker) MODE="docker" ;;
    --native) MODE="native" ;;
    --systemd) MODE="native"; INSTALL_SYSTEMD=true ;;
    --check) RUN_CHECK_ONLY=true ;;
    --help|-h)
      cat <<'EOF'
AetherFlow Studio — Linux Installer & Launcher

Usage:
  ./install-linux.sh [OPTIONS]

Options:
  --docker     Build and start using Docker Compose (recommended for production Linux)
  --native     Install npm packages, build UI bundle, and start natively via Node.js
  --systemd    Native build + install/enable aetherflow-studio.service (requires sudo/root)
  --check      Verify Linux prerequisites (Node.js, Python, Docker) without modifying state
  --help       Show this help message
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --help)" >&2
      exit 1
      ;;
  esac
done

log() { printf "\033[1;34m[AetherFlow]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[Warning]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[Error]\033[0m %s\n" "$*" >&2; }

ensure_env_file() {
  if [[ ! -f "$APP_DIR/.env" && -f "$APP_DIR/.env.example" ]]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    log "Created .env from .env.example — configure GEMINI_API_KEY / provider keys as needed."
  fi
}

check_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  if [[ "$major" -lt 22 ]]; then
    warn "Detected Node.js v$(node -v). Node.js v22+ is required (node:sqlite support)."
    return 1
  fi
  return 0
}

has_docker_compose() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

if [[ "$RUN_CHECK_ONLY" == true ]]; then
  log "Checking Linux environment prerequisites..."
  if check_node_version; then
    log "Node.js: $(node -v) (OK)"
  else
    warn "Node.js 22+ not found on host (required for --native; Docker mode brings Node 22 automatically)."
  fi
  if command -v python3 >/dev/null 2>&1; then
    log "Python: $(python3 --version) (OK)"
  else
    warn "python3 not found (optional unless running Python sandbox checks locally)."
  fi
  if has_docker_compose; then
    log "Docker Compose: $(docker compose version --short 2>/dev/null || echo available) (OK)"
  else
    warn "Docker Compose not available on host."
  fi
  exit 0
fi

if [[ "$MODE" == "auto" ]]; then
  if has_docker_compose; then
    MODE="docker"
  elif check_node_version; then
    MODE="native"
  else
    err "Neither Docker Compose nor Node.js 22+ is installed on this Linux machine."
    echo "Install Docker (https://docs.docker.com/engine/install/) or Node.js 22+:" >&2
    echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs" >&2
    exit 1
  fi
fi

ensure_env_file
mkdir -p "$APP_DIR/data" /tmp/aetherflow_sandboxes /tmp/aetherflow_projects

if [[ "$MODE" == "docker" ]]; then
  if ! has_docker_compose; then
    err "Docker and 'docker compose' plugin are required for --docker mode."
    exit 1
  fi
  log "Building and starting AetherFlow Studio via Docker Compose..."
  docker compose up -d --build
  log "Waiting for http://localhost:${PORT:-3000}/api/health ..."
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1; then
      log "AetherFlow Studio is running at http://localhost:${PORT:-3000}"
      exit 0
    fi
    sleep 2
  done
  warn "Container started; check logs with: docker compose logs -f"
  exit 0
fi

# Native Linux installation
if ! check_node_version; then
  err "Node.js 22+ is required for native Linux installation."
  exit 1
fi

log "Installing Node.js dependencies..."
if [[ -f "$APP_DIR/package-lock.json" ]]; then
  npm ci
else
  npm install
fi

log "Building production frontend bundle..."
npm run build

if [[ "$INSTALL_SYSTEMD" == true ]]; then
  SERVICE_SRC="$APP_DIR/deploy/systemd/aetherflow-studio.service"
  SERVICE_DEST="/etc/systemd/system/aetherflow-studio.service"
  if [[ ! -f "$SERVICE_SRC" ]]; then
    err "Missing systemd template at $SERVICE_SRC"
    exit 1
  fi
  NODE_BIN="$(command -v node)"
  RUN_USER="${SUDO_USER:-$USER}"
  TMP_UNIT="$(mktemp)"
  sed \
    -e "s|__RUN_USER__|$RUN_USER|g" \
    -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__NODE_BIN__|$NODE_BIN|g" \
    "$SERVICE_SRC" > "$TMP_UNIT"

  if [[ "$EUID" -eq 0 ]]; then
    mv "$TMP_UNIT" "$SERVICE_DEST"
    systemctl daemon-reload
    systemctl enable --now aetherflow-studio.service
    systemctl status --no-pager aetherflow-studio.service || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo mv "$TMP_UNIT" "$SERVICE_DEST"
    sudo systemctl daemon-reload
    sudo systemctl enable --now aetherflow-studio.service
    sudo systemctl status --no-pager aetherflow-studio.service || true
  else
    err "Root or sudo is required to install $SERVICE_DEST. Generated unit at: $TMP_UNIT"
    exit 1
  fi
  log "Installed systemd service! Manage with: sudo systemctl restart|status|stop aetherflow-studio"
  exit 0
fi

log "Build complete! Starting AetherFlow Studio in production mode on port ${PORT:-3000}..."
exec env NODE_ENV=production ./node_modules/.bin/tsx server.ts
