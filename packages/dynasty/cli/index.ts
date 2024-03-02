#!/usr/bin/env bun

import arg from "arg";
import __package__ from "../package.json";

const args = arg({
  "--help": Boolean,
  "--version": Boolean,
  "-h": "--help",
  "-v": "--version",
});

if (args["--help"] && !args._.length) {
  console.log(
    [
      `Dynasty ${__package__.version}`,
      "Options",
      "  --help, -h     Show this help message",
      "  --version, -v  Show the version",
      "",
      "Commands",
      "  dev            Start the development server",
      "  start          Start the production server",
      "  build          Build the project",
    ].join("\n"),
  );

  process.exit(0);
}

if (args["--version"] && !args._.length) {
  console.log(__package__.version);
  process.exit(0);
}

const command = args._[0];

switch (command) {
  case "dev":
    import("./dev");
    break;
  case "start":
    import("./start");
    break;
  case "build":
    import("./build");
    break;
  case undefined:
    console.log(
      `Dynasty ${__package__.version}\n\n No command specified. Run \`dynasty --help\` for usage.`,
    );
    process.exit(1);
  default:
    console.log(`Unknown command: ${command}`);
    process.exit(1);
}
