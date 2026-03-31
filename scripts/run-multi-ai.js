#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(repoRoot, "output", "multi-ai-runs");
const defaultOllamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";

const roleConfig = {
  manager: {
    profile: "Local Manager",
    model: "deepseek-r1:1.5b-qwen-distill-q8_0",
  },
  architect: {
    profile: "Local Research",
    model: "gemma3:4b",
  },
  code: {
    profile: "Local Code",
    model: "qwen2.5-coder:7b",
  },
  review: {
    profile: "Local Research",
    model: "gemma3:4b",
  },
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    prompt: "",
    promptFile: "",
    workspaceSync: true,
    ollamaBaseUrl: defaultOllamaBaseUrl,
  };
  const promptParts = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (current === "--prompt" && args[index + 1]) {
      options.prompt = args[index + 1];
      index += 1;
      continue;
    }

    if (current.startsWith("--prompt=")) {
      options.prompt = current.slice("--prompt=".length);
      continue;
    }

    if (current === "--prompt-file" && args[index + 1]) {
      options.promptFile = args[index + 1];
      index += 1;
      continue;
    }

    if (current.startsWith("--prompt-file=")) {
      options.promptFile = current.slice("--prompt-file=".length);
      continue;
    }

    if (current === "--no-workspace-sync") {
      options.workspaceSync = false;
      continue;
    }

    if (current === "--ollama-base-url" && args[index + 1]) {
      options.ollamaBaseUrl = args[index + 1];
      index += 1;
      continue;
    }

    if (current.startsWith("--ollama-base-url=")) {
      options.ollamaBaseUrl = current.slice("--ollama-base-url=".length);
      continue;
    }

    promptParts.push(current);
  }

  if (!options.prompt && promptParts.length > 0) {
    options.prompt = promptParts.join(" ").trim();
  }

  return options;
}

