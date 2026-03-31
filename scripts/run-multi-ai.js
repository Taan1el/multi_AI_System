#!/usr/bin/env node

const fs = require("node:fs/promises")
const path = require("node:path")
const { createOrchestrator } = require("../04_code/orchestrator")

const repoRoot = path.resolve(__dirname, "..")

function parseArgs(argv) {
  const args = argv.slice(2)
  const options = {
    prompt: "",
    promptFile: "",
    preset: "local",
    workspaceSync: true,
    enableWebSearch: false,
    referenceUrls: [],
    roleOverrides: {},
  }
  const promptParts = []

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]

    if (current === "--prompt" && args[index + 1]) {
      options.prompt = args[index + 1]
      index += 1
      continue
    }

    if (current.startsWith("--prompt=")) {
      options.prompt = current.slice("--prompt=".length)
      continue
    }

    if (current === "--prompt-file" && args[index + 1]) {
      options.promptFile = args[index + 1]
      index += 1
      continue
    }

    if (current.startsWith("--prompt-file=")) {
      options.promptFile = current.slice("--prompt-file=".length)
      continue
    }

    if (current === "--preset" && args[index + 1]) {
      options.preset = args[index + 1]
      index += 1
      continue
    }

    if (current.startsWith("--preset=")) {
      options.preset = current.slice("--preset=".length)
      continue
    }

    if (current === "--no-workspace-sync") {
      options.workspaceSync = false
      continue
    }

    if (current === "--web-search") {
      options.enableWebSearch = true
      continue
    }

    if (current === "--url" && args[index + 1]) {
      options.referenceUrls.push(args[index + 1])
      index += 1
      continue
    }

    if (current.startsWith("--url=")) {
      options.referenceUrls.push(current.slice("--url=".length))
      continue
    }

    if (current === "--role-override" && args[index + 1]) {
      const [role, profile] = String(args[index + 1]).split("=")
      if (role && profile) {
        options.roleOverrides[role] = profile
      }
      index += 1
      continue
    }

    if (current.startsWith("--role-override=")) {
      const [role, profile] = current.slice("--role-override=".length).split("=")
      if (role && profile) {
        options.roleOverrides[role] = profile
      }
      continue
    }

    promptParts.push(current)
  }

  if (!options.prompt && promptParts.length > 0) {
    options.prompt = promptParts.join(" ").trim()
  }

  return options
}

async function readPrompt(options) {
  if (options.promptFile) {
    const filePath = path.resolve(repoRoot, options.promptFile)
    return (await fs.readFile(filePath, "utf8")).trim()
  }

  return options.prompt.trim()
}

async function main() {
  const options = parseArgs(process.argv)
  const prompt = await readPrompt(options)

  if (!prompt) {
    throw new Error(
      'Missing prompt. Run `npm run multi-ai -- "your task here"` or use `--prompt-file path/to/request.txt`.',
    )
  }

  const orchestrator = createOrchestrator({ repoRoot })
  const run = await orchestrator.startRun({
    prompt,
    preset: options.preset,
    workspaceSync: options.workspaceSync,
    enableWebSearch: options.enableWebSearch,
    referenceUrls: options.referenceUrls,
    roleOverrides: options.roleOverrides,
  })

  console.log(`Queued run ${run.id}`)
  console.log(`Preset: ${run.preset}`)
  console.log(`Workspace sync: ${run.workspaceSync ? "enabled" : "disabled"}`)

  const result = await orchestrator.waitForRun(run.id)

  console.log("")
  console.log(`Run status: ${result.status}`)
  console.log(`Run output: ${result.runDirRelative}`)

  if (result.status === "failed") {
    console.error(result.error || "Run failed.")
    process.exitCode = 1
    return
  }

  console.log("Selected profiles:")
  for (const [role, profile] of Object.entries(result.selectedProfiles || {})) {
    console.log(`- ${role}: ${profile}`)
  }

  if (result.summary?.text) {
    console.log("")
    console.log(result.summary.text)
  }
}

main().catch((error) => {
  console.error("")
  console.error("run-multi-ai failed:")
  console.error(error.message)
  process.exitCode = 1
})
