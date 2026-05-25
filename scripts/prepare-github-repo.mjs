#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptPath), "..");
const args = new Set(process.argv.slice(2));

function run(command, commandArgs, options = {}) {
  console.log(`$ ${[command, ...commandArgs].join(" ")}`);
  return execFileSync(command, commandArgs, {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function gitOk(commandArgs) {
  try {
    run("git", commandArgs, { capture: true });
    return true;
  } catch {
    return false;
  }
}

function removeGeneratedPythonFiles(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") {
        fs.rmSync(target, { recursive: true, force: true });
      } else {
        removeGeneratedPythonFiles(target);
      }
    } else if (entry.name.endsWith(".pyc")) {
      fs.rmSync(target, { force: true });
    }
  }
}

if (!fs.existsSync(path.join(packageRoot, "package.json"))) {
  throw new Error(`package.json not found at ${packageRoot}`);
}

run("npm", ["test"]);
run("npm", ["pack", "--dry-run"]);
removeGeneratedPythonFiles(path.join(packageRoot, "hermes-plugin"));

if (!fs.existsSync(path.join(packageRoot, ".git"))) {
  run("git", ["init"]);
}

run("git", ["branch", "-M", "main"]);
run("git", ["add", "."]);

const hasCommit = gitOk(["rev-parse", "--verify", "HEAD"]);
const status = run("git", ["status", "--porcelain"], { capture: true }).trim();
if (!status) {
  console.log("No changes to commit.");
} else if (args.has("--no-commit")) {
  console.log("Prepared git index; skipped commit because --no-commit was provided.");
} else {
  const message = hasCommit ? "Update A1Zap bots CLI" : "Initial A1Zap bots CLI";
  try {
    run("git", ["commit", "-m", message]);
  } catch {
    console.log("");
    console.log("Git commit did not complete, likely because git user.name/user.email is not configured.");
    console.log("Files are staged. Configure git identity, then run:");
    console.log(`  git commit -m ${JSON.stringify(message)}`);
  }
}

console.log("");
console.log("Repo is locally prepared.");
console.log("");
console.log("Create the GitHub repo, then run:");
console.log("  git remote add origin git@github.com:a1baseai/a1zap-bots-cli.git");
console.log("  git push -u origin main");
console.log("");
console.log("Install test after push:");
console.log("  npm install -g github:a1baseai/a1zap-bots-cli");