function timestampForPath(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "run";
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function readPrompt(options) {
  if (options.promptFile) {
    const filePath = path.resolve(repoRoot, options.promptFile);
    return (await fs.readFile(filePath, "utf8")).trim();
  }

  return options.prompt.trim();
}

function getOllamaExecutable() {
  const envOverride = process.env.OLLAMA_PATH;
  if (envOverride) {
    return envOverride;
  }

  const localAppData = process.env.LOCALAPPDATA || "";
  const installedExe = path.join(localAppData, "Programs", "Ollama", "ollama.exe");
  if (localAppData && require("fs").existsSync(installedExe)) {
    return installedExe;
  }

  return "ollama";
}

async function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function isOllamaReady(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureOllamaReady(baseUrl) {
  if (await isOllamaReady(baseUrl)) {
    return;
  }

  const executable = getOllamaExecutable();

  try {
    const child = spawn(executable, ["serve"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    throw new Error(
      `Ollama is not reachable at ${baseUrl} and could not be started automatically: ${error.message}`
    );
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(1500);
    if (await isOllamaReady(baseUrl)) {
      return;
    }
  }

  throw new Error(
    `Ollama did not become ready at ${baseUrl}. Run "npm run setup:ollama" or launch the Ollama app first.`
  );
}

async function ollamaGenerate({ baseUrl, model, prompt }) {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama request failed for ${model}: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  return String(payload.response || "").trim();
}

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonCandidate(text) {
  const cleaned = stripCodeFences(text);

  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    return cleaned;
  }

  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    return cleaned.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    return cleaned.slice(arrayStart, arrayEnd + 1);
  }

  return cleaned;
}

function parseJsonOutput(text) {
  const candidate = extractJsonCandidate(text);
  return JSON.parse(candidate);
}

async function generateJson({ baseUrl, model, prompt, name }) {
  const firstPass = await ollamaGenerate({ baseUrl, model, prompt });

  try {
    return {
      raw: firstPass,
      parsed: parseJsonOutput(firstPass),
    };
  } catch {
    const repairPrompt = [
      "Convert the following text into valid JSON only.",
      "Do not add commentary. Do not add markdown fences.",
      "",
      `Original text for ${name}:`,
      firstPass,
    ].join("\n");

    const repaired = await ollamaGenerate({ baseUrl, model, prompt: repairPrompt });

    return {
      raw: repaired,
      parsed: parseJsonOutput(repaired),
    };
  }
}

function normalizeMarkdownArtifact(text, primaryTitle) {
  const cleaned = stripCodeFences(text);
  const titleIndex = cleaned.toLowerCase().indexOf(primaryTitle.toLowerCase());
  const titled = titleIndex === -1 ? cleaned : cleaned.slice(titleIndex);
  const secondHeadingMatch = titled.slice(primaryTitle.length).match(/\n# (?!#)/);

  if (!secondHeadingMatch) {
    return titled.trim();
  }

  const cutIndex = primaryTitle.length + secondHeadingMatch.index;
  return titled.slice(0, cutIndex).trim();
}

function hasPlaceholderText(value) {
  if (!value) {
    return true;
  }

  const normalized = String(value).trim().toLowerCase();
  const patterns = [
    "task title",
    "description of task",
    "file",
    "outcome",
    "open question or empty if none",
    "constraint",
    "criterion",
  ];

  return patterns.some((pattern) => normalized === pattern || normalized.includes(pattern));
}

function validateManagerBrief(payload) {
  const issues = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    issues.push("The payload must be a JSON object.");
    return issues;
  }

  if (hasPlaceholderText(payload.title) || String(payload.title || "").length < 6) {
    issues.push("title must be specific and non-placeholder.");
  }

  if (hasPlaceholderText(payload.objective) || String(payload.objective || "").length < 12) {
    issues.push("objective must be specific and non-placeholder.");
  }

  if (!Array.isArray(payload.workstreams) || payload.workstreams.length < 2) {
    issues.push("workstreams must contain at least two concrete items.");
  }

  for (const workstream of payload.workstreams || []) {
    if (hasPlaceholderText(workstream) || String(workstream || "").length < 6) {
      issues.push("workstreams must not use placeholder text.");
      break;
    }
  }

  return issues;
}

function validateTasksPayload(payload) {
  const issues = [];
  const allowedOwners = new Set(["Local Manager", "Local Research", "Local Code"]);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    issues.push("The payload must be a JSON object.");
    return issues;
  }

  if (!Array.isArray(payload.tasks) || payload.tasks.length < 3) {
    issues.push("tasks must contain at least three concrete tasks.");
    return issues;
  }

  const taskIds = new Set(payload.tasks.map((task) => task.id));

  payload.tasks.forEach((task, index) => {
    if (!/^task-\d{3}$/.test(String(task.id || ""))) {
      issues.push(`task ${index + 1} has an invalid id.`);
    }

    if (hasPlaceholderText(task.title) || String(task.title || "").length < 8) {
      issues.push(`task ${index + 1} has a placeholder title.`);
    }

    if (!allowedOwners.has(task.owner)) {
      issues.push(`task ${index + 1} owner must be exactly one allowed owner.`);
    }

    if (task.status !== "pending") {
      issues.push(`task ${index + 1} status must be pending.`);
    }

    if (!Array.isArray(task.dependsOn)) {
      issues.push(`task ${index + 1} dependsOn must be an array.`);
    } else {
      for (const dependency of task.dependsOn) {
        if (!taskIds.has(dependency)) {
          issues.push(`task ${index + 1} dependsOn references missing task ${dependency}.`);
        }
      }
    }

    if (!Array.isArray(task.deliverables) || task.deliverables.length === 0) {
      issues.push(`task ${index + 1} must include at least one deliverable.`);
    } else if (task.deliverables.some((entry) => hasPlaceholderText(entry) || String(entry).length < 4)) {
      issues.push(`task ${index + 1} has placeholder deliverables.`);
    }

    if (hasPlaceholderText(task.notes) || String(task.notes || "").length < 10) {
      issues.push(`task ${index + 1} notes must be concrete.`);
    }
  });

  return issues;
}

async function generateValidatedJson({
  baseUrl,
  model,
  initialPrompt,
  name,
  validator,
  repairPromptBuilder,
  fallbackModel,
}) {
  let prompt = initialPrompt;
  let lastRaw = "";
  let lastIssues = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { raw, parsed } = await generateJson({
      baseUrl,
      model,
      prompt,
      name,
    });
    lastRaw = raw;
    lastIssues = validator(parsed);

    if (lastIssues.length === 0) {
      return {
        raw,
        parsed,
      };
    }

    prompt = repairPromptBuilder({
      raw,
      issues: lastIssues,
    });
  }

  if (fallbackModel && fallbackModel !== model) {
    const fallbackPrompt = repairPromptBuilder({
      raw: lastRaw,
      issues: lastIssues,
    });
    const fallbackResult = await generateJson({
      baseUrl,
      model: fallbackModel,
      prompt: fallbackPrompt,
      name: `${name} fallback`,
    });
    const fallbackIssues = validator(fallbackResult.parsed);

    if (fallbackIssues.length === 0) {
      return fallbackResult;
    }

    lastIssues = fallbackIssues;
  }

  throw new Error(`Could not generate valid ${name}. Last issues: ${lastIssues.join("; ")}`);
}

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function buildSeedBrief(userPrompt) {
  return {
    title: truncate(userPrompt.replace(/\s+/g, " ").trim(), 90),
    objective: userPrompt.trim(),
    deliverable: "Generated planning, architecture, tasks, implementation handoff, and review artifacts for the requested work.",
    constraints: [
      "Prefer a practical local-first v1.",
      "Keep the output actionable for follow-up work in Roo.",
    ],
    successCriteria: [
      "The plan, architecture, tasks, implementation handoff, and review are consistent with each other.",
      "The generated tasks are concrete enough for Local Code to execute next.",
    ],
    workstreams: [
      "Planning and orchestration",
      "Architecture and design",
      "Implementation handoff",
      "Review and next-loop guidance",
    ],
    risks: [
      "Local model output can still need human verification before implementation.",
    ],
    questions: [],
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSection(markdown, heading) {
  const regex = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "im");
  const match = regex.exec(markdown);

  if (!match) {
    return "";
  }

  const sectionStart = match.index + match[0].length;
  const remainder = markdown.slice(sectionStart);
  const nextHeadingMatch = remainder.match(/\n## |\n# /);
  const sectionEnd = nextHeadingMatch ? sectionStart + nextHeadingMatch.index : markdown.length;
  return markdown.slice(sectionStart, sectionEnd).trim();
}

function extractListItems(markdownSection) {
  if (!markdownSection) {
    return [];
  }

  return markdownSection
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line))
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .map((line) =>
      line
        .replace(/^[\u2500-\u257F\s]+/, "")
        .replace(/`/g, "")
        .replace(/\*\*/g, "")
        .replace(/\s+#.*$/, "")
        .replace(/\s+-\s+.*$/, "")
        .replace(/\s*:\s+.*$/, "")
        .trim()
    )
    .filter(Boolean);
}

function taskOwnerFromText(value) {
  const normalized = value.toLowerCase();
  if (
    normalized.includes("plan") ||
    normalized.includes("scope") ||
    normalized.includes("architecture") ||
    normalized.includes("design") ||
    normalized.includes("review") ||
    normalized.includes("document")
  ) {
    return "Local Research";
  }

  if (normalized.includes("validate") || normalized.includes("test")) {
    return "Local Code";
  }

  return "Local Code";
}

function selectDeliverablesForStep(step, fileHints, fallback) {
  const normalizedStep = step.toLowerCase();
  const matches = fileHints.filter((entry) => {
    const normalizedEntry = entry.toLowerCase();
    return normalizedStep.split(/\W+/).some((token) => token.length > 3 && normalizedEntry.includes(token));
  });

  if (matches.length > 0) {
    return matches.slice(0, 3);
  }

  if (fileHints.length > 0) {
    return fileHints.slice(0, 2);
  }

  return fallback;
}

function makeTask(idNumber, title, owner, deliverables, notes, dependsOn = []) {
  return {
    id: `task-${String(idNumber).padStart(3, "0")}`,
    title,
    owner,
    status: "pending",
    dependsOn,
    deliverables,
    notes,
  };
}

function buildDeterministicTasks({ userPrompt, architectureMarkdown, implementationMarkdown }) {
  const fileHints = extractListItems(extractSection(implementationMarkdown, "Suggested File Changes"))
    .concat(extractListItems(extractSection(architectureMarkdown, "Files and Folders")))
    .slice(0, 8);
  const buildOrder = extractListItems(extractSection(implementationMarkdown, "Execution Order")).slice(0, 4);
  const fallbackBuildOrder = buildOrder.length > 0
    ? buildOrder
    : extractListItems(extractSection(architectureMarkdown, "Recommended Build Order")).slice(0, 4);
  const tasks = [];
  let taskNumber = 1;

  tasks.push(
    makeTask(
      taskNumber,
      "Confirm scope, constraints, and success criteria",
      "Local Manager",
      ["01_planning/plan.md"],
      `Use the generated plan as the working contract for: ${truncate(userPrompt, 120)}`,
      []
    )
  );
  taskNumber += 1;

  tasks.push(
    makeTask(
      taskNumber,
      "Lock the architecture and working structure",
      "Local Research",
      fileHints.length > 0 ? ["02_architecture/architecture.md", ...fileHints.slice(0, 2)] : ["02_architecture/architecture.md"],
      "Review the architecture before implementation starts and keep the folder strategy consistent.",
      ["task-001"]
    )
  );
  taskNumber += 1;

  if (fallbackBuildOrder.length > 0) {
    fallbackBuildOrder.forEach((step, index) => {
      const id = `task-${String(taskNumber - 1).padStart(3, "0")}`;
      const dependsOn = index === 0 ? ["task-002"] : [id];
      tasks.push(
        makeTask(
          taskNumber,
          truncate(step.replace(/[.:]+$/, ""), 80),
          taskOwnerFromText(step),
          selectDeliverablesForStep(step, fileHints, ["04_code/"]),
          `Execute this build-order step from the architecture: ${step}`,
          dependsOn
        )
      );
      taskNumber += 1;
    });
  } else {
    tasks.push(
      makeTask(
        taskNumber,
        "Implement the core feature set in 04_code",
        "Local Code",
        ["04_code/"],
        "Build the primary user flow and the core domain behavior first.",
        ["task-002"]
      )
    );
    taskNumber += 1;
    tasks.push(
      makeTask(
        taskNumber,
        "Add validation, safety checks, and supporting behavior",
        "Local Code",
        ["04_code/"],
        "Cover the non-happy-path behavior, configuration, and supporting logic.",
        [`task-${String(taskNumber - 1).padStart(3, "0")}`]
      )
    );
    taskNumber += 1;
  }

  const previousTaskId = tasks[tasks.length - 1].id;
  tasks.push(
    makeTask(
      taskNumber,
      "Review the implementation pass and capture the next loop",
      "Local Research",
      ["05_reviews/review.md", "memory-bank/activeContext.md"],
      "Summarize gaps, risks, and the next recommended iteration after the first pass.",
      [previousTaskId]
    )
  );

  return {
    tasks,
    meta: {
      source: "generated by run-multi-ai.js",
      orchestratorOwner: "Local Manager",
      architectureOwner: "Local Research",
      implementationOwner: "Local Code",
    },
  };
}

async function writeFile(targetPath, content) {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, content, "utf8");
}

async function snapshotWorkspace(runDir) {
  const trackedFiles = [
    "01_planning/plan.md",
    "02_architecture/architecture.md",
    "03_tasks/tasks.json",
    "05_reviews/review.md",
    "memory-bank/activeContext.md",
  ];

  for (const relativePath of trackedFiles) {
    const sourcePath = path.join(repoRoot, relativePath);
    if (!(await pathExists(sourcePath))) {
      continue;
    }
    const destinationPath = path.join(runDir, "workspace-before", relativePath);
    const fileContents = await fs.readFile(sourcePath, "utf8");
    await writeFile(destinationPath, fileContents);
  }
}

function buildManagerBriefPrompt(userPrompt) {
  return [
    "You are Local Manager in a local multi-model software workflow.",
    "Break the request into a concise orchestration brief.",
    "Return valid JSON only.",
    "Schema:",
    "{",
    '  "title": "short title",',
    '  "objective": "single sentence objective",',
    '  "deliverable": "what should exist when the work is done",',
    '  "constraints": ["constraint"],',
    '  "successCriteria": ["criterion"],',
    '  "workstreams": ["planning stream", "implementation stream"],',
    '  "risks": ["risk"],',
    '  "questions": ["open question or empty if none"]',
    "}",
    "Keep it practical and ready for planning, architecture, coding, and review handoffs.",
    "Never use placeholder text in any field.",
    "",
    "User request:",
    userPrompt,
  ].join("\n");
}

function buildPlanPrompt(userPrompt, managerBrief) {
  return [
    "You are Local Manager preparing 01_planning/plan.md for a RooFlow workspace.",
    "Write markdown only.",
    "Use these sections in this exact order:",
    "# Plan",
    "## Goal",
    "## Scope",
    "## Constraints",
    "## Success Criteria",
    "## Workstreams",
    "## Risks",
    "## Open Questions",
    "## Handoff",
    "Keep it actionable, direct, and specific to the user request.",
    "",
    "Manager brief JSON:",
    formatJson(managerBrief),
    "User request:",
    userPrompt,
  ].join("\n");
}

function buildArchitecturePrompt(userPrompt, managerBrief, planMarkdown) {
  return [
    "You are Local Research writing 02_architecture/architecture.md.",
    "Write markdown only.",
    "Use these sections in this exact order:",
    "# Architecture",
    "## Overview",
    "## System Shape",
    "## Data and State",
    "## Files and Folders",
    "## Model Collaboration",
    "## Risks and Mitigations",
    "## Recommended Build Order",
    "Focus on a practical implementation architecture that Local Code can execute.",
    "In Files and Folders, use bullet points with repo-relative paths first, then a short purpose.",
    "In Recommended Build Order, use action-oriented steps. Never list only bare filenames.",
    "",
    "User request:",
    userPrompt,
    "",
    "Manager brief JSON:",
    formatJson(managerBrief),
    "Plan markdown:",
    planMarkdown,
  ].join("\n");
}

function buildTasksPrompt(userPrompt, managerBrief, planMarkdown, architectureMarkdown) {
  return [
    "You are the task planner creating 03_tasks/tasks.json for a RooFlow workspace.",
    "Return valid JSON only.",
    "Schema:",
    "{",
    '  "tasks": [',
    "    {",
    '      "id": "task-001",',
    '      "title": "task title",',
    '      "owner": "Local Manager|Local Research|Local Code",',
    '      "status": "pending",',
    '      "dependsOn": ["task-000"],',
    '      "deliverables": ["file or outcome"],',
    '      "notes": "short execution note"',
    "    }",
    "  ],",
    '  "meta": {',
    '    "source": "generated by run-multi-ai.js",',
    '    "orchestratorOwner": "Local Manager",',
    '    "architectureOwner": "Local Research",',
    '    "implementationOwner": "Local Code"',
    "  }",
    "}",
    "Rules:",
    "- Create 5 to 10 tasks.",
    "- Use ids task-001, task-002, and so on.",
    "- Every task owner must be exactly one of: Local Manager, Local Research, Local Code.",
    "- Use status pending for all tasks.",
    "- Use dependsOn as an empty array when there is no dependency.",
    "- Keep deliverables concrete.",
    "- Never use placeholder text like Task Title, file, outcome, or Description of task.",
    "",
    "User request:",
    userPrompt,
    "",
    "Manager brief JSON:",
    formatJson(managerBrief),
    "Plan markdown:",
    planMarkdown,
    "",
    "Architecture markdown:",
    architectureMarkdown,
  ].join("\n");
}

function buildManagerBriefRepairPrompt(userPrompt, raw, issues) {
  return [
    "You are Local Manager repairing an invalid orchestration brief.",
    "Return valid JSON only.",
    "Rewrite the brief from scratch.",
    "Do not reuse placeholder text.",
    "",
    "User request:",
    userPrompt,
    "",
    "Problems to fix:",
    ...issues.map((issue) => `- ${issue}`),
    "",
    "Previous invalid JSON/text:",
    raw,
  ].join("\n");
}

function buildTasksRepairPrompt(userPrompt, planMarkdown, architectureMarkdown, raw, issues) {
  return [
    "You are the task planner repairing an invalid tasks.json response.",
    "Return valid JSON only and rewrite the tasks from scratch.",
    "Every task owner must be exactly one of: Local Manager, Local Research, Local Code.",
    "Never use placeholder text.",
    "",
    "User request:",
    userPrompt,
    "",
    "Plan markdown:",
    planMarkdown,
    "",
    "Architecture markdown:",
    architectureMarkdown,
    "",
    "Problems to fix:",
    ...issues.map((issue) => `- ${issue}`),
    "",
    "Previous invalid JSON/text:",
    raw,
  ].join("\n");
}

function buildImplementationPrompt(userPrompt, managerBrief, planMarkdown, architectureMarkdown) {
  return [
    "You are Local Code producing an implementation handoff for 04_code.",
    "Write markdown only.",
    "Do not write the actual application code yet.",
    "Create a practical implementation brief that another coding pass can execute quickly.",
    "Use these sections in this exact order:",
    "# Implementation",
    "## Build Strategy",
    "## Suggested File Changes",
    "## Execution Order",
    "## Shell Commands",
    "## Acceptance Checklist",
    "## Likely Blockers",
    "In Suggested File Changes, use repo-relative file or folder paths followed by a short purpose.",
    "In Execution Order, use action-oriented steps rather than bare filenames.",
    "",
    "User request:",
    userPrompt,
    "",
    "Manager brief JSON:",
    formatJson(managerBrief),
    "Plan markdown:",
    planMarkdown,
    "",
    "Architecture markdown:",
    architectureMarkdown,
  ].join("\n");
}

function buildReviewPrompt(userPrompt, managerBrief, planMarkdown, architectureMarkdown, tasksJson, implementationMarkdown) {
  return [
    "You are Local Research reviewing a multi-model planning pass.",
    "Write markdown only.",
    "Use these sections in this exact order:",
    "# Review",
    "## Findings",
    "## Gaps",
    "## Simpler Alternatives",
    "## Risks to Watch",
    "## Recommended Next Loop",
    "Prioritize practicality, maintainability, and correctness.",
    "",
    "User request:",
    userPrompt,
    "",
    "Manager brief JSON:",
    formatJson(managerBrief),
    "Plan markdown:",
    planMarkdown,
    "",
    "Architecture markdown:",
    architectureMarkdown,
    "",
    "Tasks JSON:",
    formatJson(tasksJson),
    "",
    "Implementation markdown:",
    implementationMarkdown,
  ].join("\n");
}

function buildSummaryMarkdown({ userPrompt, managerBrief, tasksJson, runRelativePath, workspaceSync }) {
  return [
    "# Summary",
    "",
    "## Task",
    userPrompt,
    "",
    "## Models Used",
    `- Local Manager: ${roleConfig.manager.model}`,
    `- Local Research: ${roleConfig.architect.model}`,
    `- Local Code: ${roleConfig.code.model}`,
    "",
    "## Outputs",
    `- Run directory: ${runRelativePath}`,
    `- Planning objective: ${managerBrief.objective || managerBrief.title || "See plan.md"}`,
    `- Task count: ${Array.isArray(tasksJson.tasks) ? tasksJson.tasks.length : 0}`,
    `- Workspace sync: ${workspaceSync ? "enabled" : "disabled"}`,
    "",
    "## Recommended Next Step",
    workspaceSync
      ? "Open this repo in Roo and start with Flow Orchestrator to inspect the generated plan, then move into Flow Code for implementation."
      : "Review the run folder output first. If it looks good, rerun without --no-workspace-sync or continue manually in Roo.",
    "",
    "## Continue in Roo",
    "1. Open the repository in VS Code.",
    "2. Start a new Roo chat.",
    "3. Begin in Flow Orchestrator or jump straight to Flow Code if the generated tasks are already clear.",
  ].join("\n");
}

function closeOpenCodeFence(markdown) {
  const fenceCount = (markdown.match(/```/g) || []).length;
  if (fenceCount % 2 === 0) {
    return markdown;
  }

  return `${markdown.trim()}\n\`\`\`\n`;
}

