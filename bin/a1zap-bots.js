#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.1";
const DEFAULT_API_BASE_URL = "https://dusty-sandpiper-500.convex.site";
const CONFIG_DIR = path.join(os.homedir(), ".a1zap-bots");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const BIN_PATH = fs.realpathSync(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(path.dirname(BIN_PATH), "..");
const HERMES_PLUGIN_SOURCE = path.join(PACKAGE_ROOT, "hermes-plugin", "a1zap");
const DEFAULT_HERMES_PLUGIN_DIR = path.join(os.homedir(), ".hermes", "plugins", "a1zap");
const HERMES_PLUGIN_ENABLE_KEY = "a1zap";
const DEFAULT_HERMES_ENV_PATH = path.join(os.homedir(), ".hermes", ".env");
const GITHUB_INSTALL_COMMAND = "npm install -g github:a1baseai/a1zap-bots-cli";
const SOURCE_INSTALL_COMMANDS = [
  "git clone https://github.com/a1baseai/a1zap-bots-cli.git",
  "cd a1zap-bots-cli",
  "npm run install-local",
];
const PUBLISHED_INSTALL_COMMAND = "npm install -g @a1zap/bots-cli";
const A1ZAP_HERMES_ENV_KEYS = [
  "A1ZAP_BASE_URL",
  "A1ZAP_AGENT_ID",
  "A1ZAP_API_KEY",
  "A1ZAP_HOME_CHANNEL",
  "A1ZAP_POLL_INTERVAL_MS",
  "A1ZAP_UPDATE_LIMIT",
  "A1ZAP_ALLOWED_USERS",
  "A1ZAP_ALLOW_ALL_USERS",
  "A1ZAP_LONG_POLL_SECONDS",
];

function usage() {
  return `A1Zap Bots CLI ${VERSION}

Usage:
  a1zap-bots [--json] [--base-url URL] [--agent-id ID] [--api-key KEY] [--cli-token TOKEN] <command>

Commands:
  doctor                         Check local config and optional API reachability
  login                          Browser/device login for owner-level bot setup
  login --device-code CODE       Poll an existing device login request
  config show                    Show saved config, redacting secrets
  config set [options]           Save base URL, agent ID, and optionally API key
  bots list                      List your A1Zap gateway agents
  bots create --name NAME        Create a private API-enabled gateway agent
  bots keys create               Issue a one-time key for a gateway agent
  bots webhook set --url URL     Set an HTTPS webhook for a gateway agent
  bots smoke --chat ID           Verify auth, chat access, send, and read-back
  bots send --chat ID --text T   Send a bot message
  bots messages --chat ID        Read chat messages
  bots participants --chat ID    Read chat participants
  bots updates                   Poll bot updates; supports --timeout seconds
  bots start --user-handle H     Start/reuse a proactive chat
  bots typing --chat ID          Set typing state
  bots dev --target URL          Forward updates to a local agent adapter
  hermes guide                   Print copy/paste setup guide for Hermes
  hermes env                     Print Hermes .env block for A1Zap
  hermes install-plugin          Install and enable the native Hermes platform plugin
  hermes doctor                  Check Hermes plugin, env, and optional live gateway auth
  hermes setup                   Install plugin and optionally write Hermes .env values
  hermes bootstrap --name NAME    Create a gateway agent, install plugin, print env
  openclaw init                  Print OpenClaw/local adapter setup guide
  request METHOD PATH            Raw API request escape hatch

Global options:
  --json                         Emit machine-readable JSON
  --base-url URL                 API base URL, e.g. https://x.convex.site
  --agent-id ID                  Agent ID
  --api-key KEY                  One-off API key; prefer A1ZAP_API_KEY
  --cli-token TOKEN              Owner CLI token; prefer A1ZAP_CLI_TOKEN

Doctor options:
  --live                         Check bot runtime auth with /v1/bots updates
  --setup-live                   Check public CLI/device-login route

Login options:
  --once                         Print approval URL and exit
  --device-code CODE             Poll an existing device code from JSON/once output
  --timeout SECONDS              Login polling timeout, default 600

Hermes bootstrap options:
  --name NAME                    Gateway agent name
  --handle HANDLE                Optional agent handle
  --write-env                    Upsert A1ZAP_* values into ~/.hermes/.env
  --save-secret                  Also save the one-time API key in ~/.a1zap-bots/config.json
  --allow-proactive              Include chats:start scope

Hermes setup options:
  --agent-id ID                  Existing A1Zap agent ID
  --api-key KEY                  One-time bot API key from AgentSpark or the gateway card
  --write-env                    Upsert A1ZAP_* values into ~/.hermes/.env
  --env-path PATH                Alternate Hermes env file path
  --skip-install                 Do not copy the Hermes plugin
  --skip-enable                  Do not run hermes plugins enable a1zap

Environment:
  A1ZAP_BASE_URL                 API base URL
  A1ZAP_AGENT_ID                 Agent ID
  A1ZAP_API_KEY                  Agent API key
  A1ZAP_CLI_TOKEN                Owner CLI token from a1zap-bots login
`;
}

function parseArgs(argv) {
  const globals = {
    json: false,
    baseUrl: undefined,
    agentId: undefined,
    apiKey: undefined,
    cliToken: undefined,
  };
  const args = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") globals.json = true;
    else if (arg === "--base-url") globals.baseUrl = argv[++i];
    else if (arg === "--agent-id") globals.agentId = argv[++i];
    else if (arg === "--api-key") globals.apiKey = argv[++i];
    else if (arg === "--cli-token") globals.cliToken = argv[++i];
    else if (arg === "--help" || arg === "-h") globals.help = true;
    else if (arg === "--version" || arg === "-v" || arg === "-V") globals.version = true;
    else args.push(arg);
  }
  return { globals, args };
}

function parseOptions(args) {
  const options = {};
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return { options, rest };
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function parseEnvBlock(block) {
  const values = {};
  for (const rawLine of String(block || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1);
    if (A1ZAP_HERMES_ENV_KEYS.includes(key)) {
      values[key] = value;
    }
  }
  return values;
}

function upsertEnvFile(filePath, values) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const seen = new Set();
  const lines = existing.split(/\r?\n/);
  const updatedLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    const key = match?.[1];
    if (key && Object.prototype.hasOwnProperty.call(values, key)) {
      seen.add(key);
      return `${key}=${values[key]}`;
    }
    return line;
  });

  const additions = A1ZAP_HERMES_ENV_KEYS
    .filter((key) => Object.prototype.hasOwnProperty.call(values, key) && !seen.has(key))
    .map((key) => `${key}=${values[key]}`);

  const body = [
    ...updatedLines.filter((line, index) => !(line === "" && index === updatedLines.length - 1)),
    ...(additions.length > 0 && existing.trim() ? [""] : []),
    ...additions,
  ].join("\n");

  fs.writeFileSync(filePath, `${body}\n`, { mode: 0o600 });
  return { path: filePath, keys: Object.keys(values).filter((key) => A1ZAP_HERMES_ENV_KEYS.includes(key)) };
}

function redact(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 8) return "***";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function truthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function listEnv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBaseUrl(value) {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.hostname.endsWith(".convex.cloud")) {
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function normalizeHttpsUrl(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || !url.hostname) {
    throw new Error("expected an https:// URL");
  }
  return url.toString();
}

function resolveRuntime(globals) {
  const config = loadConfig();
  const baseUrl =
    globals.baseUrl ||
    process.env.A1ZAP_BASE_URL ||
    config.baseUrl ||
    DEFAULT_API_BASE_URL;
  const agentId =
    globals.agentId ||
    process.env.A1ZAP_AGENT_ID ||
    config.agentId;
  const apiKey =
    globals.apiKey ||
    process.env.A1ZAP_API_KEY ||
    config.apiKey;
  const cliToken =
    globals.cliToken ||
    process.env.A1ZAP_CLI_TOKEN ||
    config.cliToken;
  const apiKeySource = globals.apiKey
    ? "flag"
    : process.env.A1ZAP_API_KEY
      ? "env"
      : config.apiKey
        ? "config"
        : "missing";

  return {
    config,
    baseUrl: baseUrl ? normalizeBaseUrl(baseUrl) : undefined,
    agentId,
    apiKey,
    cliToken,
    apiKeySource,
  };
}

