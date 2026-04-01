const fs = require("node:fs")
const fsp = require("node:fs/promises")
const path = require("node:path")
const { EventEmitter } = require("node:events")
const { spawn } = require("node:child_process")

const providerModule = require("../../providers")
const { getCanonicalRole } = require("../../providers/capabilities")
const { createSchemaValidator } = require("../../schemas/validator")

const DEFAULT_CONFIG = {
  runtime: {
    outputDir: "output/multi-ai-runs",
    workspaceSync: true,
    historyLimit: 60,
    maxTaskIterations: 3,
  },
  features: {
    webSearch: {
      enabled: false,
      apiUrl: "https://ollama.com/api/web_search",
      apiKeyEnv: "OLLAMA_API_KEY",
      maxResults: 3,
    },
    webFetch: {
      enabled: true,
      apiUrl: "https://ollama.com/api/web_fetch",
      apiKeyEnv: "OLLAMA_API_KEY",
    },
    urlContext: {
      enabled: true,
      maxUrls: 3,
      maxCharsPerUrl: 4000,
    },
  },
  profiles: {
    "local-manager": {
      type: "ollama",
      label: "Local Manager",
      model: "deepseek-r1:1.5b-qwen-distill-q8_0",
      baseUrl: "http://127.0.0.1:11434",
      temperature: 0.2,
      capabilities: ["reasoning", "structured_output", "long_context"],
    },
    "local-code": {
      type: "ollama",
      label: "Local Code",
      model: "qwen2.5-coder:7b",
      baseUrl: "http://127.0.0.1:11434",
      temperature: 0.2,
      capabilities: ["reasoning", "structured_output", "code_generation", "tool_execution", "long_context"],
    },
    "local-research": {
      type: "ollama",
      label: "Local Research",
      model: "gemma3:4b",
      baseUrl: "http://127.0.0.1:11434",
      temperature: 0.2,
      capabilities: ["reasoning", "structured_output", "artifact_review", "design_spec", "research_retrieval", "long_context"],
    },
    "anthropic-architect": {
      type: "anthropic",
      label: "Claude Architect",
      model: "claude-3-7-sonnet-latest",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      apiUrl: "https://api.anthropic.com/v1/messages",
      temperature: 0.2,
      maxTokens: 2200,
      capabilities: ["reasoning", "structured_output", "artifact_review", "design_spec", "research_retrieval", "long_context"],
    },
    "openai-code": {
      type: "openai",
      label: "OpenAI Code",
      model: "gpt-5",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      temperature: 0.2,
      maxTokens: 2200,
      capabilities: ["reasoning", "structured_output", "artifact_review", "code_generation", "tool_execution", "design_spec", "long_context"],
    },
    "gemini-review": {
      type: "gemini",
      label: "Gemini Review",
      model: "gemini-2.5-pro",
      apiKeyEnv: "GEMINI_API_KEY",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      temperature: 0.2,
      maxTokens: 2200,
      capabilities: ["reasoning", "structured_output", "artifact_review", "design_spec", "research_retrieval", "long_context"],
    },
    "openrouter-fallback": {
      type: "openai-compatible",
      label: "OpenRouter Fallback",
      model: "openai/gpt-5",
      apiKeyEnv: "OPENROUTER_API_KEY",
      baseUrl: "https://openrouter.ai/api/v1",
      temperature: 0.2,
      maxTokens: 2200,
      extraHeaders: {
        "HTTP-Referer": "https://github.com/Taan1el/multi_AI_System",
        "X-Title": "Multi AI System",
      },
      capabilities: ["reasoning", "structured_output", "artifact_review", "code_generation", "tool_execution", "design_spec", "research_retrieval", "long_context"],
    },
  },
  presets: {
    local: {
      label: "Local only",
      roles: {
        manager: ["local-manager"],
        architect: ["local-research"],
        code: ["local-code"],
        review: ["local-research"],
        designer: ["local-research"],
        researcher: ["local-research"],
      },
    },
    hybrid: {
      label: "Hybrid local + cloud",
      roles: {
        manager: ["local-manager", "openrouter-fallback"],
        architect: ["anthropic-architect", "gemini-review", "local-research"],
        code: ["openai-code", "openrouter-fallback", "local-code"],
        review: ["gemini-review", "anthropic-architect", "local-research"],
        designer: ["gemini-review", "anthropic-architect", "local-research"],
        researcher: ["gemini-review", "anthropic-architect", "local-research"],
      },
    },
  },
}

const STAGE_DEFS = [
  { key: "planning", label: "Planning", role: "manager" },
  { key: "architecture", label: "Architecture", role: "architect" },
  { key: "tasks", label: "Task Synthesis", role: "manager" },
  { key: "implementation", label: "Implementation", role: "coder" },
  { key: "review", label: "Review", role: "reviewer" },
  { key: "summary", label: "Summary", role: "manager" },
]

const ARTIFACT_DEFS = [
  { key: "input", relativePath: "00-input.md", type: "text" },
  { key: "managerBrief", relativePath: "01-manager-brief.json", type: "json" },
  { key: "plan", relativePath: "01_planning/plan.md", type: "text" },
  { key: "architecture", relativePath: "02_architecture/architecture.md", type: "text" },
  { key: "tasks", relativePath: "03_tasks/tasks.json", type: "json" },
  { key: "handoffsIndex", relativePath: "handoffs-index.json", type: "json" },
  { key: "reviewsIndex", relativePath: "reviews-index.json", type: "json" },
  { key: "workspaceManifest", relativePath: "workspace-manifest.md", type: "text" },
  { key: "implementation", relativePath: "04_code/implementation.md", type: "text" },
  { key: "review", relativePath: "05_reviews/review.md", type: "text" },
  { key: "runReport", relativePath: "run-report.json", type: "json" },
  { key: "summary", relativePath: "summary.md", type: "text" },
]

const WORKSPACE_COPY_EXCLUDES = new Set([".git", "node_modules", "output", ".playwright-cli"])
const SAFE_COMMAND_PREFIXES = ["npm", "npx", "node", "git status", "git diff", "python", "py", "pytest", "pnpm", "yarn", "bun"]
const BLOCKED_COMMAND_PATTERNS = ["&&", "||", ";", "|", ">", "<", "rm ", "del ", "rmdir ", "Remove-Item"]
const COMMAND_TIMEOUT_MS = 120000

