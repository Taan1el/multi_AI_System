const state = {
  config: null,
  runs: [],
  selectedRunId: null,
  selectedRun: null,
  artifactKey: "",
  eventSource: null,
}

const elements = {
  artifactSelect: document.querySelector("#artifactSelect"),
  artifactViewer: document.querySelector("#artifactViewer"),
  architectOverrideSelect: document.querySelector("#architectOverrideSelect"),
  clearRunFormButton: document.querySelector("#clearRunFormButton"),
  codeOverrideSelect: document.querySelector("#codeOverrideSelect"),
  dashboardStatusMessage: document.querySelector("#dashboardStatusMessage"),
  logList: document.querySelector("#logList"),
  managerOverrideSelect: document.querySelector("#managerOverrideSelect"),
  orchestratorForm: document.querySelector("#orchestratorForm"),
  orchestratorPromptInput: document.querySelector("#orchestratorPromptInput"),
  presetMeta: document.querySelector("#presetMeta"),
  presetSelect: document.querySelector("#presetSelect"),
  profileMeta: document.querySelector("#profileMeta"),
  referenceUrlsInput: document.querySelector("#referenceUrlsInput"),
  refreshRunsButton: document.querySelector("#refreshRunsButton"),
  reviewOverrideSelect: document.querySelector("#reviewOverrideSelect"),
  runCount: document.querySelector("#runCount"),
  runHeading: document.querySelector("#runHeading"),
  runList: document.querySelector("#runList"),
  runPresetMeta: document.querySelector("#runPresetMeta"),
  runProfilesMeta: document.querySelector("#runProfilesMeta"),
  runStatusPill: document.querySelector("#runStatusPill"),
  runUpdatedMeta: document.querySelector("#runUpdatedMeta"),
  stageGrid: document.querySelector("#stageGrid"),
  startRunButton: document.querySelector("#startRunButton"),
  webSearchInput: document.querySelector("#webSearchInput"),
  workspaceSyncInput: document.querySelector("#workspaceSyncInput"),
}

function setStatus(message, isError = false) {
  elements.dashboardStatusMessage.textContent = message
  elements.dashboardStatusMessage.style.color = isError ? "var(--danger)" : "var(--text)"
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  })

  const text = await response.text()
  const body = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(body.message || "Request failed.")
  }

  return body
}

