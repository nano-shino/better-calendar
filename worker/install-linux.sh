#!/bin/sh
# Installs the token server as a systemd service on a Linux machine.
# Copy the worker/ folder over, then run it there:
#
#   scp -r worker you@machine:better-calendar-worker
#   ssh you@machine 'sudo sh better-calendar-worker/install-linux.sh'
#
# Running it again updates the code and keeps your settings and stored tokens.
# Needs Node >= 22 and systemd.
set -eu

APP=better-calendar-tokens
SRC=$(cd "$(dirname "$0")" && pwd)
DEST=/opt/$APP
CONF=/etc/$APP.env

[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
NODE=$(command -v node) || { echo "Node.js 22 or newer is needed (https://nodejs.org)." >&2; exit 1; }
"$NODE" -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' \
  || { echo "Node.js 22 or newer is needed; this is $("$NODE" --version)." >&2; exit 1; }

install -d -m 755 "$DEST"
install -m 644 "$SRC/index.js" "$SRC/server.mjs" "$DEST/"

if [ ! -f "$CONF" ]; then
  # Fresh install: start from the template, with a new encryption key.
  key=$("$NODE" -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')
  sed "s|^TOKEN_KEY=.*|TOKEN_KEY=$key|" "$SRC/server.env.example" > "$CONF"
  chmod 600 "$CONF"
  created=1
fi

cat > /etc/systemd/system/$APP.service <<EOF
[Unit]
Description=Better Calendar token server
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=$CONF
Environment=DATA_FILE=/var/lib/$APP/tokens.json
ExecStart=$NODE $DEST/server.mjs
Restart=on-failure
DynamicUser=yes
StateDirectory=$APP
StateDirectoryMode=0700
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
if [ "${created:-}" ]; then
  systemctl enable $APP >/dev/null
  echo "Installed. Now put GOOGLE_CLIENT_SECRET in $CONF (and check the other values), then:"
  echo "  sudo systemctl start $APP"
else
  systemctl enable $APP >/dev/null
  systemctl restart $APP
  echo "Updated and restarted. Status: systemctl status $APP   Logs: journalctl -u $APP"
fi
