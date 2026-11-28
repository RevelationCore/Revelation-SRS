#!/usr/bin/env bash
# ADR-026 guard: each built SPA image serves connect-src 'self' alone (no
# scheme sources), runs unprivileged on 8080 with a read-only root, and
# never proxies back-channel logout. Usage: check-spa-headers.sh <image> [...]
set -euo pipefail
status=0
for image in "$@"; do
  name="spa-check-$RANDOM"
  docker run -d --name "$name" --read-only --user 101:101 --cap-drop ALL --tmpfs /tmp:uid=101,gid=101 -p 127.0.0.1::8080 "$image" >/dev/null
  port=$(docker port "$name" 8080/tcp | head -1 | sed 's/.*://')
  for _ in $(seq 1 20); do curl -sf "http://127.0.0.1:$port/index.html" >/dev/null && break; sleep 1; done
  csp=$(curl -sI "http://127.0.0.1:$port/" | tr -d '\r' | sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: //p')
  connect=$(echo "$csp" | tr ';' '\n' | sed 's/^ *//' | grep -E '^connect-src' || true)
  backchannel=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/bff/auth/backchannel-logout")
  docker rm -f "$name" >/dev/null
  if [ "$connect" != "connect-src 'self'" ]; then echo "$image: expected connect-src 'self', got '$connect'"; status=1; fi
  if [ "$backchannel" != "404" ]; then echo "$image: back-channel logout is reachable through nginx ($backchannel)"; status=1; fi
  [ $status -eq 0 ] && echo "$image: ok ($connect; back-channel blocked)"
done
exit $status
