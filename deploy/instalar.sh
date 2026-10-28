#!/bin/sh
# Instala (o actualiza) el despliegue automático en la VM `apps`. Como root, desde la raíz del repo:
#   sh deploy/instalar.sh
set -eu
cd "$(dirname "$0")"
install -m 755 timermayu-deploy /usr/local/sbin/timermayu-deploy
install -m 644 timermayu-deploy.service timermayu-deploy.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now timermayu-deploy.timer
echo "Listo. Logs: journalctl -u timermayu-deploy -e"
