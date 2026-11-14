#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# AetherFlow Agent Studio — Ready-to-Run Linux Installer & Prerequisite Setup
# Repository: https://github.com/0MuStAnG0/AetherFlow-Agent-Studio
#
# Quick One-Line Install on a fresh Linux server:
#   curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash
#
# Systemd Service Install (auto-installs Git, Python 3, Node.js 22+):
#   curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash -s -- --systemd
#
# Docker Compose Install (auto-installs Git, Docker Engine & Compose):
#   curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash -s -- --docker
# ==============================================================================

DEFAULT_REPO_URL="https://github.com/0MuStAnG0/AetherFlow-Agent-Studio.git"

MODE="auto"
INSTALL_SYSTEMD=false
RUN_CHECK_ONLY=false
SKIP_DEPS=false
REPO_URL="${AETHERFLOW_REPO:-$DEFAULT_REPO_URL}"
REPO_EXPLICIT=false
if [[ -n "${AETHERFLOW_REPO:-}" ]]; then
  REPO_EXPLICIT=true
fi
BRANCH="${AETHERFLOW_BRANCH:-main}"
TARGET_DIR="${AETHERFLOW_DIR:-}"
CUSTOM_PORT="${AETHERFLOW_PORT:-}"
UPDATE_ONLY=false

