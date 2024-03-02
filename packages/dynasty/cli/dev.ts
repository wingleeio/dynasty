#!/usr/bin/env bun

import arg from "arg";

const args = arg({
  "--help": Boolean,
  "--pages-dir": String,
  "--public-dir": String,
  "--out-dir": String,
  "--postcss": String,
  "--port": Number,

  "-h": "--help",
});

if (args["--help"]) {
  console.log(
    [
      "Options",
      "  --help, -h     Show this help message",
      "",
      "  --pages-dir  <path> Default: ./src/pages",
      "  --public-dir <path> Default: ./src/public",
      "  --out-dir    <path> Default: .dynasty",
      "  --port       <port> Default: 1337",
      "",
      "Examples",
      "  $ dynasty dev",
      "  $ dynasty dev --pages-dir ./pages --public-dir ./public --port 1338",
    ].join("\n"),
  );

  process.exit(0);
}

import path from "path";
import { watch } from "fs";
import child_process from "child_process";
import { WebSocketServer, WebSocket } from "ws";

const outDirectory = path.resolve(args["--out-dir"] || ".dynasy");

let child: child_process.ChildProcess | undefined;

async function startChildWorker() {
  if (child) {
    child.kill();
  }

  child = child_process.spawn(
    "bun",
    ["run", path.join(import.meta.dir, "../dev/create-worker.ts")],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DYNASTY_DEV: "true",
      },
    },
  );

  child.on("close", () => {
    child = undefined;
  });
}

const refreshPort = 21818;

const wsServer = new WebSocketServer({ port: refreshPort });

const sockets = new Set<WebSocket>();

wsServer.on("connection", (socket) => {
  sockets.add(socket);

  socket.on("close", () => {
    sockets.delete(socket);
  });

  socket.on("message", (event) => {
    if (event.toString() !== "build:complete") return;
    for (const socket of sockets) {
      socket.send("refresh");
    }
  });

  socket.send("connected");
});

watch(".", { recursive: true }, async (event, filename) => {
  if (event !== "change") return;
  if (path.resolve(filename as string).startsWith(outDirectory)) return;

  console.log(`\nChange detected - ${filename}`);
  console.log("Rebuilding...");
  await startChildWorker();
});

await startChildWorker();
