#!/usr/bin/env bash
# Shared helpers for the wslcu desktop scripts.
#
# Contract with the Node side: every script prints only `KEY=VALUE` lines on
# stdout (parsed by mcp/desktop.mjs) and free-form diagnostics on stderr.
# Never print JSON from bash — building it in JS is far less error-prone.

set -u

WSLCU_STATE_DIR="${WSLCU_STATE_DIR:-/tmp/wslcu}"

mkdir -p "$WSLCU_STATE_DIR" 2>/dev/null || true

# Is a port already listening on this machine?
port_busy() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}$"
    return $?
  fi
  (exec 3<>"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1 && { exec 3>&-; return 0; }
  return 1
}

# First free TCP port at or after $1, searched up to +50.
find_free_port() {
  local port="$1" i=0
  while [ "$i" -lt 50 ]; do
    if ! port_busy "$port"; then
      echo "$port"
      return 0
    fi
    port=$((port + 1))
    i=$((i + 1))
  done
  echo "$1"
  return 1
}

# Is the X display answering?
display_alive() {
  DISPLAY="$1" xdpyinfo >/dev/null 2>&1
}

# Wait until a predicate command succeeds, up to $2 tenths of a second.
wait_until() {
  local i=0 limit="${2:-50}"
  while [ "$i" -lt "$limit" ]; do
    if eval "$1"; then return 0; fi
    sleep 0.2
    i=$((i + 1))
  done
  return 1
}

write_pid() { echo "$1" > "${WSLCU_STATE_DIR}/$2.pid"; }

read_pid() {
  local f="${WSLCU_STATE_DIR}/$1.pid"
  [ -s "$f" ] && cat "$f" || echo ""
}