usage() {
  cat <<'EOF'
AetherFlow Agent Studio — Linux Prerequisites & One-Command Installer
Default Repo: https://github.com/0MuStAnG0/AetherFlow-Agent-Studio

One-Line Remote Install (run on Ubuntu / Debian / RHEL / Rocky / Alma / Alpine):
  curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash

With Systemd Background Service:
  curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash -s -- --systemd

With Docker Compose:
  curl -fsSL https://raw.githubusercontent.com/0MuStAnG0/AetherFlow-Agent-Studio/main/install-linux.sh | bash -s -- --docker

Options:
  --repo <url|owner/repo>  Override GitHub repository (default: 0MuStAnG0/AetherFlow-Agent-Studio)
  --branch <name>          Git branch to deploy (default: main)
  --dir <path>             Target install directory (default: /opt/aetherflow-studio for root, ~/aetherflow-studio otherwise)
  --port <number>          Configure PORT in .env (default: 3000)
  --docker                 Install Docker (if missing) and start via Docker Compose
  --native                 Install Node.js 22+ (if missing), build UI, and run in foreground
  --systemd                Install Node.js 22+ (if missing), build UI, and enable systemd service
  --update                 Pull latest changes from GitHub and rebuild/restart
  --skip-deps              Skip automatic OS prerequisite package installation
  --check                  Check Linux prerequisites without modifying the system
  --help                   Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker) MODE="docker"; shift ;;
    --native) MODE="native"; shift ;;
    --systemd) MODE="native"; INSTALL_SYSTEMD=true; shift ;;
    --check) RUN_CHECK_ONLY=true; shift ;;
    --update) UPDATE_ONLY=true; shift ;;
    --skip-deps) SKIP_DEPS=true; shift ;;
    --repo)
      [[ $# -ge 2 ]] || { echo "Missing value for --repo" >&2; exit 1; }
      REPO_URL="$2"; REPO_EXPLICIT=true; shift 2 ;;
    --repo=*)
      REPO_URL="${1#*=}"; REPO_EXPLICIT=true; shift ;;
    --branch)
      [[ $# -ge 2 ]] || { echo "Missing value for --branch" >&2; exit 1; }
      BRANCH="$2"; shift 2 ;;
    --branch=*)
      BRANCH="${1#*=}"; shift ;;
    --dir)
      [[ $# -ge 2 ]] || { echo "Missing value for --dir" >&2; exit 1; }
      TARGET_DIR="$2"; shift 2 ;;
    --dir=*)
      TARGET_DIR="${1#*=}"; shift ;;
    --port)
      [[ $# -ge 2 ]] || { echo "Missing value for --port" >&2; exit 1; }
      CUSTOM_PORT="$2"; shift 2 ;;
    --port=*)
      CUSTOM_PORT="${1#*=}"; shift ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (use --help)" >&2
      exit 1
      ;;
  esac
done

log() { printf "\033[1;34m[AetherFlow]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[Warning]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[Error]\033[0m %s\n" "$*" >&2; }

run_priv() {
  if [[ "$EUID" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    err "Root privileges or 'sudo' are required to run: $*"
    exit 1
  fi
}

detect_pkg_mgr() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "apt"
  elif command -v dnf >/dev/null 2>&1; then
    echo "dnf"
  elif command -v yum >/dev/null 2>&1; then
    echo "yum"
  elif command -v apk >/dev/null 2>&1; then
    echo "apk"
  else
    echo "unknown"
  fi
}

normalize_repo_url() {
  local raw="$1"
  raw="${raw%/}"
  if [[ "$raw" =~ ^https?:// ]] || [[ "$raw" =~ ^git@ ]]; then
    if [[ "$raw" =~ ^https://github\.com/[^/]+/[^/]+$ ]] && [[ "$raw" != *.git ]]; then
      echo "${raw}.git"
    else
      echo "$raw"
    fi
  elif [[ "$raw" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    echo "https://github.com/${raw}.git"
  else
    echo "$raw"
  fi
}

check_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  local major
  major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
  if [[ "$major" -lt 22 ]]; then
    return 1
  fi
  return 0
}

has_docker_compose() {
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1
}

install_base_prerequisites() {
  [[ "$SKIP_DEPS" == true ]] && return 0

  local need_install=false
  for bin in git curl python3; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      need_install=true
    fi
  done

  if [[ "$need_install" == false ]]; then
    return 0
  fi

  local pm
  pm="$(detect_pkg_mgr)"
  log "Installing base Linux prerequisites (git, curl, ca-certificates, python3) via $pm..."
  case "$pm" in
    apt)
      run_priv env DEBIAN_FRONTEND=noninteractive apt-get update -y
      run_priv env DEBIAN_FRONTEND=noninteractive apt-get install -y \
        git curl ca-certificates gnupg python3 python3-pip build-essential
      ;;
    dnf)
      run_priv dnf install -y git curl ca-certificates python3 python3-pip gcc-c++ make
      ;;
    yum)
      run_priv yum install -y git curl ca-certificates python3 python3-pip gcc-c++ make
      ;;
    apk)
      run_priv apk add --no-cache bash git curl ca-certificates python3 py3-pip build-base
      ;;
    *)
      err "Unsupported package manager. Install git, curl, and python3 manually."
      exit 1
      ;;
  esac
}

install_node_22() {
  if check_node_version; then
    return 0
  fi
  if [[ "$SKIP_DEPS" == true ]]; then
    err "Node.js 22+ is required (node:sqlite support), and --skip-deps was specified."
    exit 1
  fi

  local pm
  pm="$(detect_pkg_mgr)"
  log "Installing Node.js 22 LTS (required for native node:sqlite)..."
  case "$pm" in
    apt)
      run_priv env DEBIAN_FRONTEND=noninteractive apt-get update -y
      run_priv env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg
      if [[ "$EUID" -eq 0 ]]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
        DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
      else
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
      fi
      ;;
    dnf|yum)
      if [[ "$EUID" -eq 0 ]]; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
        "$pm" install -y nodejs
      else
        curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash -
        sudo "$pm" install -y nodejs
      fi
      ;;
    apk)
      run_priv apk add --no-cache nodejs npm
      ;;
    *)
      err "Could not auto-install Node.js 22+. Please install Node.js 22+ manually."
      exit 1
      ;;
  esac

  if ! check_node_version; then
    err "Node.js 22+ installation did not produce v22+. Detected: $(node -v 2>/dev/null || echo none)"
    exit 1
  fi
  log "Installed Node.js $(node -v)"
}

install_docker_engine() {
  if has_docker_compose; then
    return 0
  fi
  if [[ "$SKIP_DEPS" == true ]]; then
    err "Docker + Docker Compose v2 required for --docker mode, and --skip-deps was specified."
    exit 1
  fi

  log "Installing Docker Engine & Docker Compose v2..."
  if [[ "$EUID" -eq 0 ]]; then
    curl -fsSL https://get.docker.com | sh
  elif command -v sudo >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sudo sh
  else
    err "Root or sudo is required to install Docker."
    exit 1
  fi

  if command -v systemctl >/dev/null 2>&1; then
    run_priv systemctl enable --now docker || true
  fi
  if [[ -n "${SUDO_USER:-}" ]]; then
    run_priv usermod -aG docker "$SUDO_USER" || true
  elif [[ "$EUID" -ne 0 && -n "${USER:-}" ]]; then
    run_priv usermod -aG docker "$USER" || true
  fi

  if ! has_docker_compose; then
    err "Docker installed, but 'docker compose' plugin is unavailable."
    exit 1
  fi
}

