#!/usr/bin/env bash
# Bring up (or reuse) the virtual desktop: Xvfb + window manager + x11vnc + websockify.
#
# Idempotent and ownership-aware:
#   * an already-running display is REUSED and reported as owned=0, so a desktop
#     the user is watching never gets restarted underneath them;
#   * only processes this script started are recorded in *.pid files, and only
#     those are stopped by desktop-down.sh.

NUM_DISPLAY="${WSLCU_DISPLAY_NUM:-99}"
D=":${NUM_DISPLAY}"
RES="${WSLCU_RESOLUTION:-1280x960}"
VNC_REQ="${WSLCU_VNC_PORT:-5900}"
WEB_REQ="${WSLCU_WEB_PORT:-6080}"
BIND="${WSLCU_BIND:-127.0.0.1}"
LOG="$WSLCU_STATE_DIR"

# --- 1. X server -----------------------------------------------------------
if display_alive "$D"; then
  XVFB_OWNED=0
  XVFB_PID="$(read_pid "xvfb-${NUM_DISPLAY}")"
else
  nohup Xvfb "$D" -screen 0 "${RES}x24" -nolisten tcp </dev/null \
    >"$LOG/xvfb-${NUM_DISPLAY}.log" 2>&1 &
  XVFB_PID=$!
  XVFB_OWNED=1
  write_pid "$XVFB_PID" "xvfb-${NUM_DISPLAY}"
  if ! wait_until "display_alive $D" 60; then
    echo "ERROR=xvfb_failed"
    echo "LOG=$LOG/xvfb-${NUM_DISPLAY}.log"
    exit 3
  fi
fi

# --- 2. Window manager (optional) -----------------------------------------
# Scope the check to THIS display: a window manager running on :99 must not
# make us skip starting one on the test display.
if command -v openbox >/dev/null 2>&1; then
  if ! DISPLAY="$D" xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'; then
    DISPLAY="$D" nohup openbox </dev/null >"$LOG/openbox-${NUM_DISPLAY}.log" 2>&1 &
    write_pid "$!" "openbox-${NUM_DISPLAY}"
    wait_until "DISPLAY='$D' xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'" 30 || true
  fi
fi

# --- 3. VNC server ---------------------------------------------------------
VNC_PORT="$(find_free_port "$VNC_REQ")"
if port_busy "$VNC_PORT"; then
  VNC_OWNED=0
  VNC_PID="$(read_pid "x11vnc-${NUM_DISPLAY}")"
  PW="$(cat "$LOG/vncpw" 2>/dev/null || echo '')"
else
  if [ ! -s "$LOG/vncpass" ] || [ ! -s "$LOG/vncpw" ]; then
    PW="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 12)"
    x11vnc -storepasswd "$PW" "$LOG/vncpass" >/dev/null 2>&1 || true
    ( umask 077; printf '%s' "$PW" > "$LOG/vncpw" )
  else
    PW="$(cat "$LOG/vncpw")"
  fi
  DISPLAY="$D" nohup x11vnc -display "$D" -rfbport "$VNC_PORT" -rfbauth "$LOG/vncpass" \
    -forever -shared -noxdamage -nolookup \
    </dev/null >"$LOG/x11vnc-${NUM_DISPLAY}.log" 2>&1 &
  VNC_PID=$!
  VNC_OWNED=1
  write_pid "$VNC_PID" "x11vnc-${NUM_DISPLAY}"
  wait_until "port_busy $VNC_PORT" 50 || true
fi

# --- 4. noVNC bridge -------------------------------------------------------
WEB_PORT="$(find_free_port "$WEB_REQ")"
if port_busy "$WEB_PORT"; then
  WEB_OWNED=0
  WEB_PID="$(read_pid "websockify")"
else
  if command -v websockify >/dev/null 2>&1; then
    nohup websockify --web=/usr/share/novnc "${BIND}:${WEB_PORT}" "127.0.0.1:${VNC_PORT}" \
      </dev/null >"$LOG/websockify-${NUM_DISPLAY}.log" 2>&1 &
    WEB_PID=$!
    WEB_OWNED=1
    write_pid "$WEB_PID" "websockify"
    wait_until "port_busy $WEB_PORT" 50 || true
  else
    WEB_OWNED=0
    WEB_PID=""
  fi
fi

echo "DISPLAY=${D}"
echo "RESOLUTION=${RES}"
echo "XVFB_OWNED=${XVFB_OWNED}"
echo "XVFB_PID=${XVFB_PID}"
echo "VNC_PORT=${VNC_PORT}"
echo "VNC_OWNED=${VNC_OWNED}"
echo "VNC_PID=${VNC_PID}"
echo "WEB_PORT=${WEB_PORT}"
echo "WEB_OWNED=${WEB_OWNED}"
echo "WEB_PID=${WEB_PID}"
echo "BIND=${BIND}"
echo "VNC_PASSWORD=${PW}"
if [ -n "$WEB_PORT" ] && port_busy "$WEB_PORT" && display_alive "$D"; then
  echo "READY=1"
else
  echo "READY=0"
fi
