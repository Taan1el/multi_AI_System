const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const app = express();
const port = Number(process.env.PORT) || 3000;

const appRoot = __dirname;
const publicDir = path.join(appRoot, "public");
const dataDir = path.join(appRoot, "data");
const dataFile = path.join(dataDir, "prompts.json");

const seedPrompts = [
  {
    id: randomUUID(),
    title: "Architecture Outline",
    tags: ["architecture", "planning"],
    content:
      "Design the system structure for this feature. Include components, data flow, risks, and the smallest useful task breakdown for implementation.",
    notes: "Good starting point for Claude or Flow Architect.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: randomUUID(),
    title: "Bug Reproduction Brief",
    tags: ["debug", "qa"],
    content:
      "Investigate this issue step by step. Reproduce it, isolate the likely cause, explain the failure clearly, and propose the smallest safe fix.",
    notes: "Useful for Flow Debug sessions.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: randomUUID(),
    title: "Implementation Sprint Prompt",
    tags: ["coding", "execution"],
    content:
      "Implement the next tasks from the backlog. Keep changes organized, explain assumptions briefly, and validate the behavior before wrapping up.",
    notes: "Useful handoff prompt for Codex or Flow Code.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

let writeQueue = Promise.resolve();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

function parseTags(input) {
  if (Array.isArray(input)) {
    return [...new Set(input.map((tag) => String(tag).trim()).filter(Boolean))];
  }

  if (typeof input === "string") {
    return [
      ...new Set(
        input
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
  }

  return [];
}

function normalizeDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizePrompt(prompt) {
  return {
    id: typeof prompt.id === "string" && prompt.id.trim() ? prompt.id : randomUUID(),
    title: typeof prompt.title === "string" ? prompt.title.trim() : "",
    content: typeof prompt.content === "string" ? prompt.content.trim() : "",
    notes: typeof prompt.notes === "string" ? prompt.notes.trim() : "",
    tags: parseTags(prompt.tags),
    createdAt: normalizeDate(prompt.createdAt),
    updatedAt: normalizeDate(prompt.updatedAt),
  };
}

function sortPrompts(prompts) {
  return [...prompts].sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

async function ensureDataFile() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(
      dataFile,
      JSON.stringify({ prompts: seedPrompts }, null, 2),
      "utf8",
    );
  }
}

async function readStore() {
  await ensureDataFile();

  try {
    const raw = await fs.readFile(dataFile, "utf8");
    const parsed = JSON.parse(raw);
    const prompts = Array.isArray(parsed.prompts)
      ? parsed.prompts.map(normalizePrompt).filter((prompt) => prompt.title && prompt.content)
      : [];

    return { prompts: sortPrompts(prompts) };
  } catch {
    const fallback = { prompts: seedPrompts };
    await fs.writeFile(dataFile, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

function writeStore(nextStore) {
  writeQueue = writeQueue.then(() => {
    return fs.writeFile(dataFile, JSON.stringify(nextStore, null, 2), "utf8");
  });

  return writeQueue;
}

function validatePromptPayload(payload) {
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const content = typeof payload.content === "string" ? payload.content.trim() : "";

  if (!title) {
    return { ok: false, message: "Title is required." };
  }

  if (!content) {
    return { ok: false, message: "Prompt text is required." };
  }

  return {
    ok: true,
    value: {
      title,
      content,
      notes: typeof payload.notes === "string" ? payload.notes.trim() : "",
      tags: parseTags(payload.tags),
    },
  };
}

app.get("/api/prompts", async (_request, response, next) => {
  try {
    const store = await readStore();
    response.json(store);
  } catch (error) {
    next(error);
  }
});

app.post("/api/prompts", async (request, response, next) => {
  try {
    const validation = validatePromptPayload(request.body);

    if (!validation.ok) {
      response.status(400).json({ message: validation.message });
      return;
    }

    const store = await readStore();
    const now = new Date().toISOString();
    const prompt = {
      id: randomUUID(),
      ...validation.value,
      createdAt: now,
      updatedAt: now,
    };

    const nextStore = {
      prompts: sortPrompts([prompt, ...store.prompts]),
    };

    await writeStore(nextStore);
    response.status(201).json({ prompt, prompts: nextStore.prompts });
  } catch (error) {
    next(error);
  }
});

app.put("/api/prompts/:id", async (request, response, next) => {
  try {
    const validation = validatePromptPayload(request.body);

    if (!validation.ok) {
      response.status(400).json({ message: validation.message });
      return;
    }

    const store = await readStore();
    const existingPrompt = store.prompts.find((prompt) => prompt.id === request.params.id);

    if (!existingPrompt) {
      response.status(404).json({ message: "Prompt not found." });
      return;
    }

    const updatedPrompt = {
      ...existingPrompt,
      ...validation.value,
      updatedAt: new Date().toISOString(),
    };

    const nextStore = {
      prompts: sortPrompts(
        store.prompts.map((prompt) => {
          return prompt.id === request.params.id ? updatedPrompt : prompt;
        }),
      ),
    };

    await writeStore(nextStore);
    response.json({ prompt: updatedPrompt, prompts: nextStore.prompts });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/prompts/:id", async (request, response, next) => {
  try {
    const store = await readStore();
    const nextPrompts = store.prompts.filter((prompt) => prompt.id !== request.params.id);

    if (nextPrompts.length === store.prompts.length) {
      response.status(404).json({ message: "Prompt not found." });
      return;
    }

    const nextStore = {
      prompts: sortPrompts(nextPrompts),
    };

    await writeStore(nextStore);
    response.json({ prompts: nextStore.prompts });
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ message: "Something went wrong while handling the prompt library." });
});

app.listen(port, async () => {
  await ensureDataFile();
  console.log(`Prompt Library is running at http://localhost:${port}`);
});
