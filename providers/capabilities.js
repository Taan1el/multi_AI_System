const CANONICAL_ROLES = ["manager", "architect", "coder", "designer", "reviewer", "researcher"]

const ROLE_ALIASES = {
  code: "coder",
  review: "reviewer",
}

const LEGACY_ROLE_NAMES = {
  coder: "code",
  reviewer: "review",
}

const ROLE_CAPABILITY_REQUIREMENTS = {
  manager: ["reasoning", "structured_output"],
  architect: ["reasoning", "long_context"],
  coder: ["code_generation", "tool_execution"],
  designer: ["design_spec", "structured_output"],
  reviewer: ["artifact_review", "structured_output"],
  researcher: ["research_retrieval", "long_context"],
}

const PROFILE_TYPE_CAPABILITIES = {
  ollama: ["reasoning", "structured_output", "code_generation", "tool_execution", "long_context"],
  anthropic: [
    "reasoning",
    "structured_output",
    "artifact_review",
    "design_spec",
    "long_context",
    "research_retrieval",
  ],
  openai: [
    "reasoning",
    "structured_output",
    "artifact_review",
    "code_generation",
    "tool_execution",
    "design_spec",
    "long_context",
  ],
  "openai-compatible": [
    "reasoning",
    "structured_output",
    "artifact_review",
    "code_generation",
    "tool_execution",
    "design_spec",
    "long_context",
  ],
  gemini: [
    "reasoning",
    "structured_output",
    "artifact_review",
    "design_spec",
    "research_retrieval",
    "long_context",
  ],
}

function getCanonicalRole(roleName) {
  const normalized = String(roleName || "").trim().toLowerCase()
  return ROLE_ALIASES[normalized] || normalized
}

function getLegacyRoleName(roleName) {
  const canonicalRole = getCanonicalRole(roleName)
  return LEGACY_ROLE_NAMES[canonicalRole] || canonicalRole
}

function getRoleCapabilities(roleName) {
  return [...(ROLE_CAPABILITY_REQUIREMENTS[getCanonicalRole(roleName)] || [])]
}

function getProfileCapabilities(profile, features = {}, environment = process.env) {
  const declared = Array.isArray(profile.capabilities) ? profile.capabilities : null
  const base = declared ? [...declared] : [...(PROFILE_TYPE_CAPABILITIES[profile.type] || [])]
  const capabilities = new Set(base)

  if (!features.webSearch?.enabled || !environment[features.webSearch?.apiKeyEnv || ""]) {
    capabilities.delete("search_fetch_bridge")
  } else {
    capabilities.add("search_fetch_bridge")
  }

  if (!features.webFetch?.enabled || !environment[features.webFetch?.apiKeyEnv || ""]) {
    capabilities.delete("search_fetch_bridge")
  } else {
    capabilities.add("search_fetch_bridge")
  }

  if (features.urlContext?.enabled) {
    capabilities.add("long_context")
  }

  return [...capabilities]
}

function profileSupportsRole(profile, roleName, features = {}, environment = process.env) {
  const requiredCapabilities = getRoleCapabilities(roleName)
  const availableCapabilities = new Set(getProfileCapabilities(profile, features, environment))
  return requiredCapabilities.every((capability) => availableCapabilities.has(capability))
}

module.exports = {
  CANONICAL_ROLES,
  ROLE_ALIASES,
  LEGACY_ROLE_NAMES,
  ROLE_CAPABILITY_REQUIREMENTS,
  PROFILE_TYPE_CAPABILITIES,
  getCanonicalRole,
  getLegacyRoleName,
  getRoleCapabilities,
  getProfileCapabilities,
  profileSupportsRole,
}
