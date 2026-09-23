# Continuity Protocol

Use this when Codex context, tokens, or the local session run out.

## Source of truth

1. GitHub branch `feat/agent-director-v1` is the primary code source.
2. `docs/AGENT_HANDOFF.md` is the primary project status source.
3. A Google Drive handoff bundle is only a fallback snapshot, not the canonical repo.

## Create a fallback bundle

On this Mac, the default target is `/Users/aleksandrbogatov/Мой диск/Blockout handoffs` when that folder exists:

```bash
npm run handoff:bundle
```

To choose another folder:

```bash
BLOCKOUT_HANDOFF_DIR="/path/to/shared/folder" npm run handoff:bundle
```

The bundle contains:

- `README_CONTINUE.md` with a paste-ready prompt for a new agent.
- current branch, commit, remote, git status and recent log.
- unstaged and staged patches, if any.
- key docs copied from the repo.
- a `.bundle` git backup that can recreate the repo if GitHub is unavailable.

## Continue in a new Codex session

Paste:

```text
Работай в feat/agent-director-v1. Сначала прочитай docs/AGENT_HANDOFF.md, затем AGENTS.md и docs/CONTINUITY.md. Продолжай с Recommended next sequence. Не добавляй большие функции, пока validation/fix pass не зелёный.
```

Then verify:

```bash
git status --short --branch
npm run typecheck
npm run lint
npm run e2e
```

## Tunnel plan

A tunnel is useful later for ChatGPT driving the live local Blockout MCP, but it is not the best emergency fallback. For token/session loss, prefer GitHub plus the Google Drive bundle. Add a tunnel only after the local packaged app and compact Director MCP are stable.
