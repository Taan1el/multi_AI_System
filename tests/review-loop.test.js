const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")

const { createOrchestrator } = require("../04_code/orchestrator")
const { createMockProviderApi, createTempRepo, successfulCommandRunner } = require("./helpers")

test("review loop refines the coder task after a revision request", async () => {
  const tempRepo = await createTempRepo()

  try {
    const orchestrator = createOrchestrator({
      repoRoot: tempRepo.repoRoot,
      appRoot: tempRepo.appRoot,
      contractsRoot: tempRepo.contractsRoot,
      providerApi: createMockProviderApi({ requireRevision: true }),
      commandRunner: successfulCommandRunner,
    })

    const run = await orchestrator.startRun({
      prompt: "Create a smoke note in 04_code/generated/smoke-note.txt.",
      preset: "local",
      workspaceSync: false,
      enableWebSearch: false,
      referenceUrls: [],
    })

    const finalRun = await orchestrator.waitForRun(run.id, { pollMs: 50, timeoutMs: 15000 })
    assert.equal(finalRun.status, "completed")

    const runDir = path.join(tempRepo.repoRoot, finalRun.runDirRelative)
    const taskIndex = JSON.parse(await fs.readFile(path.join(runDir, "03_tasks", "tasks.json"), "utf8"))
    const coderTask = taskIndex.tasks.find((entry) => entry.assigned_agent === "coder")

    assert.ok(coderTask)
    assert.equal(coderTask.iteration, 2)
    assert.equal(coderTask.review_directives_applied.length, 1)
    assert.ok(coderTask.acceptance_criteria.some((entry) => /validation/i.test(entry)))
  } finally {
    await tempRepo.cleanup()
  }
})
