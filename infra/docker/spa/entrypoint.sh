#!/bin/sh
# Writes the pod's DNS resolver for nginx (see nginx.conf), then runs nginx.
set -eu
ns=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)
case "$ns" in *:*) ns="[$ns]" ;; esac
echo "resolver ${ns:-127.0.0.11} valid=30s ipv6=off;" > /tmp/nginx-resolver.conf
exec nginx -g 'daemon off;'
