#!/bin/sh
set -eu
html=/usr/share/nginx/html/index.html
test -f "$html"
if ! grep -q 'id="selfhost-source-link"' "$html"; then
  sed -i 's|</body>|<a id="selfhost-source-link" href="/source/openathlete-wahoo-a11ee107209c.tar.gz" download aria-label="Descarregar o código-fonte desta versão" style="position:fixed;right:8px;bottom:6px;z-index:40;padding:4px 8px;border-radius:6px;background:#fff;color:#1d4ed8;border:1px solid #cbd5e1;font:12px/1.4 system-ui;text-decoration:underline">Código-fonte</a></body>|' "$html"
fi
