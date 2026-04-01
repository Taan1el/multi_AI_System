const fs = require("node:fs")
const fsp = require("node:fs/promises")
const path = require("node:path")
const { EventEmitter } = require("node:events")
const { spawn } = require("node:child_process")

const DEFAULT_CONFIG = {
  runtime: {
    outputDir: "output/multi-ai-runs",
    workspaceSync: true,
    historyLimit: 60,
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
    },
    "local-code": {
      type: "ollama",
      label: "Local Code",
      model: "qwen2.5-coder:7b",
      baseUrl: "http://127.0.0.1:11434",
      temperature: 0.2,
    },
    "local-research": {
      type: "ollama",
      label: "Local Research",
      model: "gemma3:4b",
      baseUrl: "http://127.0.0.1:11434",
      temperature: 0.2,
    },
    "anthropic-architect": {
      type: "anthropic",
      label: "Claude Architect",
      model: "claude-3-7-sonnet-latest",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      apiUrl: "https://api.anthropic.com/v1/messages",
      temperature: 0.2,
      maxTokens: 2200,
    },
    "openai-code": {
      type: "openai",
      label: "OpenAI Code",
      model: "gpt-5",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: "https://api.openai.com/v1",
      temperature: 0.2,
      maxTokens: 2200,
    },
    "gemini-review": {
      type: "gemini",
      label: "Gemini Review",
      model: "gemini-2.5-pro",
      apiKeyEnv: "GEMINI_API_KEY",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      temperature: 0.2,
      maxTokens: 2200,
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
      },
    },
    hybrid: {
      label: "Hybrid local + cloud",
      roles: {
        manager: ["local-manager", "openrouter-fallback"],
        architect: ["anthropic-architect", "gemini-review", "local-research"],
        code: ["openai-code", "openrouter-fallback", "local-code"],
        review: ["gemini-review", "anthropic-architect", "local-research"],
      },
    },
  },
}

const ARTIFACT_DEFS = [
  { key: "input", relativePath: "00-input.md", type: "text" },
  { key: "managerBrief", relativePath: "01-manager-brief.json", type: "json" },
  { key: "plan", relativePath: "01_planning/plan.md", type: "text" },
  { key: "architecture", relativePath: "02_architecture/architecture.md", type: "text" },
  { key: "tasks", relativePath: "03_tasks/tasks.json", type: "json" },
  { key: "messages", relativePath: "messages.json", type: "json" },
  { key: "taskExecution", relativePath: "task-execution.json", type: "json" },
  { key: "commandResults", relativePath: "command-results.json", type: "json" },
  { key: "workspaceManifest", relativePath: "workspace-manifest.md", type: "text" },
  { key: "implementation", relativePath: "04_code/implementation.md", type: "text" },
  { key: "review", relativePath: "05_reviews/review.md", type: "text" },
  { key: "summary", relativePath: "summary.md", type: "text" },
]

const STAGE_DEFS = [
  { key: "planning", label: "Planning", role: "manager" },
  { key: "architecture", label: "Architecture", role: "architect" },
  { key: "tasks", label: "Task Synthesis", role: "manager" },
  { key: "implementation", label: "Implementation", role: "code" },
  { key: "review", label: "Review", role: "review" },
  { key: "summary", label: "Summary", role: "manager" },
]

const WORKSPACE_COPY_EXCLUDES = new Set([".git", "node_modules", "output", ".playwright-cli"])
const SAFE_COMMAND_PREFIXES = [
  "npm",
  "npx",
  "node",
  "git status",
  "git diff",
  "python",
  "py",
  "pytest",
  "pnpm",
  "yarn",
  "bun",
]
const BLOCKED_COMMAND_PATTERNS = ["&&", "||", ";", "|", ">", "<", "rm ", "del ", "rmdir ", "Remove-Item"]
const MAX_TASK_ATTEMPTS = 2
const COMMAND_TIMEOUT_MS = 120000

