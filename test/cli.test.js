import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const cli = path.resolve("bin/a1zap-bots.js");
const execFileAsync = promisify(execFile);

function run(args, extraEnv = {}) {
  const home = extraEnv.HOME || fs.mkdtempSync(path.join(os.tmpdir(), "a1zap-bots-test-"));
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: path.resolve("."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: home,
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

function runAsync(args, extraEnv = {}) {
  const home = extraEnv.HOME || fs.mkdtempSync(path.join(os.tmpdir(), "a1zap-bots-test-"));
  return execFileAsync(process.execPath, [cli, ...args], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      HOME: home,
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("doctor emits stable JSON without auth", () => {
  const output = run(["--json", "doctor"]);
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.equal(data.readyForSend, false);
  assert.equal(data.apiKey.present, false);
  assert.equal(data.install.publishedPackageAvailable, false);
  assert.equal(data.install.githubInstallCommand, "npm install -g github:a1baseai/a1zap-bots-cli");
  assert.equal(data.install.pinnedGithubInstallCommand, "npm install -g github:a1baseai/a1zap-bots-cli#v0.1.2");
  assert.deepEqual(data.install.sourceCommands, [
    "git clone https://github.com/a1baseai/a1zap-bots-cli.git",
    "cd a1zap-bots-cli",
    "npm run install-local",
  ]);
  assert.match(data.next.join("\n"), /a1zap-bots login/);
});

test("doctor setup-live checks the public device-login route", async () => {
  await withServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        verificationUri: "https://app.example.com/cli/device",
      }));
    });
  }, async (baseUrl) => {
    const { stdout } = await runAsync([
      "--json",
      "--base-url",
      baseUrl,
      "doctor",
      "--setup-live",
      "--web-url",
      "https://app.example.com",
    ]);
    const data = JSON.parse(stdout);
    assert.equal(data.success, true);
    assert.equal(data.setupRoute.checked, true);
    assert.equal(data.setupRoute.ok, true);
    assert.equal(data.setupRoute.verificationUri, "https://app.example.com/cli/device");
    assert.equal(data.setupRoute.fallbackBaseUrl, "https://dusty-sandpiper-500.convex.site");
  });
});

test("doctor setup-live points branded proxy failures at the direct Convex gateway", async () => {
  await withServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<!doctype html><html><body>not the API route</body></html>");
    });
  }, async (baseUrl) => {
    const { stdout } = await runAsync([
      "--json",
      "--base-url",
      baseUrl,
      "doctor",
      "--setup-live",
      "--web-url",
      "https://app.example.com",
    ]);
    const data = JSON.parse(stdout);
    assert.equal(data.success, false);
    assert.equal(data.setupRoute.ok, false);
    assert.match(data.setupRoute.error, /Cloudflare \/v1 proxy may not be deployed/);
    assert.equal(data.setupRoute.fallbackCommand, "a1zap-bots config set --base-url https://dusty-sandpiper-500.convex.site");
    assert.match(data.next.join("\n"), /direct Convex gateway/);
  });
});

test("send dry-run builds the canonical bot message request", () => {
  const output = run([
    "--json",
    "--base-url",
    "https://example.convex.cloud",
    "--agent-id",
    "agent_123",
    "bots",
    "send",
    "--chat",
    "chat_123",
    "--text",
    "Hello from test",
    "--dry-run",
  ], {
    A1ZAP_API_KEY: "test_key_secret",
  });
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.equal(data.dryRun, true);
  assert.equal(data.path, "/v1/bots/agent_123/messages");
  assert.equal(data.body.chatId, "chat_123");
  assert.equal(data.body.text, "Hello from test");
});

test("config set stores global config flags", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "a1zap-bots-test-"));
  run([
    "config",
    "set",
    "--base-url",
    "https://example.convex.cloud",
    "--agent-id",
    "agent_123",
    "--api-key",
    "secret_key_123",
  ], { HOME: home });
  const output = run(["--json", "config", "show"], { HOME: home });
  const data = JSON.parse(output);
  assert.equal(data.baseUrl, "https://example.convex.site");
  assert.equal(data.agentId, "agent_123");
  assert.equal(data.apiKeyPresent, true);
});

test("login dry-run builds device login request", () => {
  const output = run([
    "--json",
    "--base-url",
    "https://api.example.com",
    "login",
    "--web-url",
    "https://app.example.com",
    "--dry-run",
  ]);
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.equal(data.dryRun, true);
  assert.equal(data.path, "/v1/cli/device-login/start");
  assert.equal(data.body.verificationBaseUrl, "https://app.example.com");
});

