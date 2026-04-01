const {
  CANONICAL_ROLES,
  getCanonicalRole,
  getLegacyRoleName,
  getProfileCapabilities,
  profileSupportsRole,
} = require("./capabilities")

function getProfileAvailability(profile, environment = process.env) {
  if (profile.type === "ollama") {
    return { available: true, reason: "Local profile" }
  }

  if (profile.apiKeyEnv && !environment[profile.apiKeyEnv]) {
    return { available: false, reason: `Missing ${profile.apiKeyEnv}` }
  }

  return { available: true, reason: "Configured" }
}

function buildProfileDescriptor(name, profile, config, environment = process.env) {
  const availability = getProfileAvailability(profile, environment)
  return {
    name,
    label: profile.label || name,
    type: profile.type,
    model: profile.model,
    available: availability.available,
    reason: availability.reason,
    capabilities: getProfileCapabilities(profile, config.features || {}, environment),
  }
}

function listProfiles(config, environment = process.env) {
  return Object.entries(config.profiles || {}).map(([name, profile]) =>
    buildProfileDescriptor(name, profile, config, environment),
  )
}

function listPresets(config) {
  return Object.entries(config.presets || {}).map(([name, preset]) => ({
    name,
    label: preset.label || name,
    roles: preset.roles || {},
  }))
}

function getPresetCandidates(preset, roleName) {
  const canonicalRole = getCanonicalRole(roleName)
  const legacyRole = getLegacyRoleName(canonicalRole)
  const roles = preset.roles || {}
  return roles[canonicalRole] || roles[legacyRole] || []
}

function normalizeRoleOverrides(roleOverrides = {}) {
  const overrides = {}

  for (const [roleName, profileName] of Object.entries(roleOverrides)) {
    if (!profileName) {
      continue
    }
    overrides[getCanonicalRole(roleName)] = profileName
  }

  return overrides
}

function resolveProfiles(config, input = {}) {
  const presetName = input.presetName || "local"
  const preset = config.presets?.[presetName] || config.presets?.local
  const environment = input.environment || process.env
  const roleOverrides = normalizeRoleOverrides(input.roleOverrides)
  const selectedProfiles = {}
  const resolvedProfiles = {}

  if (!preset) {
    throw new Error(`Unknown preset "${presetName}" and no local preset fallback exists.`)
  }

  for (const roleName of CANONICAL_ROLES) {
    const override = roleOverrides[roleName]
    const candidates = override ? [override] : getPresetCandidates(preset, roleName)

    if (candidates.length === 0) {
      continue
    }

    let resolutionError = "No usable candidate was found."

    for (const profileName of candidates) {
      const profile = config.profiles?.[profileName]
      if (!profile) {
        resolutionError = `Unknown profile ${profileName}`
        continue
      }

      const availability = getProfileAvailability(profile, environment)
      if (!availability.available) {
        resolutionError = availability.reason
        continue
      }

      if (!profileSupportsRole(profile, roleName, config.features || {}, environment)) {
        resolutionError = `${profileName} does not satisfy ${roleName} capabilities`
        continue
      }

      selectedProfiles[roleName] = profileName
      resolvedProfiles[roleName] = profile
      break
    }

    if (!selectedProfiles[roleName]) {
      throw new Error(`Could not resolve a usable profile for role "${roleName}": ${resolutionError}`)
    }
  }

  return {
    selectedProfiles,
    profiles: resolvedProfiles,
    preset,
  }
}

module.exports = {
  buildProfileDescriptor,
  getProfileAvailability,
  getPresetCandidates,
  listProfiles,
  listPresets,
  normalizeRoleOverrides,
  resolveProfiles,
}
