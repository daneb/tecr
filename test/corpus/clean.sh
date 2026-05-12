#!/usr/bin/env bash
# Usage: ./strip-corpus.sh <target-dir>
# Run once per repo after cloning.
# Example:
#   git clone --depth 1 https://github.com/dtolnay/bincode   test/corpus/bincode
#   git clone --depth 1 https://github.com/colinhacks/zod     test/corpus/zod
#   git clone --depth 1 https://github.com/encode/httpx       test/corpus/httpx
#   ./strip-corpus.sh test/corpus/bincode
#   ./strip-corpus.sh test/corpus/zod
#   ./strip-corpus.sh test/corpus/httpx

set -euo pipefail
DIR="${1:?Usage: $0 <corpus-dir>}"

# Remove VCS and build artifacts
rm -rf "$DIR/.git"

# Rust
rm -rf "$DIR/target"

# TypeScript / Node
rm -rf "$DIR/node_modules" "$DIR/dist" "$DIR/build" "$DIR/.next" "$DIR/coverage"

# Python
find "$DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$DIR" -type d -name ".venv"       -exec rm -rf {} + 2>/dev/null || true
find "$DIR" -type d -name "*.egg-info"  -exec rm -rf {} + 2>/dev/null || true
find "$DIR" -name "*.pyc" -delete

# Report what's left
echo ""
echo "=== $DIR ==="
echo "Source line count by extension:"
find "$DIR" -type f \( -name "*.ts" -o -name "*.rs" -o -name "*.py" -o -name "*.go" -o -name "*.java" \) \
  | xargs wc -l 2>/dev/null | tail -1
echo "Total files:"
find "$DIR" -type f | wc -l
echo "Disk usage:"
du -sh "$DIR"