test("login JSON output includes a concrete poll command", async () => {
  await withServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        deviceCode: "a1dc_test_device_code",
        displayUserCode: "A1-TEST-1234",
        verificationUri: "https://app.example.com/cli/device",
        verificationUriComplete: "https://app.example.com/cli/device?code=A1-TEST-1234",
        expiresAt: Date.now() + 600000,
        interval: 1,
      }));
    });
  }, async (baseUrl) => {
    const { stdout } = await runAsync([
      "--json",
      "--base-url",
      baseUrl,
      "login",
      "--web-url",
      "https://app.example.com",
    ]);
    const data = JSON.parse(stdout);
    assert.equal(data.success, true);
    assert.equal(data.deviceCode, "a1dc_test_device_code");
    assert.equal(data.pollCommand, "a1zap-bots login --device-code a1dc_test_device_code");
    assert.match(data.next, /a1zap-bots login --device-code a1dc_test_device_code/);
  });
});

test("login can poll an existing device code and save CLI token", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "a1zap-bots-test-"));
  await withServer((req, res) => {
    req.resume();
    req.on("end", () => {
      assert.equal(req.url, "/v1/cli/device-login/poll");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        status: "approved",
        cliToken: "a1cli_test_saved_secret",
        scopes: ["agents:read", "agents:write"],
      }));
    });
  }, async (baseUrl) => {
    const { stdout } = await runAsync([
      "--json",
      "--base-url",
      baseUrl,
      "login",
      "--device-code",
      "a1dc_test_device_code",
      "--timeout",
      "1",
    ], { HOME: home });
    const data = JSON.parse(stdout);
    assert.equal(data.success, true);
    assert.equal(data.status, "approved");

    const config = JSON.parse(fs.readFileSync(path.join(home, ".a1zap-bots", "config.json"), "utf8"));
    assert.equal(config.baseUrl, baseUrl);
    assert.equal(config.cliToken, "a1cli_test_saved_secret");
  });
});

test("login reports non-JSON public API routes clearly", async () => {
  await withServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<!doctype html><html><body>not the API route</body></html>");
    });
  }, async (baseUrl) => {
    try {
      await runAsync([
        "--json",
        "--base-url",
        baseUrl,
        "login",
        "--web-url",
        "https://app.example.com",
      ]);
      assert.fail("login should fail against an HTML route");
    } catch (error) {
      const stderr = error.stderr.toString();
      const data = JSON.parse(stderr);
      assert.equal(data.success, false);
      assert.equal(data.status, 404);
      assert.match(data.error, /did not return JSON/);
      assert.match(data.error, /Cloudflare \/v1 proxy may not be deployed/);
      assert.equal(data.data.contentType, "text/html");
      assert.ok(data.data.rawPreview.length < 260);
    }
  });
});

test("bots create dry-run uses owner CLI endpoint", () => {
  const output = run([
    "--json",
    "--base-url",
    "https://api.example.com",
    "--cli-token",
    "a1cli_test_secret",
    "bots",
    "create",
    "--name",
    "Campus Planner",
    "--handle",
    "campus-planner",
    "--dry-run",
  ]);
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.equal(data.path, "/v1/cli/agents");
  assert.equal(data.body.name, "Campus Planner");
  assert.equal(data.body.handle, "campus-planner");
});

test("bots keys dry-run uses saved agent id and owner CLI endpoint", () => {
  const output = run([
    "--json",
    "--base-url",
    "https://api.example.com",
    "--agent-id",
    "agent_123",
    "--cli-token",
    "a1cli_test_secret",
    "bots",
    "keys",
    "create",
    "--dry-run",
  ]);
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.equal(data.path, "/v1/cli/agents/agent_123/keys");
});

test("bots webhook dry-run can enable Hermes response forwarding", () => {
  const output = run([
    "--json",
    "--base-url",
    "https://api.example.com",
    "--agent-id",
    "agent_123",
    "--cli-token",
    "a1cli_test_secret",
    "bots",
    "webhook",
    "set",
    "--url",
    "https://hermes.example.com/webhooks/a1zap",
    "--secret",
    "test_secret",
    "--forward-responses",
    "--dry-run",
  ]);
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.equal(data.path, "/v1/cli/agents/agent_123/webhook");
  assert.equal(data.body.webhookUrl, "https://hermes.example.com/webhooks/a1zap");
  assert.equal(data.body.forwardResponses, true);
});

test("bots webhook rejects non-https URLs before submission", () => {
  assert.throws(
    () => run([
      "--json",
      "--base-url",
      "https://api.example.com",
      "--agent-id",
      "agent_123",
      "--cli-token",
      "a1cli_test_secret",
      "bots",
      "webhook",
      "set",
      "--url",
      "http://localhost:8644/webhooks/a1zap",
      "--dry-run",
    ]),
    /valid https:\/\/ URL/,
  );
});

