const state = {
  prompts: [],
  selectedId: null,
  searchTerm: "",
  activeTag: "all",
};

const elements = {
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  contentInput: document.querySelector("#contentInput"),
  deleteButton: document.querySelector("#deleteButton"),
  editorHeading: document.querySelector("#editorHeading"),
  newPromptButton: document.querySelector("#newPromptButton"),
  notesInput: document.querySelector("#notesInput"),
  promptCount: document.querySelector("#promptCount"),
  promptForm: document.querySelector("#promptForm"),
  promptItemTemplate: document.querySelector("#promptItemTemplate"),
  promptList: document.querySelector("#promptList"),
  resetButton: document.querySelector("#resetButton"),
  saveButton: document.querySelector("#saveButton"),
  searchInput: document.querySelector("#searchInput"),
  selectionMeta: document.querySelector("#selectionMeta"),
  statusMessage: document.querySelector("#statusMessage"),
  tagFilters: document.querySelector("#tagFilters"),
  tagsInput: document.querySelector("#tagsInput"),
  titleInput: document.querySelector("#titleInput"),
  updatedMeta: document.querySelector("#updatedMeta"),
};

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "Not saved yet";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function parseTags(value) {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}

function getSelectedPrompt() {
  return state.prompts.find((prompt) => prompt.id === state.selectedId) ?? null;
}

function getFilteredPrompts() {
  const query = state.searchTerm.trim().toLowerCase();

  return state.prompts.filter((prompt) => {
    const matchesTag = state.activeTag === "all" || prompt.tags.includes(state.activeTag);
    const haystack = [prompt.title, prompt.content, prompt.notes, prompt.tags.join(" ")]
      .join(" ")
      .toLowerCase();
    const matchesSearch = !query || haystack.includes(query);
    return matchesTag && matchesSearch;
  });
}

