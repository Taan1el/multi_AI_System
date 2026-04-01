const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")

const { createSchemaValidator } = require("../schemas/validator")

const validator = createSchemaValidator(path.join(__dirname, "..", "schemas"))

test("handoff schema accepts the exact contract shape", () => {
  const handoff = {
    source_agent: "manager",
    target_agent: "coder",
    objective: "Write the smoke note file.",
    inputs: ["01_planning/plan.md", "02_architecture/architecture.md"],
    outputs: ["04_code/generated/smoke-note.txt"],
    blockers: [],
    assumptions: ["The workspace is writable."],
    next_action: "Create the file and return implementation evidence.",
  }

  const result = validator.validateArtifact("handoff.schema.json", handoff)
  assert.equal(result.valid, true)
})

test("handoff schema rejects missing or extra fields", () => {
  const invalidHandoff = {
    source_agent: "manager",
    target_agent: "coder",
    objective: "Write the smoke note file.",
    inputs: ["01_planning/plan.md"],
    outputs: ["04_code/generated/smoke-note.txt"],
    blockers: [],
    assumptions: [],
    next_action: "Create the file.",
    extra: true,
  }

  const result = validator.validateArtifact("handoff.schema.json", invalidHandoff)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((entry) => entry.includes("$.extra is not allowed")))
})
