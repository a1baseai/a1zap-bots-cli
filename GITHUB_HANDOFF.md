# A1Zap Bots CLI GitHub Handoff

This package should live in a small separate repo, for example:

```text
github.com/a1baseai/a1zap-bots-cli
```

Keeping it separate makes it easy for Hermes, OpenClaw, or another coding agent to clone only the gateway CLI and plugin without downloading the full A1Zap Maker app.

## Recommended Finish Path

From the monorepo:

```bash
cd /Users/pasha/a1base/a1zap-maker/packages/a1zap-bots-cli
npm run pack:check
npm run export:standalone
```

That creates:

```text
/Users/pasha/a1base/dist/a1zap-bots-cli-standalone
```

Then create the GitHub repo and push:

```bash
cd /Users/pasha/a1base/dist/a1zap-bots-cli-standalone
npm run repo:init
git remote add origin git@github.com:a1baseai/a1zap-bots-cli.git
git push -u origin main
```

If the repo should be public and npm-installable:

```bash
npm login
npm publish --access public
```

If npm publishing is not ready yet, agents can still install from GitHub:

```bash
npm install -g github:a1baseai/a1zap-bots-cli
```

For a pinned reproducible install:

```bash
npm install -g github:a1baseai/a1zap-bots-cli#v0.1.6
```

Or from source:

```bash
git clone https://github.com/a1baseai/a1zap-bots-cli.git
cd a1zap-bots-cli
npm run install-local
```

## What This Repo Contains

- `bin/a1zap-bots.js`: the CLI entrypoint.
- `hermes-plugin/a1zap`: native Hermes platform plugin.
- `examples/hermes-adapter.js`: simple local HTTP bridge for OpenClaw-style runtimes.
- `scripts/install-local.mjs`: local symlink installer.
- `scripts/export-standalone.mjs`: repo export helper.
- `test/`: CLI and Hermes plugin smoke tests.

## User Setup Flow

After install:

```bash
a1zap-bots login
a1zap-bots hermes bootstrap --name "Campus Planner" --write-env --attach-owner
a1zap-bots hermes doctor --live
hermes gateway setup
hermes gateway run
```

After the bot is in an A1Zap/A1 Cohort chat:

```bash
a1zap-bots bots attach-owner
a1zap-bots bots smoke --chat CHAT_ID_FROM_A1ZAP
```

## Production Gateway

The branded gateway is the default:

```text
https://api.a1zap.com
```

It proxies `/v1/cli/*` and `/v1/bots/*` to Convex HTTP actions.

Run this to verify:

```bash
a1zap-bots --json doctor --setup-live
```

If it returns HTML or says the route is not deployed, use the direct Convex base URL as a fallback:

```bash
a1zap-bots config set --base-url https://dusty-sandpiper-500.convex.site
```

## Security Notes

- Bot API keys are shown once.
- `doctor` redacts secrets.
- Basic Hermes scopes are `agent:read`, `messages:read`, and `messages:write`.
- Add `chats:start` only when the agent should proactively start chats.
- Native Hermes plugin is preferred for live chat gateway behavior.
- Generic webhooks are a fallback for signed triggers or custom responder routes.
