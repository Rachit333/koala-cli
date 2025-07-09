
#!/bin/bash

set -e

# ----------------------------
# CONFIG
# ----------------------------
REPO_URL="https://github.com/Rachit333/koala-cli.git"
INSTALL_DIR="/opt/koala-cli"
DEPLOY_DIR="/opt/koala-apps"
BIN_PATH="$INSTALL_DIR/bin/koala.js"
LINK_PATH="/usr/local/bin/koala"
SERVICE_NAME="koala-server"
KOALA_STATE_DIR="/opt/koala-state"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
COMPLETION_TARGET="/etc/bash_completion.d/koala"
NODE_PATH=$(command -v node || true)
REAL_USER=$(logname 2>/dev/null || echo "$SUDO_USER")
KOALA_NODE="$INSTALL_DIR/node-koala"

# ----------------------------
# PRECHECKS
# ----------------------------
if [[ -z "$REAL_USER" ]]; then
  echo "[x] Could not determine real username (SUDO_USER or logname failed)"
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "[!] This script must be run as root."
  exec sudo "$0" "$@"
fi

if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
  echo "[x] Node.js and npm are required. Please install them first."
  exit 1
fi

# ----------------------------
# CLEAN INSTALLATION
# ----------------------------
echo "[!] Performing clean reinstall..."
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true
rm -f "$LINK_PATH"
rm -rf "$INSTALL_DIR"
rm -rf "$DEPLOY_DIR"
rm -f "$SERVICE_FILE"

# ----------------------------
# SYSTEM USER (for service)
# ----------------------------
if ! id -u koala &>/dev/null; then
  echo "[+] Creating 'koala' system user..."
  useradd -r -s /usr/sbin/nologin koala
fi

# Ensure koala user's home directory exists and is usable
KOALA_HOME="/home/koala"
if [ ! -d "$KOALA_HOME" ]; then
  echo "[+] Creating home directory for 'koala' user at $KOALA_HOME"
  mkdir -p "$KOALA_HOME"
  chown koala:koala "$KOALA_HOME"
  chmod 755 "$KOALA_HOME"
else
  echo "[i] Ensuring /home/koala is owned by koala..."
  chown -R koala:koala "$KOALA_HOME"
fi

# ----------------------------
# INSTALL KOALA CLI
# ----------------------------
echo "[+] Installing Koala CLI to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
chown -R koala:koala "$INSTALL_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "[+] Updating existing Koala CLI..."
  sudo -u koala git -C "$INSTALL_DIR" pull
else
  echo "[+] Cloning Koala CLI..."
  sudo -u koala git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
echo "[+] Installing dependencies..."
sudo -u koala npm install

chmod +x "$BIN_PATH"
ln -sf "$BIN_PATH" "$LINK_PATH"

# ----------------------------
# SECURE NODE FOR PORT 80
# ----------------------------
echo "[+] Copying node binary and setting cap_net_bind_service..."
cp "$NODE_PATH" "$KOALA_NODE"
setcap 'cap_net_bind_service=+ep' "$KOALA_NODE"

# ----------------------------
# CREATE DEPLOY DIRECTORY
# ----------------------------
echo "[+] Creating deploy directory: $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"
chown -R "$REAL_USER":koala "$DEPLOY_DIR"
chmod -R 775 "$DEPLOY_DIR"
chmod g+s "$DEPLOY_DIR"

# ----------------------------
# CREATE KOALA STATE DIRECTORY
# ----------------------------
echo "[+] Creating Koala state directory: $KOALA_STATE_DIR"
mkdir -p "$KOALA_STATE_DIR"
chown koala:koala "$KOALA_STATE_DIR"
chmod 755 "$KOALA_STATE_DIR" # Setting standard directory permissions

# ----------------------------
# SET USER CONFIG
# ----------------------------
USER_CONFIG="/home/$REAL_USER/.koala-config.json"
echo "[+] Setting deploy path for user $REAL_USER in: $USER_CONFIG"
sudo -u "$REAL_USER" tee "$USER_CONFIG" >/dev/null <<EOF
{
  "appsDir": "$DEPLOY_DIR"
}
EOF

# ----------------------------
# CREATE SYSTEMD SERVICE
# ----------------------------
echo "[+] Creating systemd service..."
tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Koala Proxy Server
After=network.target