function output(globals, value, text) {
  if (globals.json) {
    console.log(JSON.stringify(value, null, 2));
  } else if (text) {
    console.log(text);
  } else {
    console.log(JSON.stringify(value, null, 2));
  }
}

function displayPath(value) {
  const home = os.homedir();
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function fail(globals, message, code = 1, details = {}) {
  if (globals.json) {
    console.error(JSON.stringify({ success: false, error: message, ...details }, null, 2));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(code);
}

function requireRuntime(globals, runtime, needsKey = true) {
  if (!runtime.baseUrl) fail(globals, "Missing base URL. Set A1ZAP_BASE_URL or run config set --base-url URL.");
  if (!runtime.agentId) fail(globals, "Missing agent ID. Set A1ZAP_AGENT_ID or run config set --agent-id ID.");
  if (needsKey && !runtime.apiKey) fail(globals, "Missing API key. Set A1ZAP_API_KEY or pass --api-key.");
}

function requireCliRuntime(globals, runtime) {
  if (!runtime.baseUrl) fail(globals, "Missing base URL. Set A1ZAP_BASE_URL or pass --base-url URL.");
  if (!runtime.cliToken) fail(globals, "Missing CLI token. Run a1zap-bots login or set A1ZAP_CLI_TOKEN.");
}

function apiUrl(runtime, apiPath, query) {
  const url = new URL(apiPath.startsWith("/") ? apiPath : `/${apiPath}`, runtime.baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function parseJsonOrThrow(response, method, url) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 240);
    const looksLikeHtml = /text\/html/i.test(contentType) || /^<!doctype html/i.test(text.trim()) || /<html[\s>]/i.test(text);
    const routeHint =
      looksLikeHtml && url.pathname.startsWith("/v1/")
        ? " The public API route returned an HTML page instead of JSON; the Cloudflare /v1 proxy may not be deployed for this path yet."
        : "";
    data = { rawPreview: preview, contentType };
    if (!response.ok || looksLikeHtml) {
      const error = new Error(`${method} ${url.pathname} did not return JSON.${routeHint}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
  }
  if (!response.ok) {
    const message = data?.error || data?.message || `${method} ${url.pathname} failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function requestJson(runtime, method, apiPath, body, query) {
  const url = apiUrl(runtime, apiPath, query);
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": runtime.apiKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseJsonOrThrow(response, method, url);
}

async function requestPublicJson(runtime, method, apiPath, body, query) {
  const url = apiUrl(runtime, apiPath, query);
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseJsonOrThrow(response, method, url);
}

async function requestCliJson(runtime, method, apiPath, body, query) {
  const url = apiUrl(runtime, apiPath, query);
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.cliToken}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseJsonOrThrow(response, method, url);
}

function botPath(runtime, suffix = "") {
  return `/v1/bots/${encodeURIComponent(runtime.agentId)}${suffix}`;
}

function hermesEnvBlock(runtime, options = {}) {
  const includeSecret = Boolean(options.includeSecret);
  const apiKey = includeSecret && runtime.apiKey ? runtime.apiKey : "<paste_key_shown_once_from_AgentSpark>";
  return [
    "# A1Zap Hermes platform adapter",
    `A1ZAP_BASE_URL=${runtime.baseUrl || "https://YOUR-CONVEX-DEPLOYMENT.convex.site"}`,
    `A1ZAP_AGENT_ID=${runtime.agentId || "AGENT_ID_FROM_A1ZAP"}`,
    `A1ZAP_API_KEY=${apiKey}`,
    "# Optional: chat/channel ID for Hermes background deliveries",
    "A1ZAP_HOME_CHANNEL=",
    "# A1Zap already gates sender access by chat membership. Set this false only if you also fill A1ZAP_ALLOWED_USERS.",
    "A1ZAP_ALLOWED_USERS=",
    "A1ZAP_ALLOW_ALL_USERS=true",
    "# Optional: keep gateway polling efficient",
    "A1ZAP_LONG_POLL_SECONDS=25",
  ].join("\n");
}

function agentSparkPrompt(agentName = "Campus Planner") {
  return [
    `I want to connect a Hermes agent to A1Zap. Please create or reuse an external bot named "${agentName}".`,
    "If this is a new setup, recommend the fast path: a1zap-bots hermes bootstrap --name \"AGENT_NAME\" --write-env.",
    "Give it the minimum scopes: agent:read, messages:read, messages:write.",
    "Only add chats:start if I confirm it should proactively start chats with people.",
    "Then show me the Convex site base URL, agent ID, and a one-time API key for Hermes.",
    "Please keep webhook signing on by default if we add webhooks later.",
  ].join(" ");
}

function hermesGatewayPrompt(agentName = "Campus Planner") {
  return [
    `You are my Hermes Agent. I want A1Zap to be one of your messaging platforms for the agent named "${agentName}".`,
    "Use the native A1Zap Hermes platform plugin, not generic webhooks, unless I explicitly ask for webhook fallback.",
    "After I install the plugin and put A1ZAP_BASE_URL, A1ZAP_AGENT_ID, A1ZAP_API_KEY, and A1ZAP_ALLOW_ALL_USERS=true into ~/.hermes/.env, guide me through `hermes gateway setup`, `hermes gateway run`, and an A1Zap chat smoke test.",
    "Treat A1Zap like Telegram/Discord: receive inbound chat messages, send typing when useful, reply back to the same chat, and preserve per-chat session memory.",
    "Use A1Zap's bot key only for A1Zap gateway traffic; do not paste it into chat messages or logs.",
  ].join(" ");
}

function webhookFallbackPrompt(agentName = "Campus Planner") {
  return [
    `I am using Hermes' generic webhook adapter as a fallback for A1Zap messages to "${agentName}".`,
    "Create a signed HTTPS webhook route for A1Zap message.received events and return the route URL plus HMAC secret.",
    "If the route is meant to reply in the A1Zap chat, it must return JSON like `{ \"message\": \"reply text\" }` or `{ \"reply\": { \"content\": \"reply text\" } }`; otherwise treat this as a trigger/log route and use the native A1Zap platform plugin for live chat replies.",
    "I will paste that HTTPS route and secret into A1Zap with `a1zap-bots bots webhook set --forward-responses` only when the route returns a reply body.",
  ].join(" ");
}

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) {
    throw new Error(`Hermes plugin source is missing at ${source}`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function enableHermesPlugin(options = {}) {
  if (options.skipEnable) {
    return {
      enabled: false,
      skipped: true,
      command: `hermes plugins enable ${HERMES_PLUGIN_ENABLE_KEY}`,
    };
  }
  if (options.dryRun) {
    return {
      enabled: false,
      dryRun: true,
      command: `hermes plugins enable ${HERMES_PLUGIN_ENABLE_KEY}`,
    };
  }
  try {
    const stdout = execFileSync("hermes", ["plugins", "enable", HERMES_PLUGIN_ENABLE_KEY], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      enabled: true,
      command: `hermes plugins enable ${HERMES_PLUGIN_ENABLE_KEY}`,
      output: stdout.trim(),
    };
  } catch (error) {
    return {
      enabled: false,
      command: `hermes plugins enable ${HERMES_PLUGIN_ENABLE_KEY}`,
      error: error?.stderr?.toString?.().trim() || error?.message || "Could not enable Hermes plugin automatically",
    };
  }
}

function runHermesCommand(args) {
  try {
    const stdout = execFileSync("hermes", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    return { ok: true, output: stdout.trim() };
  } catch (error) {
    return {
      ok: false,
      error: error?.stderr?.toString?.().trim() || error?.message || "Hermes command failed",
    };
  }
}

function readHermesEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, values: {} };
  }
  const text = fs.readFileSync(filePath, "utf8");
  return { exists: true, values: parseEnvBlock(text) };
}

function readHermesPluginManifest(pluginDir) {
  const manifestPath = path.join(pluginDir, "plugin.yaml");
  if (!fs.existsSync(manifestPath)) {
    return { exists: false, path: manifestPath, name: null, version: null };
  }
  const text = fs.readFileSync(manifestPath, "utf8");
  const name = text.match(/^name:\s*["']?([^"'\n#]+)["']?/m)?.[1]?.trim() || null;
  const version = text.match(/^version:\s*["']?([^"'\n#]+)["']?/m)?.[1]?.trim() || null;
  return { exists: true, path: manifestPath, name, version };
}

function sourceInstallBlock() {
  return [
    "# GitHub install path available today:",
    GITHUB_INSTALL_COMMAND,
    "",
    "# Published package path, once @a1zap/bots-cli is released:",
    `# ${PUBLISHED_INSTALL_COMMAND}`,
    "",
    "# Source checkout path:",
    ...SOURCE_INSTALL_COMMANDS,
  ].join("\n");
}

function runtimeWithHermesEnv(runtime, envValues) {
  return {
    ...runtime,
    baseUrl: runtime.baseUrl || (envValues.A1ZAP_BASE_URL ? normalizeBaseUrl(envValues.A1ZAP_BASE_URL) : undefined),
    agentId: runtime.agentId || envValues.A1ZAP_AGENT_ID,
    apiKey: runtime.apiKey || envValues.A1ZAP_API_KEY,
    apiKeySource: runtime.apiKey ? runtime.apiKeySource : envValues.A1ZAP_API_KEY ? "hermes-env" : runtime.apiKeySource,
  };
}

function parseJsonOption(globals, value, label) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    fail(globals, `${label} must be valid JSON`);
  }
}

async function commandDoctor(globals, rest) {
  const runtime = resolveRuntime(globals);
  const { options } = parseOptions(rest);
  const report = {
    success: true,
    version: VERSION,
    node: process.version,
    configPath: CONFIG_PATH,
    baseUrl: runtime.baseUrl || null,
    agentId: runtime.agentId || null,
    apiKey: {
      present: Boolean(runtime.apiKey),
      source: runtime.apiKeySource,
      preview: redact(runtime.apiKey),
    },
    cliToken: {
      present: Boolean(runtime.cliToken),
      preview: redact(runtime.cliToken),
    },
    readyForSend: Boolean(runtime.baseUrl && runtime.agentId && runtime.apiKey),
    readyForSetup: Boolean(runtime.baseUrl && runtime.cliToken),
    network: {
      checked: false,
      ok: null,
      error: null,
    },
    setupRoute: {
      checked: false,
      ok: null,
      error: null,
      verificationUri: null,
      fallbackBaseUrl: DEFAULT_API_BASE_URL,
      fallbackCommand: `a1zap-bots config set --base-url ${DEFAULT_API_BASE_URL}`,
    },
    install: {
      githubInstallCommand: GITHUB_INSTALL_COMMAND,
      publishedPackage: PUBLISHED_INSTALL_COMMAND,
      publishedPackageAvailable: false,
      localInstallCommand: "npm run install-local",
      packageCheckCommand: "npm run pack:check",
      sourceCommands: SOURCE_INSTALL_COMMANDS,
    },
    next: [],
  };

  if (options.live && report.readyForSend) {
    report.network.checked = true;
    try {
      await requestJson(runtime, "GET", botPath(runtime, "/updates"), undefined, { limit: 1 });
      report.network.ok = true;
    } catch (error) {
      report.success = false;
      report.network.ok = false;
      report.network.error = error.message;
    }
  }

  if (options.setupLive) {
    report.setupRoute.checked = true;
    try {
      const started = await requestPublicJson(runtime, "POST", "/v1/cli/device-login/start", {
        label: "A1Zap Bots CLI doctor",
        verificationBaseUrl: options.webUrl || process.env.A1ZAP_WEB_URL || inferWebUrl(runtime),
      });
      report.setupRoute.ok = true;
      report.setupRoute.verificationUri = started.verificationUri || null;
    } catch (error) {
      report.success = false;
      report.setupRoute.ok = false;
      report.setupRoute.error = error.message;
    }
  }

  if (report.setupRoute.checked && report.setupRoute.ok === false) {
    report.next.push(`Use the direct Convex gateway until the branded proxy is deployed: \`${report.setupRoute.fallbackCommand}\`.`);
  }
  if (!runtime.cliToken) {
    report.next.push("Run `a1zap-bots login` to approve an owner CLI token.");
  }
  if (!runtime.agentId || !runtime.apiKey) {
    report.next.push("Create or connect a bot with `a1zap-bots hermes bootstrap --name \"Campus Planner\" --write-env`.");
  }
  if (report.readyForSend) {
    report.next.push("Run `a1zap-bots --json doctor --live`, then `a1zap-bots bots smoke --chat CHAT_ID_FROM_A1ZAP --dry-run`.");
  }

  output(globals, report, report.readyForSend ? "A1Zap bot config is ready." : "A1Zap bot config is incomplete.");
}

function inferWebUrl(runtime) {
  try {
    const url = new URL(runtime.baseUrl || "");
    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      return "http://127.0.0.1:3000";
    }
  } catch {
    // Ignore malformed local config here; request validation will catch it.
  }
  return undefined;
}

