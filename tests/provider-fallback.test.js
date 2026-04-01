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

test("router skips unavailable cloud profiles before selecting a compatible fallback", () => {
  const result = resolveProfiles(config, {
    presetName: "hybrid",
    environment: {
      OPENROUTER_API_KEY: "set",
    },
  })

  assert.equal(result.selectedProfiles.coder, "openrouter-fallback")
  assert.equal(result.selectedProfiles.architect, "local-research")
})