if [[ "$RUN_CHECK_ONLY" == true ]]; then
  log "Checking Linux environment prerequisites..."
  if command -v git >/dev/null 2>&1; then
    log "Git: $(git --version) (OK)"
  else
    warn "git not found (will be auto-installed during setup)."
  fi
  if command -v curl >/dev/null 2>&1; then
    log "curl: $(curl --version | head -n1) (OK)"
  else
    warn "curl not found (will be auto-installed during setup)."
  fi
  if check_node_version; then
    log "Node.js: $(node -v) (OK)"
  else
    warn "Node.js 22+ not found (will be auto-installed for --native/--systemd)."
  fi
  if command -v python3 >/dev/null 2>&1; then
    log "Python: $(python3 --version) (OK)"
  else
    warn "python3 not found (will be auto-installed during setup)."
  fi
  if has_docker_compose; then
    log "Docker Compose: $(docker compose version --short 2>/dev/null || echo available) (OK)"
  else
    warn "Docker Compose not available (optional; auto-installed when --docker is passed)."
  fi
  exit 0
fi

# Detect whether script is already executing inside a cloned AetherFlow repository
LOCAL_MODE=false
APP_DIR=""
SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
if [[ -n "$SCRIPT_SOURCE" && -f "$SCRIPT_SOURCE" ]]; then
  CANDIDATE_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
  if [[ -f "$CANDIDATE_DIR/package.json" && -f "$CANDIDATE_DIR/server.ts" ]]; then
    LOCAL_MODE=true
    APP_DIR="$CANDIDATE_DIR"
  fi
elif [[ -f "$(pwd)/package.json" && -f "$(pwd)/server.ts" ]]; then
  LOCAL_MODE=true
  APP_DIR="$(pwd)"
fi

# Remote bootstrap path (curl | bash) or explicit --repo clone/update
if [[ "$LOCAL_MODE" == false || "$REPO_EXPLICIT" == true ]]; then
  install_base_prerequisites

  REPO_URL="$(normalize_repo_url "$REPO_URL")"

  if [[ -z "$TARGET_DIR" ]]; then
    if [[ "$LOCAL_MODE" == true && -n "$APP_DIR" ]]; then
      TARGET_DIR="$APP_DIR"
    elif [[ "$EUID" -eq 0 ]]; then
      TARGET_DIR="/opt/aetherflow-studio"
    else
      TARGET_DIR="$HOME/aetherflow-studio"
    fi
  fi

  if [[ -d "$TARGET_DIR/.git" ]]; then
    log "Updating existing repository in $TARGET_DIR (branch: $BRANCH)..."
    git -C "$TARGET_DIR" config core.fileMode false || true
    git -C "$TARGET_DIR" fetch origin "$BRANCH"
    git -C "$TARGET_DIR" checkout -f "$BRANCH" 2>/dev/null || git -C "$TARGET_DIR" checkout -f -B "$BRANCH" "origin/$BRANCH"
    git -C "$TARGET_DIR" reset --hard "origin/$BRANCH"
  elif [[ -e "$TARGET_DIR" && -n "$(ls -A "$TARGET_DIR" 2>/dev/null || true)" ]]; then
    err "Target directory $TARGET_DIR already exists and is not a git repository. Pass --dir <empty-path>."
    exit 1
  else
    log "Cloning $REPO_URL (branch: $BRANCH) into $TARGET_DIR..."
    if mkdir -p "$(dirname "$TARGET_DIR")" 2>/dev/null && [[ -w "$(dirname "$TARGET_DIR")" ]]; then
      git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$TARGET_DIR"
    else
      run_priv mkdir -p "$TARGET_DIR"
      run_priv chown -R "${SUDO_USER:-$USER}":"${SUDO_USER:-$USER}" "$TARGET_DIR"
      git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$TARGET_DIR"
    fi
    git -C "$TARGET_DIR" config core.fileMode false || true
  fi

  FORWARD_ARGS=()
  if [[ "$MODE" == "docker" ]]; then
    FORWARD_ARGS+=(--docker)
  elif [[ "$INSTALL_SYSTEMD" == true ]]; then
    FORWARD_ARGS+=(--systemd)
  elif [[ "$MODE" == "native" ]]; then
    FORWARD_ARGS+=(--native)
  fi
  if [[ -n "$CUSTOM_PORT" ]]; then
    FORWARD_ARGS+=(--port "$CUSTOM_PORT")
  fi
  if [[ "$SKIP_DEPS" == true ]]; then
    FORWARD_ARGS+=(--skip-deps)
  fi

  chmod +x "$TARGET_DIR/install-linux.sh"
  log "Handing off to $TARGET_DIR/install-linux.sh ..."
  exec env AETHERFLOW_REPO="" bash "$TARGET_DIR/install-linux.sh" "${FORWARD_ARGS[@]}"