async function pollDeviceLogin(globals, runtime, deviceCode, intervalSeconds, timeoutSeconds) {
  const timeoutMs = Number(timeoutSeconds || 600) * 1000;
  const intervalMs = Math.max(1, Number(intervalSeconds || 2)) * 1000;
  const startedAt = Date.now();
  let lastStatus = "pending";

  while (Date.now() - startedAt < timeoutMs) {
    const polled = await requestPublicJson(runtime, "POST", "/v1/cli/device-login/poll", {
      deviceCode,
    });
    lastStatus = polled.status;

    if (polled.status === "pending") {
      if (!globals.json) process.stdout.write(".");
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    if (polled.status === "approved" && polled.cliToken) {
      const config = loadConfig();
      config.baseUrl = runtime.baseUrl;
      config.cliToken = polled.cliToken;
      saveConfig(config);
      output(globals, {
        success: true,
        status: "approved",
        configPath: CONFIG_PATH,
        cliTokenPreview: redact(polled.cliToken),
        scopes: polled.scopes || [],
      }, `\nApproved. Saved CLI token to ${displayPath(CONFIG_PATH)}.`);
      return;
    }

    fail(globals, `Login ${polled.status}`);
  }

  fail(globals, `Login timed out while ${lastStatus}`);
}

async function commandLogin(globals, rest) {
  const { options } = parseOptions(rest);
  const runtime = resolveRuntime(globals);
  if (!runtime.baseUrl) fail(globals, "Missing base URL. Pass --base-url URL.");

  if (options.deviceCode) {
    await pollDeviceLogin(globals, runtime, String(options.deviceCode), options.interval || 2, options.timeout);
    return;
  }

  const body = {
    label: options.label || "A1Zap Bots CLI",
    verificationBaseUrl: options.webUrl || process.env.A1ZAP_WEB_URL || inferWebUrl(runtime),
  };
  if (options.scopes) {
    body.scopes = String(options.scopes)
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
  }
  if (options.dryRun) {
    output(globals, {
      success: true,
      dryRun: true,
      method: "POST",
      path: "/v1/cli/device-login/start",
      body,
    });
    return;
  }

  const started = await requestPublicJson(runtime, "POST", "/v1/cli/device-login/start", body);
  const loginInfo = {
    userCode: started.displayUserCode || started.userCode,
    verificationUri: started.verificationUri,
    verificationUriComplete: started.verificationUriComplete,
    expiresAt: started.expiresAt,
    interval: Number(started.interval || 2),
  };

  if (globals.json && !options.poll) {
    const pollCommand = `a1zap-bots login --device-code ${started.deviceCode}`;
    output(globals, {
      success: true,
      ...loginInfo,
      deviceCode: started.deviceCode,
      pollCommand,
      next: `Open verificationUriComplete, approve the code, then run: ${pollCommand}`,
    });
    return;
  }

  console.log("A1Zap CLI login");
  console.log("");
  console.log(`1. Open: ${loginInfo.verificationUriComplete}`);
  console.log(`2. Confirm code: ${loginInfo.userCode}`);
  console.log("3. Come back here; I will finish the setup automatically.");
  console.log("");

  if (options.once) {
    return;
  }

  await pollDeviceLogin(globals, runtime, started.deviceCode, loginInfo.interval, options.timeout);
}

async function commandConfig(globals, rest) {
  const [sub, ...tail] = rest;
  if (sub === "show" || !sub) {
    const runtime = resolveRuntime(globals);
    output(globals, {
      success: true,
      configPath: CONFIG_PATH,
      baseUrl: runtime.config.baseUrl || null,
      agentId: runtime.config.agentId || null,
      apiKeyPresent: Boolean(runtime.config.apiKey),
      apiKeyPreview: redact(runtime.config.apiKey),
      cliTokenPresent: Boolean(runtime.config.cliToken),
      cliTokenPreview: redact(runtime.config.cliToken),
    });
    return;
  }
  if (sub !== "set") fail(globals, `Unknown config command: ${sub}`);
  const { options } = parseOptions(tail);
  const config = loadConfig();
  const baseUrl = options.baseUrl || globals.baseUrl;
  const agentId = options.agentId || globals.agentId;
  const apiKey = options.apiKey || globals.apiKey;
  const cliToken = options.cliToken || globals.cliToken;
  if (baseUrl) config.baseUrl = normalizeBaseUrl(baseUrl);
  if (agentId) config.agentId = agentId;
  if (apiKey) config.apiKey = apiKey;
  if (cliToken) config.cliToken = cliToken;
  saveConfig(config);
  output(globals, {
    success: true,
    configPath: CONFIG_PATH,
    baseUrl: config.baseUrl || null,
    agentId: config.agentId || null,
    apiKeyPresent: Boolean(config.apiKey),
    cliTokenPresent: Boolean(config.cliToken),
  }, `Saved config to ${CONFIG_PATH}`);
}

async function commandBots(globals, rest) {
  const [sub, ...tail] = rest;
  const parsed = parseOptions(tail);
  const { options } = parsed;
  const optionRest = parsed.rest;
  const runtime = resolveRuntime(globals);

  if (sub === "list") {
    requireCliRuntime(globals, runtime);
    const result = await requestCliJson(runtime, "GET", "/v1/cli/agents", undefined, {
      limit: options.limit || 50,
    });
    output(globals, result);
    return;
  }

  if (sub === "create") {
    requireCliRuntime(globals, runtime);
    if (!options.name) fail(globals, "bots create requires --name NAME");
    const body = {
      name: options.name,
      handle: options.handle,
      description: options.description,
      runtime: options.runtime || "hermes",
      allowProactiveStarts: Boolean(options.allowProactive || options.allowProactiveStarts),
      createKey: options.noKey ? false : true,
    };
    if (options.dryRun) {
      output(globals, { success: true, dryRun: true, method: "POST", path: "/v1/cli/agents", body });
      return;
    }
    const result = await requestCliJson(runtime, "POST", "/v1/cli/agents", body);
    const config = loadConfig();
    config.baseUrl = result.baseUrl || runtime.baseUrl;
    if (result.agent?.id) config.agentId = result.agent.id;
    if (options.saveSecret && result.key?.apiKey) config.apiKey = result.key.apiKey;
    saveConfig(config);
    output(globals, result, [
      `Created gateway agent ${result.agent?.name || options.name} (${result.agent?.id || "unknown id"}).`,
      `Saved base URL and agent ID to ${displayPath(CONFIG_PATH)}.`,
      result.key?.apiKey ? "A one-time bot API key is in the env block below. Store it now; existing keys are not shown again." : "",
      result.setup?.hermesEnv ? "\nPaste into ~/.hermes/.env:\n```bash\n" + result.setup.hermesEnv + "\n```" : "",
    ].filter(Boolean).join("\n"));
    return;
  }

  if (sub === "keys") {
    const [keyAction] = optionRest;
    if (keyAction !== "create") fail(globals, "bots keys supports: create");
    requireCliRuntime(globals, runtime);
    const agentId = options.agentId || runtime.agentId;
    if (!agentId) fail(globals, "bots keys create requires --agent-id ID or saved agent ID");
    const body = {
      label: options.label,
      runtime: options.runtime || "hermes",
      allowProactiveStarts: Boolean(options.allowProactive || options.allowProactiveStarts),
    };
    const apiPath = `/v1/cli/agents/${encodeURIComponent(agentId)}/keys`;
    if (options.dryRun) {
      output(globals, { success: true, dryRun: true, method: "POST", path: apiPath, body });
      return;
    }
    const result = await requestCliJson(runtime, "POST", apiPath, body);
    const config = loadConfig();
    config.baseUrl = result.baseUrl || runtime.baseUrl;
    config.agentId = result.agent?.id || agentId;
    if (options.saveSecret && result.key?.apiKey) config.apiKey = result.key.apiKey;
    saveConfig(config);
    output(globals, result, [
      `Created gateway key ${result.key?.keyPrefix || ""} for ${result.agent?.name || agentId}.`,
      result.setup?.hermesEnv ? "\nPaste into ~/.hermes/.env:\n```bash\n" + result.setup.hermesEnv + "\n```" : "",
    ].filter(Boolean).join("\n"));
    return;
  }

  if (sub === "webhook") {
    const [webhookAction] = optionRest;
    if (webhookAction !== "set") fail(globals, "bots webhook supports: set");
    requireCliRuntime(globals, runtime);
    const agentId = options.agentId || runtime.agentId;
    if (!agentId) fail(globals, "bots webhook set requires --agent-id ID or saved agent ID");
    if (!options.url) fail(globals, "bots webhook set requires --url https://...");
    let webhookUrl;
    try {
      webhookUrl = normalizeHttpsUrl(options.url);
    } catch {
      fail(globals, "bots webhook set requires a valid https:// URL");
    }
    const body = {
      webhookUrl,
      secret: options.secret,
      events: options.events
        ? String(options.events).split(",").map((event) => event.trim()).filter(Boolean)
        : undefined,
      forwardResponses: Boolean(options.forwardResponses || options.forwardResponse || options.forward),
    };
    const apiPath = `/v1/cli/agents/${encodeURIComponent(agentId)}/webhook`;
    if (options.dryRun) {
      output(globals, { success: true, dryRun: true, method: "POST", path: apiPath, body });
      return;
    }
    const result = await requestCliJson(runtime, "POST", apiPath, body);
    output(globals, result, `Set webhook for ${result.agent?.name || agentId}: ${result.webhook?.url || options.url}`);
    return;
  }

  if (sub === "smoke") {
    requireRuntime(globals, runtime);
    if (!options.chat) fail(globals, "bots smoke requires --chat CHAT_ID");
    const text = options.text || "A1Zap gateway smoke test";
    const messageBody = {
      chatId: options.chat,
      text,
      metadata: {
        source: "a1zap-bots-smoke",
        smokeTest: true,
      },
    };
    if (options.dryRun) {
      output(globals, {
        success: true,
        dryRun: true,
        steps: [
          { method: "GET", path: botPath(runtime, "/updates"), query: { limit: 1, timeout: 0 } },
          { method: "GET", path: botPath(runtime, `/chats/${encodeURIComponent(options.chat)}/participants`) },
          { method: "POST", path: botPath(runtime, `/chats/${encodeURIComponent(options.chat)}/typing`), body: { isTyping: true } },
          { method: "POST", path: botPath(runtime, "/messages"), body: messageBody },
          { method: "POST", path: botPath(runtime, `/chats/${encodeURIComponent(options.chat)}/typing`), body: { isTyping: false } },
          { method: "GET", path: botPath(runtime, `/chats/${encodeURIComponent(options.chat)}/messages`), query: { limit: 25 } },
        ],
      });
      return;
    }

    const report = {
      success: false,
      authOk: false,
      chatAccessOk: false,
      typingOk: false,
      sendOk: false,
      readBackOk: false,
      chatId: options.chat,
      participantsCount: 0,
      messageId: null,
      cursor: null,
      errors: [],
    };

    try {
      const updates = await requestJson(runtime, "GET", botPath(runtime, "/updates"), undefined, {
        limit: 1,
        timeout: 0,
      });
      report.authOk = true;
      report.cursor = updates.cursor || null;
    } catch (error) {
      report.errors.push(`updates: ${error.message}`);
    }

    try {
      const participants = await requestJson(runtime, "GET", botPath(runtime, `/chats/${encodeURIComponent(options.chat)}/participants`));
      report.chatAccessOk = true;
      report.participantsCount = Array.isArray(participants.participants) ? participants.participants.length : 0;
    } catch (error) {
      report.errors.push(`participants: ${error.message}`);
    }

    try {
      await requestJson(runtime, "POST", botPath(runtime, `/chats/${encodeURIComponent(options.chat)}/typing`), { isTyping: true });
      await requestJson(runtime, "POST", botPath(runtime, `/chats/${encodeURIComponent(options.chat)}/typing`), { isTyping: false });
      report.typingOk = true;
    } catch (error) {
      report.errors.push(`typing: ${error.message}`);
    }

    if (!options.readOnly && report.chatAccessOk) {
      try {
        const sent = await requestJson(runtime, "POST", botPath(runtime, "/messages"), messageBody);
        report.sendOk = Boolean(sent.messageId || sent.message?.id);
        report.messageId = sent.messageId || sent.message?.id || null;
      } catch (error) {
        report.errors.push(`send: ${error.message}`);
      }
    } else if (options.readOnly) {
      report.sendOk = true;
    }

    try {
      const messages = await requestJson(runtime, "GET", botPath(runtime, `/chats/${encodeURIComponent(options.chat)}/messages`), undefined, {
        limit: 25,
      });
      const list = Array.isArray(messages.messages) ? messages.messages : [];
      report.readBackOk = options.readOnly
        ? true
        : Boolean(report.messageId && list.some((message) => message.id === report.messageId));
      if (!report.readBackOk && !options.readOnly) {
        report.errors.push("read-back: sent message was not visible in the latest 25 messages");
      }
    } catch (error) {
      report.errors.push(`messages: ${error.message}`);
    }

    report.success = report.authOk && report.chatAccessOk && report.typingOk && report.sendOk && report.readBackOk;
    output(globals, report, report.success ? "A1Zap bot gateway smoke test passed." : "A1Zap bot gateway smoke test failed.");
    if (!report.success && !globals.json) process.exit(1);
    return;
  }

  if (sub === "send") {
    requireRuntime(globals, runtime);
    if (!options.chat) fail(globals, "bots send requires --chat CHAT_ID");
    if (!options.text && !options.bodyJson) fail(globals, "bots send requires --text TEXT or --body-json JSON");
    const body = options.bodyJson
      ? parseJsonOption(globals, options.bodyJson, "--body-json")
      : {
          chatId: options.chat,
          text: options.text,
          replyToMessageId: options.replyTo,
          metadata: parseJsonOption(globals, options.metadataJson, "--metadata-json"),
        };
    if (!body.chatId) body.chatId = options.chat;
    if (options.dryRun) {
      output(globals, { success: true, dryRun: true, method: "POST", path: botPath(runtime, "/messages"), body });
      return;
    }
    const result = await requestJson(runtime, "POST", botPath(runtime, "/messages"), body);
    output(globals, result, result.messageId ? `sent ${result.messageId}` : "sent");
    return;
  }

  if (sub === "messages") {
    requireRuntime(globals, runtime);
    if (!options.chat) fail(globals, "bots messages requires --chat CHAT_ID");
    const result = await requestJson(runtime, "GET", botPath(runtime, `/chats/${encodeURIComponent(options.chat)}/messages`), undefined, {
      limit: options.limit,
      before: options.before,
    });
    output(globals, result);
    return;
  }

  if (sub === "participants") {
    requireRuntime(globals, runtime);
    if (!options.chat) fail(globals, "bots participants requires --chat CHAT_ID");
    const result = await requestJson(runtime, "GET", botPath(runtime, `/chats/${encodeURIComponent(options.chat)}/participants`));
    output(globals, result);
    return;
  }

  if (sub === "updates") {
    requireRuntime(globals, runtime);
    const result = await requestJson(runtime, "GET", botPath(runtime, "/updates"), undefined, {
      cursor: options.cursor,
      limit: options.limit || 25,
      timeout: options.timeout,
    });
    output(globals, result);
    return;
  }

  if (sub === "start") {
    requireRuntime(globals, runtime);
    if (!options.userHandle) fail(globals, "bots start requires --user-handle HANDLE");
    const body = {
      userHandle: options.userHandle,
      initialMessage: options.text || options.initialMessage,
    };
    if (options.dryRun) {
      output(globals, { success: true, dryRun: true, method: "POST", path: botPath(runtime, "/chats/start"), body });
      return;
    }
    const result = await requestJson(runtime, "POST", botPath(runtime, "/chats/start"), body);
    output(globals, result);
    return;
  }

  if (sub === "typing") {
    requireRuntime(globals, runtime);
    if (!options.chat) fail(globals, "bots typing requires --chat CHAT_ID");
    const body = { isTyping: options.off ? false : true };
    const result = await requestJson(runtime, "POST", botPath(runtime, `/chats/${encodeURIComponent(options.chat)}/typing`), body);
    output(globals, result, body.isTyping ? "typing on" : "typing off");
    return;
  }

  if (sub === "dev") {
    await commandDev(globals, options);
    return;
  }

  fail(globals, `Unknown bots command: ${sub || ""}`);
}

async function commandHermes(globals, rest) {
  const [sub = "guide", ...tail] = rest;
  const { options } = parseOptions(tail);
  const runtime = resolveRuntime(globals);

  if (sub === "guide") {
    const agentName = options.agentName || options.name || "Campus Planner";
    const prompt = agentSparkPrompt(agentName);
    const hermesPrompt = hermesGatewayPrompt(agentName);
    const webhookPrompt = webhookFallbackPrompt(agentName);
    const envBlock = hermesEnvBlock(runtime, { includeSecret: false });
    const webhookCommands = [
      "# Hermes webhook fallback: signed event bridge, not the preferred live chat gateway",
      "# Use this only for custom responders or trigger/log workflows. The native plugin is the chat path.",
      "# You can also put WEBHOOK_ENABLED=true, WEBHOOK_PORT=8644, and WEBHOOK_SECRET=... in ~/.hermes/.env",
      "hermes gateway setup",
      "hermes webhook subscribe a1zap-messages \\",
      "  --events \"message.received\" \\",
      "  --prompt \"A1Zap message from {message.sender.name}: {message.text}\" \\",
      "  --description \"A1Zap inbound chat messages\"",
      "",
      "# A1Zap side: paste the HTTPS webhook route and HMAC secret Hermes gives you",
      "# Add --forward-responses only if that route returns JSON reply content.",
      "a1zap-bots bots webhook set \\",
      "  --agent-id AGENT_ID_FROM_A1ZAP \\",
      "  --url https://YOUR-HERMES-TUNNEL/webhooks/a1zap-messages \\",
      "  --secret WEBHOOK_SECRET_FROM_HERMES",
      "# If the route returns JSON reply content, rerun with: --forward-responses",
    ].join("\n");
    const serviceCommands = [
      "# Optional: keep Hermes running in the background after the foreground smoke test passes",
      "hermes gateway install",
      "hermes gateway start",
      "hermes gateway status",
    ].join("\n");
    const guide = [
      "A1Zap <-> Hermes gateway setup",
      "",
      "Fast path: A1Zap creates the agent/key, installs the Hermes platform plugin, and writes ~/.hermes/.env.",
      "```bash",
      sourceInstallBlock(),
      "",
      "a1zap-bots login",
      `a1zap-bots hermes bootstrap --name ${JSON.stringify(agentName)} --write-env`,
      "a1zap-bots hermes doctor",
      "hermes gateway setup",
      "hermes gateway run",
      "```",
      "",
      "Manual path, with each side made explicit:",
      "",
      "1. A1Zap side: create or pick a gateway agent and one-time key:",
      "```bash",
      "a1zap-bots login",
      `a1zap-bots bots create --name ${JSON.stringify(agentName)} --runtime hermes`,
      "```",
      "",
      "Alternative: in A1Zap, start AgentSpark from new chat or the agent settings sidebar.",
      "",
      "Paste this into AgentSpark:",
      "```",
      prompt,
      "```",
      "",
      "Paste this into Hermes if you want the agent itself to walk you through the platform setup:",
      "```",
      hermesPrompt,
      "```",
      "",
      "2. Hermes side: install the native A1Zap messaging platform plugin:",
      "```bash",
      "a1zap-bots hermes install-plugin",
      "```",
      "",
      "3. Existing-agent path: write AgentSpark's values directly into ~/.hermes/.env:",
      "```bash",
      `a1zap-bots --base-url ${runtime.baseUrl || DEFAULT_API_BASE_URL} hermes setup \\`,
      "  --agent-id AGENT_ID_FROM_A1ZAP \\",
      "  --api-key KEY_SHOWN_ONCE \\",
      "  --write-env",
      "a1zap-bots hermes doctor --live",
      "```",
      "",
      "Manual .env fallback, replacing the placeholders with AgentSpark's values:",
      "```bash",
      envBlock,
      "```",
      "",
      "4. A1Zap CLI side: save non-secret defaults and run a dry smoke test after the bot is in a chat:",
      "```bash",
      `a1zap-bots config set --base-url ${runtime.baseUrl || DEFAULT_API_BASE_URL} --agent-id AGENT_ID_FROM_A1ZAP`,
      "export A1ZAP_API_KEY=KEY_SHOWN_ONCE",
      "a1zap-bots hermes doctor",
      "a1zap-bots --json doctor --live",
      "a1zap-bots bots smoke --chat CHAT_ID_FROM_A1ZAP --dry-run",
      "```",
      "",
      "5. Start Hermes:",
      "```bash",
      "hermes gateway setup",
      "hermes gateway run",
      "```",
      "",
      "During `hermes gateway setup`, choose the A1Zap platform. If you used `--write-env`, Hermes can read the A1ZAP_* values from ~/.hermes/.env.",
      "",
      "A1Zap will now act as a Hermes messaging platform. Inbound A1Zap messages arrive as Hermes MessageEvents; Hermes replies post back into the same A1Zap chat.",
      "Normal setup sets A1ZAP_ALLOW_ALL_USERS=true because A1Zap already gates access by chat membership. Use A1ZAP_ALLOWED_USERS instead if you want an extra Hermes-only allowlist.",
      "This is the recommended path for Hermes because it behaves like Telegram, Discord, or Slack inside `hermes gateway`.",
      "",
      "Webhook fallback:",
      "",
      "Hermes' webhook adapter is useful for signed event triggers. It is not the preferred live A1Zap chat gateway unless your route returns a reply body or delivers back through an enabled platform. For chat, use the native A1Zap platform plugin above.",
      "",
      "Paste this into Hermes only if you are using the generic webhook adapter instead of the native platform plugin:",
      "```",
      webhookPrompt,
      "```",
      "",
      "```bash",
      webhookCommands,
      "```",
      "",
      "Background service, after the foreground smoke test passes:",
      "```bash",
      serviceCommands,
      "```",
    ].join("\n");
    output(globals, {
      success: true,
      agentSparkPrompt: prompt,
      hermesGatewayPrompt: hermesPrompt,
      webhookFallbackPrompt: webhookPrompt,
      hermesEnv: envBlock,
      webhookCommands,
      serviceCommands,
      copyPastePrompts: {
        agentSpark: prompt,
        hermesGateway: hermesPrompt,
        hermesWebhookFallback: webhookPrompt,
      },
      installCommand: "a1zap-bots hermes install-plugin",
      setupCommands: [
        ...SOURCE_INSTALL_COMMANDS,
        "a1zap-bots login",
        `a1zap-bots hermes bootstrap --name ${JSON.stringify(agentName)} --write-env`,
        `a1zap-bots bots create --name ${JSON.stringify(agentName)} --runtime hermes`,
        "a1zap-bots hermes install-plugin",
        `a1zap-bots --base-url ${runtime.baseUrl || DEFAULT_API_BASE_URL} hermes setup --agent-id AGENT_ID_FROM_A1ZAP --api-key KEY_SHOWN_ONCE --write-env`,
        "a1zap-bots hermes doctor",
        "a1zap-bots --json doctor --live",
        "a1zap-bots bots smoke --chat CHAT_ID_FROM_A1ZAP --dry-run",
        "hermes gateway setup",
        "hermes gateway run",
        "hermes gateway install",
        "hermes gateway start",
      ],
      docs: {
        pluginDestination: DEFAULT_HERMES_PLUGIN_DIR,
        accessModel: "A1Zap chat membership gates who can reach the bot; Hermes allow-all is only for senders that A1Zap already delivered.",
      },
    }, guide);
    return;
  }

  if (sub === "env") {
    const envBlock = hermesEnvBlock(runtime, { includeSecret: options.includeSecret });
    output(globals, {
      success: true,
      includeSecret: Boolean(options.includeSecret),
      env: envBlock,
    }, envBlock);
    return;
  }

  if (sub === "doctor") {
    const envPath = path.resolve(options.envPath || DEFAULT_HERMES_ENV_PATH);
    const pluginDestination = path.resolve(options.pluginsDir || options.dest || DEFAULT_HERMES_PLUGIN_DIR);
    const hermes = runHermesCommand(["--help"]);
    const plugins = hermes.ok ? runHermesCommand(["plugins", "list"]) : { ok: false, error: "Hermes is not available" };
    const envFile = readHermesEnvFile(envPath);
    const hermesRuntime = runtimeWithHermesEnv(runtime, envFile.values);
    const hasBaseUrl = Boolean(hermesRuntime.baseUrl);
    const hasAgentId = Boolean(hermesRuntime.agentId);
    const hasApiKey = Boolean(hermesRuntime.apiKey);
    const allowAllUsers = truthyEnv(envFile.values.A1ZAP_ALLOW_ALL_USERS || process.env.A1ZAP_ALLOW_ALL_USERS);
    const allowedUsers = listEnv(envFile.values.A1ZAP_ALLOWED_USERS || process.env.A1ZAP_ALLOWED_USERS);
    const sourceManifest = readHermesPluginManifest(HERMES_PLUGIN_SOURCE);
    const installedManifest = readHermesPluginManifest(pluginDestination);
    const pluginInstalled = installedManifest.exists;
    const pluginNeedsUpdate = Boolean(
      sourceManifest.version
        && installedManifest.version
        && sourceManifest.version !== installedManifest.version,
    );
    const pluginListed = Boolean(plugins.ok && /a1zap/i.test(plugins.output || ""));
    const report = {
      success: true,
      hermes: {
        available: hermes.ok,
        error: hermes.ok ? null : hermes.error,
      },
      plugin: {
        source: HERMES_PLUGIN_SOURCE,
        destination: pluginDestination,
        installed: pluginInstalled,
        listedByHermes: pluginListed,
        sourceVersion: sourceManifest.version,
        installedVersion: installedManifest.version,
        needsUpdate: pluginNeedsUpdate,
        enableCommand: `hermes plugins enable ${HERMES_PLUGIN_ENABLE_KEY}`,
      },
      env: {
        path: envPath,
        exists: envFile.exists,
        hasBaseUrl,
        hasAgentId,
        hasApiKey,
        baseUrl: hermesRuntime.baseUrl || null,
        agentId: hermesRuntime.agentId || null,
        apiKey: {
          present: hasApiKey,
          source: hermesRuntime.apiKeySource,
          preview: redact(hermesRuntime.apiKey),
        },
      },
      access: {
        allowAllA1ZapChatMembers: allowAllUsers,
        allowedUsersCount: allowedUsers.length,
        readyForInboundMessages: allowAllUsers || allowedUsers.length > 0,
        recommendation:
          allowAllUsers || allowedUsers.length > 0
            ? "A1Zap inbound access is configured for Hermes."
            : "Set A1ZAP_ALLOW_ALL_USERS=true to trust A1Zap chat membership, or fill A1ZAP_ALLOWED_USERS with sender IDs/handles.",
      },
      readyForHermesGateway: Boolean(hermes.ok && pluginInstalled && !pluginNeedsUpdate && hasBaseUrl && hasAgentId && hasApiKey),
      network: {
        checked: false,
        ok: null,
        error: null,
      },
      commands: {
        installCliFromSource: SOURCE_INSTALL_COMMANDS,
        publishedInstallCommand: PUBLISHED_INSTALL_COMMAND,
        publishedPackageAvailable: false,
        bootstrapNewAgent: "a1zap-bots hermes bootstrap --name \"Campus Planner\" --write-env",
        setupExistingAgent: `a1zap-bots --base-url ${hermesRuntime.baseUrl || DEFAULT_API_BASE_URL} hermes setup --agent-id AGENT_ID_FROM_A1ZAP --api-key KEY_SHOWN_ONCE --write-env`,
        runForeground: ["hermes gateway setup", "hermes gateway run"],
        smokeTest: "a1zap-bots bots smoke --chat CHAT_ID_FROM_A1ZAP --dry-run",
        runBackground: ["hermes gateway install", "hermes gateway start", "hermes gateway status"],
      },
      next: [],
    };

    if (!hermes.ok) report.next.push("Install Hermes and confirm `hermes --help` works.");
    if (!pluginInstalled) report.next.push("Run `a1zap-bots hermes install-plugin`.");
    if (pluginNeedsUpdate) report.next.push("Run `a1zap-bots hermes install-plugin` to update the A1Zap Hermes platform plugin.");
    if (!pluginListed) report.next.push(`Run \`hermes plugins enable ${HERMES_PLUGIN_ENABLE_KEY}\` if your Hermes version requires opt-in plugins.`);
    if (!hasBaseUrl || !hasAgentId || !hasApiKey) {
      report.next.push("Run `a1zap-bots hermes bootstrap --name \"Campus Planner\" --write-env` or paste A1ZAP_* values into ~/.hermes/.env.");
    }
    if (!allowAllUsers && allowedUsers.length === 0) {
      report.next.push("Set `A1ZAP_ALLOW_ALL_USERS=true` for normal A1Zap chat-member access, or fill `A1ZAP_ALLOWED_USERS` for a stricter Hermes allowlist.");
    }
    if (report.readyForHermesGateway) {
      report.next.push("Run `hermes gateway setup`, then `hermes gateway run`.");
      report.next.push("After the bot is in an A1Zap chat, run `a1zap-bots bots smoke --chat CHAT_ID_FROM_A1ZAP --dry-run`.");
    }

    if (options.live && hasBaseUrl && hasAgentId && hasApiKey) {
      report.network.checked = true;
      try {
        await requestJson(hermesRuntime, "GET", botPath(hermesRuntime, "/updates"), undefined, { limit: 1, timeout: 0 });
        report.network.ok = true;
      } catch (error) {
        report.success = false;
        report.network.ok = false;
        report.network.error = error.message;
      }
    }

    if (!report.readyForHermesGateway) {
      report.success = false;
    }

    output(
      globals,
      report,
      report.readyForHermesGateway
        ? "A1Zap is ready for Hermes gateway. Run `hermes gateway setup`, then `hermes gateway run`."
        : `A1Zap Hermes setup needs attention:\n- ${report.next.join("\n- ")}`,
    );
    return;
  }

  if (sub === "install-plugin") {
    const destination = path.resolve(options.pluginsDir || options.dest || DEFAULT_HERMES_PLUGIN_DIR);
    if (!options.dryRun) {
      copyDirectory(HERMES_PLUGIN_SOURCE, destination);
    }
    const enableResult = enableHermesPlugin({
      dryRun: Boolean(options.dryRun),
      skipEnable: Boolean(options.noEnable || options.skipEnable),
    });
    const result = {
      success: true,
      dryRun: Boolean(options.dryRun),
      source: HERMES_PLUGIN_SOURCE,
      destination,
      enable: enableResult,
    };
    output(
      globals,
      result,
      options.dryRun
        ? `Would install A1Zap Hermes plugin to ${displayPath(destination)}\nWould enable with: ${enableResult.command}`
        : [
            `Installed A1Zap Hermes plugin to ${displayPath(destination)}`,
            enableResult.enabled
              ? "Enabled Hermes plugin a1zap."
              : `Enable it with: ${enableResult.command}`,
          ].join("\n"),
    );
    return;
  }

  if (sub === "bootstrap") {
    requireCliRuntime(globals, runtime);
    const name = options.name || options.agentName;
    if (!name) fail(globals, "hermes bootstrap requires --name NAME");

    const createResult = await requestCliJson(runtime, "POST", "/v1/cli/agents", {
      name,
      handle: options.handle,
      description: options.description,
      runtime: "hermes",
      allowProactiveStarts: Boolean(options.allowProactive || options.allowProactiveStarts),
      createKey: true,
    });

    const config = loadConfig();
    config.baseUrl = createResult.baseUrl || runtime.baseUrl;
    if (createResult.agent?.id) config.agentId = createResult.agent.id;
    if (options.saveSecret && createResult.key?.apiKey) config.apiKey = createResult.key.apiKey;
    saveConfig(config);

    const destination = path.resolve(options.pluginsDir || options.dest || DEFAULT_HERMES_PLUGIN_DIR);
    if (!options.skipInstall) {
      copyDirectory(HERMES_PLUGIN_SOURCE, destination);
    }
    const enableResult = enableHermesPlugin({
      skipEnable: Boolean(options.noEnable || options.skipEnable),
    });

    const envBlock = createResult.setup?.hermesEnv || hermesEnvBlock(
      {
        baseUrl: createResult.baseUrl || runtime.baseUrl,
        agentId: createResult.agent?.id,
        apiKey: createResult.key?.apiKey,
      },
      { includeSecret: Boolean(createResult.key?.apiKey) },
    );

    let envFile = null;
    if (options.writeEnv) {
      envFile = upsertEnvFile(path.resolve(options.envPath || DEFAULT_HERMES_ENV_PATH), parseEnvBlock(envBlock));
    }

    output(globals, {
      success: true,
      agent: createResult.agent,
      key: createResult.key,
      baseUrl: createResult.baseUrl,
      configPath: CONFIG_PATH,
      pluginDestination: options.skipInstall ? null : destination,
      enable: enableResult,
      envFile,
      savedSecret: Boolean(options.saveSecret && createResult.key?.apiKey),
      hermesEnv: envBlock,
      nextCommands: [
        "a1zap-bots hermes doctor",
        "hermes gateway setup",
        "hermes gateway run",
        "a1zap-bots bots smoke --chat CHAT_ID_FROM_A1ZAP --dry-run",
      ],
    }, [
      `Created Hermes gateway agent ${createResult.agent?.name || name} (${createResult.agent?.id || "unknown id"}).`,
      `Saved base URL and agent ID to ${displayPath(CONFIG_PATH)}.`,
      options.skipInstall ? "Skipped plugin install." : `Plugin installed to ${displayPath(destination)}.`,
      enableResult.enabled
        ? "Hermes plugin a1zap is enabled."
        : `Enable it with: ${enableResult.command}`,
      envFile
        ? `Wrote A1Zap values to ${displayPath(envFile.path)}.`
        : "Paste this into ~/.hermes/.env:",
      envFile ? "" : "```bash",
      envFile ? "" : envBlock,
      envFile ? "" : "```",
      "",
      "Then run:",
      "```bash",
      "a1zap-bots hermes doctor",
      "hermes gateway setup",
      "hermes gateway run",
      "```",
      "",
      "Once the bot is in an A1Zap chat:",
      "```bash",
      "a1zap-bots bots smoke --chat CHAT_ID_FROM_A1ZAP --dry-run",
      "```",
    ].filter((line) => line !== "").join("\n"));
    return;
  }

  if (sub === "setup") {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const existingBaseUrl = runtime.baseUrl || "";
      const existingAgentId = runtime.agentId || "";
      const baseUrl =
        options.baseUrl ||
        existingBaseUrl ||
        (await rl.question(`A1Zap base URL${existingBaseUrl ? ` [${existingBaseUrl}]` : ""}: `));
      const agentId =
        options.agentId ||
        existingAgentId ||
        (await rl.question(`A1Zap agent ID${existingAgentId ? ` [${existingAgentId}]` : ""}: `));
      const apiKey =
        options.apiKey ||
        runtime.apiKey ||
        (await rl.question("One-time API key from AgentSpark (input is visible; leave blank to skip): "));
      if (!baseUrl) fail(globals, "Hermes setup needs an A1Zap base URL.");
      if (!agentId) fail(globals, "Hermes setup needs an A1Zap agent ID.");

      const config = loadConfig();
      config.baseUrl = normalizeBaseUrl(baseUrl);
      config.agentId = agentId;
      if (options.saveSecret && apiKey) config.apiKey = apiKey;
      saveConfig(config);

      if (!options.skipInstall) {
        copyDirectory(HERMES_PLUGIN_SOURCE, DEFAULT_HERMES_PLUGIN_DIR);
      }
      const enableResult = enableHermesPlugin({
        skipEnable: Boolean(options.noEnable || options.skipEnable),
      });

      const setupRuntime = { baseUrl: config.baseUrl, agentId: config.agentId, apiKey };
      const envBlock = hermesEnvBlock(setupRuntime, { includeSecret: Boolean(apiKey) });
      let envFile = null;
      if (options.writeEnv) {
        envFile = upsertEnvFile(path.resolve(options.envPath || DEFAULT_HERMES_ENV_PATH), parseEnvBlock(envBlock));
      }
      const printableEnvBlock = envFile
        ? hermesEnvBlock(setupRuntime, { includeSecret: false })
        : envBlock;
      output(globals, {
        success: true,
        configPath: CONFIG_PATH,
        pluginDestination: options.skipInstall ? null : DEFAULT_HERMES_PLUGIN_DIR,
        enable: enableResult,
        savedSecret: Boolean(options.saveSecret && apiKey),
        envFile,
        hermesEnv: printableEnvBlock,
        nextCommands: [
          "a1zap-bots hermes doctor",
          "hermes gateway setup",
          "hermes gateway run",
          "a1zap-bots bots smoke --chat CHAT_ID_FROM_A1ZAP --dry-run",
        ],
      }, [
        "A1Zap Hermes setup is ready.",
        "",
        `CLI config saved to ${displayPath(CONFIG_PATH)}.`,
        options.skipInstall ? "Skipped plugin install." : `Plugin installed to ${displayPath(DEFAULT_HERMES_PLUGIN_DIR)}.`,
        enableResult.enabled
          ? "Hermes plugin a1zap is enabled."
          : `Enable it with: ${enableResult.command}`,
        "",
        envFile
          ? `Wrote A1Zap values to ${displayPath(envFile.path)}. The key is stored there, not reprinted here.`
          : "Paste this into ~/.hermes/.env:",
        envFile ? "" : "```bash",
        envFile ? "" : envBlock,
        envFile ? "" : "```",
        "",
        "Then run:",
        "```bash",
        "a1zap-bots hermes doctor",
        "hermes gateway setup",
        "hermes gateway run",
        "```",
        "",
        "After the bot is in an A1Zap chat:",
        "```bash",
        "a1zap-bots bots smoke --chat CHAT_ID_FROM_A1ZAP --dry-run",
        "```",
      ].join("\n"));
    } finally {
      rl.close();
    }
    return;
  }

  fail(globals, `Unknown hermes command: ${sub || ""}`);
}

