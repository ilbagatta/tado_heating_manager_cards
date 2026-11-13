#!/bin/sh
# Copia le card sul server e aggiorna ?v= della risorsa Lovelace (poi basta un refresh normale).
# Uso: tools/deploy.sh <host>     (es. tools/deploy.sh 10.0.0.1)
set -e
HOST="$1"
[ -n "$HOST" ] || { echo "Uso: $0 <host>"; exit 1; }
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/^const THM_CARDS_VERSION = "\(.*\)";/\1/p' dist/tado-heating-manager-cards.js)
[ -n "$VERSION" ] || { echo "Versione non trovata"; exit 1; }
scp -q dist/tado-heating-manager-cards.js "root@$HOST:/config/www/"
echo "File copiato (versione $VERSION)"
ssh "root@$HOST" python3 - "$VERSION" < tools/bump_resource.py
