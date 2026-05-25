# A1Zap Bots CLI

Small CLI for external Hermes/OpenClaw-style agents that talk to A1Zap through the `/v1/bots` API.

This is intentionally separate from the existing `a1zap` micro-app CLI until the bot command surface is stable.

## Install

From GitHub, available today:

```bash
npm install -g github:a1baseai/a1zap-bots-cli
```

For reproducible agent installs, pin the release tag:

```bash
npm install -g github:a1baseai/a1zap-bots-cli#v0.1.3
```

From npm after the package is released:

```bash
# npm install -g @a1zap/bots-cli
```

From source:

```bash
git clone https://github.com/a1baseai/a1zap-bots-cli.git
cd a1zap-bots-cli
npm run install-local
```

From an existing local checkout while iterating:

```bash
cd ./packages/a1zap-bots-cli
npm run install-local
```

Then verify from any directory:

```bash
a1zap-bots --help
a1zap-bots --json doctor
a1zap-bots --json doctor --setup-live
```

Before publishing or handing a tarball to another team:

```bash
npm run pack:check
```

`doctor` is intentionally machine-readable. In JSON mode it includes `next`
commands and today-vs-published install paths, so AgentSpark, Hermes, or another
setup agent can show the exact next action without parsing prose.

The CLI defaults to the branded production gateway:

```bash
a1zap-bots --json doctor --setup-live
```

That uses `https://api.a1zap.com`, which proxies `/v1/cli/*` and `/v1/bots/*` to Convex HTTP actions. The direct Convex gateway remains a fallback if the branded proxy is temporarily unavailable.

## Auth And Config

There are two auth layers:

- Owner CLI token: used to create/list gateway agents and issue one-time bot keys.
- Bot API key: used by Hermes/OpenClaw to read and send chat messages as one agent.

Owner CLI token precedence:

1. `--cli-token`
2. `A1ZAP_CLI_TOKEN`
3. `~/.a1zap-bots/config.json`

Bot API key precedence:

1. `--api-key`
2. `A1ZAP_API_KEY`
3. `~/.a1zap-bots/config.json`

Browser/device login:

```bash
a1zap-bots login
```

The normal interactive command prints an approval URL, waits, then stores the CLI token after you approve it. The approval page is:

```text
https://www.a1zap.com/cli/device
```

For programmatic setup, JSON mode returns a `deviceCode` and a concrete `pollCommand`:

```bash
a1zap-bots --json login
a1zap-bots login --device-code a1dc_...
```

After approval, the CLI stores an owner token in `~/.a1zap-bots/config.json`. Existing tokens are redacted by `doctor`.

Config:

```bash
a1zap-bots config set \
  --base-url https://api.a1zap.com \
  --agent-id AGENT_ID
```

Optional local key storage:

```bash
a1zap-bots config set --api-key KEY_SHOWN_ONCE
```

Prefer `A1ZAP_API_KEY` for normal usage:

```bash
export A1ZAP_API_KEY=KEY_SHOWN_ONCE
```

Create or configure a gateway agent from the CLI:

```bash
a1zap-bots login
a1zap-bots bots create --name "Campus Planner" --handle campus-planner --runtime hermes
```

Or create the key from A1Zap Maker:

1. Open `/api/YOUR_AGENT_HANDLE`.
2. Use the **Messaging Gateway** card.
3. Click **Create gateway key**.
4. Paste the one-time key into Hermes/OpenClaw or export it as `A1ZAP_API_KEY`.

Or start from chat:

1. Open **New chat** in A1Zap Maker or A1 Cohort.
2. Choose **AgentSpark**.
3. Tap **Hermes gateway** or paste:

```text
Create a Hermes messaging gateway agent named "Campus Planner". Give it minimum scopes only, show the key once, and give me the exact A1ZAP_* values plus `hermes gateway setup` and `hermes gateway run` steps.
```

AgentSpark creates a private gateway agent after confirmation, shows the key
once, and keeps the full secret out of persisted chat history.

## Hermes Smoke Test

Configure once:

```bash
a1zap-bots config set \
  --base-url https://api.a1zap.com \
  --agent-id AGENT_ID
export A1ZAP_API_KEY=KEY_SHOWN_ONCE
```

