#!/usr/bin/env bash
# Stop only what this plugin started. An X display the plugin merely reused
# (owned=0) is never touched: the human may be watching it.

NUM_DISPLAY="${WSLCU_DISPLAY_NUM:-99}"
D=":${NUM_DISPLAY}"

stop_pidfile() {
  local label="$1" pid
  pid="$(read_pid "$label")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    echo "STOPPED_${label}=${pid}"
  else
    echo "SKIPPED_${label}=${pid:-none}"
  fi
  rm -f "${WSLCU_STATE_DIR}/${label}.pid"
}

# Order matters: take the bridge down before the display it forwards.
stop_pidfile "websockify"
stop_pidfile "x11vnc-${NUM_DISPLAY}"
stop_pidfile "openbox-${NUM_DISPLAY}"
stop_pidfile "xvfb-${NUM_DISPLAY}"

if display_alive "$D"; then
  echo "DISPLAY_ALIVE=1"
else
  echo "DISPLAY_ALIVE=0"
fi
echo "DONE=1"
