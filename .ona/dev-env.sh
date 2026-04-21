#!/bin/sh
# .ona/dev-env.sh — Bring up a Home Assistant + frontend dev environment in Ona.
#
# This file is intentionally fork-only. It lives on the `ona-tooling` branch
# in this fork and is consumed from feature branches via:
#
#   git worktree add ../ona-tooling ona-tooling
#   ../ona-tooling/.ona/dev-env.sh           # default = setup + run
#
# State lives entirely under $HOME/.ona-ha/ (venv, HA config, logs, pid files)
# so the working tree stays clean.

set -eu

# -------- configuration -------------------------------------------------------

STATE_DIR="${HOME}/.ona-ha"
VENV_DIR="${STATE_DIR}/venv"
CONFIG_DIR="${STATE_DIR}/config"
LOG_DIR="${STATE_DIR}/logs"
RUN_DIR="${STATE_DIR}/run"
STATE_FILE="${STATE_DIR}/state"
HA_PORT=8123
HA_PORT_NAME="Home Assistant"

# -------- helpers -------------------------------------------------------------

log() { printf '\033[1;34m[ona]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[1;31m[ona]\033[0m %s\n' "$*" >&2; }
die() { err "$*"; exit 1; }

ensure_dirs() {
  mkdir -p "$STATE_DIR" "$CONFIG_DIR" "$LOG_DIR" "$RUN_DIR"
}

