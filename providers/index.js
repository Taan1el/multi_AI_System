const fs = require("node:fs")
const path = require("node:path")
const { spawn } = require("node:child_process")
const { listProfiles, listPresets, resolveProfiles } = require("./router")

const PROVIDER_TIMEOUT_MS = 180000

function getOllamaExecutable(environment = process.env) {
  if (environment.OLLAMA_PATH) {
    return environment.OLLAMA_PATH
  }

  const localAppData = environment.LOCALAPPDATA || ""
  const installedExe = path.join(localAppData, "Programs", "Ollama", "ollama.exe")
  if (localAppData && fs.existsSync(installedExe)) {
    return installedExe
  }

  return "ollama"
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function isOllamaReady(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
    return response.ok
  } catch {
    return false
  }
}

async function ensureOllamaReady(baseUrl, environment = process.env) {
  if (await isOllamaReady(baseUrl)) {
    return
  }

  const executable = getOllamaExecutable(environment)
  const child = spawn(executable, ["serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
  child.unref()

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(1500)
    if (await isOllamaReady(baseUrl)) {
      return
    }
  }

  throw new Error(`Ollama did not become ready at ${baseUrl}.`)
}

function buildHeaders(profile, apiKey) {
  const baseHeaders = { "Content-Type": "application/json" }

  if (profile.type === "anthropic") {
    return {
      ...baseHeaders,
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    }
  }

  if (profile.type === "gemini") {
    return {
      ...baseHeaders,
      "x-goog-api-key": apiKey,
    }
  }

  if (apiKey) {
    return {
      ...baseHeaders,
      Authorization: `Bearer ${apiKey}`,
      ...(profile.extraHeaders || {}),
    }
  }

  return {
    ...baseHeaders,
    ...(profile.extraHeaders || {}),
  }
}

function extractOpenAIContent(payload) {
  const message = payload.choices?.[0]?.message?.content
  if (typeof message === "string") {
    return message.trim()
  }

  if (Array.isArray(message)) {
    return message
      .map((part) => {
        if (typeof part === "string") {
          return part
        }
        if (part?.type === "text") {
          return part.text || ""
        }
        return ""
      })
      .join("\n")
      .trim()
  }

  return ""
}

function extractAnthropicContent(payload) {
  return (payload.content || [])
    .map((entry) => (entry?.type === "text" ? entry.text || "" : ""))
    .join("\n")
    .trim()
}

function extractGeminiContent(payload) {
  return (payload.candidates?.[0]?.content?.parts || [])
    .map((part) => part?.text || "")
    .join("\n")
    .trim()
}

async function generateText(profile, prompt, context = {}, environment = process.env) {
  const apiKey = profile.apiKeyEnv ? environment[profile.apiKeyEnv] : undefined

  if (profile.type === "ollama") {
    await ensureOllamaReady(profile.baseUrl, environment)
    const response = await fetch(`${profile.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: profile.model,
        prompt,
        stream: false,
        options: {
          temperature: profile.temperature ?? 0.2,
        },
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${await response.text()}`)
    }

    const payload = await response.json()
    return String(payload.response || "").trim()
  }

  if (profile.apiKeyEnv && !apiKey) {
    throw new Error(`Missing required credential: ${profile.apiKeyEnv}`)
  }

  if (profile.type === "anthropic") {
    const response = await fetch(profile.apiUrl, {
      method: "POST",
      headers: buildHeaders(profile, apiKey),
      body: JSON.stringify({
        model: profile.model,
        max_tokens: profile.maxTokens ?? 2200,
        temperature: profile.temperature ?? 0.2,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: prompt }],
          },
        ],
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${response.status} ${await response.text()}`)
    }

    return extractAnthropicContent(await response.json())
  }

  if (profile.type === "gemini") {
    const response = await fetch(`${profile.baseUrl}/models/${profile.model}:generateContent`, {
      method: "POST",
      headers: buildHeaders(profile, apiKey),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: profile.temperature ?? 0.2,
          maxOutputTokens: profile.maxTokens ?? 2200,
        },
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`)
    }

    return extractGeminiContent(await response.json())
  }

  const baseUrl = String(profile.baseUrl || "").replace(/\/$/, "")
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: buildHeaders(profile, apiKey),
    body: JSON.stringify({
      model: profile.model,
      messages: [{ role: "user", content: prompt }],
      temperature: profile.temperature ?? 0.2,
      metadata: {
        runRole: context.role || "",
        runStage: context.stage || "",
        runId: context.runId || "",
      },
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed: ${response.status} ${await response.text()}`)
  }

  return extractOpenAIContent(await response.json())
}

module.exports = {
  generateText,
  listProfiles,
  listPresets,
  resolveProfiles,
}
