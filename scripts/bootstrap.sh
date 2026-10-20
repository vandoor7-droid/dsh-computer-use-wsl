#!/usr/bin/env bash
# Install the desktop prerequisites inside the distribution.
# Explicit only: desktop_up never installs packages on its own.

MISSING="$(for c in Xvfb x11vnc xdotool import xclip websockify openbox; do command -v "$c" >/dev/null 2>&1 || echo -n "$c "; done)"
echo "MISSING_BEFORE=${MISSING}"

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq xvfb x11vnc xdotool imagemagick xclip openbox novnc websockify \
    >/dev/null 2>&1 || echo "APT_WARN=install had errors"
fi

echo "MISSING_AFTER=$(for c in Xvfb x11vnc xdotool import xclip websockify openbox; do command -v "$c" >/dev/null 2>&1 || echo -n "$c "; done)"
echo "DONE=1"
