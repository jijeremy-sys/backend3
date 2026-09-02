#!/usr/bin/env node
// Prints the SHA-256 hash to put in ADMIN_PASSWORD_HASH.
// Usage: node scripts/hash-admin-password.mjs "your-password-here"
// (Or run it with no argument and it will prompt so the password
// never ends up in your shell history.)

import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

async function main() {
  let password = process.argv[2];
  if (!password) {
    const rl = createInterface({ input: stdin, output: stdout });
    password = await rl.question("Admin password: ");
    rl.close();
  }
  const hash = createHash("sha256").update(password, "utf8").digest("hex");
  console.log("\nADMIN_PASSWORD_HASH=" + hash);
  console.log("\nSet this (and ADMIN_USERNAME) in your deployment's environment variables.");
}

main();