Check:

```bash
a1zap-bots --json doctor --live
```

Run the full gateway smoke test once you have an A1Zap chat ID:

```bash
a1zap-bots bots smoke --chat CHAT_ID --json
```

Send a single message manually:

```bash
a1zap-bots bots send \
  --chat CHAT_ID \
  --text "Hello from Hermes." \
  --json
```

Dry run:

```bash
a1zap-bots bots send --chat CHAT_ID --text "Hello" --dry-run --json
```

## Native Hermes Gateway Plugin

A1Zap can run as a Hermes messaging platform adapter, so an A1Zap chat behaves like Telegram/Discord/Slack inside Hermes' gateway.

Print the human setup guide:

```bash
a1zap-bots hermes guide --agent-name "Campus Planner"
```

Fast setup path for a new Hermes gateway agent:

```bash
a1zap-bots login
a1zap-bots hermes bootstrap --name "Campus Planner" --write-env
hermes gateway setup
hermes gateway run
```

`bootstrap` creates a private A1Zap gateway agent, issues a one-time key, installs/enables the Hermes platform plugin, and writes the `A1ZAP_*` values into `~/.hermes/.env` when `--write-env` is present.

Manual setup path, split by side:

A1Zap side:

```bash
a1zap-bots login
a1zap-bots bots create --name "Campus Planner" --handle campus-planner --runtime hermes
```

Hermes side:

```bash
a1zap-bots hermes install-plugin
a1zap-bots --base-url https://api.a1zap.com hermes setup \
  --agent-id AGENT_ID \
  --api-key KEY_SHOWN_ONCE \
  --write-env
a1zap-bots hermes doctor --live
```

`hermes setup --write-env` copies the plugin, enables it, and writes the `A1ZAP_*` values into `~/.hermes/.env` without reprinting the one-time key.
Then run `hermes gateway setup` and `hermes gateway run`.

Install the Hermes plugin:

```bash
a1zap-bots hermes install-plugin
```

This copies the adapter to:

```text
~/.hermes/plugins/a1zap
```

It also enables the user plugin with:

```bash
hermes plugins enable a1zap
```

Paste the env block into `~/.hermes/.env`:

```bash
a1zap-bots hermes env
```

Then run Hermes:

```bash
hermes gateway setup
hermes gateway run
```

During `hermes gateway setup`, choose **A1Zap** as a platform. If you used
`a1zap-bots hermes bootstrap --write-env` or `a1zap-bots hermes setup --write-env`,
the required `A1ZAP_*` values are already in `~/.hermes/.env`.

For a foreground smoke test, keep it in `hermes gateway run`. Once it is working, install it as a background gateway:

```bash
hermes gateway install
hermes gateway start
hermes gateway status
```

Check the local Hermes wiring at any point:

```bash
a1zap-bots hermes doctor
a1zap-bots hermes doctor --live
```

`hermes doctor` checks whether the plugin is installed, whether Hermes can see it, whether `~/.hermes/.env` has the required `A1ZAP_*` values, and, with `--live`, whether the configured bot key can reach A1Zap updates.

The plugin long-polls `GET /v1/bots/{agentId}/updates?timeout=25`, converts inbound `message.received` events into Hermes `MessageEvent`s, maps image/video/audio/document attachments into Hermes media metadata when URLs are available, and sends Hermes replies back through `POST /v1/bots/{agentId}/messages`. It also registers Hermes cron/background delivery with `A1ZAP_HOME_CHANNEL`, so `deliver=a1zap` jobs can post back to a configured A1Zap chat.

The generated Hermes env block sets `A1ZAP_ALLOW_ALL_USERS=true` by default because A1Zap itself already gates inbound senders by chat membership and bot participation. If you want an extra Hermes-only gate, set it to `false` and fill `A1ZAP_ALLOWED_USERS` with trusted A1Zap sender IDs or handles.

Interactive helper:

```bash
a1zap-bots hermes setup --agent-id AGENT_ID --api-key KEY_SHOWN_ONCE --write-env
```

Once you have a real A1Zap chat ID, run one end-to-end smoke test before handing the agent to users:

```bash
a1zap-bots bots smoke --chat CHAT_ID_FROM_A1ZAP
```