test("bots smoke dry-run builds end-to-end gateway checks", () => {
  const output = run([
    "--json",
    "--base-url",
    "https://api.example.com",
    "--agent-id",
    "agent_123",
    "bots",
    "smoke",
    "--chat",
    "chat_123",
    "--text",
    "Smoke hello",
    "--dry-run",
  ], {
    A1ZAP_API_KEY: "test_key_secret",
  });
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.equal(data.dryRun, true);
  assert.equal(data.steps[0].path, "/v1/bots/agent_123/updates");
  assert.equal(data.steps[1].path, "/v1/bots/agent_123/chats/chat_123/participants");
  assert.equal(data.steps[3].path, "/v1/bots/agent_123/messages");
  assert.equal(data.steps[3].body.text, "Smoke hello");
});

test("hermes env redacts secrets unless explicitly requested", () => {
  const output = run([
    "--json",
    "--base-url",
    "https://example.convex.cloud",
    "--agent-id",
    "agent_123",
    "--api-key",
    "secret_key_123",
    "hermes",
    "env",
  ]);
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.match(data.env, /A1ZAP_BASE_URL=https:\/\/example\.convex\.site/);
  assert.match(data.env, /A1ZAP_AGENT_ID=agent_123/);
  assert.match(data.env, /A1ZAP_API_KEY=<paste_key_shown_once_from_AgentSpark>/);
  assert.match(data.env, /A1ZAP_ALLOW_ALL_USERS=true/);
  assert.doesNotMatch(data.env, /secret_key_123/);
});

test("hermes install-plugin dry-run points at the Hermes platform plugin destination", () => {
  const output = run(["--json", "hermes", "install-plugin", "--dry-run"]);
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.equal(data.dryRun, true);
  assert.match(data.source, /hermes-plugin\/a1zap$/);
  assert.match(data.destination, /\.hermes\/plugins\/a1zap$/);
  assert.equal(data.enable.dryRun, true);
  assert.equal(data.enable.command, "hermes plugins enable a1zap");
});

test("hermes doctor checks plugin install and Hermes env without printing secrets", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "a1zap-bots-test-"));
  const fakeBin = path.join(home, "bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  const fakeHermes = path.join(fakeBin, "hermes");
  fs.writeFileSync(
    fakeHermes,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"plugins\" ]; then",
      "  echo 'a1zap enabled'",
      "else",
      "  echo 'Hermes fake'",
      "fi",
    ].join("\n"),
  );
  fs.chmodSync(fakeHermes, 0o755);

  const pluginDir = path.join(home, ".hermes", "plugins", "a1zap");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "plugin.yaml"), "name: a1zap\nversion: 0.2.1\n");
  const envDir = path.join(home, ".hermes");
  fs.mkdirSync(envDir, { recursive: true });
  fs.writeFileSync(path.join(envDir, ".env"), [
    "A1ZAP_BASE_URL=https://example.convex.site",
    "A1ZAP_AGENT_ID=agent_123",
    "A1ZAP_API_KEY=secret_key_123",
    "A1ZAP_ALLOW_ALL_USERS=true",
  ].join("\n"));

  const output = run(["--json", "hermes", "doctor"], {
    HOME: home,
    PATH: `${fakeBin}:${process.env.PATH}`,
  });
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.equal(data.readyForHermesGateway, true);
  assert.equal(data.plugin.installed, true);
  assert.equal(data.plugin.listedByHermes, true);
  assert.equal(data.plugin.needsUpdate, false);
  assert.equal(data.env.hasBaseUrl, true);
  assert.equal(data.env.hasAgentId, true);
  assert.equal(data.env.hasApiKey, true);
  assert.equal(data.access.allowAllA1ZapChatMembers, true);
  assert.equal(data.access.readyForInboundMessages, true);
  assert.equal(data.commands.bootstrapNewAgent, "a1zap-bots hermes bootstrap --name \"Campus Planner\" --write-env");
  assert.deepEqual(data.commands.runForeground, ["hermes gateway setup", "hermes gateway run"]);
  assert.notEqual(data.env.apiKey.preview, "secret_key_123");
  assert.equal(JSON.stringify(data).includes("secret_key_123"), false);
});

