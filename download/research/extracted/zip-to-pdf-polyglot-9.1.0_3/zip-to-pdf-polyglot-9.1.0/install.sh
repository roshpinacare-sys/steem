#!/usr/bin/env bash
# install.sh — One-command setup for zip-to-pdf-polyglot v9.1.0
set -e

echo ""
echo "  zip-to-pdf-polyglot v9.1.0 — installer"
echo "  ======================================="
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "  ERROR: Node.js not found. Install Node.js 18+ from https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "  ERROR: Node.js 18+ required (found v${NODE_VERSION})"
  exit 1
fi

echo "  ✓ Node.js $(node --version)"

if ! command -v npm &>/dev/null; then
  echo "  ERROR: npm not found."
  exit 1
fi
echo "  ✓ npm $(npm --version)"
echo ""

# Install dependencies
echo "  Installing dependencies (express, multer, tsx, typescript…)"
npm install --silent
echo "  ✓ Dependencies installed"

# Build
echo "  Building TypeScript → dist/"
npm run build 2>&1 | grep -E "error TS|warning TS|^" | head -20
echo "  ✓ Build complete"

echo ""
echo "  ──────────────────────────────────────────────"
echo "  Ready! Quick start:"
echo ""
echo "    CLI:     node dist/cli.js build archive.zip"
echo "    CLI:     node dist/cli.js --list-strategies"
echo "    Server:  node dist/server/index.js          (then open http://localhost:3000)"
echo "    MCP:     node dist/mcp-server/index.js"
echo "    Tests:   npm test"
echo ""
echo "  Without building (uses tsx):"
echo "    npx tsx cli.ts build archive.zip"
echo "    npx tsx server/index.ts"
echo "  ──────────────────────────────────────────────"
echo ""