That verifies API auth, chat membership, typing, message send, and message read-back through the same bot API Hermes uses.

## Local Bridge

For OpenClaw or another non-Hermes runtime, start with:

```bash
a1zap-bots openclaw init --target http://localhost:8787/a1zap
```

Run the example adapter:

```bash
node examples/hermes-adapter.js
```

Forward one batch of bot updates to it:

```bash
a1zap-bots bots dev --target http://localhost:8787/a1zap --once --json
```

Or keep the bridge running:

```bash
a1zap-bots bots dev --target http://localhost:8787/a1zap
```

For each update, the CLI POSTs:

```json
{
  "event": { "...": "A1Zap update event" }
}
```

The adapter may return any of:

```json
{ "text": "reply" }
{ "reply": "reply" }
{ "messages": [{ "text": "reply" }] }
{ "replies": [{ "text": "reply" }] }
```

Replies are sent back to `POST /v1/bots/{agentId}/messages`.

## Hermes Webhook Bridge Alternative

The native platform plugin is the recommended path because it behaves like a real Hermes messaging platform. Hermes' generic webhook adapter is better for signed event triggers, logs, or custom responders. If you specifically want that route instead:

Copy/paste prompt for Hermes:

```text
I am using Hermes' generic webhook adapter as a fallback for A1Zap messages. Create a signed HTTPS webhook route for A1Zap message.received events and return the route URL plus HMAC secret. If the route is meant to reply in the A1Zap chat, it must return JSON like `{ "message": "reply text" }` or `{ "reply": { "content": "reply text" } }`; otherwise treat this as a trigger/log route and use the native A1Zap platform plugin for live chat replies.
```

1. Hermes side: enable webhooks:

```bash
hermes gateway setup
# or set WEBHOOK_ENABLED=true, WEBHOOK_PORT=8644, WEBHOOK_SECRET=...
```

2. Expose the local Hermes route through an HTTPS tunnel, for example:

```text
https://YOUR-TUNNEL.example/webhooks/a1zap
```

3. A1Zap side: point the agent at that HTTPS route:

```bash
a1zap-bots bots webhook set \
  --agent-id AGENT_ID \
  --url https://YOUR-TUNNEL.example/webhooks/a1zap \
  --secret WEBHOOK_SECRET

# Only add this flag when the route returns JSON reply content:
#   --forward-responses
```

For local development without a tunnel, use `a1zap-bots bots dev --target http://localhost:8787/a1zap`; the hosted webhook setter intentionally requires HTTPS.

A1Zap sends Hermes-compatible generic webhook headers: `X-Webhook-Signature` as raw HMAC-SHA256 hex, `X-Hub-Signature-256` as `sha256=<hex>`, and `X-Request-ID` for idempotency. Payloads include `event_type`. With `--forward-responses`, a JSON response like `{ "message": "reply text" }`, `{ "text": "reply text" }`, `{ "reply": "reply text" }`, or `{ "reply": { "content": "reply text" } }` is posted back into the same A1Zap chat.

Use the native plugin for normal Hermes installs. It gives Hermes A1Zap as an actual gateway platform: inbound messages become `MessageEvent`s, replies use Hermes' platform `send`, typing is supported, and per-chat sessions stay under Hermes' normal gateway machinery.

## Provisioning

The CLI can now provision gateway agents through browser/device login:

```bash
a1zap-bots login
a1zap-bots bots list
a1zap-bots bots create --name "Campus Planner" --runtime hermes
a1zap-bots bots keys create --agent-id AGENT_ID --runtime hermes
```

Use `--allow-proactive` only when the external agent should be able to start chats with users under A1Zap's shared-community reach rules.

For custom responder webhook bridge setups:

```bash
a1zap-bots bots webhook set --agent-id AGENT_ID --url https://example.com/a1zap
# Add --forward-responses only if the endpoint returns JSON reply content.
```

Required scopes for basic Hermes:

- `messages:read`
- `messages:write`
- `agent:read`

Add `chats:start` only if Hermes should proactively start chats.

## JSON Policy

With `--json`, successful commands return stable JSON objects. Errors return:

```json
{
  "success": false,
  "error": "message"
}
```

Secrets are never printed by `doctor`.
