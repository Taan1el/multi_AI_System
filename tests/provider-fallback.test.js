const test = require("node:test")
const assert = require("node:assert/strict")

const config = require("../multi-ai.config.json")
const { resolveProfiles } = require("../providers/router")

test("router skips earlier profiles that do not satisfy role capabilities", () => {
  const customConfig = structuredClone(config)
  customConfig.presets.local.roles.code = ["local-manager", "local-code"]

  const result = resolveProfiles(customConfig, {
    presetName: "local",
    environment: {},
  })

  assert.equal(result.selectedProfiles.coder, "local-code")
})

test("hybrid manager falls back from anthropic to openai when anthropic is unavailable", () => {
  const result = resolveProfiles(config, {
    presetName: "hybrid",
    environment: {
      OPENAI_API_KEY: "set",
    },
  })

  assert.equal(result.selectedProfiles.manager, "openai-code")
  assert.equal(result.selectedProfiles.coder, "openai-code")
  assert.equal(result.selectedProfiles.architect, "local-research")
})
