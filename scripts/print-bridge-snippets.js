const fs = require("node:fs/promises")
const path = require("node:path")

async function main() {
  const repoRoot = path.resolve(__dirname, "..")
  const outputDir = path.join(repoRoot, "output", "integration-snippets")
  const defaultMcpPath = "path/to/web-search-mcp.py"
  const mcpPath = process.env.OLLAMA_WEB_SEARCH_MCP_PATH || defaultMcpPath
  const normalizedMcpPath = mcpPath.replace(/\\/g, "/")

  const codexSnippet = [
    "# Add this to ~/.codex/config.toml",
    "# It mirrors Ollama's documented Codex MCP integration for web_search and web_fetch.",
    "[mcp_servers.web_search]",
    'command = "uv"',
    `args = ["run", "${normalizedMcpPath}"]`,
    'env = { OLLAMA_API_KEY = "${OLLAMA_API_KEY}" }',
    "",
  ].join("\n")

  const rooSnippet = `${JSON.stringify(
    {
      mcpServers: {
        web_search_and_fetch: {
          type: "stdio",
          command: "uv",
          args: ["run", normalizedMcpPath],
          env: {
            OLLAMA_API_KEY: "${OLLAMA_API_KEY}",
          },
        },
      },
    },
    null,
    2,
  )}\n`

  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(path.join(outputDir, "codex-ollama-web-search.example.toml"), codexSnippet, "utf8")
  await fs.writeFile(path.join(outputDir, "roo-ollama-web-search.example.json"), rooSnippet, "utf8")

  process.stdout.write(
    [
      `Wrote integration snippets to ${outputDir}`,
      "",
      "Codex MCP snippet:",
      codexSnippet,
      "Roo MCP snippet:",
      rooSnippet,
      "Set OLLAMA_WEB_SEARCH_MCP_PATH if you want these files to point at a real local copy of Ollama's web-search-mcp.py example.",
    ].join("\n"),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