function getAllTags() {
  return [...new Set(state.prompts.flatMap((prompt) => prompt.tags))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function setStatus(message, isError = false) {
  elements.statusMessage.textContent = message;
  elements.statusMessage.style.color = isError ? "var(--danger)" : "var(--text)";
}

function syncSelection() {
  const filteredPrompts = getFilteredPrompts();
  const selectedPrompt = getSelectedPrompt();

  if (selectedPrompt && filteredPrompts.some((prompt) => prompt.id === selectedPrompt.id)) {
    return;
  }

  if (filteredPrompts.length > 0) {
    state.selectedId = filteredPrompts[0].id;
    populateForm(filteredPrompts[0]);
    return;
  }

  state.selectedId = null;
  populateForm(null);
}

function populateForm(prompt) {
  if (!prompt) {
    elements.promptForm.reset();
    elements.editorHeading.textContent = "Create a new prompt";
    elements.selectionMeta.textContent = "New draft";
    elements.updatedMeta.textContent = "Not saved yet";
    elements.deleteButton.disabled = true;
    elements.saveButton.textContent = "Save prompt";
    return;
  }

  elements.titleInput.value = prompt.title;
  elements.tagsInput.value = prompt.tags.join(", ");
  elements.contentInput.value = prompt.content;
  elements.notesInput.value = prompt.notes;
  elements.editorHeading.textContent = prompt.title;
  elements.selectionMeta.textContent = `Editing ${prompt.tags.length} tag${prompt.tags.length === 1 ? "" : "s"}`;
  elements.updatedMeta.textContent = formatDate(prompt.updatedAt);
  elements.deleteButton.disabled = false;
  elements.saveButton.textContent = "Update prompt";
}

function renderTagFilters() {
  const tags = getAllTags();
  const options = ["all", ...tags];

  elements.tagFilters.innerHTML = options
    .map((tag) => {
      const isActive = state.activeTag === tag;
      const label = tag === "all" ? "All tags" : tag;
      return `
        <button class="tag-pill${isActive ? " active" : ""}" type="button" data-tag="${escapeHtml(tag)}">
          ${escapeHtml(label)}
        </button>
      `;
    })
    .join("");
}

function renderPromptList() {
  const prompts = getFilteredPrompts();
  elements.promptCount.textContent = `${prompts.length} prompt${prompts.length === 1 ? "" : "s"}`;

  if (prompts.length === 0) {
    elements.promptList.innerHTML = `
      <div class="empty-state">
        <span>No prompts found</span>
        <p>Adjust the search, clear the tag filter, or create a fresh prompt.</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  prompts.forEach((prompt) => {
    const item = elements.promptItemTemplate.content.firstElementChild.cloneNode(true);
    item.dataset.id = prompt.id;

    if (prompt.id === state.selectedId) {
      item.classList.add("active");
    }

    item.querySelector(".prompt-title").textContent = prompt.title;
    item.querySelector(".prompt-date").textContent = formatDate(prompt.updatedAt);
    item.querySelector(".prompt-preview").textContent = prompt.content;
    item.querySelector(".prompt-tags").innerHTML = prompt.tags
      .map((tag) => `<span class="tag-pill">${escapeHtml(tag)}</span>`)
      .join("");

    fragment.append(item);
  });

  elements.promptList.innerHTML = "";
  elements.promptList.append(fragment);
}

function render() {
  renderTagFilters();
  renderPromptList();
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...options,
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.message || "Request failed.");
  }

  return body;
}

async function loadPrompts() {
  setStatus("Loading prompts...");

  try {
    const data = await request("/api/prompts");
    state.prompts = data.prompts;
    syncSelection();
    render();
    setStatus("Prompt library ready.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

function resetEditor() {
  state.selectedId = null;
  populateForm(null);
  render();
  setStatus("Draft reset.");
}

elements.newPromptButton.addEventListener("click", () => {
  resetEditor();
});

elements.resetButton.addEventListener("click", () => {
  populateForm(getSelectedPrompt());
  setStatus("Editor reset to the current selection.");
});

elements.clearFiltersButton.addEventListener("click", () => {
  state.searchTerm = "";
  state.activeTag = "all";
  elements.searchInput.value = "";
  syncSelection();
  render();
  setStatus("Filters cleared.");
});

elements.searchInput.addEventListener("input", (event) => {
  state.searchTerm = event.target.value;
  syncSelection();
  render();
});

elements.tagFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tag]");

  if (!button) {
    return;
  }

  state.activeTag = button.dataset.tag;
  syncSelection();
  render();
});

elements.promptList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");

  if (!button) {
    return;
  }

  state.selectedId = button.dataset.id;
  populateForm(getSelectedPrompt());
  render();
  setStatus("Prompt selected.");
});

elements.promptForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    title: elements.titleInput.value,
    tags: parseTags(elements.tagsInput.value),
    content: elements.contentInput.value,
    notes: elements.notesInput.value,
  };

  const selectedPrompt = getSelectedPrompt();
  const isUpdate = Boolean(selectedPrompt);

  setStatus(isUpdate ? "Updating prompt..." : "Saving prompt...");

  try {
    const data = await request(isUpdate ? `/api/prompts/${selectedPrompt.id}` : "/api/prompts", {
      method: isUpdate ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });

    state.prompts = data.prompts;
    state.selectedId = data.prompt.id;
    populateForm(data.prompt);
    render();
    setStatus(isUpdate ? "Prompt updated." : "Prompt created.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

elements.deleteButton.addEventListener("click", async () => {
  const selectedPrompt = getSelectedPrompt();

  if (!selectedPrompt) {
    return;
  }

  const confirmed = window.confirm(`Delete "${selectedPrompt.title}"?`);

  if (!confirmed) {
    return;
  }

  setStatus("Deleting prompt...");

  try {
    const data = await request(`/api/prompts/${selectedPrompt.id}`, {
      method: "DELETE",
    });

    state.prompts = data.prompts;
    state.selectedId = null;
    syncSelection();
    render();
    setStatus("Prompt deleted.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

loadPrompts();