function createOrchestrator(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, "..", "..")
  const contractsRoot = options.contractsRoot || repoRoot
  const appRoot = options.appRoot || path.resolve(__dirname, "..")
  const configPath = options.configPath || path.join(repoRoot, "multi-ai.config.json")
  const envPath = options.envPath || path.join(repoRoot, ".env")
  const dataDir = path.join(appRoot, "data")
  const runIndexFile = path.join(dataDir, "orchestrator-runs.json")
  const providerApi = options.providerApi || providerModule
  const schemaValidator = createSchemaValidator(path.join(contractsRoot, "schemas"))
  const commandRunner = options.commandRunner || runWorkspaceCommand
  const emitter = new EventEmitter()
  const agentCache = new Map()
  let runQueue = Promise.resolve()

  function loadLocalEnv() {
    if (!fs.existsSync(envPath)) {
      return
    }

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) {
        continue
      }

      const separatorIndex = trimmed.indexOf("=")
      if (separatorIndex === -1) {
        continue
      }

      const key = trimmed.slice(0, separatorIndex).trim()
      let value = trimmed.slice(separatorIndex + 1).trim()

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }

      if (!(key in process.env)) {
        process.env[key] = value
      }
    }
  }

  function deepMerge(base, override) {
    if (Array.isArray(base) || Array.isArray(override)) {
      return override !== undefined ? override : base
    }

    if (typeof base !== "object" || base === null) {
      return override !== undefined ? override : base
    }

    const merged = { ...base }
    const source = override || {}

    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === "object" && !Array.isArray(value) && key in base) {
        merged[key] = deepMerge(base[key], value)
      } else {
        merged[key] = value
      }
    }

    return merged
  }

  async function loadConfig() {
    loadLocalEnv()
    let userConfig = {}

    if (fs.existsSync(configPath)) {
      userConfig = JSON.parse(await fsp.readFile(configPath, "utf8"))
    }

    return deepMerge(DEFAULT_CONFIG, userConfig)
  }

  async function ensureStorage(config) {
    await fsp.mkdir(dataDir, { recursive: true })
    await fsp.mkdir(path.join(repoRoot, config.runtime.outputDir), { recursive: true })

    if (!fs.existsSync(runIndexFile)) {
      await fsp.writeFile(runIndexFile, JSON.stringify({ runs: [] }, null, 2), "utf8")
    }
  }

  async function readRunIndex() {
    const config = await loadConfig()
    await ensureStorage(config)
    const parsed = JSON.parse(await fsp.readFile(runIndexFile, "utf8"))
    return Array.isArray(parsed.runs) ? parsed.runs : []
  }

  async function writeRunIndex(runs) {
    await fsp.writeFile(runIndexFile, JSON.stringify({ runs }, null, 2), "utf8")
  }

  function runFilePath(runDir) {
    return path.join(runDir, "run.json")
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "run"
  }

  function timestampForPath(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0")
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  }

  function truncate(value, maxLength) {
    const text = String(value || "")
    if (text.length <= maxLength) {
      return text
    }
    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`
  }

  async function pathExists(targetPath) {
    try {
      await fsp.access(targetPath)
      return true
    } catch {
      return false
    }
  }

  async function ensureDir(targetPath) {
    await fsp.mkdir(targetPath, { recursive: true })
  }

  async function writeFile(targetPath, content) {
    await ensureDir(path.dirname(targetPath))
    await fsp.writeFile(targetPath, content, "utf8")
  }

  function formatJson(value) {
    return `${JSON.stringify(value, null, 2)}\n`
  }

  async function readJsonFileWithRetry(filePath, attempts = 6) {
    let lastError = null

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const raw = await fsp.readFile(filePath, "utf8")
        return JSON.parse(raw)
      } catch (error) {
        lastError = error
        if (error.name !== "SyntaxError" || attempt === attempts - 1) {
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
      }
    }

    throw lastError
  }

  function summarizeRun(record) {
    return {
      id: record.id,
      title: record.title,
      prompt: record.prompt,
      preset: record.preset,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      workspaceSync: record.workspaceSync,
      runDirRelative: record.runDirRelative,
      selectedProfiles: record.selectedProfiles,
      stageStates: record.stageStates,
      error: record.error,
      summary: record.summary,
      referenceUrls: record.referenceUrls,
      enableWebSearch: record.enableWebSearch,
    }
  }

  async function writeRunRecord(record) {
    const runDir = path.join(repoRoot, record.runDirRelative)
    await writeFile(runFilePath(runDir), formatJson(record))

    const config = await loadConfig()
    const runs = await readRunIndex()
    const nextRuns = [summarizeRun(record), ...runs.filter((entry) => entry.id !== record.id)].slice(
      0,
      config.runtime.historyLimit || DEFAULT_CONFIG.runtime.historyLimit,
    )
    await writeRunIndex(nextRuns)
    emitter.emit(`run:${record.id}`, summarizeRun(record))
  }

  async function readRunRecord(runId) {
    const runs = await readRunIndex()
    const summary = runs.find((entry) => entry.id === runId)
    if (!summary) {
      return null
    }

    const runDir = path.join(repoRoot, summary.runDirRelative)
    return readJsonFileWithRetry(runFilePath(runDir))
  }

  async function listRuns() {
    const runs = await readRunIndex()
    return runs.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
  }

  async function listProfiles() {
    const config = await loadConfig()
    return providerApi.listProfiles(config, process.env)
  }

  async function listPresets() {
    const config = await loadConfig()
    return providerApi.listPresets(config)
  }

  function createInitialStageStates() {
    return Object.fromEntries(
      STAGE_DEFS.map((stage) => [
        stage.key,
        {
          label: stage.label,
          role: stage.role,
          status: "queued",
          profile: null,
          startedAt: null,
          completedAt: null,
          error: null,
        },
      ]),
    )
  }

  function appendLog(record, message, level = "info") {
    record.logs.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
    })
    record.updatedAt = new Date().toISOString()
  }

  async function updateStage(record, stageKey, patch) {
    record.stageStates[stageKey] = {
      ...record.stageStates[stageKey],
      ...patch,
    }
    record.updatedAt = new Date().toISOString()
    await writeRunRecord(record)
  }

  async function collectArtifacts(record) {
    const runDir = path.join(repoRoot, record.runDirRelative)
    const artifacts = {}

    for (const artifact of ARTIFACT_DEFS) {
      const absolutePath = path.join(runDir, artifact.relativePath)
      if (!(await pathExists(absolutePath))) {
        continue
      }

      const raw = await fsp.readFile(absolutePath, "utf8")
      artifacts[artifact.key] = {
        relativePath: artifact.relativePath.replace(/\\/g, "/"),
        content: artifact.type === "json" ? JSON.parse(raw) : raw,
      }
    }

    return artifacts
  }

  function buildSeedBrief(userPrompt) {
    return {
      title: truncate(String(userPrompt || "").replace(/\s+/g, " ").trim(), 90),
      objective: String(userPrompt || "").trim(),
      deliverable: "A schema-validated multi-agent run with task, handoff, review, and run-report artifacts.",
      constraints: [
        "Preserve the current CLI and dashboard surface.",
        "Keep provider routing config-driven and vendor-agnostic.",
        "Use shared-workspace execution for code changes.",
      ],
      successCriteria: [
        "The run produces validated task, handoff, review, and run-report artifacts.",
        "Approved code changes can be synced back to the repo when workspaceSync is enabled.",
      ],
      risks: ["Model output may still require human review before merge or release."],
    }
  }

  async function loadAgentContract(roleName) {
    const canonicalRole = getCanonicalRole(roleName)
    if (agentCache.has(canonicalRole)) {
      return agentCache.get(canonicalRole)
    }

    const agentPath = path.join(contractsRoot, "agents", `${canonicalRole}.md`)
    const contract = await fsp.readFile(agentPath, "utf8")
    agentCache.set(canonicalRole, contract)
    return contract
  }

  function stripCodeFences(value) {
    return String(value || "")
      .trim()
      .replace(/^```(?:json|markdown|md)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim()
  }

  function normalizeMarkdownArtifact(raw, heading) {
    const cleaned = stripCodeFences(raw)
    const headingIndex = cleaned.toLowerCase().indexOf(heading.toLowerCase())
    const scoped = headingIndex === -1 ? cleaned : cleaned.slice(headingIndex)
    return `${scoped.trim()}\n`
  }

  function normalizeStringArray(values) {
    return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))]
  }

  function extractJsonObject(raw) {
    const cleaned = stripCodeFences(raw)
    try {
      return JSON.parse(cleaned)
    } catch {
      const firstBrace = cleaned.indexOf("{")
      const lastBrace = cleaned.lastIndexOf("}")
      if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        throw new Error("No JSON object found.")
      }
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1))
    }
  }

  function extractUrls(input) {
    return [...new Set(String(input || "").match(/https?:\/\/[^\s)]+/g) || [])]
  }

  function cleanFetchedText(content, maxChars) {
    return String(content || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxChars)
  }

  async function performWebFetch(url, config) {
    const fetchConfig = config.features.webFetch
    if (!fetchConfig?.enabled) {
      return null
    }

    const apiKey = process.env[fetchConfig.apiKeyEnv]
    if (!apiKey) {
      return null
    }

    try {
      const response = await fetch(fetchConfig.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        return null
      }

      const payload = await response.json()
      return {
        url,
        title: payload.title || "",
        content: cleanFetchedText(payload.content || "", config.features.urlContext.maxCharsPerUrl || 4000),
      }
    } catch {
      return null
    }
  }

  async function fetchUrlContext(urls, config) {
    if (!config.features.urlContext.enabled || urls.length === 0) {
      return []
    }

    const entries = []
    const limitedUrls = urls.slice(0, config.features.urlContext.maxUrls || 3)

    for (const url of limitedUrls) {
      const fetched = await performWebFetch(url, config)
      if (fetched?.content) {
        entries.push(fetched)
        continue
      }

      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          headers: { "User-Agent": "multi-ai-system/1.0" },
        })
        entries.push({
          url,
          content: cleanFetchedText(await response.text(), config.features.urlContext.maxCharsPerUrl || 4000),
        })
      } catch (error) {
        entries.push({ url, content: `Failed to fetch URL context: ${error.message}` })
      }
    }

    return entries
  }

  async function performWebSearch(query, config) {
    const searchConfig = config.features.webSearch
    if (!searchConfig.enabled) {
      return []
    }

    const apiKey = process.env[searchConfig.apiKeyEnv]
    if (!apiKey) {
      return []
    }

    try {
      const response = await fetch(searchConfig.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: searchConfig.maxResults || 3,
        }),
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        return []
      }

      const payload = await response.json()
      return Array.isArray(payload.results) ? payload.results : []
    } catch {
      return []
    }
  }

  function buildAugmentationText(referenceUrls, urlContextEntries, searchResults) {
    const sections = []

    if (referenceUrls.length > 0) {
      sections.push(["Reference URLs:", ...referenceUrls.map((url) => `- ${url}`)].join("\n"))
    }

    if (urlContextEntries.length > 0) {
      sections.push(["Fetched URL context:", ...urlContextEntries.map((entry) => `- ${entry.url}\n  ${entry.content}`)].join("\n"))
    }

    if (searchResults.length > 0) {
      sections.push(
        ["Web search results:", ...searchResults.map((entry) => `- ${entry.title || "Untitled"}\n  URL: ${entry.url || ""}\n  Snippet: ${entry.content || entry.snippet || ""}`)].join("\n"),
      )
    }

    return sections.length > 0 ? `${sections.join("\n\n")}\n\n` : ""
  }

  function normalizeRelativePath(relativePath) {
    const normalized = path.posix.normalize(String(relativePath || "").trim().replace(/\\/g, "/"))
    if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) {
      return null
    }
    return normalized
  }

  async function copyPathRecursive(sourcePath, destinationPath) {
    const stats = await fsp.lstat(sourcePath)
    if (stats.isSymbolicLink()) {
      return
    }

    if (stats.isDirectory()) {
      if (WORKSPACE_COPY_EXCLUDES.has(path.basename(sourcePath))) {
        return
      }

      await ensureDir(destinationPath)
      const entries = await fsp.readdir(sourcePath)
      for (const entry of entries) {
        await copyPathRecursive(path.join(sourcePath, entry), path.join(destinationPath, entry))
      }
      return
    }

    await ensureDir(path.dirname(destinationPath))
    await fsp.copyFile(sourcePath, destinationPath)
  }

  async function ensureExecutionWorkspace(runDir) {
    const workspaceDir = path.join(runDir, "workspace")
    if (!(await pathExists(workspaceDir))) {
      await copyPathRecursive(repoRoot, workspaceDir)
    }
    return workspaceDir
  }

  async function buildWorkspaceManifest(workspaceDir) {
    const lines = ["# Workspace Manifest", "", "## Files"]
    const queue = [{ absolutePath: workspaceDir, relativePath: "", depth: 0 }]
    let entriesWritten = 0

    while (queue.length > 0 && entriesWritten < 180) {
      const current = queue.shift()
      const entries = await fsp.readdir(current.absolutePath, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name))

      for (const entry of entries) {
        if (WORKSPACE_COPY_EXCLUDES.has(entry.name)) {
          continue
        }

        const nextRelativePath = current.relativePath ? `${current.relativePath}/${entry.name}` : entry.name
        lines.push(`- ${nextRelativePath}${entry.isDirectory() ? "/" : ""}`)
        entriesWritten += 1

        if (entry.isDirectory() && current.depth < 3) {
          queue.push({
            absolutePath: path.join(current.absolutePath, entry.name),
            relativePath: nextRelativePath,
            depth: current.depth + 1,
          })
        }
      }
    }

    return `${lines.join("\n")}\n`
  }

  async function applyWorkspaceFileWrites(workspaceDir, fileEntries) {
    const writtenFiles = []

    for (const entry of fileEntries) {
      const relativePath = normalizeRelativePath(entry.path)
      if (!relativePath) {
        continue
      }

      const targetPath = path.join(workspaceDir, relativePath)
      await writeFile(targetPath, `${String(entry.content || "")}\n`)
      writtenFiles.push(relativePath)
    }

    return writtenFiles
  }

  async function syncWorkspaceFilesToRepo(workspaceDir, relativePaths) {
    const synced = []
    for (const relativePath of relativePaths) {
      const normalized = normalizeRelativePath(relativePath)
      if (!normalized) {
        continue
      }

      const sourcePath = path.join(workspaceDir, normalized)
      if (!(await pathExists(sourcePath))) {
        continue
      }

      const targetPath = path.join(repoRoot, normalized)
      await ensureDir(path.dirname(targetPath))
      await fsp.copyFile(sourcePath, targetPath)
      synced.push(normalized)
    }

    return synced
  }

  function isSafeCommand(command) {
    const normalized = String(command || "").trim()
    const lowered = normalized.toLowerCase()
    if (!normalized) {
      return false
    }

    if (BLOCKED_COMMAND_PATTERNS.some((pattern) => lowered.includes(pattern.toLowerCase()))) {
      return false
    }

    return SAFE_COMMAND_PREFIXES.some((prefix) => lowered === prefix || lowered.startsWith(`${prefix} `))
  }

  async function runWorkspaceCommand(workspaceDir, command) {
    const normalized = String(command || "").trim()
    if (!isSafeCommand(normalized)) {
      return {
        command: normalized,
        status: "skipped",
        exitCode: null,
        stdout: "",
        stderr: "Command blocked by safety policy.",
      }
    }

    return new Promise((resolve) => {
      const child = spawn("powershell", ["-NoProfile", "-Command", normalized], {
        cwd: workspaceDir,
        windowsHide: true,
      })
      let stdout = ""
      let stderr = ""
      let completed = false
      const timer = setTimeout(() => {
        if (!completed) {
          child.kill()
        }
      }, COMMAND_TIMEOUT_MS)

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk)
      })
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk)
      })
      child.on("error", (error) => {
        completed = true
        clearTimeout(timer)
        resolve({
          command: normalized,
          status: "failed",
          exitCode: null,
          stdout: stdout.trim(),
          stderr: `${stderr}\n${error.message}`.trim(),
        })
      })
      child.on("close", (exitCode) => {
        completed = true
        clearTimeout(timer)
        resolve({
          command: normalized,
          status: exitCode === 0 ? "completed" : "failed",
          exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      })
    })
  }

  function buildPlanPrompt(agentContract, userPrompt, managerBrief, augmentationText) {
    return [
      agentContract.trim(),
      "",
      "Write markdown only using these sections in this exact order:",
      "# Plan",
      "## Goal",
      "## Scope",
      "## Constraints",
      "## Success Criteria",
      "## Workstreams",
      "## Risks",
      "## Open Questions",
      "## Handoff",
      "",
      augmentationText,
      "User prompt:",
      userPrompt,
      "",
      "Manager brief JSON:",
      formatJson(managerBrief),
    ].join("\n")
  }

  function buildArchitecturePrompt(agentContract, userPrompt, planMarkdown, handoff) {
    return [
      agentContract.trim(),
      "",
      "Write markdown only using these sections in this exact order:",
      "# Architecture",
      "## Overview",
      "## System Shape",
      "## Data and State",
      "## Files and Folders",
      "## Model Collaboration",
      "## Risks and Mitigations",
      "## Recommended Build Order",
      "",
      "User prompt:",
      userPrompt,
      "",
      "Plan markdown:",
      planMarkdown,
      "",
      "Handoff JSON:",
      formatJson(handoff),
    ].join("\n")
  }

  function buildTextSpecialistPrompt(agentContract, task, handoff, supportingArtifacts, roleName) {
    const headings = {
      researcher: "# Research",
      designer: "# Design Specification",
      architect: "# Architecture",
    }

    return [
      agentContract.trim(),
      "",
      "Write markdown only.",
      `Start with ${headings[roleName] || "# Output"}.`,
      "",
      "Task JSON:",
      formatJson(task),
      "Handoff JSON:",
      formatJson(handoff),
      "Supporting artifacts:",
      supportingArtifacts.join("\n\n"),
    ].join("\n")
  }

  function buildCoderPrompt(agentContract, task, handoff, supportingArtifacts, workspaceManifest) {
    const workspaceContext = buildScopedWorkspaceContext(workspaceManifest, task)
    return [
      agentContract.trim(),
      "",
      "Return JSON only.",
      "Use exactly these top-level fields:",
      '- "summary": string',
      '- "files": array of objects with "path" and "content"',
      '- "commands": array of strings',
      '- "blockers": array of strings',
      '- "assumptions": array of strings',
      "",
      "Task JSON:",
      formatJson(task),
      "Handoff JSON:",
      formatJson(handoff),
      "Workspace context:",
      workspaceContext,
      "",
      "Supporting artifacts:",
      supportingArtifacts.join("\n\n"),
    ].join("\n")
  }

  function buildReviewerPrompt(agentContract, task, handoff, specialistOutput, commandResults) {
    return [
      agentContract.trim(),
      "",
      "Return JSON only.",
      "Use exactly these top-level fields: findings, blocking_issues, non_blocking_improvements, revision_request, approved.",
      "",
      "Task JSON:",
      formatJson(task),
      "Handoff JSON:",
      formatJson(handoff),
      "Specialist output summary:",
      specialistOutput.summary || specialistOutput.relativePath || "No summary provided.",
      "Specialist blockers:",
      formatJson(specialistOutput.blockers || []),
      "Command results:",
      formatJson(commandResults),
    ].join("\n")
  }

  async function generateText(roleName, profile, prompt, context = {}) {
    return providerApi.generateText(profile, prompt, { role: getCanonicalRole(roleName), ...context }, process.env)
  }

  function ensureReviewShape(review) {
    return {
      findings: normalizeStringArray(review.findings),
      blocking_issues: normalizeStringArray(review.blocking_issues),
      non_blocking_improvements: normalizeStringArray(review.non_blocking_improvements),
      revision_request: normalizeStringArray(review.revision_request),
      approved: Boolean(review.approved),
    }
  }

  function buildFallbackReview(task, specialistOutput, commandResults) {
    const commandFailures = commandResults.filter((entry) => entry.status === "failed")
    const blockingIssues = normalizeStringArray([
      ...(specialistOutput.blockers || []),
      ...commandFailures.map((entry) => `Command failed: ${entry.command}`),
    ])

    if (blockingIssues.length > 0) {
      return {
        findings: [`${task.assigned_agent} output has unresolved blockers.`],
        blocking_issues: blockingIssues,
        non_blocking_improvements: [],
        revision_request: [blockingIssues[0]],
        approved: false,
      }
    }

    return {
      findings: [`${task.assigned_agent} output satisfied the current task contract.`],
      blocking_issues: [],
      non_blocking_improvements: [],
      revision_request: [],
      approved: true,
    }
  }

  function parseReviewArtifact(raw, task, specialistOutput, commandResults) {
    try {
      return ensureReviewShape(extractJsonObject(raw))
    } catch {
      return buildFallbackReview(task, specialistOutput, commandResults)
    }
  }

  function parseCoderResponse(raw) {
    try {
      const parsed = extractJsonObject(raw)
      return {
        summary: String(parsed.summary || "").trim(),
        files: Array.isArray(parsed.files)
          ? parsed.files
              .map((entry) => ({
                path: normalizeRelativePath(entry.path),
                content: String(entry.content || "").replace(/\r\n/g, "\n"),
              }))
              .filter((entry) => entry.path)
          : [],
        commands: normalizeStringArray(parsed.commands),
        blockers: normalizeStringArray(parsed.blockers),
        assumptions: normalizeStringArray(parsed.assumptions),
      }
    } catch {
      return {
        summary: stripCodeFences(raw),
        files: [],
        commands: [],
        blockers: ["Coder output did not return valid JSON."],
        assumptions: [],
      }
    }
  }

  function taskSnapshot(task) {
    return {
      objective: task.objective,
      inputs: [...task.inputs],
      outputs: [...task.outputs],
      constraints: [...task.constraints],
      acceptance_criteria: [...task.acceptance_criteria],
      workspace_scope: [...task.workspace_scope],
    }
  }

  function createTaskArtifact(input) {
    return {
      id: input.id,
      run_id: input.run_id,
      assigned_agent: getCanonicalRole(input.assigned_agent),
      title: input.title,
      objective: input.objective,
      inputs: normalizeStringArray(input.inputs),
      outputs: normalizeStringArray(input.outputs),
      constraints: normalizeStringArray(input.constraints),
      acceptance_criteria: normalizeStringArray(input.acceptance_criteria),
      dependencies: normalizeStringArray(input.dependencies),
      workspace_scope: normalizeStringArray(input.workspace_scope),
      status: input.status || "queued",
      iteration: Number(input.iteration || 1),
      blockers: normalizeStringArray(input.blockers),
      assumptions: normalizeStringArray(input.assumptions),
      review_directives_applied: Array.isArray(input.review_directives_applied) ? input.review_directives_applied : [],
    }
  }

  function buildTaskFileName(task) {
    return `tasks/${task.id}.json`
  }

  async function writeTaskArtifact(runDir, task) {
    schemaValidator.assertValidArtifact("task.schema.json", task)
    await writeFile(path.join(runDir, buildTaskFileName(task)), formatJson(task))
  }

  async function writeTasksIndex(runDir, tasks, meta) {
    await writeFile(
      path.join(runDir, "03_tasks", "tasks.json"),
      formatJson({
        tasks,
        meta,
      }),
    )
  }

  function buildHandoff(task, sourceAgent, targetAgent, nextAction) {
    return {
      source_agent: getCanonicalRole(sourceAgent),
      target_agent: getCanonicalRole(targetAgent),
      objective: task.objective,
      inputs: [...task.inputs],
      outputs: [...task.outputs],
      blockers: [...task.blockers],
      assumptions: [...task.assumptions],
      next_action: nextAction,
    }
  }

  async function writeHandoffArtifact(runDir, task, handoff) {
    schemaValidator.assertValidArtifact("handoff.schema.json", handoff)
    const relativePath = `handoffs/${task.id}.iter-${String(task.iteration).padStart(2, "0")}.${handoff.source_agent}-to-${handoff.target_agent}.json`
    await writeFile(path.join(runDir, relativePath), formatJson(handoff))
    return relativePath
  }

  async function writeReviewArtifact(runDir, task, review) {
    schemaValidator.assertValidArtifact("review.schema.json", review)
    const relativePath = `reviews/${task.id}.iter-${String(task.iteration).padStart(2, "0")}.json`
    await writeFile(path.join(runDir, relativePath), formatJson(review))
    return relativePath
  }

  function requiresResearch(prompt, referenceUrls, enableWebSearch) {
    return referenceUrls.length > 0 || enableWebSearch || /\b(research|reference|compare|investigate|evidence|docs|documentation)\b/i.test(prompt)
  }

  function requiresDesign(prompt) {
    return /\b(ui|ux|design|layout|visual|dashboard|screen|page|styling|frontend)\b/i.test(prompt)
  }

  function extractArchitectureFileHints(architectureMarkdown) {
    return normalizeStringArray(
      String(architectureMarkdown || "")
        .split(/\r?\n/)
        .filter((line) => /^\s*[-*]\s+/.test(line))
        .map((line) =>
          line
            .replace(/^\s*[-*]\s+/, "")
            .split(/\s+-\s+/)[0]
            .replace(/[`*]/g, "")
            .split(/\s*:\s+/)[0]
            .replace(/:+$/, "")
            .trim(),
        )
        .filter((line) => /\//.test(line)),
    ).slice(0, 5)
  }

  function buildScopedWorkspaceContext(workspaceManifest, task) {
    const manifestLines = String(workspaceManifest || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const fileLines = manifestLines.filter((line) => line.startsWith("- "))
    const scope = normalizeStringArray(task.workspace_scope.length > 0 ? task.workspace_scope : task.outputs)
    const relevantLines =
      scope.length === 0
        ? fileLines.slice(0, 40)
        : fileLines.filter((line) => {
            const relativePath = line.replace(/^- /, "").replace(/\/$/, "")
            return scope.some((entry) => {
              const normalizedEntry = String(entry || "").replace(/\/$/, "")
              return relativePath === normalizedEntry || relativePath.startsWith(`${normalizedEntry}/`)
            })
          })

    return [
      "# Workspace Context",
      "",
      "## Allowed Scope",
      ...(scope.length === 0 ? ["- No explicit workspace scope was extracted."] : scope.map((entry) => `- ${entry}`)),
      "",
      "## Relevant Files",
      ...(relevantLines.length === 0 ? ["- No existing files matched the scope yet."] : relevantLines.slice(0, 40)),
      "",
    ].join("\n")
  }

  function buildFollowUpTasks(runId, prompt, architectureMarkdown, context) {
    const tasks = []
    let taskNumber = 2
    const architectureHints = extractArchitectureFileHints(architectureMarkdown)
    const dependencyIds = ["task-001"]

    if (requiresResearch(prompt, context.referenceUrls, context.enableWebSearch)) {
      tasks.push(
        createTaskArtifact({
          id: `task-${String(taskNumber).padStart(3, "0")}`,
          run_id: runId,
          assigned_agent: "researcher",
          title: "Research supporting context",
          objective: "Produce bounded research context that reduces ambiguity for downstream implementation.",
          inputs: ["01_planning/plan.md", "02_architecture/architecture.md", ...context.referenceUrls],
          outputs: ["artifacts/research.md"],
          constraints: ["Focus only on information that affects the current run objective."],
          acceptance_criteria: ["Research findings are relevant and directly usable by later tasks."],
          dependencies: [...dependencyIds],
          workspace_scope: [],
          blockers: [],
          assumptions: [],
        }),
      )
      dependencyIds.push(tasks[tasks.length - 1].id)
      taskNumber += 1
    }

    if (requiresDesign(prompt)) {
      tasks.push(
        createTaskArtifact({
          id: `task-${String(taskNumber).padStart(3, "0")}`,
          run_id: runId,
          assigned_agent: "designer",
          title: "Produce design specification",
          objective: "Create an implementation-ready design specification for the user-facing parts of the task.",
          inputs: ["01_planning/plan.md", "02_architecture/architecture.md"],
          outputs: ["artifacts/design-spec.md"],
          constraints: ["Keep the output text-based and directly implementable by the coder."],
          acceptance_criteria: ["The design specification clarifies layout, interaction, and content expectations."],
          dependencies: [...dependencyIds],
          workspace_scope: architectureHints.filter((hint) => hint.startsWith("04_code")).slice(0, 3),
          blockers: [],
          assumptions: [],
        }),
      )
      dependencyIds.push(tasks[tasks.length - 1].id)
      taskNumber += 1
    }

    tasks.push(
      createTaskArtifact({
        id: `task-${String(taskNumber).padStart(3, "0")}`,
        run_id: runId,
        assigned_agent: "coder",
        title: "Implement the approved task in the shared workspace",
        objective: "Apply the requested code changes in the run workspace and capture implementation evidence.",
        inputs: ["01_planning/plan.md", "02_architecture/architecture.md", ...tasks.map((task) => task.outputs[0])],
        outputs: architectureHints.length > 0 ? architectureHints.filter((hint) => hint.startsWith("04_code")) : ["04_code/"],
        constraints: ["Stay within the shared workspace.", "Use only safe shell commands."],
        acceptance_criteria: ["Requested code changes are applied.", "Validation evidence is captured for the reviewer."],
        dependencies: [...dependencyIds],
        workspace_scope: architectureHints.filter((hint) => hint.startsWith("04_code")),
        blockers: [],
        assumptions: [],
      }),
    )

    return tasks
  }

  function buildSpecialistOutputPath(task) {
    if (task.assigned_agent === "architect") {
      return "02_architecture/architecture.md"
    }
    if (task.assigned_agent === "researcher") {
      return "artifacts/research.md"
    }
    if (task.assigned_agent === "designer") {
      return "artifacts/design-spec.md"
    }
    return "04_code/implementation.md"
  }

  async function executeSpecialistTask(params) {
    const {
      record,
      runDir,
      task,
      handoff,
      workspaceDir,
      workspaceManifest,
      supportingArtifacts,
      selectedProfiles,
      profiles,
    } = params
    const roleName = getCanonicalRole(task.assigned_agent)
    const profile = profiles[roleName]
    const agentContract = await loadAgentContract(roleName)

    if (roleName === "coder") {
      const prompt = buildCoderPrompt(agentContract, task, handoff, supportingArtifacts, workspaceManifest)
      const raw = await generateText(roleName, profile, prompt, {
        stage: "implementation",
        taskId: task.id,
        runId: record.id,
      })
      const parsed = parseCoderResponse(raw)
      const writtenFiles = await applyWorkspaceFileWrites(workspaceDir, parsed.files)
      const commandResults = []

      for (const command of parsed.commands.slice(0, 4)) {
        commandResults.push(await commandRunner(workspaceDir, command))
      }

      return {
        summary: parsed.summary || "Coder response processed.",
        relativePath: "04_code/implementation.md",
        markdown: "",
        writtenFiles,
        commandResults,
        blockers: parsed.blockers,
        assumptions: parsed.assumptions,
        profile: selectedProfiles.coder,
      }
    }

    const prompt = roleName === "architect"
      ? buildArchitecturePrompt(agentContract, record.prompt, record.planMarkdown, handoff)
      : buildTextSpecialistPrompt(agentContract, task, handoff, supportingArtifacts, roleName)
    const raw = await generateText(roleName, profile, prompt, {
      stage: roleName === "architect" ? "architecture" : "implementation",
      taskId: task.id,
      runId: record.id,
    })
    const heading = roleName === "architect" ? "# Architecture" : roleName === "researcher" ? "# Research" : "# Design Specification"
    const markdown = normalizeMarkdownArtifact(raw, heading)
    const relativePath = buildSpecialistOutputPath(task)
    await writeFile(path.join(runDir, relativePath), markdown)

    return {
      summary: truncate(markdown.split(/\r?\n/).slice(0, 5).join(" "), 240),
      relativePath,
      markdown,
      writtenFiles: [],
      commandResults: [],
      blockers: [],
      assumptions: [],
      profile: selectedProfiles[roleName],
    }
  }

  function refineTaskFromReview(task, review, reviewFileRelativePath) {
    const directive = normalizeStringArray(review.revision_request)[0]
    if (!directive) {
      throw new Error(`Review ${reviewFileRelativePath} rejected the task without a concrete revision request.`)
    }

    const previousSnapshot = taskSnapshot(task)
    const nextTask = {
      ...task,
      iteration: task.iteration + 1,
      status: "needs_revision",
      blockers: normalizeStringArray([...task.blockers, ...review.blocking_issues]),
    }
    const changedFields = []
    const lowerDirective = directive.toLowerCase()
    const pathMatch = directive.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+/)

    if (pathMatch && !nextTask.workspace_scope.includes(pathMatch[0])) {
      nextTask.workspace_scope = [...nextTask.workspace_scope, pathMatch[0]]
      changedFields.push("workspace_scope")
    }

    if (/(validate|verify|test|check)/i.test(lowerDirective)) {
      nextTask.acceptance_criteria = normalizeStringArray([...nextTask.acceptance_criteria, directive])
      changedFields.push("acceptance_criteria")
    }

    if (/(exact|specific|format|schema|content|string|json)/i.test(lowerDirective)) {
      nextTask.constraints = normalizeStringArray([...nextTask.constraints, directive])
      changedFields.push("constraints")
    }

    if (changedFields.length === 0) {
      nextTask.outputs = normalizeStringArray([...nextTask.outputs, `review-directive:${directive}`])
      changedFields.push("outputs")
    }

    nextTask.review_directives_applied = [
      ...nextTask.review_directives_applied,
      {
        source_review_file: reviewFileRelativePath,
        directive,
        changed_fields: [...new Set(changedFields)],
        previous_snapshot: previousSnapshot,
        next_snapshot: taskSnapshot(nextTask),
      },
    ]

    return createTaskArtifact(nextTask)
  }

  async function executeTaskLoop(params) {
    const {
      record,
      runDir,
      task,
      allTasks,
      selectedProfiles,
      profiles,
      workspaceDir,
      workspaceManifest,
      handoffsIndex,
      reviewsIndex,
      changedFiles,
      artifactContext,
      maxIterations,
    } = params

    let activeTask = task
    const supportingArtifacts = artifactContext.map((entry) => `${entry.path}\n${entry.content}`).slice(-6)

    while (activeTask.iteration <= maxIterations) {
      activeTask.status = "in_progress"
      await writeTaskArtifact(runDir, activeTask)
      appendLog(record, `Running ${activeTask.id} with ${activeTask.assigned_agent}`)
      await writeRunRecord(record)

      const handoff = buildHandoff(
        activeTask,
        "manager",
        activeTask.assigned_agent,
        `Complete ${activeTask.title} and return outputs for review.`,
      )
      const handoffFile = await writeHandoffArtifact(runDir, activeTask, handoff)
      handoffsIndex.push(handoffFile)

      const specialistOutput = await executeSpecialistTask({
        record,
        runDir,
        task: activeTask,
        handoff,
        workspaceDir,
        workspaceManifest,
        supportingArtifacts,
        selectedProfiles,
        profiles,
      })

      for (const filePath of specialistOutput.writtenFiles || []) {
        changedFiles.add(filePath)
      }

      const reviewerContract = await loadAgentContract("reviewer")
      const reviewPrompt = buildReviewerPrompt(
        reviewerContract,
        activeTask,
        handoff,
        specialistOutput,
        specialistOutput.commandResults || [],
      )
      const reviewRaw = await generateText("reviewer", profiles.reviewer, reviewPrompt, {
        stage: "review",
        taskId: activeTask.id,
        runId: record.id,
      })
      const review = parseReviewArtifact(reviewRaw, activeTask, specialistOutput, specialistOutput.commandResults || [])
      schemaValidator.assertValidArtifact("review.schema.json", review)
      const reviewFile = await writeReviewArtifact(runDir, activeTask, review)
      reviewsIndex.push(reviewFile)

      if (review.approved) {
        activeTask.status = "completed"
        await writeTaskArtifact(runDir, activeTask)
        artifactContext.push({
          path: specialistOutput.relativePath,
          content: specialistOutput.markdown || specialistOutput.summary,
        })
        return {
          task: activeTask,
          specialistOutput,
          review,
          reviewFile,
        }
      }

      if (activeTask.iteration >= maxIterations) {
        activeTask.status = "failed"
        activeTask.blockers = normalizeStringArray([...activeTask.blockers, ...review.blocking_issues])
        await writeTaskArtifact(runDir, activeTask)
        return {
          task: activeTask,
          specialistOutput,
          review,
          reviewFile,
        }
      }

      activeTask = refineTaskFromReview(activeTask, review, reviewFile)
      await writeTaskArtifact(runDir, activeTask)
      const taskIndex = allTasks.findIndex((entry) => entry.id === activeTask.id)
      if (taskIndex !== -1) {
        allTasks[taskIndex] = activeTask
      }
      appendLog(record, `Refined ${activeTask.id} for iteration ${activeTask.iteration}`)
      await writeRunRecord(record)
    }

    return {
      task: activeTask,
      specialistOutput: {
        summary: "",
        relativePath: "",
        markdown: "",
        writtenFiles: [],
        commandResults: [],
        blockers: activeTask.blockers,
        assumptions: activeTask.assumptions,
      },
      review: {
        findings: [],
        blocking_issues: activeTask.blockers,
        non_blocking_improvements: [],
        revision_request: [],
        approved: false,
      },
      reviewFile: "",
    }
  }

  function buildImplementationMarkdown(taskResults, changedFiles, syncedFiles) {
    const lines = ["# Implementation", "", "## Task Results"]

    if (taskResults.length === 0) {
      lines.push("- No implementation tasks were executed.")
    } else {
      for (const result of taskResults) {
        lines.push(`- ${result.task.id} | ${result.task.title} | ${result.task.status}`)
      }
    }

    lines.push("", "## Files Changed")
    if (changedFiles.size === 0) {
      lines.push("- None")
    } else {
      for (const filePath of [...changedFiles]) {
        lines.push(`- ${filePath}`)
      }
    }

    lines.push("", "## Synced Files")
    if (syncedFiles.length === 0) {
      lines.push("- None")
    } else {
      for (const filePath of syncedFiles) {
        lines.push(`- ${filePath}`)
      }
    }

    lines.push("", "## Command Results")
    const commands = taskResults.flatMap((result) => result.specialistOutput.commandResults || [])
    if (commands.length === 0) {
      lines.push("- No shell commands were executed.")
    } else {
      for (const entry of commands) {
        lines.push(`- ${entry.command} | ${entry.status} | exit: ${entry.exitCode ?? "n/a"}`)
      }
    }

    return `${lines.join("\n")}\n`
  }

  function buildReviewMarkdown(taskResults) {
    const lines = ["# Review", "", "## Findings"]
    const reviews = taskResults.map((result) => result.review)

    if (reviews.length === 0) {
      lines.push("- No reviewed specialist tasks were executed.")
    } else {
      for (const review of reviews) {
        for (const finding of review.findings) {
          lines.push(`- ${finding}`)
        }
      }
    }

    lines.push("", "## Gaps")
    const blockingIssues = normalizeStringArray(reviews.flatMap((review) => review.blocking_issues))
    if (blockingIssues.length === 0) {
      lines.push("- None")
    } else {
      for (const issue of blockingIssues) {
        lines.push(`- ${issue}`)
      }
    }

    lines.push("", "## Simpler Alternatives")
    lines.push("- Keep the first pass small and add more specialist roles only where the prompt requires them.")
    lines.push("", "## Risks to Watch")
    lines.push("- Model output still benefits from human review before merge.")
    lines.push("", "## Recommended Next Loop")
    const revisions = normalizeStringArray(reviews.flatMap((review) => review.revision_request))
    if (revisions.length === 0) {
      lines.push("- Move to the next scoped feature or validation pass.")
    } else {
      for (const revision of revisions) {
        lines.push(`- ${revision}`)
      }
    }

    return `${lines.join("\n")}\n`
  }

  function buildSummaryMarkdown({ record, taskResults, syncedFiles }) {
    const lines = ["# Summary", "", "## Task", record.prompt, "", "## Models Used"]
    for (const [roleName, profileName] of Object.entries(record.selectedProfiles || {})) {
      lines.push(`- ${roleName}: ${profileName}`)
    }
    lines.push("", "## Outputs")
    lines.push(`- Run directory: ${record.runDirRelative}`)
    lines.push(`- Synced files: ${syncedFiles.length}`)
    lines.push(`- Executed specialist tasks: ${taskResults.length}`)
    lines.push("", "## Recommended Next Step")
    lines.push(record.status === "terminal_failure" ? "Review the failed task artifacts before retrying the run." : "Inspect the run-report and approved outputs, then continue with the next scoped task.")
    return `${lines.join("\n")}\n`
  }

  function buildActiveContext(summaryMarkdown, runRelativePath, managerBrief) {
    return [
      "# Active Context",
      "",
      `- Last multi-agent run: ${new Date().toISOString()}`,
      `- Run directory: ${runRelativePath}`,
      `- Active objective: ${managerBrief.objective}`,
      "",
      "## Latest Summary",
      summaryMarkdown.trim(),
      "",
    ].join("\n")
  }

  function buildTaskSummary(tasks) {
    return {
      total: tasks.length,
      completed: tasks.filter((task) => task.status === "completed").length,
      needs_revision: tasks.filter((task) => task.status === "needs_revision").length,
      blocked: tasks.filter((task) => task.status === "blocked").length,
      failed: tasks.filter((task) => task.status === "failed").length,
    }
  }

  async function writeWorkspaceArtifacts(params) {
    await writeFile(path.join(repoRoot, "01_planning", "plan.md"), params.planMarkdown)
    await writeFile(path.join(repoRoot, "02_architecture", "architecture.md"), params.architectureMarkdown)
    await writeFile(path.join(repoRoot, "03_tasks", "tasks.json"), formatJson(params.tasksIndex))
    await writeFile(path.join(repoRoot, "05_reviews", "review.md"), params.reviewMarkdown)
    await writeFile(path.join(repoRoot, "memory-bank", "activeContext.md"), buildActiveContext(params.summaryMarkdown, params.runRelativePath, params.managerBrief))
    if (params.workspaceDir && params.changedFiles.length > 0) {
      await syncWorkspaceFilesToRepo(params.workspaceDir, params.changedFiles)
    }
  }

  async function executeRun(runId) {
    const record = await readRunRecord(runId)
    if (!record) {
      return
    }

    const config = await loadConfig()
    const { selectedProfiles, profiles } = providerApi.resolveProfiles(config, {
      presetName: record.preset,
      roleOverrides: record.roleOverrides,
      environment: process.env,
    })

    record.selectedProfiles = selectedProfiles
    record.status = "running"
    record.updatedAt = new Date().toISOString()
    appendLog(record, `Resolved preset "${record.preset}" to profiles ${JSON.stringify(selectedProfiles)}`)
    await writeRunRecord(record)

    const runDir = path.join(repoRoot, record.runDirRelative)
    const workspaceDir = await ensureExecutionWorkspace(runDir)
    const workspaceManifest = await buildWorkspaceManifest(workspaceDir)
    await writeFile(path.join(runDir, "workspace-manifest.md"), workspaceManifest)
    await writeFile(path.join(runDir, "00-input.md"), `# Input\n\n${record.prompt}\n`)

    const managerBrief = buildSeedBrief(record.prompt)
    record.managerBrief = managerBrief
    await writeFile(path.join(runDir, "01-manager-brief.json"), formatJson(managerBrief))
    await ensureDir(path.join(runDir, "tasks"))
    await ensureDir(path.join(runDir, "handoffs"))
    await ensureDir(path.join(runDir, "reviews"))
    await ensureDir(path.join(runDir, "artifacts"))
    await writeRunRecord(record)

    const referenceUrls = [...new Set([...(record.referenceUrls || []), ...extractUrls(record.prompt)])]
    const urlContextEntries = await fetchUrlContext(referenceUrls, config)
    const searchResults = record.enableWebSearch ? await performWebSearch(record.prompt, config) : []
    const augmentationText = buildAugmentationText(referenceUrls, urlContextEntries, searchResults)
    const handoffsIndex = []
    const reviewsIndex = []
    const artifactContext = []
    const changedFiles = new Set()
    let tasks = []
    let syncedFiles = []

    try {
      await updateStage(record, "planning", { status: "running", profile: selectedProfiles.manager, startedAt: new Date().toISOString() })
      const managerContract = await loadAgentContract("manager")
      const planRaw = await generateText("manager", profiles.manager, buildPlanPrompt(managerContract, record.prompt, managerBrief, augmentationText), { stage: "planning", runId: record.id })
      const planMarkdown = normalizeMarkdownArtifact(planRaw, "# Plan")
      record.planMarkdown = planMarkdown
      await writeFile(path.join(runDir, "01_planning", "plan.md"), planMarkdown)
      artifactContext.push({ path: "01_planning/plan.md", content: planMarkdown })
      await updateStage(record, "planning", { status: "completed", completedAt: new Date().toISOString() })

      const architectureTask = createTaskArtifact({
        id: "task-001",
        run_id: record.id,
        assigned_agent: "architect",
        title: "Define the implementation architecture",
        objective: "Produce the architecture and file layout needed for the run objective.",
        inputs: ["01_planning/plan.md"],
        outputs: ["02_architecture/architecture.md"],
        constraints: ["Keep the design practical and directly actionable for later specialist tasks."],
        acceptance_criteria: ["Architecture names files, system shape, data flow, and build order."],
        dependencies: [],
        workspace_scope: [],
        blockers: [],
        assumptions: [],
      })
      tasks = [architectureTask]
      await writeTaskArtifact(runDir, architectureTask)

      await updateStage(record, "architecture", { status: "running", profile: selectedProfiles.architect, startedAt: new Date().toISOString() })
      const architectureResult = await executeTaskLoop({
        record,
        runDir,
        task: architectureTask,
        allTasks: tasks,
        selectedProfiles,
        profiles,
        workspaceDir,
        workspaceManifest,
        handoffsIndex,
        reviewsIndex,
        changedFiles,
        artifactContext,
        maxIterations: config.runtime.maxTaskIterations,
      })
      tasks[0] = architectureResult.task
      if (architectureResult.task.status !== "completed") {
        throw new Error(`Architecture task failed: ${architectureResult.review.blocking_issues.join("; ")}`)
      }
      record.architectureMarkdown = architectureResult.specialistOutput.markdown
      await updateStage(record, "architecture", { status: "completed", completedAt: new Date().toISOString() })

      const followUpTasks = buildFollowUpTasks(record.id, record.prompt, record.architectureMarkdown, {
        referenceUrls,
        enableWebSearch: record.enableWebSearch,
      })
      tasks = [...tasks, ...followUpTasks]
      for (const task of followUpTasks) {
        await writeTaskArtifact(runDir, task)
      }

      await updateStage(record, "tasks", { status: "running", profile: selectedProfiles.manager, startedAt: new Date().toISOString() })
      const tasksIndex = { tasks, meta: { source: "generated by the multi-agent orchestrator", selected_profiles: selectedProfiles } }
      await writeTasksIndex(runDir, tasks, tasksIndex.meta)
      await updateStage(record, "tasks", { status: "completed", completedAt: new Date().toISOString() })

      await updateStage(record, "implementation", { status: "running", profile: selectedProfiles.coder, startedAt: new Date().toISOString() })
      const implementationResults = []
      for (const task of tasks.filter((entry) => entry.id !== "task-001")) {
        const taskResult = await executeTaskLoop({
          record,
          runDir,
          task,
          allTasks: tasks,
          selectedProfiles,
          profiles,
          workspaceDir,
          workspaceManifest,
          handoffsIndex,
          reviewsIndex,
          changedFiles,
          artifactContext,
          maxIterations: config.runtime.maxTaskIterations,
        })
        const taskIndex = tasks.findIndex((entry) => entry.id === taskResult.task.id)
        tasks[taskIndex] = taskResult.task
        implementationResults.push(taskResult)

        if (taskResult.task.status !== "completed") {
          record.status = "terminal_failure"
          record.error = `${taskResult.task.id} failed review loop`
          break
        }
      }

      const implementationMarkdown = buildImplementationMarkdown(implementationResults, changedFiles, [])
      await writeFile(path.join(runDir, "04_code", "implementation.md"), implementationMarkdown)
      await writeTasksIndex(runDir, tasks, tasksIndex.meta)
      await writeFile(path.join(runDir, "handoffs-index.json"), formatJson(handoffsIndex))
      await writeFile(path.join(runDir, "reviews-index.json"), formatJson(reviewsIndex))
      await updateStage(record, "implementation", {
        status: record.status === "terminal_failure" ? "failed" : "completed",
        completedAt: new Date().toISOString(),
        error: record.error || null,
      })

      await updateStage(record, "review", { status: "running", profile: selectedProfiles.reviewer, startedAt: new Date().toISOString() })
      const reviewMarkdown = buildReviewMarkdown([architectureResult, ...implementationResults])
      await writeFile(path.join(runDir, "05_reviews", "review.md"), reviewMarkdown)
      await updateStage(record, "review", { status: "completed", completedAt: new Date().toISOString() })

      await updateStage(record, "summary", { status: "running", profile: selectedProfiles.manager, startedAt: new Date().toISOString() })
      if (record.workspaceSync && record.status !== "terminal_failure") {
        syncedFiles = await syncWorkspaceFilesToRepo(workspaceDir, [...changedFiles])
      }

      const summaryMarkdown = buildSummaryMarkdown({
        record,
        taskResults: [architectureResult, ...implementationResults],
        syncedFiles,
      })
      await writeFile(path.join(runDir, "summary.md"), summaryMarkdown)

      const runReport = {
        run_id: record.id,
        prompt: record.prompt,
        preset: record.preset,
        status: record.status === "terminal_failure" ? "terminal_failure" : "completed",
        created_at: record.createdAt,
        updated_at: new Date().toISOString(),
        selected_profiles: {
          manager: selectedProfiles.manager,
          architect: selectedProfiles.architect,
          coder: selectedProfiles.coder,
          designer: selectedProfiles.designer,
          reviewer: selectedProfiles.reviewer,
          researcher: selectedProfiles.researcher,
        },
        artifact_files: {
          plan_md: "01_planning/plan.md",
          architecture_md: "02_architecture/architecture.md",
          task_index_json: "03_tasks/tasks.json",
          implementation_md: "04_code/implementation.md",
          review_md: "05_reviews/review.md",
          summary_md: "summary.md",
          run_report_json: "run-report.json",
          handoff_files: handoffsIndex,
          review_files: reviewsIndex,
          task_files: tasks.map((task) => buildTaskFileName(task)),
        },
        task_summary: buildTaskSummary(tasks),
        iteration_summary: {
          current: Math.max(...tasks.map((task) => task.iteration)),
          max: config.runtime.maxTaskIterations,
        },
        workspace_root: path.join(record.runDirRelative, "workspace").replace(/\\/g, "/"),
        terminal_reason: record.status === "terminal_failure" ? "terminal_failure" : "success",
      }
      schemaValidator.assertValidArtifact("run-report.schema.json", runReport)
      await writeFile(path.join(runDir, "run-report.json"), formatJson(runReport))

      if (record.workspaceSync && record.status !== "terminal_failure") {
        await writeWorkspaceArtifacts({
          planMarkdown,
          architectureMarkdown: record.architectureMarkdown,
          tasksIndex,
          reviewMarkdown,
          summaryMarkdown,
          runRelativePath: record.runDirRelative,
          managerBrief,
          workspaceDir,
          changedFiles: [...changedFiles],
        })
      }

      await updateStage(record, "summary", { status: "completed", completedAt: new Date().toISOString() })
      record.status = record.status === "terminal_failure" ? "failed" : "completed"
      record.summary = { text: summaryMarkdown, selectedProfiles }
      record.error = record.error || null
      await writeRunRecord(record)
    } catch (error) {
      appendLog(record, error.message, "error")
      record.status = "failed"
      record.error = error.message
      record.updatedAt = new Date().toISOString()

      for (const stage of Object.values(record.stageStates)) {
        if (stage.status === "running") {
          stage.status = "failed"
          stage.error = error.message
          stage.completedAt = new Date().toISOString()
          break
        }
      }

      await writeRunRecord(record)
    }
  }

  async function startRun(input) {
    const config = await loadConfig()
    await ensureStorage(config)
    const prompt = String(input.prompt || "").trim()
    if (!prompt) {
      throw new Error("Prompt is required.")
    }

    const preset = config.presets[input.preset] ? input.preset : "local"
    const runId = `${timestampForPath()}-${slugify(prompt)}`
    const runDirRelative = path.join(config.runtime.outputDir, runId).replace(/\\/g, "/")
    const record = {
      id: runId,
      title: truncate(prompt.replace(/\s+/g, " ").trim(), 90),
      prompt,
      preset,
      status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspaceSync: typeof input.workspaceSync === "boolean" ? input.workspaceSync : Boolean(config.runtime.workspaceSync),
      roleOverrides: input.roleOverrides || {},
      referenceUrls: Array.isArray(input.referenceUrls) ? [...new Set(input.referenceUrls)] : [],
      enableWebSearch: Boolean(input.enableWebSearch),
      runDirRelative,
      selectedProfiles: {},
      stageStates: createInitialStageStates(),
      logs: [],
      error: null,
      summary: null,
    }

    await writeRunRecord(record)

    runQueue = runQueue
      .then(() => executeRun(runId))
      .catch(async (error) => {
        const failedRecord = await readRunRecord(runId)
        if (failedRecord) {
          failedRecord.status = "failed"
          failedRecord.error = error.message
          appendLog(failedRecord, error.message, "error")
          await writeRunRecord(failedRecord)
        }
      })

    return summarizeRun(record)
  }

  async function waitForRun(runId, options = {}) {
    const pollMs = options.pollMs || 1000
    const timeoutMs = options.timeoutMs || 15 * 60 * 1000
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
      const run = await readRunRecord(runId)
      if (!run) {
        return null
      }
      if (run.status === "completed" || run.status === "failed") {
        return run
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }

    throw new Error(`Timed out waiting for run ${runId}`)
  }

  async function getRun(runId, options = {}) {
    const record = await readRunRecord(runId)
    if (!record) {
      return null
    }

    if (options.includeArtifacts === false) {
      return record
    }

    return {
      ...record,
      artifacts: await collectArtifacts(record),
    }
  }

  function subscribe(runId, listener) {
    const eventName = `run:${runId}`
    emitter.on(eventName, listener)
    return () => emitter.off(eventName, listener)
  }

  return {
    loadConfig,
    listProfiles,
    listPresets,
    listRuns,
    getRun,
    startRun,
    waitForRun,
    subscribe,
  }
}

module.exports = {
  createOrchestrator,
}