fi

cd "$APP_DIR"
install_base_prerequisites

if [[ "$UPDATE_ONLY" == true && -d "$APP_DIR/.git" ]]; then
  log "Pulling latest updates from GitHub (branch: $BRANCH)..."
  git -C "$APP_DIR" config core.fileMode false || true
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
fi

ensure_env_file() {
  if [[ ! -f "$APP_DIR/.env" && -f "$APP_DIR/.env.example" ]]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    log "Created .env from .env.example — set GEMINI_API_KEY / provider keys in $APP_DIR/.env if needed."
  fi
  if [[ -n "$CUSTOM_PORT" && -f "$APP_DIR/.env" ]]; then
    if grep -qE '^PORT=' "$APP_DIR/.env"; then
      sed -i.bak -E "s|^PORT=.*|PORT=${CUSTOM_PORT}|" "$APP_DIR/.env" && rm -f "$APP_DIR/.env.bak"
    else
      printf "\nPORT=%s\n" "$CUSTOM_PORT" >> "$APP_DIR/.env"
    fi
    export PORT="$CUSTOM_PORT"
    log "Configured PORT=$CUSTOM_PORT in .env"
  elif [[ -f "$APP_DIR/.env" ]]; then
    local env_port
    env_port="$(grep -E '^PORT=' "$APP_DIR/.env" | head -n1 | cut -d'=' -f2- | tr -d '[:space:]' || true)"
    if [[ -n "$env_port" ]]; then
      export PORT="$env_port"
    fi
  fi
}

if [[ "$MODE" == "auto" ]]; then
  if has_docker_compose; then
    MODE="docker"
  else
    MODE="native"
    if [[ "$EUID" -eq 0 || -x "$(command -v sudo 2>/dev/null || true)" ]] && command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
      INSTALL_SYSTEMD=true
    fi
  fi
fi

ensure_env_file
mkdir -p "$APP_DIR/data" /tmp/aetherflow_sandboxes /tmp/aetherflow_projects

if [[ "$MODE" == "docker" ]]; then
  install_docker_engine
  log "Building and starting AetherFlow Agent Studio via Docker Compose..."
  docker compose up -d --build
  log "Waiting for http://127.0.0.1:${PORT:-3000}/api/health ..."
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1; then
      log "AetherFlow Agent Studio is live at http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost):${PORT:-3000}"
      exit 0
    fi
    sleep 2
  done
  warn "Container started; inspect logs with: docker compose logs -f"
  exit 0
fi

# Native Linux installation (auto-installs Node.js 22+ if missing)
install_node_22

log "Installing Node.js dependencies..."
if ! grep -q "legacy-peer-deps=true" "$APP_DIR/.npmrc" 2>/dev/null; then
  echo "legacy-peer-deps=true" >> "$APP_DIR/.npmrc"
fi
if [[ -f "$APP_DIR/package-lock.json" ]]; then
  npm ci --legacy-peer-deps || npm install --legacy-peer-deps
else
  npm install --legacy-peer-deps
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
  RUN_USER="${SUDO_USER:-${USER:-root}}"
  TMP_UNIT="$(mktemp)"
  sed \
    -e "s|__RUN_USER__|$RUN_USER|g" \
    -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__NODE_BIN__|$NODE_BIN|g" \
    "$SERVICE_SRC" > "$TMP_UNIT"

  run_priv mv "$TMP_UNIT" "$SERVICE_DEST"
  run_priv systemctl daemon-reload
  run_priv systemctl enable --now aetherflow-studio.service
  run_priv systemctl status --no-pager aetherflow-studio.service || true

  SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)"
  log "Installed systemd service! URL: http://${SERVER_IP}:${PORT:-3000}"
  log "Manage service: sudo systemctl status|restart|stop aetherflow-studio"
  log "View live logs: sudo journalctl -u aetherflow-studio -f"
  exit 0
fi

log "Build complete! Starting AetherFlow Agent Studio in production mode on port ${PORT:-3000}..."
exec env NODE_ENV=production ./node_modules/.bin/tsx server.ts