function formatDate(value) {
  if (!value) {
    return "Unknown"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "Unknown"
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function closeRunStream() {
  if (state.eventSource) {
    state.eventSource.close()
    state.eventSource = null
  }
}

function createOption(value, label, { selected = false } = {}) {
  const option = document.createElement("option")
  option.value = value
  option.textContent = label
  option.selected = selected
  return option
}

function renderOverrideOptions(selectElement) {
  const options = [createOption("", "Auto from preset")]

  for (const profile of state.config?.profiles || []) {
    const availability = profile.available ? "" : " (unavailable)"
    options.push(
      createOption(profile.name, `${profile.label} | ${profile.model}${availability}`),
    )
  }

  selectElement.replaceChildren(...options)
}

function renderConfig() {
  if (!state.config) {
    return
  }

  elements.presetSelect.replaceChildren(
    ...state.config.presets.map((preset) => createOption(preset.name, preset.label)),
  )

  renderOverrideOptions(elements.managerOverrideSelect)
  renderOverrideOptions(elements.architectOverrideSelect)
  renderOverrideOptions(elements.codeOverrideSelect)
  renderOverrideOptions(elements.reviewOverrideSelect)

  const availableProfiles = state.config.profiles.filter((profile) => profile.available)
  const searchReady = state.config.profiles.some((profile) => profile.capabilities?.search)
  elements.presetMeta.textContent = state.config.presets.map((preset) => preset.label).join(", ")
  elements.profileMeta.textContent = `${availableProfiles.length}/${state.config.profiles.length} ready | search ${searchReady ? "available" : "disabled"}`
  elements.webSearchInput.disabled = !searchReady
  elements.webSearchInput.title = searchReady
    ? "Use Ollama web search and web fetch augmentation."
    : "Set OLLAMA_API_KEY and enable webSearch in multi-ai.config.json to use this option."

  if (!searchReady) {
    elements.webSearchInput.checked = false
  }
}

function statusClassName(status) {
  const token = String(status || "idle")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  return `status-${token || "idle"}`
}

function createStatusPill(status) {
  const pill = document.createElement("span")
  pill.className = `status-pill small ${statusClassName(status)}`
  pill.textContent = status
  return pill
}

function createEmptyState(label, message = "") {
  const emptyState = document.createElement("div")
  emptyState.className = "empty-state"

  const labelElement = document.createElement("span")
  labelElement.textContent = label
  emptyState.append(labelElement)

  if (message) {
    const messageElement = document.createElement("p")
    messageElement.textContent = message
    emptyState.append(messageElement)
  }

  return emptyState
}

function createDetailRow(label, value) {
  const row = document.createElement("p")

  const labelElement = document.createElement("span")
  labelElement.className = "detail-label"
  labelElement.textContent = label

  row.append(labelElement, document.createTextNode(value))
  return row
}

function renderRunList() {
  elements.runCount.textContent = `${state.runs.length} run${state.runs.length === 1 ? "" : "s"}`

  if (state.runs.length === 0) {
    elements.runList.replaceChildren(createEmptyState("No runs yet", "Start a run from the launch panel to see it here."))
    return
  }

  const fragment = document.createDocumentFragment()

  state.runs.forEach((run) => {
    const item = document.createElement("button")
    item.className = `run-item${run.id === state.selectedRunId ? " active" : ""}`
    item.type = "button"
    item.dataset.runId = run.id

    const top = document.createElement("div")
    top.className = "run-item-top"

    const title = document.createElement("strong")
    title.textContent = run.title

    top.append(title, createStatusPill(run.status))

    const meta = document.createElement("p")
    meta.className = "run-item-meta"
    meta.textContent = `${run.preset} | ${formatDate(run.updatedAt)}`

    item.append(top, meta)
    fragment.append(item)
  })

  elements.runList.replaceChildren(fragment)
}

function renderStages(run) {
  const stages = Object.values(run.stageStates || {})

  if (stages.length === 0) {
    elements.stageGrid.replaceChildren(createEmptyState("No stages"))
    return
  }

  const fragment = document.createDocumentFragment()

  stages.forEach((stage) => {
    const card = document.createElement("article")
    card.className = `stage-card ${statusClassName(stage.status)}`

    const top = document.createElement("div")
    top.className = "stage-card-top"

    const label = document.createElement("strong")
    label.textContent = stage.label

    top.append(label, createStatusPill(stage.status))
    card.append(
      top,
      createDetailRow("Role", stage.role),
      createDetailRow("Profile", stage.profile || "Auto"),
      createDetailRow("Started", formatDate(stage.startedAt)),
      createDetailRow("Finished", formatDate(stage.completedAt)),
      createDetailRow("Error", stage.error || "None"),
    )

    fragment.append(card)
  })

  elements.stageGrid.replaceChildren(fragment)
}

function renderArtifacts(run) {
  const artifacts = run.artifacts || {}
  const keys = Object.keys(artifacts)

  if (keys.length === 0) {
    elements.artifactSelect.replaceChildren(createOption("", "Choose an artifact"))
    elements.artifactViewer.textContent = "Artifacts will appear here when the run progresses."
    return
  }

  const currentKey = keys.includes(state.artifactKey) ? state.artifactKey : keys[0]
  state.artifactKey = currentKey
  elements.artifactSelect.replaceChildren(
    ...keys.map((key) =>
      createOption(key, artifacts[key].relativePath, {
        selected: key === currentKey,
      }),
    ),
  )

  const artifact = artifacts[currentKey]
  elements.artifactViewer.textContent =
    typeof artifact.content === "string" ? artifact.content : JSON.stringify(artifact.content, null, 2)
}

function renderLogs(run) {
  const logs = [...(run.logs || [])].reverse()

  if (logs.length === 0) {
    elements.logList.replaceChildren(createEmptyState("No logs yet"))
    return
  }

  const fragment = document.createDocumentFragment()

  logs.forEach((entry) => {
    const item = document.createElement("article")
    item.className = `log-item ${entry.level === "error" ? "error" : ""}`

    const top = document.createElement("div")
    top.className = "prompt-item-top"

    const level = document.createElement("span")
    level.className = "detail-label"
    level.textContent = entry.level

    const timestamp = document.createElement("span")
    timestamp.className = "prompt-date"
    timestamp.textContent = formatDate(entry.timestamp)

    const message = document.createElement("p")
    message.textContent = entry.message

    top.append(level, timestamp)
    item.append(top, message)
    fragment.append(item)
  })

  elements.logList.replaceChildren(fragment)
}

function renderSelectedRun() {
  const run = state.selectedRun

  if (!run) {
    elements.runHeading.textContent = "Select a run"
    elements.runStatusPill.textContent = "Idle"
    elements.runStatusPill.className = "status-pill"
    elements.runPresetMeta.textContent = "-"
    elements.runProfilesMeta.textContent = "-"
    elements.runUpdatedMeta.textContent = "-"
    elements.stageGrid.replaceChildren()
    elements.artifactSelect.replaceChildren(createOption("", "Choose an artifact"))
    elements.artifactViewer.textContent = "No run selected."
    elements.logList.replaceChildren()
    return
  }

  elements.runHeading.textContent = run.title
  elements.runStatusPill.textContent = run.status
  elements.runStatusPill.className = `status-pill ${statusClassName(run.status)}`
  elements.runPresetMeta.textContent = run.preset
  elements.runProfilesMeta.textContent = Object.entries(run.selectedProfiles || {})
    .map(([role, profile]) => `${role}:${profile}`)
    .join(" | ") || "Pending profile resolution"
  elements.runUpdatedMeta.textContent = formatDate(run.updatedAt)

  renderStages(run)
  renderArtifacts(run)
  renderLogs(run)
}

function upsertRun(run) {
  const nextRuns = [run, ...state.runs.filter((entry) => entry.id !== run.id)]
  state.runs = nextRuns.sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  })
  renderRunList()
}