async function commandOpenClaw(globals, rest) {
  const [sub = "init", ...tail] = rest;
  const { options } = parseOptions(tail);
  const runtime = resolveRuntime(globals);
  if (sub !== "init") fail(globals, `Unknown openclaw command: ${sub || ""}`);

  const agentName = options.agentName || options.name || "Campus Planner";
  const target = options.target || "http://localhost:8787/a1zap";
  const envBlock = [
    "# A1Zap bot gateway for OpenClaw or any local HTTP adapter",
    `A1ZAP_BASE_URL=${runtime.baseUrl || DEFAULT_API_BASE_URL}`,
    `A1ZAP_AGENT_ID=${runtime.agentId || "AGENT_ID_FROM_A1ZAP"}`,
    `A1ZAP_API_KEY=${runtime.apiKey || "<paste_key_shown_once>"}`,
  ].join("\n");
  const bridgeCommand = `a1zap-bots bots dev --target ${target}`;
  const guide = [
    "A1Zap <-> OpenClaw/local agent setup",
    "",
    "1. Create or pick an A1Zap gateway agent:",
    "```bash",
    "a1zap-bots login",
    `a1zap-bots bots create --name ${JSON.stringify(agentName)} --runtime openclaw`,
    "```",
    "",
    "2. Put the one-time key into your local agent environment:",
    "```bash",
    envBlock,
    "```",
    "",
    "3. Run your OpenClaw/local agent HTTP adapter at:",
    target,
    "",
    "It should accept POST bodies shaped like:",
    "```json",
    JSON.stringify({ event: { type: "message.received", message: { chatId: "chat_id", text: "hello" } } }, null, 2),
    "```",
    "",
    "And return any of:",
    "```json",
    JSON.stringify({ text: "reply" }, null, 2),
    "```",
    "",
    "4. Start the bridge:",
    "```bash",
    bridgeCommand,
    "```",
  ].join("\n");

  output(globals, {
    success: true,
    agentName,
    env: envBlock,
    target,
    bridgeCommand,
    setupCommands: [
      "a1zap-bots login",
      `a1zap-bots bots create --name ${JSON.stringify(agentName)} --runtime openclaw`,
      bridgeCommand,
    ],
    adapterContract: {
      inbound: { event: "A1Zap update event" },
      replies: [
        { text: "reply" },
        { reply: "reply" },
        { messages: [{ text: "reply" }] },
        { replies: [{ text: "reply" }] },
      ],
    },
  }, guide);
}