# Auto-detect the target HA frontend repo (i.e. the OTHER worktree).
# Resolution order:
#   1. --repo <path> flag (already parsed into $REPO_PATH)
#   2. $HA_FRONTEND_REPO env var
#   3. cached value in $STATE_FILE
#   4. probe sibling directories of the worktree containing this script
#   5. give up and ask the user
detect_repo() {
  if [ -n "${REPO_PATH:-}" ]; then
    printf '%s' "$REPO_PATH"; return 0
  fi
  if [ -n "${HA_FRONTEND_REPO:-}" ] && [ -d "$HA_FRONTEND_REPO" ]; then
    printf '%s' "$HA_FRONTEND_REPO"; return 0
  fi
  if [ -f "$STATE_FILE" ]; then
    cached=$(grep -E '^repo=' "$STATE_FILE" 2>/dev/null | sed 's/^repo=//')
    if [ -n "$cached" ] && [ -d "$cached" ]; then
      printf '%s' "$cached"; return 0
    fi
  fi

  script_dir=$(cd "$(dirname "$0")" && pwd)
  worktree_root=$(cd "$script_dir/.." && pwd)
  parent=$(cd "$worktree_root/.." && pwd)

  for entry in "$parent"/*; do
    [ -d "$entry/.git" ] || [ -f "$entry/.git" ] || continue
    [ "$entry" = "$worktree_root" ] && continue
    # Must look like the HA frontend repo
    [ -f "$entry/package.json" ] || continue
    grep -q '"home-assistant-frontend"' "$entry/package.json" 2>/dev/null || continue
    branch=$(git -C "$entry" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    [ "$branch" = "ona-tooling" ] && continue
    printf '%s' "$entry"; return 0
  done

  return 1
}

remember_repo() {
  printf 'repo=%s\n' "$1" > "$STATE_FILE"
}

ona_public_url() {
  # Returns the public URL for $HA_PORT, or empty if the port isn't open.
  # Uses JSON output to avoid parsing the table (port names may contain spaces).
  gitpod environment port list -o json 2>/dev/null \
    | python3 -c "
import json, sys
try:
    ports = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for p in ports or []:
    if p.get('port') == ${HA_PORT}:
        print(p.get('url', ''))
        break
"
}

ensure_port_open() {
  url=$(ona_public_url)
  if [ -n "$url" ]; then
    log "Port ${HA_PORT} already exposed: ${url}"
    printf '%s' "$url"
    return 0
  fi
  log "Opening port ${HA_PORT} publicly via Ona..."
  gitpod environment port open "$HA_PORT" --name "$HA_PORT_NAME" >/dev/null
  url=$(ona_public_url)
  [ -n "$url" ] || die "Failed to open port ${HA_PORT}"
  log "Port ${HA_PORT} exposed: ${url}"
  printf '%s' "$url"
}

write_config() {
  repo_path="$1"
  ona_origin="$2"
  cfg="${CONFIG_DIR}/configuration.yaml"
  log "Writing ${cfg}"
  cat > "$cfg" <<EOF
# Minimal set of integrations needed for the frontend to work + demo
# entities to test against. We don't use \`default_config:\` because it
# pulls in \`go2rtc\`, which requires an external binary not available
# in the Ona dev environment.
frontend:
  development_repo: ${repo_path}
config:    # config UI for editing dashboards
api:       # REST + WebSocket API
auth:
person:    # required for HA onboarding to complete
sun:
system_health:
input_boolean:
input_number:

http:
  use_x_forwarded_for: true
  # Ona's Gateway sits in the 172.16.0.0/12 private range; the source IP
  # changes between requests, so we trust the whole range. Also trust
  # 10.0.0.0/8 in case the runner topology changes.
  trusted_proxies:
    - 127.0.0.1
    - ::1
    - 172.16.0.0/12
    - 10.0.0.0/8
  cors_allowed_origins:
    - ${ona_origin}

# Provides ready-made brightness-capable light entities
# (light.bed_light, light.ceiling_lights, light.kitchen_lights, ...)
# for testing card features against real states + services.
demo:

# Lovelace UI mode (needed to edit dashboards via the frontend)
lovelace:
  mode: storage
EOF
}

ensure_venv() {
  if [ -x "${VENV_DIR}/bin/hass" ] || [ -f "${VENV_DIR}/lib/python3.14/site-packages/homeassistant/__init__.py" ]; then
    log "Home Assistant venv already present at ${VENV_DIR}"
    return 0
  fi
  log "Creating Python venv at ${VENV_DIR}"
  python3 -m venv "$VENV_DIR"
  # Invoke pip via `python -m pip` because some sandboxed environments
  # (notably Ona) refuse to execute scripts whose shebang resolves
  # through the venv's symlinked python interpreter.
  log "Upgrading pip / wheel"
  "${VENV_DIR}/bin/python" -m pip install --quiet --upgrade pip wheel
  log "Installing homeassistant (this can take a few minutes)..."
  "${VENV_DIR}/bin/python" -m pip install --quiet homeassistant
  log "Home Assistant installed."
}

is_running() {
  pidfile="$1"
  [ -f "$pidfile" ] || return 1
  pid=$(cat "$pidfile" 2>/dev/null)
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

stop_pid() {
  pidfile="$1"
  name="$2"
  if is_running "$pidfile"; then
    pid=$(cat "$pidfile")
    log "Stopping ${name} (pid ${pid})"
    kill "$pid" 2>/dev/null || true
    # give it a beat, then kill -9 if needed
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

# -------- subcommands ---------------------------------------------------------

cmd_setup() {
  ensure_dirs
  repo=$(detect_repo) || die "Could not auto-detect HA frontend repo. Pass --repo <path> or set HA_FRONTEND_REPO."
  log "Target repo: ${repo}"
  remember_repo "$repo"

  ensure_venv
  url=$(ensure_port_open)
  write_config "$repo" "$url"
  log "Setup complete."
  log "  Repo:        ${repo}"
  log "  HA config:   ${CONFIG_DIR}/configuration.yaml"
  log "  Public URL:  ${url}"
}

cmd_run() {
  ensure_dirs
  repo=$(detect_repo) || die "Run setup first or pass --repo."
  [ -d "${VENV_DIR}" ] || die "Home Assistant venv missing. Run '$0 setup' first."
  [ -f "${CONFIG_DIR}/configuration.yaml" ] || die "HA config missing. Run '$0 setup' first."

  url=$(ona_public_url)
  [ -n "$url" ] || url=$(ensure_port_open)

  # If anything is already running, stop it first so we don't end up with two HAs.
  stop_pid "${RUN_DIR}/frontend.pid" "frontend watch"
  stop_pid "${RUN_DIR}/hass.pid"     "Home Assistant"

  : > "${LOG_DIR}/frontend.log"
  : > "${LOG_DIR}/hass.log"

  log "Starting frontend watch build in ${repo}"
  ( cd "$repo" && exec script/develop ) >>"${LOG_DIR}/frontend.log" 2>&1 &
  echo $! > "${RUN_DIR}/frontend.pid"

  log "Starting Home Assistant Core"
  # Invoke via `python -m homeassistant` to avoid Ona's restriction on
  # shebang execution through symlinked python interpreters.
  "${VENV_DIR}/bin/python" -m homeassistant -c "$CONFIG_DIR" >>"${LOG_DIR}/hass.log" 2>&1 &
  echo $! > "${RUN_DIR}/hass.pid"

  log ""
  log "Open the frontend at: ${url}"
  log "Logs:"
  log "  ${LOG_DIR}/frontend.log"
  log "  ${LOG_DIR}/hass.log"
  log ""
  log "Tailing both logs. Press Ctrl-C to stop both processes."

  # Trap so Ctrl-C cleans up.
  trap 'echo; cmd_stop; exit 0' INT TERM
  tail -F "${LOG_DIR}/frontend.log" "${LOG_DIR}/hass.log"
}

cmd_stop() {
  ensure_dirs
  stop_pid "${RUN_DIR}/frontend.pid" "frontend watch"
  stop_pid "${RUN_DIR}/hass.pid"     "Home Assistant"
  log "Stopped."
}

cmd_url() {
  url=$(ona_public_url)
  if [ -z "$url" ]; then
    err "Port ${HA_PORT} is not currently exposed. Run '$0 setup' or '$0 run' first."
    return 1
  fi
  printf '%s\n' "$url"
}

cmd_status() {
  if is_running "${RUN_DIR}/hass.pid"; then
    log "Home Assistant: running (pid $(cat ${RUN_DIR}/hass.pid))"
  else
    log "Home Assistant: stopped"
  fi
  if is_running "${RUN_DIR}/frontend.pid"; then
    log "Frontend watch: running (pid $(cat ${RUN_DIR}/frontend.pid))"
  else
    log "Frontend watch: stopped"
  fi
  url=$(ona_public_url)
  if [ -n "$url" ]; then log "Public URL:    ${url}"; else log "Public URL:    (port not exposed)"; fi
}

cmd_reset() {
  log "About to wipe ${STATE_DIR}"
  printf 'Are you sure? [y/N] '
  read -r answer
  case "$answer" in
    y|Y|yes|YES)
      cmd_stop || true
      rm -rf "$STATE_DIR"
      log "Removed ${STATE_DIR}"
      ;;
    *) log "Aborted." ;;
  esac
}

cmd_help() {
  cat <<EOF
Usage: $0 [--repo <path>] <command>

Commands:
  setup       Install HA Core, open port ${HA_PORT}, write HA config
  run         Start HA + frontend watch in background, tail logs (Ctrl-C stops both)
  stop        Stop HA + frontend watch
  status      Show whether HA / frontend / port are up
  url         Print the public Ona URL for HA
  reset       Wipe ${STATE_DIR} (venv, HA config, logs)
  help        Show this help

Default (no command): runs 'setup' if needed, then 'run'.

Environment:
  HA_FRONTEND_REPO   Path to the HA frontend repo to build/serve.
                     If unset, auto-detected from sibling worktrees.

State directory:
  ${STATE_DIR}
EOF
}

# -------- arg parsing ---------------------------------------------------------

REPO_PATH=""
CMD=""

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)   REPO_PATH="$2"; shift 2 ;;
    --repo=*) REPO_PATH="${1#--repo=}"; shift ;;
    -h|--help|help) CMD="help"; shift ;;
    setup|run|stop|status|url|reset) CMD="$1"; shift ;;
    *) err "Unknown argument: $1"; cmd_help; exit 2 ;;
  esac
done

if [ -z "$CMD" ]; then
  # Default: setup (if needed) + run
  ensure_dirs
  if [ ! -x "${VENV_DIR}/bin/hass" ] || [ ! -f "${CONFIG_DIR}/configuration.yaml" ]; then
    cmd_setup
  fi
  cmd_run
  exit $?
fi

case "$CMD" in
  setup)  cmd_setup ;;
  run)    cmd_run ;;
  stop)   cmd_stop ;;
  status) cmd_status ;;
  url)    cmd_url ;;
  reset)  cmd_reset ;;
  help)   cmd_help ;;
esac
