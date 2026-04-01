const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")

const actualRepoRoot = path.resolve(__dirname, "..")

async function createTempRepo() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "multi-ai-system-"))
  await fs.mkdir(path.join(tempRoot, "01_planning"), { recursive: true })
  await fs.mkdir(path.join(tempRoot, "02_architecture"), { recursive: true })
  await fs.mkdir(path.join(tempRoot, "03_tasks"), { recursive: true })
  await fs.mkdir(path.join(tempRoot, "04_code", "data"), { recursive: true })
  await fs.mkdir(path.join(tempRoot, "05_reviews"), { recursive: true })
  await fs.mkdir(path.join(tempRoot, "memory-bank"), { recursive: true })

  const config = JSON.parse(await fs.readFile(path.join(actualRepoRoot, "multi-ai.config.json"), "utf8"))
  await fs.writeFile(path.join(tempRoot, "multi-ai.config.json"), JSON.stringify(config, null, 2), "utf8")
  await fs.writeFile(path.join(tempRoot, "memory-bank", "activeContext.md"), "# Active Context\n", "utf8")

  return {
    repoRoot: tempRoot,
    appRoot: path.join(tempRoot, "04_code"),
    contractsRoot: actualRepoRoot,
    cleanup: async () => fs.rm(tempRoot, { recursive: true, force: true }),
  }
}

function createMockProviderApi(options = {}) {
  const reviewCounts = new Map()

  return {
    listProfiles(config) {
      return Object.entries(config.profiles).map(([name, profile]) => ({
        name,
        label: profile.label || name,
        type: profile.type,
        model: profile.model,
        available: true,
        reason: "Mock profile",
        capabilities: profile.capabilities || [],
      }))
    },
    listPresets(config) {
      return Object.entries(config.presets).map(([name, preset]) => ({
        name,
        label: preset.label || name,
        roles: preset.roles,
      }))
    },
    resolveProfiles(config) {
      return {
        selectedProfiles: {
          manager: "local-manager",
          architect: "local-research",
          coder: "local-code",
          designer: "local-research",
          reviewer: "local-research",
          researcher: "local-research",
        },
        profiles: {
          manager: config.profiles["local-manager"],
          architect: config.profiles["local-research"],
          coder: config.profiles["local-code"],
          designer: config.profiles["local-research"],
          reviewer: config.profiles["local-research"],
          researcher: config.profiles["local-research"],
        },
      }
    },
    async generateText(profile, prompt, context) {
      if (context.stage === "planning") {
        return [
          "# Plan",
          "",
          "## Goal",
          "Create a smoke note artifact.",
          "",
          "## Scope",
          "- Add a tiny implementation artifact.",
          "",
          "## Constraints",
          "- Keep the change small.",
          "",
          "## Success Criteria",
          "- A file is written in 04_code.",
          "",
          "## Workstreams",
          "- Planning",
          "- Architecture",
          "- Implementation",
          "",
          "## Risks",
          "- Low",
          "",
          "## Open Questions",
          "- None",
          "",
          "## Handoff",
          "- Continue to architecture.",
        ].join("\n")
      }

      if (context.stage === "architecture") {
        return [
          "# Architecture",
          "",
          "## Overview",
          "A small file write in 04_code.",
          "",
          "## System Shape",
          "- one file output",
          "",
          "## Data and State",
          "- no persistent state",
          "",
          "## Files and Folders",
          "- 04_code/generated/smoke-note.txt - generated smoke note",
          "",
          "## Model Collaboration",
          "- architect defines the output file",
          "",
          "## Risks and Mitigations",
          "- low risk",
          "",
          "## Recommended Build Order",
          "- create the generated smoke note file",
        ].join("\n")
      }

      if (context.role === "coder") {
        const wantsValidation = /validate/i.test(prompt)
        return JSON.stringify({
          summary: wantsValidation ? "Created the smoke note with validation guidance." : "Created the smoke note.",
          files: [
            {
              path: "04_code/generated/smoke-note.txt",
              content: wantsValidation
                ? "multi-agent smoke note\nvalidated=true"
                : "multi-agent smoke note",
            },
          ],
          commands: [],
          blockers: [],
          assumptions: [],
        })
      }

      if (context.role === "reviewer") {
        const currentCount = reviewCounts.get(context.taskId) || 0
        reviewCounts.set(context.taskId, currentCount + 1)

        if (context.taskId !== "task-001" && options.requireRevision && currentCount === 0) {
          return JSON.stringify({
            findings: ["Implementation exists but validation is not explicit enough."],
            blocking_issues: ["Validation evidence is missing from the task outcome."],
            non_blocking_improvements: [],
            revision_request: ["Add an explicit validation check to the acceptance criteria and output."],
            approved: false,
          })
        }

        return JSON.stringify({
          findings: ["Output satisfies the task."],
          blocking_issues: [],
          non_blocking_improvements: [],
          revision_request: [],
          approved: true,
        })
      }

      return [
        "# Research",
        "",
        "The supporting context is sufficient for the smoke task.",
      ].join("\n")
    },
  }
}

async function successfulCommandRunner(_workspaceDir, command) {
  return {
    command,
    status: "completed",
    exitCode: 0,
    stdout: "",
    stderr: "",
  }
}

module.exports = {
  actualRepoRoot,
  createMockProviderApi,
  createTempRepo,
  successfulCommandRunner,
}
