# Supabase MCP

This project is configured for the Supabase MCP server with project ref:

```bash
esqzngqpfwrlcnapmfpx
```

The project-level MCP config is in `.mcp.json`.

## Setup

Create a Supabase personal access token from the Supabase dashboard, then expose it in your shell before starting an MCP-capable client:

```bash
export SUPABASE_ACCESS_TOKEN="your-supabase-personal-access-token"
```

The MCP server is configured in read-only mode by default:

```json
"--read-only"
```

Remove that argument from `.mcp.json` only when you intentionally want the assistant to perform write operations through Supabase MCP.
