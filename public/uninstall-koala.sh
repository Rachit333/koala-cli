#!/bin/bash

set -e

# ----------------------------
# CONFIG (Must match install script)
# ----------------------------
INSTALL_DIR="/opt/koala-cli"
DEPLOY_DIR="/opt/koala-apps"
KOALA_STATE_DIR="/opt/koala-state"
LINK_PATH="/usr/local/bin/koala"
SERVICE_NAME="koala-server"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
COMPLETION_TARGET="/etc/bash_completion.d/koala"
REAL_USER=$(logname 2>/dev/null || echo "$SUDO_USER")
KOALA_HOME="/home/koala"
USER_CONFIG="/home/$REAL_USER/.koala-config.json"


# ----------------------------
# PRECHECKS
# ----------------------------
if [[ $EUID -ne 0 ]]; then
  echo "[!] This script must be run as root. Attempting to re-run with sudo."
  exec sudo "$0" "$@"
fi

echo "[!] Starting Koala CLI uninstallation..."

# ----------------------------
# STOP AND DISABLE SERVICE
# ----------------------------
echo "[+] Stopping and disabling systemd service: $SERVICE_NAME"
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true
rm -f "$SERVICE_FILE"

# ----------------------------
# REMOVE INSTALLATION DIRECTORIES AND LINKS
# ----------------------------
echo "[+] Removing Koala CLI installation directory: $INSTALL_DIR"
rm -rf "$INSTALL_DIR"

echo "[+] Removing Koala applications deployment directory: $DEPLOY_DIR"
rm -rf "$DEPLOY_DIR"

echo "[+] Removing Koala state directory: $KOALA_STATE_DIR"
rm -rf "$KOALA_STATE_DIR"

echo "[+] Removing symbolic link: $LINK_PATH"
rm -f "$LINK_PATH"

# ----------------------------
# REMOVE SYSTEM USER
# ----------------------------
if id -u koala &>/dev/null; then
  echo "[+] Deleting 'koala' system user and its home directory: $KOALA_HOME"
  userdel -r koala # -r removes home directory and mail spool
else
  echo "[i] 'koala' system user not found, skipping user removal."
fi

# ----------------------------
# REMOVE USER CONFIG AND AUTOCOMPLETION
# ----------------------------
if [[ -n "$REAL_USER" ]]; then
  echo "[+] Removing user configuration file: $USER_CONFIG"
  rm -f "$USER_CONFIG"
fi

echo "[+] Removing shell autocompletion file: $COMPLETION_TARGET"
rm -f "$COMPLETION_TARGET"

# Remove autocomplete sources from user's shell config (best effort)
USER_HOME_DIR=$(getent passwd "$REAL_USER" | cut -d: -f6)
USER_BASHRC="$USER_HOME_DIR/.bashrc"
USER_ZSHRC="$USER_HOME_DIR/.zshrc"
FISH_CONFIG="$USER_HOME_DIR/.config/fish/config.fish"

if [[ -f "$USER_BASHRC" ]]; then
  sed -i "/source $COMPLETION_TARGET/d" "$USER_BASHRC"
  echo "[i] Removed autocomplete source from $USER_BASHRC (if present)."
fi

if [[ -f "$USER_ZSHRC" ]]; then
  sed -i '/# Koala CLI Autocomplete/,/compdef _koala_completions koala/d' "$USER_ZSHRC"
  echo "[i] Removed autocomplete source from $USER_ZSHRC (if present)."
fi

if [[ -f "$FISH_CONFIG" ]]; then
  sed -i '/# Koala CLI Autocomplete/,/complete -c koala -f -a "(__koala_complete)"/d' "$FISH_CONFIG"
  echo "[i] Removed autocomplete source from $FISH_CONFIG (if present)."
fi

# ----------------------------
# SYSTEMD DAEMON RELOAD
# ----------------------------
echo "[+] Reloading systemd daemon..."
systemctl daemon-reload
systemctl daemon-reexec # Essential for clean service state

echo ""
echo -e "\033[1;32m[✓] Koala CLI uninstallation complete.\033[0m"
echo -e "\033[1;33m[!] You may need to restart your terminal session for shell changes (like autocompletion) to fully take effect.\033[0m"
echo ""