function fillShellCommandsFallback(markdown) {
  const shellCommandsSection = extractSection(markdown, "Shell Commands");
  const normalized = shellCommandsSection.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "").trim();

  if (normalized) {
    return markdown;
  }

  const commands = [];

  if (markdown.includes("requirements.txt")) {
    commands.push("python -m venv .venv");
    commands.push(".venv\\Scripts\\activate");
    commands.push("pip install -r requirements.txt");
  }

  if (markdown.toLowerCase().includes("tests/")) {
    commands.push("pytest");
  }

  if (markdown.includes("Dockerfile")) {
    commands.push("docker build -t local-multi-ai-task .");
  }

  if (commands.length === 0) {
    commands.push("# Add the project-specific commands here after the first implementation pass.");
  }

  return markdown.replace(
    /## Shell Commands[\s\S]*?(?=\n## |\n# |$)/,
    `## Shell Commands\n\`\`\`sh\n${commands.join("\n")}\n\`\`\`\n`
  );
}

function buildActiveContext(summaryMarkdown, runRelativePath, managerBrief) {
  const timestamp = new Date().toISOString();
  return [
    "# Active Context",
    "",
    `- Last multi-model run: ${timestamp}`,
    `- Run directory: ${runRelativePath}`,
    `- Active objective: ${managerBrief.objective || managerBrief.title || "Generated orchestration task"}`,
    `- Deliverable target: ${managerBrief.deliverable || "See run summary"}`,
    "",
    "## Latest Summary",
    summaryMarkdown.trim(),
    "",
  ].join("\n");
}

