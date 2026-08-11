#!/usr/bin/env node
// parasite-skill CLI launcher. Works under both Node.js (npx) and Bun (bunx).
import { run } from "../src/index.js";

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  },
);
