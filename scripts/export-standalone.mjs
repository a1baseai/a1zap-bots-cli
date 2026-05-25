#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptPath), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const workspaceRoot = path.resolve(repoRoot, "..");
const defaultOutput = path.resolve(workspaceRoot, "dist", "a1zap-bots-cli-standalone");
const outputRoot = path.resolve(process.argv[2] || process.env.OUT_DIR || defaultOutput);
const relativeOutput = path.relative(workspaceRoot, outputRoot);
if (relativeOutput === "" || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
  throw new Error(`Refusing to export outside workspace root: ${outputRoot}`);
}

const includePaths = [
  "README.md",
  "GITHUB_HANDOFF.md",
  "Makefile",
  "package.json",
  "bin",
  "examples",
  "hermes-plugin",
  "scripts",
  "test",
];

function copyRecursive(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

const existingGitDir = path.join(outputRoot, ".git");
const preservedGitDir = fs.existsSync(existingGitDir)
  ? fs.mkdtempSync(path.join(os.tmpdir(), "a1zap-bots-cli-git-"))
  : null;
if (preservedGitDir) {
  fs.renameSync(existingGitDir, path.join(preservedGitDir, ".git"));
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });
if (preservedGitDir) {
  fs.renameSync(path.join(preservedGitDir, ".git"), existingGitDir);
  fs.rmSync(preservedGitDir, { recursive: true, force: true });
}

for (const relativePath of includePaths) {
  const source = path.join(packageRoot, relativePath);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing expected package path: ${source}`);
  }
  copyRecursive(source, path.join(outputRoot, relativePath));
}

const packageJsonPath = path.join(outputRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
packageJson.repository = {
  type: "git",
  url: "git+https://github.com/a1baseai/a1zap-bots-cli.git",
};
packageJson.bugs = {
  url: "https://github.com/a1baseai/a1zap-bots-cli/issues",
};
packageJson.homepage = "https://github.com/a1baseai/a1zap-bots-cli#readme";
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

writeText(
  path.join(outputRoot, ".gitignore"),
  [
    "node_modules/",
    ".DS_Store",
    "__pycache__/",
    "*.pyc",
    "*.tgz",
    "coverage/",
    ".env",
    ".env.*",
    "",
  ].join("\n"),
);

writeText(
  path.join(outputRoot, ".github", "workflows", "ci.yml"),
  [
    "name: CI",
    "",
    "on:",
    "  push:",
    "    branches: [main]",
    "  pull_request:",
    "    branches: [main]",
    "",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    "      - run: npm test",
    "      - run: npm pack --dry-run",
    "",
  ].join("\n"),
);

writeText(
  path.join(outputRoot, "FINISH.md"),
  [
    "# Finish Publishing A1Zap Bots CLI",
    "",
    "1. Create a GitHub repo named `a1zap-bots-cli` under `a1baseai`.",
    "2. Initialize and commit this folder:",
    "",
    "```bash",
    "npm run repo:init",
    "```",
    "",
    "Or do it manually:",
    "",
    "```bash",
    "git init",
    "git add .",
    "git commit -m \"Initial A1Zap bots CLI\"",
    "git branch -M main",
    "```",
    "",
    "3. Add the GitHub remote and push:",
    "",
    "```bash",
    "git remote add origin git@github.com:a1baseai/a1zap-bots-cli.git",
    "git push -u origin main",
    "```",
    "",
    "4. Install from GitHub while npm publishing is pending:",
    "",
    "```bash",
    "npm install -g github:a1baseai/a1zap-bots-cli",
    "```",
    "",
    "5. Publish to npm when ready:",
    "",
    "```bash",
    "npm login",
    "npm publish --access public",
    "```",
    "",
    "6. Verify the gateway path:",
    "",
    "```bash",
    "a1zap-bots --json doctor --setup-live",
    "a1zap-bots login",
    "a1zap-bots hermes bootstrap --name \"Campus Planner\" --write-env",
    "a1zap-bots hermes doctor --live",
    "hermes gateway setup",
    "hermes gateway run",
    "```",
    "",
  ].join("\n"),
);

const relativeDisplay = path.relative(os.homedir(), outputRoot);
console.log(`Exported standalone A1Zap Bots CLI to ${relativeDisplay.startsWith("..") ? outputRoot : `~/${relativeDisplay}`}`);
console.log("");
console.log("Next:");
console.log(`  cd ${outputRoot}`);
console.log("  npm run repo:init");
console.log("  git remote add origin git@github.com:a1baseai/a1zap-bots-cli.git");
console.log("  git push -u origin main");