async function writeWorkspaceArtifacts({ planMarkdown, architectureMarkdown, tasksJson, reviewMarkdown, summaryMarkdown, runRelativePath, managerBrief }) {
  await writeFile(path.join(repoRoot, "01_planning", "plan.md"), `${planMarkdown.trim()}\n`);
  await writeFile(path.join(repoRoot, "02_architecture", "architecture.md"), `${architectureMarkdown.trim()}\n`);
  await writeFile(path.join(repoRoot, "03_tasks", "tasks.json"), formatJson(tasksJson));
  await writeFile(path.join(repoRoot, "05_reviews", "review.md"), `${reviewMarkdown.trim()}\n`);
  await writeFile(
    path.join(repoRoot, "memory-bank", "activeContext.md"),
    buildActiveContext(summaryMarkdown, runRelativePath, managerBrief)
  );
}

async function run() {
  const options = parseArgs(process.argv);
  const prompt = await readPrompt(options);

  if (!prompt) {
    throw new Error(
      'Missing prompt. Run `npm run multi-ai -- "your task here"` or use `--prompt-file path/to/request.txt`.'
    );
  }

  await ensureOllamaReady(options.ollamaBaseUrl);
  await ensureDir(outputRoot);

  const runId = `${timestampForPath()}-${slugify(prompt)}`;
  const runDir = path.join(outputRoot, runId);
  const runRelativePath = path.relative(repoRoot, runDir).replace(/\\/g, "/");

  await ensureDir(runDir);
  await snapshotWorkspace(runDir);
  await writeFile(path.join(runDir, "00-input.md"), `# Input\n\n${prompt}\n`);

  console.log(`Running multi-model orchestration in ${runRelativePath}`);
  console.log(`Manager model: ${roleConfig.manager.model}`);
  console.log(`Architect model: ${roleConfig.architect.model}`);
  console.log(`Code model: ${roleConfig.code.model}`);
  console.log(`Review model: ${roleConfig.review.model}`);

  console.log("\n[1/6] Preparing manager brief...");
  const managerBrief = buildSeedBrief(prompt);
  await writeFile(path.join(runDir, "01-manager-brief.json"), formatJson(managerBrief));

  console.log("[2/6] Writing planning artifact...");
  const planRaw = await ollamaGenerate({
    baseUrl: options.ollamaBaseUrl,
    model: roleConfig.manager.model,
    prompt: buildPlanPrompt(prompt, managerBrief),
  });
  const planMarkdown = normalizeMarkdownArtifact(planRaw, "# Plan");
  await writeFile(path.join(runDir, "01_planning", "plan.md"), `${planMarkdown.trim()}\n`);

  console.log("[3/6] Writing architecture artifact...");
  const architectureRaw = await ollamaGenerate({
    baseUrl: options.ollamaBaseUrl,
    model: roleConfig.architect.model,
    prompt: buildArchitecturePrompt(prompt, managerBrief, planMarkdown),
  });
  const architectureMarkdown = normalizeMarkdownArtifact(architectureRaw, "# Architecture");
  await writeFile(path.join(runDir, "02_architecture", "architecture.md"), `${architectureMarkdown.trim()}\n`);

  console.log("[4/6] Writing implementation handoff...");
  const implementationRaw = await ollamaGenerate({
    baseUrl: options.ollamaBaseUrl,
    model: roleConfig.code.model,
    prompt: buildImplementationPrompt(prompt, managerBrief, planMarkdown, architectureMarkdown),
  });
  const implementationMarkdown = fillShellCommandsFallback(
    closeOpenCodeFence(normalizeMarkdownArtifact(implementationRaw, "# Implementation"))
  );
  await writeFile(path.join(runDir, "04_code", "implementation.md"), `${implementationMarkdown.trim()}\n`);

  console.log("[5/6] Building task list...");
  const tasksJson = buildDeterministicTasks({
    userPrompt: prompt,
    architectureMarkdown,
    implementationMarkdown,
  });
  await writeFile(path.join(runDir, "03_tasks", "tasks.json"), formatJson(tasksJson));

  console.log("[6/6] Writing review and summary...");
  const reviewRaw = await ollamaGenerate({
    baseUrl: options.ollamaBaseUrl,
    model: roleConfig.review.model,
    prompt: buildReviewPrompt(
      prompt,
      managerBrief,
      planMarkdown,
      architectureMarkdown,
      tasksJson,
      implementationMarkdown
    ),
  });
  const reviewMarkdown = closeOpenCodeFence(normalizeMarkdownArtifact(reviewRaw, "# Review"));
  await writeFile(path.join(runDir, "05_reviews", "review.md"), `${reviewMarkdown.trim()}\n`);

  const summaryMarkdown = buildSummaryMarkdown({
    userPrompt: prompt,
    managerBrief,
    tasksJson,
    runRelativePath,
    workspaceSync: options.workspaceSync,
  });
  await writeFile(path.join(runDir, "summary.md"), `${summaryMarkdown.trim()}\n`);

  await writeFile(
    path.join(outputRoot, "latest-run.json"),
    formatJson({
      runId,
      path: runRelativePath,
      title: managerBrief.title || slugify(prompt),
      updatedAt: new Date().toISOString(),
      workspaceSync: options.workspaceSync,
    })
  );

  if (options.workspaceSync) {
    await writeWorkspaceArtifacts({
      planMarkdown,
      architectureMarkdown,
      tasksJson,
      reviewMarkdown,
      summaryMarkdown,
      runRelativePath,
      managerBrief,
    });
  }

  console.log("");
  console.log("Multi-model run complete.");
  console.log(`Run output: ${runRelativePath}`);
  console.log(`Workspace sync: ${options.workspaceSync ? "enabled" : "disabled"}`);
  console.log("Next step: open this repo in Roo and continue from Flow Orchestrator or Flow Code.");
}

run().catch((error) => {
  console.error("");
  console.error("run-multi-ai failed:");
  console.error(error.message);
  process.exitCode = 1;
});
