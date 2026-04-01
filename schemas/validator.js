const fs = require("node:fs")
const path = require("node:path")

function loadSchema(schemaDir, schemaFile) {
  const schemaPath = path.join(schemaDir, schemaFile)
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"))
}

function validateType(expectedType, value) {
  if (expectedType === "array") {
    return Array.isArray(value)
  }

  if (expectedType === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value)
  }

  if (expectedType === "number") {
    return typeof value === "number" && Number.isFinite(value)
  }

  return typeof value === expectedType
}

function validateSchemaValue(schema, value, currentPath = "$") {
  const errors = []

  if (schema.type && !validateType(schema.type, value)) {
    errors.push(`${currentPath} must be ${schema.type}`)
    return errors
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${currentPath} must be one of ${schema.enum.join(", ")}`)
  }

  if (schema.minLength && typeof value === "string" && value.length < schema.minLength) {
    errors.push(`${currentPath} must have length >= ${schema.minLength}`)
  }

  if (schema.type === "array") {
    for (let index = 0; index < value.length; index += 1) {
      errors.push(...validateSchemaValue(schema.items || {}, value[index], `${currentPath}[${index}]`))
    }
  }

  if (schema.type === "object") {
    const entries = Object.entries(value)
    const required = new Set(schema.required || [])

    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${currentPath}.${key} is required`)
      }
    }

    if (schema.additionalProperties === false) {
      for (const [key] of entries) {
        if (!schema.properties || !(key in schema.properties)) {
          errors.push(`${currentPath}.${key} is not allowed`)
        }
      }
    }

    for (const [key, propertySchema] of Object.entries(schema.properties || {})) {
      if (!(key in value)) {
        continue
      }
      errors.push(...validateSchemaValue(propertySchema, value[key], `${currentPath}.${key}`))
    }
  }

  return errors
}

function createSchemaValidator(schemaDir) {
  const cache = new Map()

  function getSchema(schemaFile) {
    if (!cache.has(schemaFile)) {
      cache.set(schemaFile, loadSchema(schemaDir, schemaFile))
    }
    return cache.get(schemaFile)
  }

  function validateArtifact(schemaFile, value) {
    const schema = getSchema(schemaFile)
    const errors = validateSchemaValue(schema, value)
    return {
      valid: errors.length === 0,
      errors,
    }
  }

  function assertValidArtifact(schemaFile, value) {
    const result = validateArtifact(schemaFile, value)
    if (!result.valid) {
      throw new Error(`Schema validation failed for ${schemaFile}: ${result.errors.join("; ")}`)
    }
  }

  return {
    assertValidArtifact,
    getSchema,
    validateArtifact,
  }
}

module.exports = {
  createSchemaValidator,
  loadSchema,
  validateSchemaValue,
}
