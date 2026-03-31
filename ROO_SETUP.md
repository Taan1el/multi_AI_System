# Roo Code Multi-Provider Setup

## What is already done

- Roo Code is installed in VS Code.
- This repository already contains project-local RooFlow files:
  - `.roomodes`
  - `.roo/`
  - `memory-bank/`

That means new Roo Code chats opened inside this repository can use the Flow modes defined here.

## Best way to get Claude, Gemini, ChatGPT, Codex, and more

Use Roo Code profiles and map them to different providers/models:

1. `Claude Architect`
   - Provider: Anthropic
   - Use for: Flow Architect, review, planning

2. `Codex Code`
   - Provider: OpenAI or ChatGPT Plus/Pro
   - Use for: Flow Code, implementation, refactors

3. `Gemini Research`
   - Provider: Google Gemini
   - Use for: long-context analysis, brainstorming, research-heavy tasks

4. `Router Lab`
   - Provider: OpenRouter
   - Use for: one-key access to many models from multiple vendors

5. `Copilot Bridge` (optional)
   - Provider: VS Code LM API
   - Use for: experimental access to models exposed by GitHub Copilot or other VS Code LM providers

## Recommended setup order

1. Open this repository in VS Code.
2. Open the Roo Code sidebar.
3. Open Roo settings.
4. Create a separate profile for each provider you actually want to use.
5. In each profile, pick the provider and model that match the role.
6. Start a new Roo chat in this repo and switch to:
   - `Flow Architect` for Claude
   - `Flow Code` for OpenAI/Codex
   - `Flow Debug` for debugging
   - `Flow Ask` for explanation-only turns

## What you need to add manually

- Anthropic API key for Claude
- Google AI / Gemini API key
- OpenAI API key or ChatGPT Plus/Pro sign-in
- Optional OpenRouter API key

I cannot safely fill these in for you because they are your private credentials.

## Easiest real-world strategy

If you want the least setup friction:

- Use Anthropic directly for Claude
- Use OpenAI directly for GPT/Codex-style coding
- Use Google Gemini directly for Gemini
- Use OpenRouter only if you want one fallback key for many vendors

If you want the simplest single-key experiment setup:

- Use OpenRouter first
- Then add direct Anthropic/OpenAI/Google later for better control

## Important behavior notes

- New chats in Roo Code inside this repository can use RooFlow features because `.roomodes` and `.roo` are project-local.
- New chats in the Codex desktop app do **not** automatically become RooFlow chats.
- RooFlow mode files organize behavior, but the actual provider/model comes from the Roo Code profile you selected.

## How to make new Roo threads use RooFlow

Do this each time:

1. Open this same project in VS Code
2. Start a new Roo chat
3. Choose the provider profile you want
4. Switch the mode to one of the `Flow-*` modes

That is the real path to "Claude for architecture, Codex/OpenAI for code" in practice.

## About ChatGPT, Codex, and Copilot

- `ChatGPT Plus/Pro` in Roo Code is a provider option from Roo's docs.
- `OpenAI` is the direct API path.
- `VS Code LM API` is experimental and can expose models from GitHub Copilot or other LM-capable extensions.
- If you want maximum control and predictable behavior, direct Anthropic/OpenAI/Gemini providers are safer than the experimental LM API route.

## Plugin vs custom modes

You probably do **not** need a plugin first.

Start with:

- Roo profiles
- your existing `Flow-*` modes
- MCP servers if you need tools or integrations

Create a plugin only if you want:

- reusable tooling across many projects
- custom slash commands
- packaged prompts/modes for a team
- repeatable installation for others

## Suggested default mapping

- `Flow Architect` -> Anthropic Claude
- `Flow Code` -> OpenAI / Codex-style model
- `Flow Debug` -> OpenAI or Claude, whichever is better for the issue
- `Flow Ask` -> Gemini or Claude for explanation-heavy tasks

## Quick start checklist

- Install Roo Code
- Open this repo in VS Code
- Add provider credentials
- Create 2 to 5 Roo profiles
- Start a Roo chat
- Pick a profile
- Switch to a `Flow-*` mode
- Work from `01_planning`, `02_architecture`, `03_tasks`, `04_code`, and `05_reviews`
