#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binSource = path.join(root, "bin", "a1zap-bots.js");
const prefix = process.env.PREFIX || path.join(os.homedir(), ".local");
const binDir = process.env.BIN_DIR || path.join(prefix, "bin");
const target = path.join(binDir, process.platform === "win32" ? "a1zap-bots.cmd" : "a1zap-bots");

function ensureExecutable(file) {
  if (process.platform !== "win32") {
    fs.chmodSync(file, 0o755);
  }
}

function installUnixShim() {
  fs.mkdirSync(binDir, { recursive: true });
  ensureExecutable(binSource);
  try {
    fs.rmSync(target, { force: true });
  } catch {
    // Ignore stale shim cleanup failures; symlink/write below will surface real errors.
  }
  fs.symlinkSync(binSource, target);
}

function installWindowsShim() {
  fs.mkdirSync(binDir, { recursive: true });
  const command = [
    "@echo off",
    `node "${binSource}" %*`,
    "",
  ].join("\r\n");
  fs.writeFileSync(target, command);
}

if (!fs.existsSync(binSource)) {
  console.error(`Could not find CLI entrypoint at ${binSource}`);
  process.exit(1);
}

if (process.platform === "win32") {
  installWindowsShim();
} else {
  installUnixShim();
}

console.log(`Installed ${target}`);
console.log(`Run: ${target} --help`);
if (!process.env.PATH?.split(path.delimiter).includes(binDir)) {
  console.log(`Tip: add ${binDir} to PATH to use a1zap-bots from any directory.`);
}
