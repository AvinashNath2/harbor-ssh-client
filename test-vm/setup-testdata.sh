#!/bin/bash
# Populate the test VM with realistic data that exercises every HarborSCP
# Storage Analyzer feature. Runs once at container start via custom-cont-init.d.

# Skip if data already created (container restart)
[ -f /data/.harbor_testdata_done ] && exit 0

echo ">>> [HarborSCP] Creating storage analyzer test data..."

# ── 1. Duplicate files (same size → detected by size-based scan) ──────────────
HOME_DIR=/config/home/harbor
mkdir -p "$HOME_DIR/documents/reports" \
         "$HOME_DIR/documents/archive" \
         "$HOME_DIR/downloads/misc"

# 15 MB report — 3 copies in different dirs
dd if=/dev/urandom bs=1M count=15 of="$HOME_DIR/documents/reports/annual_report_2024.pdf" 2>/dev/null
cp "$HOME_DIR/documents/reports/annual_report_2024.pdf" \
   "$HOME_DIR/documents/archive/annual_report_2024_backup.pdf"
cp "$HOME_DIR/documents/reports/annual_report_2024.pdf" \
   "$HOME_DIR/downloads/misc/annual_report_copy.pdf"

# 25 MB dataset — 2 copies
dd if=/dev/urandom bs=1M count=25 of="$HOME_DIR/documents/dataset_q1.csv" 2>/dev/null
cp "$HOME_DIR/documents/dataset_q1.csv" \
   "$HOME_DIR/documents/archive/dataset_q1_backup.csv"

# 10 MB model — 2 copies
dd if=/dev/urandom bs=1M count=10 of="$HOME_DIR/downloads/model_v2.bin" 2>/dev/null
cp "$HOME_DIR/downloads/model_v2.bin" \
   "$HOME_DIR/documents/archive/model_v2_old.bin"

# ── 2. Old /tmp files (access time > 90 days — matched by tmp-old preset) ────
mkdir -p /tmp/app-cache /tmp/sessions /tmp/render

dd if=/dev/zero bs=1M  count=5  of=/tmp/app-cache/cache_2023.tmp   2>/dev/null
dd if=/dev/zero bs=512K count=1 of=/tmp/sessions/sess_deadbeef      2>/dev/null
dd if=/dev/zero bs=2M  count=1  of=/tmp/render/frame_buffer.raw     2>/dev/null

# Set atime to Jan 2023 — well over 90 days old
touch -a -t 202301010000 /tmp/app-cache/cache_2023.tmp
touch -a -t 202302150000 /tmp/sessions/sess_deadbeef
touch -a -t 202303010000 /tmp/render/frame_buffer.raw

# Recent /tmp file — should NOT be deleted
dd if=/dev/zero bs=1M count=1 of=/tmp/recent_job.tmp 2>/dev/null

# ── 3. Rotated logs in /var/log ───────────────────────────────────────────────
mkdir -p /var/log/nginx /var/log/app /var/log/harbor

# Active (current) logs — must NOT be deleted
echo "2026-07-30 active access log"  > /var/log/nginx/access.log
echo "2026-07-30 active error log"   > /var/log/nginx/error.log

# Numbered rotated logs — matched by old-logs preset
for i in 1 2 3 4 5; do
    dd if=/dev/zero bs=2M count=1 of=/var/log/nginx/access.log.$i  2>/dev/null
    dd if=/dev/zero bs=1M count=1 of=/var/log/nginx/error.log.$i   2>/dev/null
done

# Gzip-compressed rotated logs — also matched by old-logs preset
for i in 6 7 8 9; do
    dd if=/dev/zero bs=3M count=1 2>/dev/null | gzip -c > /var/log/nginx/access.log.$i.gz
done
dd if=/dev/zero bs=8M  count=1 2>/dev/null | gzip -c > /var/log/syslog.1.gz
dd if=/dev/zero bs=5M  count=1 2>/dev/null | gzip -c > /var/log/syslog.2.gz
dd if=/dev/zero bs=12M count=1 2>/dev/null | gzip -c > /var/log/app/app.log.1.gz
dd if=/dev/zero bs=4M  count=1 of=/var/log/app/app.log.1                2>/dev/null
dd if=/dev/zero bs=4M  count=1 of=/var/log/app/app.log.2                2>/dev/null
dd if=/dev/zero bs=4M  count=1 of=/var/log/harbor/harbor.log.1          2>/dev/null

