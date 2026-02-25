#!/bin/sh
set -e

# Start Tailscale daemon in userspace networking mode
# (no TUN device needed — works in unprivileged containers)
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "Starting Tailscale daemon..."
    tailscaled --tun=userspace-networking --statedir=/data/tailscale --socket=/var/run/tailscale/tailscaled.sock &

    # Wait for daemon to be ready
    sleep 2

    # Authenticate and connect to tailnet
    TAILSCALE_ARGS="--authkey=$TAILSCALE_AUTHKEY --hostname=paw-railway"

    # Accept DNS to enable MagicDNS resolution of .ts.net hostnames
    TAILSCALE_ARGS="$TAILSCALE_ARGS --accept-dns=true"

    tailscale --socket=/var/run/tailscale/tailscaled.sock up $TAILSCALE_ARGS

    echo "Tailscale connected. Checking status..."
    tailscale --socket=/var/run/tailscale/tailscaled.sock status
    echo "Tailscale ready."

    # Relay localhost:11434 → Ollama via Tailscale mesh
    echo "Setting up Ollama relay via Tailscale..."
    socat TCP-LISTEN:11434,fork,reuseaddr EXEC:"tailscale nc local-lab 11434" &
    echo "Ollama relay ready on localhost:11434"
else
    echo "WARNING: TAILSCALE_AUTHKEY not set. Skipping Tailscale setup."
    echo "Paw will not be able to reach Tailscale network resources."
fi

# Hand off to the main application
exec "$@"
