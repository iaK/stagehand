#!/bin/bash
set -e

# Start dbus
export DBUS_SESSION_BUS_ADDRESS=$(dbus-daemon --session --fork --print-address)

# Set display for GTK/Tauri
export DISPLAY=:1

# Start VNC server
vncserver :1 -geometry 1400x900 -depth 24 -localhost no
sleep 2

# Start noVNC (browser-based VNC client)
websockify --web /usr/share/novnc 6080 localhost:5901 &
sleep 1

echo ""
echo "============================================"
echo "  Container ready!"
echo "  Open http://localhost:6080/vnc.html"
echo "  VNC password: password"
echo "============================================"
echo ""
echo "  To run the app:  cd /app && npm run tauri dev"
echo ""
echo "============================================"

# Drop into a shell with DISPLAY set
exec bash