# ── 4. Core dumps ─────────────────────────────────────────────────────────────
mkdir -p /var/crash /var/core

dd if=/dev/zero bs=1M count=20 of=/var/crash/core.nginx.12345    2>/dev/null
dd if=/dev/zero bs=1M count=8  of=/var/crash/nginx.12345.crash   2>/dev/null
dd if=/dev/zero bs=1M count=35 of=/var/crash/core.app.67890      2>/dev/null
dd if=/dev/zero bs=1M count=5  of=/var/core/core.worker.11223    2>/dev/null

# ── 5. Large files for Largest Items view ────────────────────────────────────
mkdir -p /opt/apps/data /opt/apps/models

dd if=/dev/urandom bs=1M count=100 of=/opt/apps/data/db_backup_full.sql   2>/dev/null
dd if=/dev/urandom bs=1M count=50  of=/opt/apps/data/db_backup_delta.sql  2>/dev/null
dd if=/dev/urandom bs=1M count=80  of=/opt/apps/models/bert_weights.bin   2>/dev/null
dd if=/dev/urandom bs=1M count=30  of=/opt/apps/models/embedding_v3.bin   2>/dev/null

# ── 6. Deep directory tree for Storage Explorer / Heatmap ────────────────────
mkdir -p /data/prod/backups/daily \
         /data/prod/backups/weekly \
         /data/prod/uploads/2024/q1 \
         /data/prod/uploads/2024/q2 \
         /data/staging/builds \
         /data/staging/artifacts \
         /data/archive/2023 \
         /data/archive/2022

dd if=/dev/zero bs=1M count=200 of=/data/prod/backups/daily/db_20240701.tar.gz   2>/dev/null
dd if=/dev/zero bs=1M count=150 of=/data/prod/backups/daily/db_20240702.tar.gz   2>/dev/null
dd if=/dev/zero bs=1M count=300 of=/data/prod/backups/weekly/db_week27.tar.gz    2>/dev/null
dd if=/dev/zero bs=1M count=40  of=/data/prod/uploads/2024/q1/batch_export.csv   2>/dev/null
dd if=/dev/zero bs=1M count=60  of=/data/prod/uploads/2024/q2/batch_export.csv   2>/dev/null
dd if=/dev/zero bs=1M count=80  of=/data/staging/builds/release_candidate.tar    2>/dev/null
dd if=/dev/zero bs=1M count=20  of=/data/staging/artifacts/test_results.zip      2>/dev/null
dd if=/dev/zero bs=1M count=120 of=/data/archive/2023/full_export.tar.gz         2>/dev/null
dd if=/dev/zero bs=1M count=90  of=/data/archive/2022/full_export.tar.gz         2>/dev/null

# Age histogram: set old mtimes on archive files (shows in "older than 90d" bucket)
touch -m -t 202301010000 /data/archive/2022/full_export.tar.gz
touch -m -t 202306150000 /data/archive/2023/full_export.tar.gz

# ── 7. Fake APT cache (apt-cache cleanup estimate) ───────────────────────────
mkdir -p /var/cache/apt/archives
dd if=/dev/zero bs=1M count=80 of=/var/cache/apt/archives/fake_pkg_1.deb 2>/dev/null
dd if=/dev/zero bs=1M count=40 of=/var/cache/apt/archives/fake_pkg_2.deb 2>/dev/null
dd if=/dev/zero bs=1M count=20 of=/var/cache/apt/archives/fake_pkg_3.deb 2>/dev/null

# ── Mark done ─────────────────────────────────────────────────────────────────
touch /data/.harbor_testdata_done
chown -R 1000:1000 /config/home/harbor /data 2>/dev/null || true

echo ""
echo ">>> [HarborSCP] Test data ready:"
du -sh "$HOME_DIR" /tmp/ /var/log/ /var/crash/ /opt/ /data/ /var/cache/apt/archives/ 2>/dev/null || true
echo ""
echo ">>> Connect via HarborSCP:"
echo "    Host:     localhost"
echo "    Port:     2222"
echo "    Username: harbor"
echo "    Password: harbor123"
