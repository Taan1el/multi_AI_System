const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs/promises")
const path = require("node:path")

const { createOrchestrator } = require("../04_code/orchestrator")
const { createSchemaValidator } = require("../schemas/validator")
const { createMockProviderApi, createTempRepo, successfulCommandRunner } = require("./helpers")

test("completed run writes schema-valid task, handoff, review, and run-report artifacts", async () => {
  const tempRepo = await createTempRepo()
  const validator = createSchemaValidator(path.join(tempRepo.contractsRoot, "schemas"))

  try {
    const orchestrator = createOrchestrator({
      repoRoot: tempRepo.repoRoot,
      appRoot: tempRepo.appRoot,
      contractsRoot: tempRepo.contractsRoot,
      providerApi: createMockProviderApi({ requireRevision: false }),
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
    const runReport = JSON.parse(await fs.readFile(path.join(runDir, "run-report.json"), "utf8"))
    assert.equal(validator.validateArtifact("run-report.schema.json", runReport).valid, true)

    for (const relativePath of runReport.artifact_files.task_files) {
      const taskArtifact = JSON.parse(await fs.readFile(path.join(runDir, relativePath), "utf8"))
      assert.equal(validator.validateArtifact("task.schema.json", taskArtifact).valid, true)
    }

    for (const relativePath of runReport.artifact_files.handoff_files) {
      const handoffArtifact = JSON.parse(await fs.readFile(path.join(runDir, relativePath), "utf8"))
      assert.equal(validator.validateArtifact("handoff.schema.json", handoffArtifact).valid, true)
    }

    for (const relativePath of runReport.artifact_files.review_files) {
      const reviewArtifact = JSON.parse(await fs.readFile(path.join(runDir, relativePath), "utf8"))
      assert.equal(validator.validateArtifact("review.schema.json", reviewArtifact).valid, true)
    }

    assert.equal(typeof runReport.artifact_files.plan_md, "string")
    assert.equal(typeof runReport.artifact_files.implementation_md, "string")
  } finally {
    await tempRepo.cleanup()
  }
})
