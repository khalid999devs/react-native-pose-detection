#!/usr/bin/env node
// Thin entry point. The implementation lives in plugin/build so the config plugin and the CLI
// share one downloader, one manifest, and one installer.
const { run } = require('../plugin/build/cli');

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
