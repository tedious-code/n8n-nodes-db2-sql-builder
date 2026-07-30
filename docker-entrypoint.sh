#!/bin/sh
set -eu

if [ -d /opt/custom-certificates ]; then
	echo "Trusting custom certificates from /opt/custom-certificates."
	export NODE_OPTIONS="--use-openssl-ca ${NODE_OPTIONS:-}"
	export SSL_CERT_DIR=/opt/custom-certificates
	c_rehash /opt/custom-certificates
fi

if [ "$#" -gt 0 ]; then
	exec n8n "$@"
fi

exec n8n