function eventChatId(event) {
  return event?.chatId || event?.message?.chatId || event?.data?.chatId || event?.chat?.id || null;
}

function normalizeReplies(payload) {
  if (!payload) return [];
  if (typeof payload === "string") return [{ text: payload }];
  if (payload.text) return [payload];
  if (payload.reply) return typeof payload.reply === "string" ? [{ text: payload.reply }] : [payload.reply];
  if (Array.isArray(payload.messages)) return payload.messages;
  if (Array.isArray(payload.replies)) return payload.replies;
  return [];
}

async function commandDev(globals, options) {
  const runtime = resolveRuntime(globals);
  requireRuntime(globals, runtime);
  if (!options.target) fail(globals, "bots dev requires --target URL");
  let cursor = options.cursor;
  const limit = options.limit || 25;
  const intervalMs = Number(options.intervalMs || 2000);

  do {
    const updates = await requestJson(runtime, "GET", botPath(runtime, "/updates"), undefined, {
      cursor,
      limit,
      timeout: options.timeout || 25,
    });
    cursor = updates.cursor || cursor;
    const events = Array.isArray(updates.events) ? updates.events : [];

    for (const event of events) {
      const response = await fetch(options.target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event }),
      });
      if (!response.ok) {
        console.error(`local target failed: HTTP ${response.status}`);
        continue;
      }
      const payload = await response.json().catch(() => null);
      for (const reply of normalizeReplies(payload)) {
        const chatId = reply.chatId || eventChatId(event);
        if (!chatId || !reply.text) continue;
        await requestJson(runtime, "POST", botPath(runtime, "/messages"), {
          chatId,
          text: reply.text,
          metadata: {
            ...(reply.metadata || {}),
            source: reply.metadata?.source || "a1zap-bots-dev",
          },
        });
      }
    }

    const status = { success: true, cursor, eventCount: events.length, once: Boolean(options.once) };
    if (globals.json || options.once) output(globals, status, `processed ${events.length} events`);
    if (options.once) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
}