function createOrchestrator(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, "..", "..")
  const appRoot = options.appRoot || path.resolve(__dirname, "..")
  const dataDir = path.join(appRoot, "data")
  const configPath = options.configPath || path.join(repoRoot, "multi-ai.config.json")
  const envPath = options.envPath || path.join(repoRoot, ".env")
  const runIndexFile = path.join(dataDir, "orchestrator-runs.json")
  const emitter = new EventEmitter()

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

    try {
      await fsp.access(runIndexFile)
    } catch {
      await fsp.writeFile(runIndexFile, JSON.stringify({ runs: [] }, null, 2), "utf8")
    }
  }

  async function readRunIndex() {
    await ensureStorage(await loadConfig())
    const raw = await fsp.readFile(runIndexFile, "utf8")
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed.runs) ? parsed.runs : []
  }

  async function writeRunIndex(runs) {
    await fsp.writeFile(runIndexFile, JSON.stringify({ runs }, null, 2), "utf8")
  }

  function runFilePath(runDir) {
    return path.join(runDir, "run.json")
  }

  function slugify(value) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "run"
  }

  function timestampForPath(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0")
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      "-",
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join("")
  }

  function truncate(value, maxLength) {
    if (value.length <= maxLength) {
      return value
    }

    return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`
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
    const raw = await fsp.readFile(runFilePath(runDir), "utf8")
    return JSON.parse(raw)
  }

  async function listRuns() {
    const runs = await readRunIndex()
    return runs.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
  }

  function buildSeedBrief(userPrompt) {
    return {
      title: truncate(userPrompt.replace(/\s+/g, " ").trim(), 90),
      objective: userPrompt.trim(),
      deliverable:
        "Generated planning, architecture, executable tasks, implementation evidence, and review artifacts for the requested work.",
      constraints: [
        "Prefer a practical local-first v1.",
        "Keep the output actionable for follow-up work in Roo or the dashboard.",
      ],
      successCriteria: [
        "The plan, architecture, tasks, implementation evidence, and review are consistent with each other.",
        "The generated tasks are concrete enough for the selected code model to execute in the run workspace.",
      ],
      workstreams: [
        "Planning and orchestration",
        "Architecture and design",
        "Implementation and validation",
        "Review and next-loop guidance",
      ],
      risks: ["Model output can need human verification before implementation."],
      questions: [],
    }
  }

  function stripCodeFences(text) {
    return text
      .trim()
      .replace(/^```(?:json|markdown|md)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim()
  }

  function normalizeMarkdownArtifact(text, primaryTitle) {
    const cleaned = stripCodeFences(text)
    const titleIndex = cleaned.toLowerCase().indexOf(primaryTitle.toLowerCase())
    const titled = titleIndex === -1 ? cleaned : cleaned.slice(titleIndex)
    const secondHeadingMatch = titled.slice(primaryTitle.length).match(/\n# (?!#)/)

    if (!secondHeadingMatch) {
      return titled.trim()
    }

    const cutIndex = primaryTitle.length + secondHeadingMatch.index
    return titled.slice(0, cutIndex).trim()
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  function extractSection(markdown, heading) {
    const regex = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "im")
    const match = regex.exec(markdown)
    if (!match) {
      return ""
    }

    const sectionStart = match.index + match[0].length
    const remainder = markdown.slice(sectionStart)
    const nextHeadingMatch = remainder.match(/\n## |\n# /)
    const sectionEnd = nextHeadingMatch ? sectionStart + nextHeadingMatch.index : markdown.length
    return markdown.slice(sectionStart, sectionEnd).trim()
  }

  function extractListItems(markdownSection) {
    if (!markdownSection) {
      return []
    }

    return markdownSection
      .split(/\r?\n/)
      .filter((line) => /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line))
      .map((line) => line.trim())
      .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
      .map((line) =>
        line
          .replace(/^[\u2500-\u257F\s]+/, "")
          .replace(/`/g, "")
          .replace(/\*\*/g, "")
          .replace(/\s+#.*$/, "")
          .replace(/\s+-\s+.*$/, "")
          .replace(/\s*:\s+.*$/, "")
          .trim(),
      )
      .filter(Boolean)
  }

  function taskOwnerFromText(value) {
    const normalized = value.toLowerCase()
    if (
      normalized.includes("plan") ||
      normalized.includes("scope") ||
      normalized.includes("architecture") ||
      normalized.includes("design") ||
      normalized.includes("review") ||
      normalized.includes("document")
    ) {
      return "Local Research"
    }

    return "Local Code"
  }

  function selectDeliverablesForStep(step, fileHints, fallback) {
    const normalizedStep = step.toLowerCase()
    const matches = fileHints.filter((entry) => {
      const normalizedEntry = entry.toLowerCase()
      return normalizedStep.split(/\W+/).some((token) => token.length > 3 && normalizedEntry.includes(token))
    })

    if (matches.length > 0) {
      return matches.slice(0, 3)
    }

    if (fileHints.length > 0) {
      return fileHints.slice(0, 2)
    }

    return fallback
  }

  function makeTask(idNumber, title, owner, deliverables, notes, dependsOn = []) {
    return {
      id: `task-${String(idNumber).padStart(3, "0")}`,
      title,
      owner,
      status: "pending",
      dependsOn,
      deliverables,
      notes,
    }
  }

  function buildDeterministicTasks({ userPrompt, architectureMarkdown, implementationMarkdown }) {
    const fileHints = extractListItems(extractSection(implementationMarkdown, "Suggested File Changes"))
      .concat(extractListItems(extractSection(architectureMarkdown, "Files and Folders")))
      .slice(0, 8)
    const tasks = []
    let taskNumber = 1

    tasks.push(
      makeTask(
        taskNumber,
        "Confirm scope, constraints, and success criteria",
        "Local Manager",
        ["01_planning/plan.md"],
        `Use the generated plan as the working contract for: ${truncate(userPrompt, 120)}`,
        [],
      ),
    )
    taskNumber += 1

    tasks.push(
      makeTask(
        taskNumber,
        "Lock the architecture and working structure",
        "Local Research",
        fileHints.length > 0 ? ["02_architecture/architecture.md", ...fileHints.slice(0, 2)] : ["02_architecture/architecture.md"],
        "Review the architecture before implementation starts and keep the folder strategy consistent.",
        ["task-001"],
      ),
    )
    taskNumber += 1

    tasks.push(
      makeTask(
        taskNumber,
        "Implement the primary code changes in 04_code",
        "Local Code",
        fileHints.length > 0 ? selectDeliverablesForStep("primary implementation", fileHints, ["04_code/"]) : ["04_code/"],
        "Build the smallest working version of the requested feature or task in the shared workspace.",
        ["task-002"],
      ),
    )
    taskNumber += 1
    tasks.push(
      makeTask(
        taskNumber,
        "Validate the implementation and tighten supporting behavior",
        "Local Code",
        fileHints.length > 0 ? fileHints.slice(0, 3) : ["04_code/"],
        "Run bounded validation steps, fix obvious issues, and leave implementation evidence for review.",
        [`task-${String(taskNumber - 1).padStart(3, "0")}`],
      ),
    )
    taskNumber += 1

    const previousTaskId = tasks[tasks.length - 1].id
    tasks.push(
      makeTask(
        taskNumber,
        "Review the implementation pass and capture the next loop",
        "Local Research",
        ["05_reviews/review.md", "memory-bank/activeContext.md"],
        "Summarize gaps, risks, and the next recommended iteration after the first pass.",
        [previousTaskId],
      ),
    )

    return {
      tasks,
      meta: {
        source: "generated by the multi-provider orchestrator",
        orchestratorOwner: "Local Manager",
        architectureOwner: "Local Research",
        implementationOwner: "Local Code",
      },
    }
  }

  function closeOpenCodeFence(markdown) {
    const fenceCount = (markdown.match(/```/g) || []).length
    if (fenceCount % 2 === 0) {
      return markdown
    }
    return `${markdown.trim()}\n\`\`\`\n`
  }

  function fillShellCommandsFallback(markdown) {
    const shellCommandsSection = extractSection(markdown, "Shell Commands")
    const normalized = shellCommandsSection.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "").trim()

    if (normalized) {
      return markdown
    }

    const commands = []
    if (markdown.includes("requirements.txt")) {
      commands.push("python -m venv .venv")
      commands.push(".venv\\Scripts\\activate")
      commands.push("pip install -r requirements.txt")
    }
    if (markdown.toLowerCase().includes("tests/")) {
      commands.push("pytest")
    }
    if (markdown.includes("Dockerfile")) {
      commands.push("docker build -t local-multi-ai-task .")
    }
    if (commands.length === 0) {
      commands.push("# Add the project-specific commands here after the first implementation pass.")
    }

    return markdown.replace(
      /## Shell Commands[\s\S]*?(?=\n## |\n# |$)/,
      `## Shell Commands\n\`\`\`sh\n${commands.join("\n")}\n\`\`\`\n`,
    )
  }

  function buildSummaryMarkdown({ userPrompt, managerBrief, tasksJson, runRelativePath, workspaceSync, selectedProfiles }) {
    return [
      "# Summary",
      "",
      "## Task",
      userPrompt,
      "",
      "## Models Used",
      `- Manager: ${selectedProfiles.manager}`,
      `- Architect: ${selectedProfiles.architect}`,
      `- Code: ${selectedProfiles.code}`,
      `- Review: ${selectedProfiles.review}`,
      "",
      "## Outputs",
      `- Run directory: ${runRelativePath}`,
      `- Planning objective: ${managerBrief.objective || managerBrief.title || "See plan.md"}`,
      `- Task count: ${Array.isArray(tasksJson.tasks) ? tasksJson.tasks.length : 0}`,
      `- Workspace sync: ${workspaceSync ? "enabled" : "disabled"}`,
      "",
      "## Recommended Next Step",
      workspaceSync
        ? "Open the dashboard or Roo to inspect the generated plan, then move into implementation."
        : "Review the run folder output first. If it looks good, rerun without --no-workspace-sync or continue manually.",
      "",
      "## Continue",
      "1. Review the artifacts in the dashboard or run folder.",
      "2. Continue in Roo Flow Orchestrator or Flow Code.",
      "3. Iterate with another run if the routing or prompt needs refinement.",
    ].join("\n")
  }

  function buildActiveContext(summaryMarkdown, runRelativePath, managerBrief) {
    const timestamp = new Date().toISOString()
    return [
      "# Active Context",
      "",
      `- Last multi-model run: ${timestamp}`,
      `- Run directory: ${runRelativePath}`,
      `- Active objective: ${managerBrief.objective || managerBrief.title || "Generated orchestration task"}`,
      `- Deliverable target: ${managerBrief.deliverable || "See run summary"}`,
      "",
      "## Latest Summary",
      summaryMarkdown.trim(),
      "",
    ].join("\n")
  }

  function buildPlanPrompt(userPrompt, managerBrief, augmentationText) {
    return [
      "You are Local Manager preparing 01_planning/plan.md for a multi-provider RooFlow workspace.",
      "Write markdown only.",
      "Use these sections in this exact order:",
      "# Plan",
      "## Goal",
      "## Scope",
      "## Constraints",
      "## Success Criteria",
      "## Workstreams",
      "## Risks",
      "## Open Questions",
      "## Handoff",
      "Keep it actionable, direct, and specific to the user request.",
      "",
      "Manager brief JSON:",
      formatJson(managerBrief),
      augmentationText,
      "User request:",
      userPrompt,
    ].join("\n")
  }

  function buildArchitecturePrompt(userPrompt, managerBrief, planMarkdown, augmentationText) {
    return [
      "You are Local Research writing 02_architecture/architecture.md.",
      "Write markdown only.",
      "Use these sections in this exact order:",
      "# Architecture",
      "## Overview",
      "## System Shape",
      "## Data and State",
      "## Files and Folders",
      "## Model Collaboration",
      "## Risks and Mitigations",
      "## Recommended Build Order",
      "Focus on a practical implementation architecture that Local Code can execute.",
      "In Files and Folders, use bullet points with repo-relative paths first, then a short purpose.",
      "In Recommended Build Order, use action-oriented steps. Never list only bare filenames.",
      "",
      augmentationText,
      "User request:",
      userPrompt,
      "",
      "Manager brief JSON:",
      formatJson(managerBrief),
      "Plan markdown:",
      planMarkdown,
    ].join("\n")
  }

  function buildTaskAssignmentPrompt({
    userPrompt,
    managerBrief,
    task,
    planMarkdown,
    architectureMarkdown,
    reviewerFeedback,
  }) {
    return [
      "You are Local Manager assigning one concrete implementation task to Local Code.",
      "Write markdown only.",
      "Use these sections in this exact order:",
      "# Task Assignment",
      "## Objective",
      "## Required Changes",
      "## Acceptance Checks",
      "## Constraints",
      "Be specific to the current task and the existing workspace.",
      "",
      "User request:",
      userPrompt,
      "",
      "Manager brief JSON:",
      formatJson(managerBrief),
      "Current task JSON:",
      formatJson(task),
      "Plan markdown:",
      planMarkdown,
      "",
      "Architecture markdown:",
      architectureMarkdown,
      reviewerFeedback ? `\nReviewer feedback to address:\n${reviewerFeedback}\n` : "",
    ].join("\n")
  }

  function buildCoderPrompt({
    userPrompt,
    task,
    assignmentMarkdown,
    workspaceManifest,
    reviewerFeedback,
    augmentationText,
  }) {
    return [
      "You are Local Code working inside a shared run workspace.",
      "You must propose real file contents and safe shell commands for this task.",
      "Write markdown only.",
      "Use these sections in this exact order:",
      "# Coder Response",
      "## Summary",
      "## Files",
      'For each file, use a heading exactly like "### FILE: relative/path.ext" followed by one fenced code block with the full new file content.',
      "If no file changes are needed, write exactly `### FILE: NONE`.",
      "## Shell Commands",
      "Use a single fenced sh block with one command per line. Only include commands that should be run now.",
      "## Notes",
      "Keep the response executable and minimal. Do not describe hypothetical work. Do not return diffs.",
      "",
      augmentationText,
      "User request:",
      userPrompt,
      "",
      "Current task JSON:",
      formatJson(task),
      "Manager assignment:",
      assignmentMarkdown,
      reviewerFeedback ? `\nReviewer feedback to address:\n${reviewerFeedback}\n` : "",
      "Workspace manifest:",
      workspaceManifest,
    ].join("\n")
  }

  function buildReviewerDecisionPrompt({
    userPrompt,
    task,
    assignmentMarkdown,
    coderResponse,
    commandBatch,
  }) {
    return [
      "You are Local Research reviewing one implementation attempt.",
      "Write markdown only.",
      "Use these sections in this exact order:",
      "# Review Decision",
      "## Verdict",
      "Write only one word: approve or revise.",
      "## Findings",
      "Use bullet points.",
      "## Required Changes",
      "Use bullet points. If the task is good enough, write `- None`.",
      "",
      "User request:",
      userPrompt,
      "",
      "Current task JSON:",
      formatJson(task),
      "Manager assignment:",
      assignmentMarkdown,
      "Coder summary:",
      coderResponse.summary || "No summary provided.",
      "",
      "Files written:",
      formatJson(coderResponse.files.map((entry) => entry.path)),
      "Shell commands attempted:",
      formatJson(
        commandBatch.map((entry) => ({
          command: entry.command,
          status: entry.status,
          exitCode: entry.exitCode,
          stdout: entry.stdout,
          stderr: entry.stderr,
        })),
      ),
      "Coder notes:",
      coderResponse.notes || "None.",
    ].join("\n")
  }

  function buildReviewPrompt(userPrompt, managerBrief, planMarkdown, architectureMarkdown, tasksJson, implementationMarkdown, augmentationText) {
    return [
      "You are Local Research reviewing an executed multi-agent pass.",
      "Write markdown only.",
      "Use these sections in this exact order:",
      "# Review",
      "## Findings",
      "## Gaps",
      "## Simpler Alternatives",
      "## Risks to Watch",
      "## Recommended Next Loop",
      "Prioritize practicality, maintainability, and correctness.",
      "",
      augmentationText,
      "User request:",
      userPrompt,
      "",
      "Manager brief JSON:",
      formatJson(managerBrief),
      "Plan markdown:",
      planMarkdown,
      "",
      "Architecture markdown:",
      architectureMarkdown,
      "",
      "Tasks JSON:",
      formatJson(tasksJson),
      "",
      "Implementation markdown:",
      implementationMarkdown,
    ].join("\n")
  }

  async function snapshotWorkspace(runDir) {
    const trackedFiles = [
      "01_planning/plan.md",
      "02_architecture/architecture.md",
      "03_tasks/tasks.json",
      "05_reviews/review.md",
      "memory-bank/activeContext.md",
    ]

    for (const relativePath of trackedFiles) {
      const sourcePath = path.join(repoRoot, relativePath)
      if (!(await pathExists(sourcePath))) {
        continue
      }
      const destinationPath = path.join(runDir, "workspace-before", relativePath)
      const fileContents = await fsp.readFile(sourcePath, "utf8")
      await writeFile(destinationPath, fileContents)
    }
  }

  function normalizeRelativeWorkspacePath(value) {
    const normalized = path.posix.normalize(String(value || "").trim().replace(/\\/g, "/"))
    if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === "..") {
      return null
    }

    if (path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) {
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

  async function buildWorkspaceManifestMarkdown(workspaceDir) {
    const lines = ["# Workspace Manifest", "", "## Files"]
    const queue = [{ dir: workspaceDir, depth: 0, prefix: "" }]
    const maxDepth = 3
    const maxEntries = 180
    let entryCount = 0

    while (queue.length > 0 && entryCount < maxEntries) {
      const current = queue.shift()
      const entries = await fsp.readdir(current.dir, { withFileTypes: true })
      entries.sort((left, right) => left.name.localeCompare(right.name))

      for (const entry of entries) {
        if (WORKSPACE_COPY_EXCLUDES.has(entry.name)) {
          continue
        }

        const relativePath = current.prefix ? `${current.prefix}/${entry.name}` : entry.name
        lines.push(`- ${relativePath}${entry.isDirectory() ? "/" : ""}`)
        entryCount += 1

        if (entryCount >= maxEntries) {
          break
        }

        if (entry.isDirectory() && current.depth < maxDepth) {
          queue.push({
            dir: path.join(current.dir, entry.name),
            depth: current.depth + 1,
            prefix: relativePath,
          })
        }
      }
    }

    if (entryCount >= maxEntries) {
      lines.push("", `Manifest truncated after ${maxEntries} entries.`)
    }

    return `${lines.join("\n")}\n`
  }

  function appendAgentMessage(messages, { role, profile, taskId, kind, content }) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      role,
      profile,
      taskId: taskId || null,
      kind,
      content: String(content || "").trim(),
    }
    messages.push(entry)
    return entry
  }

  function extractCodeFenceContents(value) {
    const match = String(value || "").match(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/)
    return match ? match[1].trim() : String(value || "").trim()
  }

  function parseShellCommands(markdownSection) {
    const body = extractCodeFenceContents(markdownSection)
    return body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
  }

  function parseCoderResponse(markdown) {
    const summary = extractSection(markdown, "Summary") || stripCodeFences(markdown)
    const filesSection = extractSection(markdown, "Files")
    const notes = extractSection(markdown, "Notes")
    const shellCommands = parseShellCommands(extractSection(markdown, "Shell Commands"))
    const files = []
    const fileRegex = /^### FILE:\s+(.+?)\s*$([\s\S]*?)(?=^### FILE:\s+|$)/gim
    let match

    while ((match = fileRegex.exec(filesSection))) {
      const relativePath = normalizeRelativeWorkspacePath(match[1])
      if (!relativePath || relativePath.toUpperCase() === "NONE") {
        continue
      }

      files.push({
        path: relativePath,
        content: `${extractCodeFenceContents(match[2])}\n`,
      })
    }

    return {
      summary: summary.trim(),
      files,
      commands: shellCommands,
      notes: notes.trim(),
      raw: markdown,
    }
  }

  function parseReviewerDecision(markdown) {
    const verdictSection = extractSection(markdown, "Verdict").toLowerCase()
    const findings = extractListItems(extractSection(markdown, "Findings"))
    const requiredChanges = extractListItems(extractSection(markdown, "Required Changes"))
    const verdict = verdictSection.includes("approve") ? "approve" : "revise"

    return {
      verdict,
      findings,
      requiredChanges,
      raw: markdown,
    }
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
    const trimmed = String(command || "").trim()
    if (!isSafeCommand(trimmed)) {
      return {
        command: trimmed,
        status: "skipped",
        exitCode: null,
        stdout: "",
        stderr: "Command blocked by safety policy.",
      }
    }

    return new Promise((resolve) => {
      const startedAt = Date.now()
      const child = spawn("powershell", ["-NoProfile", "-Command", trimmed], {
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
          command: trimmed,
          status: "failed",
          exitCode: null,
          stdout: stdout.trim(),
          stderr: `${stderr}\n${error.message}`.trim(),
          durationMs: Date.now() - startedAt,
        })
      })
      child.on("close", (exitCode) => {
        completed = true
        clearTimeout(timer)
        resolve({
          command: trimmed,
          status: exitCode === 0 ? "completed" : "failed",
          exitCode,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          durationMs: Date.now() - startedAt,
        })
      })
    })
  }

  async function applyWorkspaceFileWrites(workspaceDir, files) {
    const writtenFiles = []

    for (const entry of files) {
      const relativePath = normalizeRelativeWorkspacePath(entry.path)
      if (!relativePath) {
        continue
      }

      const targetPath = path.join(workspaceDir, relativePath)
      await writeFile(targetPath, entry.content)
      writtenFiles.push(relativePath)
    }

    return writtenFiles
  }

  async function syncWorkspaceFilesToRepo(workspaceDir, relativePaths) {
    const synced = []

    for (const relativePath of relativePaths) {
      const normalized = normalizeRelativeWorkspacePath(relativePath)
      if (!normalized) {
        continue
      }

      const sourcePath = path.join(workspaceDir, normalized)
      if (!(await pathExists(sourcePath))) {
        continue
      }

      const destinationPath = path.join(repoRoot, normalized)
      await ensureDir(path.dirname(destinationPath))
      await fsp.copyFile(sourcePath, destinationPath)
      synced.push(normalized)
    }

    return synced
  }

  function selectExecutableTasks(tasksJson) {
    return (tasksJson.tasks || []).filter((task) => {
      const owner = String(task.owner || "").toLowerCase()
      return owner.includes("code")
    })
  }

  async function persistExecutionArtifacts(runDir, executionState) {
    await writeFile(path.join(runDir, "messages.json"), formatJson(executionState.messages))
    await writeFile(path.join(runDir, "task-execution.json"), formatJson(executionState.taskExecution))
    await writeFile(path.join(runDir, "command-results.json"), formatJson(executionState.commandResults))
    await writeFile(path.join(runDir, "workspace-manifest.md"), executionState.workspaceManifest)
  }

  function buildImplementationReportMarkdown({ taskExecution, commandResults, syncedFiles, workspaceDir }) {
    const lines = [
      "# Implementation",
      "",
      "## Workspace",
      `- Run workspace: ${workspaceDir.replace(/\\/g, "/")}`,
      `- Synced files: ${syncedFiles.length}`,
      "",
      "## Task Outcomes",
    ]

    if (taskExecution.length === 0) {
      lines.push("- No executable coding tasks were selected for this run.")
    } else {
      for (const task of taskExecution) {
        lines.push(`- ${task.id} | ${task.title} | ${task.status} | attempts: ${task.attempts.length}`)
      }
    }

    lines.push("", "## Files Changed")
    if (syncedFiles.length === 0) {
      lines.push("- None")
    } else {
      for (const filePath of syncedFiles) {
        lines.push(`- ${filePath}`)
      }
    }

    lines.push("", "## Command Results")
    if (commandResults.length === 0) {
      lines.push("- No shell commands were executed.")
    } else {
      for (const result of commandResults) {
        lines.push(`- ${result.command} | ${result.status} | exit: ${result.exitCode ?? "n/a"}`)
      }
    }

    lines.push("", "## Next Step")
    lines.push(
      taskExecution.some((task) => task.status !== "completed")
        ? "Review the task execution artifact and run another iteration for blocked or revised tasks."
        : "Inspect the synced files and run project-specific validation before the next feature loop.",
    )

    return `${lines.join("\n")}\n`
  }

  async function writeWorkspaceArtifacts({
    planMarkdown,
    architectureMarkdown,
    tasksJson,
    reviewMarkdown,
    summaryMarkdown,
    runRelativePath,
    managerBrief,
    workspaceDir,
    changedFiles,
  }) {
    await writeFile(path.join(repoRoot, "01_planning", "plan.md"), `${planMarkdown.trim()}\n`)
    await writeFile(path.join(repoRoot, "02_architecture", "architecture.md"), `${architectureMarkdown.trim()}\n`)
    await writeFile(path.join(repoRoot, "03_tasks", "tasks.json"), formatJson(tasksJson))
    await writeFile(path.join(repoRoot, "05_reviews", "review.md"), `${reviewMarkdown.trim()}\n`)
    if (workspaceDir && Array.isArray(changedFiles) && changedFiles.length > 0) {
      await syncWorkspaceFilesToRepo(workspaceDir, changedFiles)
    }
    await writeFile(
      path.join(repoRoot, "memory-bank", "activeContext.md"),
      buildActiveContext(summaryMarkdown, runRelativePath, managerBrief),
    )
  }

  function getOllamaExecutable() {
    const envOverride = process.env.OLLAMA_PATH
    if (envOverride) {
      return envOverride
    }

    const localAppData = process.env.LOCALAPPDATA || ""
    const installedExe = path.join(localAppData, "Programs", "Ollama", "ollama.exe")
    if (localAppData && fs.existsSync(installedExe)) {
      return installedExe
    }

    return "ollama"
  }

  async function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
  }

  async function isOllamaReady(baseUrl) {
    try {
      const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
      return response.ok
    } catch {
      return false
    }
  }

  async function ensureOllamaReady(baseUrl) {
    if (await isOllamaReady(baseUrl)) {
      return
    }

    const executable = getOllamaExecutable()
    try {
      const child = spawn(executable, ["serve"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      })
      child.unref()
    } catch (error) {
      throw new Error(
        `Ollama is not reachable at ${baseUrl} and could not be started automatically: ${error.message}`,
      )
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(1500)
      if (await isOllamaReady(baseUrl)) {
        return
      }
    }

    throw new Error(`Ollama did not become ready at ${baseUrl}.`)
  }

  function buildHeaders(profile, apiKey) {
    const baseHeaders = {
      "Content-Type": "application/json",
    }

    if (profile.type === "anthropic") {
      return {
        ...baseHeaders,
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      }
    }

    if (profile.type === "gemini") {
      return {
        ...baseHeaders,
        "x-goog-api-key": apiKey,
      }
    }

    if (apiKey) {
      return {
        ...baseHeaders,
        Authorization: `Bearer ${apiKey}`,
        ...(profile.extraHeaders || {}),
      }
    }

    return {
      ...baseHeaders,
      ...(profile.extraHeaders || {}),
    }
  }

  function extractOpenAIContent(payload) {
    const message = payload.choices?.[0]?.message?.content
    if (typeof message === "string") {
      return message.trim()
    }

    if (Array.isArray(message)) {
      return message
        .map((part) => {
          if (typeof part === "string") {
            return part
          }
          if (part?.type === "text") {
            return part.text || ""
          }
          return ""
        })
        .join("\n")
        .trim()
    }

    return ""
  }

  function extractAnthropicContent(payload) {
    return (payload.content || [])
      .map((entry) => (entry?.type === "text" ? entry.text || "" : ""))
      .join("\n")
      .trim()
  }

  function extractGeminiContent(payload) {
    return (payload.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text || "")
      .join("\n")
      .trim()
  }

  const PROVIDER_TIMEOUT_MS = 180000

  async function generateTextWithProfile(profile, prompt) {
    const apiKey = profile.apiKeyEnv ? process.env[profile.apiKeyEnv] : undefined

    if (profile.type === "ollama") {
      await ensureOllamaReady(profile.baseUrl)
      const response = await fetch(`${profile.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: profile.model,
          prompt,
          stream: false,
          options: {
            temperature: profile.temperature ?? 0.2,
          },
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      })

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`)
      }

      const payload = await response.json()
      return String(payload.response || "").trim()
    }

    if (!apiKey) {
      throw new Error(`Missing required credential: ${profile.apiKeyEnv}`)
    }

    if (profile.type === "anthropic") {
      const response = await fetch(profile.apiUrl, {
        method: "POST",
        headers: buildHeaders(profile, apiKey),
        body: JSON.stringify({
          model: profile.model,
          max_tokens: profile.maxTokens ?? 2200,
          temperature: profile.temperature ?? 0.2,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: prompt }],
            },
          ],
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      })

      if (!response.ok) {
        throw new Error(`Anthropic request failed: ${response.status} ${await response.text()}`)
      }

      return extractAnthropicContent(await response.json())
    }

    if (profile.type === "gemini") {
      const response = await fetch(`${profile.baseUrl}/models/${profile.model}:generateContent`, {
        method: "POST",
        headers: buildHeaders(profile, apiKey),
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: profile.temperature ?? 0.2,
            maxOutputTokens: profile.maxTokens ?? 2200,
          },
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      })

      if (!response.ok) {
        throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`)
      }

      return extractGeminiContent(await response.json())
    }

    const baseUrl = profile.baseUrl.replace(/\/$/, "")
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(profile, apiKey),
      body: JSON.stringify({
        model: profile.model,
        messages: [{ role: "user", content: prompt }],
        temperature: profile.temperature ?? 0.2,
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`OpenAI-compatible request failed: ${response.status} ${await response.text()}`)
    }

    return extractOpenAIContent(await response.json())
  }

  function getProfileAvailability(profile) {
    if (profile.type === "ollama") {
      return { available: true, reason: "Local profile" }
    }

    if (profile.apiKeyEnv && !process.env[profile.apiKeyEnv]) {
      return { available: false, reason: `Missing ${profile.apiKeyEnv}` }
    }

    return { available: true, reason: "Configured" }
  }

  function getProfileCapabilities(profile, config) {
    const apiKeyEnv = config.features.webSearch.apiKeyEnv
    return {
      textGeneration: true,
      streaming: false,
      toolCalling: ["ollama", "openai", "openai-compatible", "gemini"].includes(profile.type),
      search: Boolean(config.features.webSearch.enabled && process.env[apiKeyEnv]),
      urlContext: Boolean(config.features.urlContext.enabled),
    }
  }

  async function listProfiles() {
    const config = await loadConfig()
    return Object.entries(config.profiles).map(([name, profile]) => {
      const availability = getProfileAvailability(profile)
      return {
        name,
        label: profile.label || name,
        type: profile.type,
        model: profile.model,
        available: availability.available,
        reason: availability.reason,
        capabilities: getProfileCapabilities(profile, config),
      }
    })
  }

  async function listPresets() {
    const config = await loadConfig()
    return Object.entries(config.presets).map(([name, preset]) => ({
      name,
      label: preset.label || name,
      roles: preset.roles,
    }))
  }

  async function resolveProfiles({ presetName, roleOverrides }) {
    const config = await loadConfig()
    const preset = config.presets[presetName] || config.presets.local
    const selectedProfiles = {}
    const resolution = {}

    for (const role of ["manager", "architect", "code", "review"]) {
      const preferred = roleOverrides?.[role] ? [roleOverrides[role]] : preset.roles[role] || []
      let selected = null
      let skipReason = "No profile candidates configured"

      for (const profileName of preferred) {
        const profile = config.profiles[profileName]
        if (!profile) {
          skipReason = `Unknown profile ${profileName}`
          continue
        }
        const availability = getProfileAvailability(profile)
        if (availability.available) {
          selected = profileName
          break
        }
        skipReason = availability.reason
      }

      if (!selected) {
        throw new Error(`Could not resolve a usable profile for role "${role}": ${skipReason}`)
      }

      selectedProfiles[role] = selected
      resolution[role] = config.profiles[selected]
    }

    return { selectedProfiles, profiles: resolution, config }
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
    const maxChars = config.features.urlContext.maxCharsPerUrl || 4000

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
        content: cleanFetchedText(payload.content || "", maxChars),
      }
    } catch {
      return null
    }
  }

  async function fetchUrlContext(urls, config) {
    if (!config.features.urlContext.enabled || urls.length === 0) {
      return []
    }

    const limited = urls.slice(0, config.features.urlContext.maxUrls || 3)
    const entries = []

    for (const url of limited) {
      try {
        const fetched = await performWebFetch(url, config)
        if (fetched?.content) {
          entries.push(fetched)
          continue
        }

        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          headers: { "User-Agent": "multi-ai-system/1.0" },
        })
        const body = await response.text()
        const text = cleanFetchedText(body, config.features.urlContext.maxCharsPerUrl || 4000)

        entries.push({ url, content: text })
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
      sections.push(
        [
          "Fetched URL context:",
          ...urlContextEntries.map((entry) => `- ${entry.url}\n  ${entry.content}`),
        ].join("\n"),
      )
    }

    if (searchResults.length > 0) {
      sections.push(
        [
          "Web search results:",
          ...searchResults.map(
            (entry) => `- ${entry.title || "Untitled"}\n  URL: ${entry.url || ""}\n  Snippet: ${entry.content || entry.snippet || ""}`,
          ),
        ].join("\n"),
      )
    }

    return sections.length > 0 ? `${sections.join("\n\n")}\n\n` : ""
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

  async function executeImplementationLoop({
    record,
    runDir,
    managerBrief,
    planMarkdown,
    architectureMarkdown,
    tasksJson,
    augmentationText,
    selectedProfiles,
    profiles,
  }) {
    const workspaceDir = await ensureExecutionWorkspace(runDir)
    const workspaceManifest = await buildWorkspaceManifestMarkdown(workspaceDir)
    const executionState = {
      messages: [],
      taskExecution: [],
      commandResults: [],
      workspaceManifest,
    }
    const changedFiles = new Set()
    const executableTasks = selectExecutableTasks(tasksJson)

    await persistExecutionArtifacts(runDir, executionState)

    if (executableTasks.length === 0) {
      appendLog(record, "No executable coding tasks were selected for this run")
      await writeRunRecord(record)
      const implementationMarkdown = buildImplementationReportMarkdown({
        taskExecution: executionState.taskExecution,
        commandResults: executionState.commandResults,
        syncedFiles: [],
        workspaceDir,
      })
      await writeFile(path.join(runDir, "04_code", "implementation.md"), implementationMarkdown)
      return {
        implementationMarkdown,
        workspaceDir,
        changedFiles: [],
      }
    }

    for (const task of executableTasks) {
      const taskRecord = {
        id: task.id,
        title: task.title,
        owner: task.owner,
        status: "running",
        dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : [],
        attempts: [],
      }
      executionState.taskExecution.push(taskRecord)
      task.status = "in_progress"
      await writeFile(path.join(runDir, "03_tasks", "tasks.json"), formatJson(tasksJson))
      appendLog(record, `Executing ${task.id}: ${task.title}`)
      await writeRunRecord(record)

      let reviewerFeedback = ""

      for (let attempt = 1; attempt <= MAX_TASK_ATTEMPTS; attempt += 1) {
        const assignmentRaw = await generateTextWithProfile(
          profiles.manager,
          buildTaskAssignmentPrompt({
            userPrompt: record.prompt,
            managerBrief,
            task,
            planMarkdown,
            architectureMarkdown,
            reviewerFeedback,
          }),
        )
        const assignmentMarkdown = normalizeMarkdownArtifact(assignmentRaw, "# Task Assignment")
        appendAgentMessage(executionState.messages, {
          role: "manager",
          profile: selectedProfiles.manager,
          taskId: task.id,
          kind: "assignment",
          content: assignmentMarkdown,
        })

        const coderRaw = await generateTextWithProfile(
          profiles.code,
          buildCoderPrompt({
            userPrompt: record.prompt,
            task,
            assignmentMarkdown,
            workspaceManifest,
            reviewerFeedback,
            augmentationText,
          }),
        )
        const coderMarkdown = normalizeMarkdownArtifact(coderRaw, "# Coder Response")
        const coderResponse = parseCoderResponse(coderMarkdown)
        appendAgentMessage(executionState.messages, {
          role: "code",
          profile: selectedProfiles.code,
          taskId: task.id,
          kind: "result",
          content: coderMarkdown,
        })

        const writtenFiles = await applyWorkspaceFileWrites(workspaceDir, coderResponse.files)
        for (const relativePath of writtenFiles) {
          changedFiles.add(relativePath)
        }

        const commandBatch = []
        for (const command of coderResponse.commands.slice(0, 4)) {
          const result = await runWorkspaceCommand(workspaceDir, command)
          const payload = {
            taskId: task.id,
            attempt,
            ...result,
          }
          executionState.commandResults.push(payload)
          commandBatch.push(payload)
        }

        const reviewRaw = await generateTextWithProfile(
          profiles.review,
          buildReviewerDecisionPrompt({
            userPrompt: record.prompt,
            task,
            assignmentMarkdown,
            coderResponse,
            commandBatch,
          }),
        )
        const reviewMarkdown = normalizeMarkdownArtifact(reviewRaw, "# Review Decision")
        const reviewDecision = parseReviewerDecision(reviewMarkdown)
        appendAgentMessage(executionState.messages, {
          role: "review",
          profile: selectedProfiles.review,
          taskId: task.id,
          kind: "review",
          content: reviewMarkdown,
        })

        taskRecord.attempts.push({
          attempt,
          assignment: assignmentMarkdown,
          coderSummary: coderResponse.summary,
          writtenFiles,
          commands: commandBatch.map((entry) => ({
            command: entry.command,
            status: entry.status,
            exitCode: entry.exitCode,
          })),
          review: {
            verdict: reviewDecision.verdict,
            findings: reviewDecision.findings,
            requiredChanges: reviewDecision.requiredChanges,
          },
        })

        reviewerFeedback = [...reviewDecision.findings, ...reviewDecision.requiredChanges]
          .filter((entry) => entry && entry.toLowerCase() !== "none")
          .map((entry) => `- ${entry}`)
          .join("\n")

        await persistExecutionArtifacts(runDir, executionState)

        if (reviewDecision.verdict === "approve") {
          taskRecord.status = "completed"
          task.status = "completed"
          appendLog(record, `${task.id} approved after attempt ${attempt}`)
          await writeRunRecord(record)
          break
        }

        if (attempt === MAX_TASK_ATTEMPTS) {
          taskRecord.status = "needs-review"
          task.status = "blocked"
          appendLog(record, `${task.id} still needs review after ${attempt} attempts`, "error")
          await writeRunRecord(record)
          break
        }

        taskRecord.status = "revising"
        appendLog(record, `${task.id} requires another coding pass`)
        await writeRunRecord(record)
      }

      if (taskRecord.status === "running") {
        taskRecord.status = "completed"
        task.status = "completed"
      }

      await writeFile(path.join(runDir, "03_tasks", "tasks.json"), formatJson(tasksJson))
      await persistExecutionArtifacts(runDir, executionState)
    }

    const implementationMarkdown = buildImplementationReportMarkdown({
      taskExecution: executionState.taskExecution,
      commandResults: executionState.commandResults,
      syncedFiles: [...changedFiles],
      workspaceDir,
    })
    await writeFile(path.join(runDir, "04_code", "implementation.md"), implementationMarkdown)

    return {
      implementationMarkdown,
      workspaceDir,
      changedFiles: [...changedFiles],
      taskExecution: executionState.taskExecution,
      commandResults: executionState.commandResults,
    }
  }

  async function executeRun(runId) {
    const record = await readRunRecord(runId)
    if (!record) {
      return
    }

    const { selectedProfiles, profiles, config } = await resolveProfiles({
      presetName: record.preset,
      roleOverrides: record.roleOverrides,
    })

    record.selectedProfiles = selectedProfiles
    record.status = "running"
    record.updatedAt = new Date().toISOString()
    appendLog(record, `Resolved preset "${record.preset}" to profiles ${JSON.stringify(selectedProfiles)}`)
    await writeRunRecord(record)

    const runDir = path.join(repoRoot, record.runDirRelative)
    await ensureDir(runDir)
    await snapshotWorkspace(runDir)
    await writeFile(path.join(runDir, "00-input.md"), `# Input\n\n${record.prompt}\n`)

    const managerBrief = buildSeedBrief(record.prompt)
    await writeFile(path.join(runDir, "01-manager-brief.json"), formatJson(managerBrief))
    record.managerBrief = managerBrief
    await writeRunRecord(record)

    const referenceUrls = [...new Set([...(record.referenceUrls || []), ...extractUrls(record.prompt)])]
    const urlContextEntries = await fetchUrlContext(referenceUrls, config)
    const searchResults = record.enableWebSearch ? await performWebSearch(record.prompt, config) : []
    const augmentationText = buildAugmentationText(referenceUrls, urlContextEntries, searchResults)

    try {
      await updateStage(record, "planning", {
        status: "running",
        profile: selectedProfiles.manager,
        startedAt: new Date().toISOString(),
      })
      appendLog(record, `Planning with ${selectedProfiles.manager}`)
      const planRaw = await generateTextWithProfile(
        profiles.manager,
        buildPlanPrompt(record.prompt, managerBrief, augmentationText),
      )
      const planMarkdown = normalizeMarkdownArtifact(planRaw, "# Plan")
      await writeFile(path.join(runDir, "01_planning", "plan.md"), `${planMarkdown.trim()}\n`)
      await updateStage(record, "planning", {
        status: "completed",
        completedAt: new Date().toISOString(),
      })

      await updateStage(record, "architecture", {
        status: "running",
        profile: selectedProfiles.architect,
        startedAt: new Date().toISOString(),
      })
      appendLog(record, `Architecture with ${selectedProfiles.architect}`)
      const architectureRaw = await generateTextWithProfile(
        profiles.architect,
        buildArchitecturePrompt(record.prompt, managerBrief, planMarkdown, augmentationText),
      )
      const architectureMarkdown = normalizeMarkdownArtifact(architectureRaw, "# Architecture")
      await writeFile(path.join(runDir, "02_architecture", "architecture.md"), `${architectureMarkdown.trim()}\n`)
      await updateStage(record, "architecture", {
        status: "completed",
        completedAt: new Date().toISOString(),
      })

      await updateStage(record, "tasks", {
        status: "running",
        profile: selectedProfiles.manager,
        startedAt: new Date().toISOString(),
      })
      appendLog(record, "Synthesizing deterministic task list")
      const tasksJson = buildDeterministicTasks({
        userPrompt: record.prompt,
        architectureMarkdown,
        implementationMarkdown: "",
      })
      await writeFile(path.join(runDir, "03_tasks", "tasks.json"), formatJson(tasksJson))
      await updateStage(record, "tasks", {
        status: "completed",
        completedAt: new Date().toISOString(),
      })

      await updateStage(record, "implementation", {
        status: "running",
        profile: selectedProfiles.code,
        startedAt: new Date().toISOString(),
      })
      appendLog(record, `Executing code tasks with ${selectedProfiles.code}`)
      const implementationResult = await executeImplementationLoop({
        record,
        runDir,
        managerBrief,
        planMarkdown,
        architectureMarkdown,
        tasksJson,
        augmentationText,
        selectedProfiles,
        profiles,
      })
      const implementationMarkdown = implementationResult.implementationMarkdown
      await updateStage(record, "implementation", {
        status: "completed",
        completedAt: new Date().toISOString(),
      })

      await updateStage(record, "review", {
        status: "running",
        profile: selectedProfiles.review,
        startedAt: new Date().toISOString(),
      })
      appendLog(record, `Review with ${selectedProfiles.review}`)
      const reviewRaw = await generateTextWithProfile(
        profiles.review,
        buildReviewPrompt(
          record.prompt,
          managerBrief,
          planMarkdown,
          architectureMarkdown,
          tasksJson,
          implementationMarkdown,
          augmentationText,
        ),
      )
      const reviewMarkdown = closeOpenCodeFence(normalizeMarkdownArtifact(reviewRaw, "# Review"))
      await writeFile(path.join(runDir, "05_reviews", "review.md"), `${reviewMarkdown.trim()}\n`)
      await updateStage(record, "review", {
        status: "completed",
        completedAt: new Date().toISOString(),
      })

      await updateStage(record, "summary", {
        status: "running",
        profile: selectedProfiles.manager,
        startedAt: new Date().toISOString(),
      })
      const summaryMarkdown = buildSummaryMarkdown({
        userPrompt: record.prompt,
        managerBrief,
        tasksJson,
        runRelativePath: record.runDirRelative,
        workspaceSync: record.workspaceSync,
        selectedProfiles,
      })
      await writeFile(path.join(runDir, "summary.md"), `${summaryMarkdown.trim()}\n`)

      if (record.workspaceSync) {
        appendLog(record, "Syncing artifacts back into the Roo workspace")
        await writeWorkspaceArtifacts({
          planMarkdown,
          architectureMarkdown,
          tasksJson,
          reviewMarkdown,
          summaryMarkdown,
          runRelativePath: record.runDirRelative,
          managerBrief,
          workspaceDir: implementationResult.workspaceDir,
          changedFiles: implementationResult.changedFiles,
        })
      }

      await updateStage(record, "summary", {
        status: "completed",
        completedAt: new Date().toISOString(),
      })

      record.status = "completed"
      record.error = null
      record.summary = {
        text: summaryMarkdown,
        selectedProfiles,
      }
      appendLog(record, "Run completed successfully")
      record.updatedAt = new Date().toISOString()
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
      workspaceSync:
        typeof input.workspaceSync === "boolean" ? input.workspaceSync : Boolean(config.runtime.workspaceSync),
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
      await sleep(pollMs)
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
