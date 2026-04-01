const test = require("node:test")
const assert = require("node:assert/strict")

const config = require("../multi-ai.config.json")
const { resolveProfiles } = require("../providers/router")

test("local preset resolves canonical roles and preserves legacy aliases", () => {
  const result = resolveProfiles(config, {
    presetName: "local",
    roleOverrides: {
      code: "local-code",
      review: "local-research",
    },
    environment: {},
  })

  assert.equal(result.selectedProfiles.manager, "local-manager")
  assert.equal(result.selectedProfiles.architect, "local-research")
  assert.equal(result.selectedProfiles.coder, "local-code")
  assert.equal(result.selectedProfiles.reviewer, "local-research")
  assert.equal(result.selectedProfiles.designer, "local-research")
  assert.equal(result.selectedProfiles.researcher, "local-research")
})

test("hybrid preset prefers anthropic for the manager when the credential is present", () => {
  const result = resolveProfiles(config, {
    presetName: "hybrid",
    environment: {
      ANTHROPIC_API_KEY: "set",
    },
  })

  assert.equal(result.selectedProfiles.manager, "anthropic-architect")
  assert.equal(result.selectedProfiles.architect, "anthropic-architect")
  assert.equal(result.selectedProfiles.coder, "local-code")
  assert.equal(result.selectedProfiles.reviewer, "anthropic-architect")
  assert.equal(result.selectedProfiles.designer, "anthropic-architect")
  assert.equal(result.selectedProfiles.researcher, "anthropic-architect")
})
