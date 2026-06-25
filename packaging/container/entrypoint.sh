#!/bin/sh
# Container entrypoint for honcho-inspector-ui.
#
# Reads $BACKEND_HOST (default: localhost) and $BACKEND_PORT (default:
# 8080) from the environment, substitutes them into the proxy.conf.json
# template baked into the image, and writes the rendered config to a
# www-data-writable temp path. That path is what `ng serve` reads.
#
# Why a wrapper: Vite's proxy.conf.json does not interpolate env
# variables. We could ship two different proxy.conf.json files (one
# for host mode, one for compose), but a tiny entrypoint that renders
# the template is simpler and lets operators override the backend
# host at runtime without rebuilding the image.
#
# Why /var/lib/honcho-inspector-ui (and not /etc/honcho-inspector-ui)
# for the rendered config: /etc/.../ is often a bind-mounted volume
# owned by root:root, mode 0750 -- www-data cannot write there. The
# state dir /var/lib/.../ is owned by root:www-data, mode 0750, which
# www-data can write to. The host-mount convention is "operator
# config in /etc, runtime state in /var/lib" -- we honour it.
#
# After rendering, execs ng serve as PID 1's child so signal
# forwarding from tini works correctly.

set -eu

BACKEND_HOST="${BACKEND_HOST:-localhost}"
BACKEND_PORT="${BACKEND_PORT:-8080}"

TEMPLATE="/usr/local/share/honcho-inspector-ui/proxy.conf.json.template"
RENDERED="/var/lib/honcho-inspector-ui/proxy.conf.json"

if [ ! -f "$TEMPLATE" ]; then
    echo "FATAL: $TEMPLATE missing -- the image is broken" >&2
    exit 1
fi

# Substitute ${BACKEND_HOST} and ${BACKEND_PORT} in the template.
sed -e "s|\${BACKEND_HOST}|${BACKEND_HOST}|g" \
    -e "s|\${BACKEND_PORT}|${BACKEND_PORT}|g" \
    "$TEMPLATE" > "$RENDERED"

echo "honcho-inspector-ui proxy target: http://${BACKEND_HOST}:${BACKEND_PORT}"

exec node /usr/local/share/honcho-inspector-ui/node_modules/.bin/ng serve \
    --host 0.0.0.0 \
    --port 4200 \
    --proxy-config "$RENDERED" \
    --watch=false