async function commandRequest(globals, rest) {
  const [method, apiPath, ...tail] = rest;
  if (!method || !apiPath) fail(globals, "request requires METHOD PATH");
  const { options } = parseOptions(tail);
  const runtime = resolveRuntime(globals);
  requireRuntime(globals, runtime);
  const body = parseJsonOption(globals, options.bodyJson, "--body-json");
  const result = await requestJson(runtime, method.toUpperCase(), apiPath, body);
  output(globals, result);
}

async function main() {
  const { globals, args } = parseArgs(process.argv.slice(2));
  if (globals.version) {
    console.log(VERSION);
    return;
  }
  if (globals.help || args.length === 0) {
    console.log(usage());
    return;
  }

  const [command, ...rest] = args;
  try {
    if (command === "doctor") await commandDoctor(globals, rest);
    else if (command === "login") await commandLogin(globals, rest);
    else if (command === "config") await commandConfig(globals, rest);
    else if (command === "bots") await commandBots(globals, rest);
    else if (command === "hermes") await commandHermes(globals, rest);
    else if (command === "openclaw") await commandOpenClaw(globals, rest);
    else if (command === "request") await commandRequest(globals, rest);
    else fail(globals, `Unknown command: ${command}`);
  } catch (error) {
    fail(globals, error.message || String(error), 1, error.status ? { status: error.status, data: error.data } : {});
  }
}

main();