[Service]
ExecStart=/opt/koala-cli/node-koala /opt/koala-cli/server/index.js
WorkingDirectory=/opt/koala-cli
Restart=always
User=koala
Group=koala
Environment="NODE_ENV=production NPM_CONFIG_CACHE=/tmp/koala-npm-cache" # Modified: Added NPM_CONFIG_CACHE
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=false                                                     # Modified: Changed from 'yes' to 'false'
StandardOutput=journal
StandardError=journal
SyslogIdentifier=koala

[Install]
WantedBy=multi-user.target

EOF

chmod 644 "$SERVICE_FILE"
systemctl daemon-reexec
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# ----------------------------
# BASH/ZSH/FISH AUTOCOMPLETION
# ----------------------------
echo "[+] Installing shell autocompletion for Koala..."

COMPLETION_SCRIPT_CONTENT='
#!/bin/bash

_koala_completions() {
  local cur prev
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  
  local suggestions
  suggestions=$(koala __complete "$cur" 2>/dev/null)
  COMPREPLY=( $(compgen -W "${suggestions}" -- ${cur}) )
}
complete -F _koala_completions koala
'

# Bash completion system-wide
echo "$COMPLETION_SCRIPT_CONTENT" >"$COMPLETION_TARGET"
chmod 644 "$COMPLETION_TARGET"

# Per-user shell config files
USER_HOME="/home/$REAL_USER"
USER_BASHRC="$USER_HOME/.bashrc"
USER_ZSHRC="$USER_HOME/.zshrc"
FISH_CONFIG="$USER_HOME/.config/fish/config.fish"

# Bash: auto-source for user
if [[ -f "$USER_BASHRC" && ! $(grep "$COMPLETION_TARGET" "$USER_BASHRC") ]]; then
  echo "source $COMPLETION_TARGET" >>"$USER_BASHRC"
  echo "[+] Added autocomplete source to $USER_BASHRC"
fi

# Zsh: write function directly to ~/.zshrc
if [[ -f "$USER_ZSHRC" && ! $(grep "koala __complete" "$USER_ZSHRC") ]]; then
  cat >>"$USER_ZSHRC" <<'ZSH_EOF'

# Koala CLI Autocomplete
_koala_completions() {
  local suggestions
  suggestions=("${(@f)$(koala __complete "$words[$CURRENT]" 2>/dev/null)}")
  compadd -- ${suggestions[@]}
}
compdef _koala_completions koala
ZSH_EOF
  echo "[+] Added Koala autocomplete to $USER_ZSHRC"
fi

# Fish: add function to config
if [[ -f "$FISH_CONFIG" && ! $(grep "koala __complete" "$FISH_CONFIG") ]]; then
  mkdir -p "$(dirname "$FISH_CONFIG")"
  cat >>"$FISH_CONFIG" <<'FISH_EOF'

# Koala CLI Autocomplete
function __koala_complete
  set -l suggestions (koala __complete (commandline -cp) 2>/dev/null)
  for s in $suggestions
    echo $s
  end
end

complete -c koala -f -a "(__koala_complete)"
FISH_EOF
  echo "[+] Added Koala autocomplete to $FISH_CONFIG"
fi

echo ""
echo "[→] Trying to enable autocomplete now..."

USER_SHELL=$(getent passwd "$REAL_USER" | cut -d: -f7)

if [[ "$USER_SHELL" == *"bash" && -f "$USER_BASHRC" ]]; then
  echo -e "\033[1;33m[!] To enable autocomplete now, run:\033[0m source ~/.bashrc"
elif [[ "$USER_SHELL" == *"zsh" && -f "$USER_ZSHRC" ]]; then
  echo -e "\033[1;33m[!] To enable autocomplete now, run:\033[0m source ~/.zshrc"
elif [[ "$USER_SHELL" == *"fish" && -f "$FISH_CONFIG" ]]; then
  echo -e "\033[1;33m[!] To enable autocomplete now, run:\033[0m source ~/.config/fish/config.fish"
else
  echo -e "\033[1;33m[!] Restart your shell to enable autocomplete.\033[0m"
fi

# ----------------------------
# FINAL MESSAGE
# ----------------------------
echo ""
echo -e "\033[1;32m[✓] Koala CLI installed globally!\033[0m"
echo -e "\033[1;34m[→] Deployed apps will live in:\033[0m $DEPLOY_DIR"
echo -e "\033[1;34m[→] Config saved to:\033[0m $USER_CONFIG"
echo -e "\033[1;33m[!] Try:\033[0m koala --help"
echo ""
echo -e "\033[1;33m[!] If you encounter issues, please check the logs at:\033[0m /var/log/syslog"
echo "(To uninstall, run: sudo bash uninstall-koala.sh)"
