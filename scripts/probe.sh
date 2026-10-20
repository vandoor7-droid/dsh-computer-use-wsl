#!/usr/bin/env bash
# Report readiness without changing anything.

NUM_DISPLAY="${WSLCU_DISPLAY_NUM:-99}"
D=":${NUM_DISPLAY}"
VNC_REQ="${WSLCU_VNC_PORT:-5900}"
WEB_REQ="${WSLCU_WEB_PORT:-6080}"

if display_alive "$D"; then
  echo "DISPLAY_ALIVE=1"
  DISPLAY="$D" xdpyinfo 2>/dev/null | awk '/dimensions:/{print "DISPLAY_SIZE=" $2; exit}'
else
  echo "DISPLAY_ALIVE=0"
  echo "DISPLAY_SIZE="
fi

# The real ports may have drifted upwards if the requested ones were taken.
VNC_PORT=""
WEB_PORT=""
for p in $(seq "$VNC_REQ" $((VNC_REQ + 10))); do
  if port_busy "$p"; then VNC_PORT="$p"; break; fi
done
for p in $(seq "$WEB_REQ" $((WEB_REQ + 10))); do
  if port_busy "$p"; then WEB_PORT="$p"; break; fi
done

echo "VNC_PORT=${VNC_PORT}"
echo "WEB_PORT=${WEB_PORT}"
echo "VNC_ALIVE=$([ -n "$VNC_PORT" ] && echo 1 || echo 0)"
echo "WEB_ALIVE=$([ -n "$WEB_PORT" ] && echo 1 || echo 0)"
echo "VNC_PASSWORD=$(cat "$WSLCU_STATE_DIR/vncpw" 2>/dev/null || echo '')"
echo "TOOLS_MISSING=$(for c in Xvfb x11vnc xdotool import xclip websockify openbox; do command -v $c >/dev/null 2>&1 || echo -n "$c,"; done)"
