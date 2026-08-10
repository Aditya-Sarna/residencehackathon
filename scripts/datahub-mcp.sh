#!/usr/bin/env bash
# Launch the official DataHub MCP Server (mcp-server-datahub) against local GMS.
# Pair with Residence MCP in Claude Desktop — see desktop/mcp/claude_desktop_config.example.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DATAHUB_GMS_URL="${DATAHUB_GMS_URL:-http://localhost:8080}"
export DATAHUB_GMS_TOKEN="${DATAHUB_GMS_TOKEN:-}"

if [[ -f "$HOME/miniconda3/etc/profile.d/conda.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/miniconda3/etc/profile.d/conda.sh"
  conda activate residence 2>/dev/null || true
fi

if ! python -c "import mcp_server_datahub" 2>/dev/null; then
  echo "Installing mcp-server-datahub + datahub-agent-context…"
  pip install 'mcp-server-datahub>=0.6.0' 'datahub-agent-context>=1.7.0'
fi

echo "DataHub MCP → GMS ${DATAHUB_GMS_URL}"
echo "Transport: ${1:-stdio}  (pass 'http' for HTTP on :8000)"
TRANSPORT="${1:-stdio}"
if [[ "$TRANSPORT" == "http" ]]; then
  exec python -m mcp_server_datahub --transport http
else
  exec python -m mcp_server_datahub --transport stdio
fi