async function loadRun(runId, preserveArtifact = false) {
  const { run } = await request(`/api/orchestrator/runs/${runId}`)
  state.selectedRunId = run.id
  state.selectedRun = run

  if (!preserveArtifact) {
    state.artifactKey = ""
  }

  upsertRun(run)
  renderSelectedRun()

  if (run.status === "queued" || run.status === "running") {
    openRunStream(run.id)
  } else {
    closeRunStream()
  }
}

function openRunStream(runId) {
  closeRunStream()
  state.eventSource = new EventSource(`/api/orchestrator/runs/${runId}/events`)

  state.eventSource.onmessage = async (event) => {
    const payload = JSON.parse(event.data)

    if (!payload.run) {
      return
    }

    upsertRun(payload.run)

    if (payload.run.id === state.selectedRunId) {
      if (payload.run.status === "completed" || payload.run.status === "failed") {
        await loadRun(payload.run.id, true)
        closeRunStream()
      } else {
        state.selectedRun = {
          ...state.selectedRun,
          ...payload.run,
        }
        renderSelectedRun()
      }
    }
  }

  state.eventSource.onerror = () => {
    setStatus("Live updates disconnected. Refreshing the run list may restore the view.", true)
  }
}

async function loadRuns() {
  const { runs } = await request("/api/orchestrator/runs")
  state.runs = runs
  renderRunList()

  if (!state.selectedRunId && runs.length > 0) {
    await loadRun(runs[0].id)
  }
}

async function loadConfig() {
  const configResponse = await request("/api/orchestrator/config")
  state.config = configResponse
  renderConfig()
}

function buildRoleOverridesPayload() {
  return {
    manager: elements.managerOverrideSelect.value,
    architect: elements.architectOverrideSelect.value,
    code: elements.codeOverrideSelect.value,
    review: elements.reviewOverrideSelect.value,
  }
}

function clearForm() {
  elements.orchestratorPromptInput.value = ""
  elements.referenceUrlsInput.value = ""
  elements.webSearchInput.checked = false
  elements.workspaceSyncInput.checked = true
  elements.presetSelect.value = "local"
  elements.managerOverrideSelect.value = ""
  elements.architectOverrideSelect.value = ""
  elements.codeOverrideSelect.value = ""
  elements.reviewOverrideSelect.value = ""
  setStatus("Run form cleared.")
}

elements.clearRunFormButton.addEventListener("click", () => {
  clearForm()
})

elements.refreshRunsButton.addEventListener("click", async () => {
  setStatus("Refreshing run history...")

  try {
    await loadRuns()
    setStatus("Run history refreshed.")
  } catch (error) {
    setStatus(error.message, true)
  }
})

elements.runList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-run-id]")

  if (!button) {
    return
  }

  setStatus("Loading run details...")

  try {
    await loadRun(button.dataset.runId)
    setStatus("Run loaded.")
  } catch (error) {
    setStatus(error.message, true)
  }
})

elements.artifactSelect.addEventListener("change", () => {
  state.artifactKey = elements.artifactSelect.value
  renderArtifacts(state.selectedRun || {})
})

elements.orchestratorForm.addEventListener("submit", async (event) => {
  event.preventDefault()

  const prompt = elements.orchestratorPromptInput.value.trim()
  if (!prompt) {
    setStatus("Prompt is required.", true)
    return
  }

  elements.startRunButton.disabled = true
  setStatus("Starting run...")

  try {
    const { run } = await request("/api/orchestrator/runs", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        preset: elements.presetSelect.value,
        workspaceSync: elements.workspaceSyncInput.checked,
        enableWebSearch: elements.webSearchInput.checked,
        referenceUrls: elements.referenceUrlsInput.value,
        roleOverrides: buildRoleOverridesPayload(),
      }),
    })

    upsertRun(run)
    await loadRun(run.id)
    setStatus("Run queued.")
  } catch (error) {
    setStatus(error.message, true)
  } finally {
    elements.startRunButton.disabled = false
  }
})

async function boot() {
  setStatus("Loading orchestrator...")

  try {
    await loadConfig()
    await loadRuns()
    renderSelectedRun()
    setStatus("Orchestrator ready.")
  } catch (error) {
    setStatus(error.message, true)
  }
}

window.addEventListener("beforeunload", () => {
  closeRunStream()
})

boot()