test("hermes bootstrap creates a gateway agent and can write Hermes env", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "a1zap-bots-test-"));
  let testBaseUrl = "";
  await withServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      assert.equal(req.method, "POST");
      assert.equal(req.url, "/v1/cli/agents");
      assert.equal(req.headers.authorization, "Bearer a1cli_test_secret");
      const parsed = JSON.parse(body);
      assert.equal(parsed.name, "Campus Planner");
      assert.equal(parsed.runtime, "hermes");
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        baseUrl: testBaseUrl,
        agent: { id: "agent_123", name: "Campus Planner", handle: "campus-planner" },
        key: {
          id: "key_123",
          apiKey: "a1bot_test_secret",
          keyPrefix: "a1bot_test",
          scopes: ["agent:read", "messages:read", "messages:write"],
          shownOnce: true,
        },
        setup: {
          hermesEnv: [
            "# A1Zap Hermes platform adapter",
            `A1ZAP_BASE_URL=${testBaseUrl}`,
            "A1ZAP_AGENT_ID=agent_123",
            "A1ZAP_API_KEY=a1bot_test_secret",
            "A1ZAP_HOME_CHANNEL=",
            "A1ZAP_ALLOWED_USERS=",
            "A1ZAP_ALLOW_ALL_USERS=true",
            "A1ZAP_LONG_POLL_SECONDS=25",
          ].join("\n"),
        },
      }));
    });
  }, async (baseUrl) => {
    testBaseUrl = baseUrl;
    const { stdout } = await runAsync([
      "--json",
      "--base-url",
      baseUrl,
      "--cli-token",
      "a1cli_test_secret",
      "hermes",
      "bootstrap",
      "--name",
      "Campus Planner",
      "--skip-install",
      "--skip-enable",
      "--write-env",
    ], { HOME: home });
    const data = JSON.parse(stdout);
    assert.equal(data.success, true);
    assert.equal(data.agent.id, "agent_123");
    assert.equal(data.envFile.path, path.join(home, ".hermes", ".env"));

    const config = JSON.parse(fs.readFileSync(path.join(home, ".a1zap-bots", "config.json"), "utf8"));
    assert.equal(config.agentId, "agent_123");
    assert.equal(config.baseUrl, baseUrl);
    assert.equal(config.apiKey, undefined);

    const envText = fs.readFileSync(path.join(home, ".hermes", ".env"), "utf8");
    assert.match(envText, new RegExp(`A1ZAP_BASE_URL=${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(envText, /A1ZAP_AGENT_ID=agent_123/);
    assert.match(envText, /A1ZAP_API_KEY=a1bot_test_secret/);
  });
});

test("hermes setup can write an existing gateway agent into Hermes env", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "a1zap-bots-test-"));
  const fakeBin = path.join(home, "bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  const fakeHermes = path.join(fakeBin, "hermes");
  fs.writeFileSync(
    fakeHermes,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"plugins\" ]; then",
      "  exit 0",
      "fi",
      "echo 'Hermes fake'",
    ].join("\n"),
  );
  fs.chmodSync(fakeHermes, 0o755);

  const output = run([
    "--json",
    "--base-url",
    "https://example.convex.cloud",
    "hermes",
    "setup",
    "--agent-id",
    "agent_123",
    "--api-key",
    "a1bot_test_secret",
    "--skip-install",
    "--skip-enable",
    "--write-env",
  ], {
    HOME: home,
    PATH: `${fakeBin}:${process.env.PATH}`,
  });
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.equal(data.envFile.path, path.join(home, ".hermes", ".env"));
  assert.equal(JSON.stringify(data).includes("a1bot_test_secret"), false);

  const envText = fs.readFileSync(path.join(home, ".hermes", ".env"), "utf8");
  assert.match(envText, /A1ZAP_BASE_URL=https:\/\/example\.convex\.site/);
  assert.match(envText, /A1ZAP_AGENT_ID=agent_123/);
  assert.match(envText, /A1ZAP_API_KEY=a1bot_test_secret/);
  assert.match(envText, /A1ZAP_ALLOW_ALL_USERS=true/);
});

test("Hermes plugin smoke covers registration, send, event conversion, and standalone delivery", () => {
  const output = execFileSync("python3", ["test/hermes_plugin_smoke.py"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  assert.match(output, /hermes plugin smoke passed/);
});

test("openclaw init emits bridge setup contract", () => {
  const output = run([
    "--json",
    "--base-url",
    "https://api.example.com",
    "--agent-id",
    "agent_123",
    "openclaw",
    "init",
    "--target",
    "http://localhost:8787/a1zap",
  ]);
  const data = JSON.parse(output);
  assert.equal(data.success, true);
  assert.equal(data.bridgeCommand, "a1zap-bots bots dev --target http://localhost:8787/a1zap");
  assert.equal(data.adapterContract.replies[0].text, "reply");
});
