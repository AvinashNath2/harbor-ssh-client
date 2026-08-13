#!/bin/bash
set -e

# ── Generate filesystem structure for Storage Analyzer testing ─────────────────

if [ ! -f /var/log/test/.done ]; then
    echo "[setup] Creating 50,000 log files in /var/log/test/ ..."
    mkdir -p /var/log/test

    python3 - <<'PYEOF'
import os, random, time

log_dir = "/var/log/test"
levels  = ["INFO ", "DEBUG", "WARN ", "ERROR"]
apps    = ["api-server", "worker", "scheduler", "cache", "db-proxy"]
hosts   = [f"192.168.1.{i}" for i in range(1, 50)]

for i in range(50_000):
    app  = apps[i % len(apps)]
    ts   = f"2026-08-{(i % 28)+1:02d} {(i//3600)%24:02d}:{(i//60)%60:02d}:{i%60:02d}"
    with open(f"{log_dir}/{app}_{i:05d}.log", "w") as f:
        f.write(f"[{ts}] INFO  Starting {app} instance request_id={i}\n")
        f.write(f"[{ts}] DEBUG Received request from {hosts[i % len(hosts)]} path=/api/v2/resource/{i}\n")
        f.write(f"[{ts}] {levels[i%4]} Processing took {(i%100)+1}ms — status={'200 OK' if i%10!=0 else '500 ERR'}\n")
        f.write(f"[{ts}] DEBUG Heap={i%512+64}MB RSS={i%256+32}MB threads={i%32+4}\n")
        f.write(f"[{ts}] WARN  Slow query on users_table: {(i%50)+5}ms\n")
        f.write(f"[{ts}] INFO  Done — idle, waiting for next request\n")

print(f"[setup] Created {50_000} log files")
PYEOF

    touch /var/log/test/.done
    echo "[setup] Log files done."
fi

# ── Extra directories to make storage tree interesting ─────────────────────────

if [ ! -f /var/lib/appdata/.done ]; then
    echo "[setup] Creating /var/lib/appdata structure..."
    mkdir -p /var/lib/appdata/{uploads,cache,backups,sessions}

    python3 - <<'PYEOF'
import os, random, string

for sub, n, size in [
    ("/var/lib/appdata/uploads",  500,  8192),
    ("/var/lib/appdata/cache",   2000,  1024),
    ("/var/lib/appdata/backups",   50, 65536),
    ("/var/lib/appdata/sessions", 800,   512),
]:
    os.makedirs(sub, exist_ok=True)
    for i in range(n):
        with open(f"{sub}/file_{i:04d}.dat", "wb") as f:
            f.write(bytes(random.randint(0, 255) for _ in range(size)))

print("[setup] appdata structure done")
PYEOF

    touch /var/lib/appdata/.done
fi

if [ ! -d /home/harbor/projects ]; then
    echo "[setup] Creating /home/harbor/projects..."
    mkdir -p /home/harbor/projects/{frontend,backend,infra,scripts,docs}
    for proj in frontend backend infra scripts docs; do
        for i in $(seq 1 30); do
            echo "# Project file $i in $proj" > "/home/harbor/projects/$proj/module_${i}.py"
        done
    done
    chown -R harbor:harbor /home/harbor/projects
fi

mkdir -p /var/log/nginx /var/log/syslog-archive /tmp/build-cache
if [ ! -f /var/log/nginx/access.log ]; then
    for i in $(seq 1 5000); do
        echo "192.168.1.$((i%50+1)) - - [02/Aug/2026:07:00:$((i%60)):00 +0000] \"GET /api/$i HTTP/1.1\" 200 $((i*17+100))" >> /var/log/nginx/access.log
    done
fi

# ── Start SSH ──────────────────────────────────────────────────────────────────
echo "[setup] All done — starting SSH on port 22"
exec /usr/sbin/sshd -D
