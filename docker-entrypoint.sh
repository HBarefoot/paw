#!/bin/sh
set -e

TS_SOCKET="/var/run/tailscale/tailscaled.sock"

# Start Tailscale daemon in userspace networking mode
# (no TUN device needed — works in unprivileged containers)
if [ -n "$TAILSCALE_AUTHKEY" ]; then
    echo "Starting Tailscale daemon..."
    tailscaled --tun=userspace-networking --statedir=/data/tailscale --socket=$TS_SOCKET &
    TAILSCALED_PID=$!

    # Wait for daemon socket to appear (up to 10s)
    echo "Waiting for tailscaled to be ready..."
    for i in $(seq 1 20); do
        if [ -S "$TS_SOCKET" ]; then
            echo "tailscaled ready after ${i}x0.5s"
            break
        fi
        sleep 0.5
    done

    if [ ! -S "$TS_SOCKET" ]; then
        echo "ERROR: tailscaled socket never appeared. Check logs above."
        # Continue without Tailscale rather than blocking startup
    else
        # Authenticate and connect to tailnet
        echo "Connecting to tailnet..."
        tailscale --socket=$TS_SOCKET up \
            --authkey="$TAILSCALE_AUTHKEY" \
            --hostname=paw-railway \
            --accept-dns=true

        echo "Tailscale connected. Status:"
        tailscale --socket=$TS_SOCKET status
        echo ""

        # Verify we can reach local-lab before starting relay
        echo "Testing connectivity to local-lab:11434..."
        if tailscale --socket=$TS_SOCKET nc local-lab 11434 </dev/null 2>&1; then
            echo "local-lab reachable."
        else
            echo "WARNING: Could not reach local-lab:11434 — Ollama may not be running."
        fi

        # Relay localhost:11434 → Ollama via Tailscale mesh
        echo "Setting up Ollama relay via Tailscale..."
        socat TCP-LISTEN:11434,fork,reuseaddr,bind=127.0.0.1 \
            EXEC:"tailscale --socket=$TS_SOCKET nc local-lab 11434" &
        SOCAT_PID=$!
        sleep 0.5

        # Verify socat is running
        if kill -0 $SOCAT_PID 2>/dev/null; then
            echo "Ollama relay ready on localhost:11434 (PID $SOCAT_PID)"
        else
            echo "ERROR: socat relay failed to start"
        fi
    fi
else
    echo "WARNING: TAILSCALE_AUTHKEY not set. Skipping Tailscale setup."
    echo "Paw will not be able to reach Tailscale network resources."
fi

# Hand off to the main application
exec "$@"
