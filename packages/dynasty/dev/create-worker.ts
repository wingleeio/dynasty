#!/usr/bin/env bun

import path from "path";
import arg from "arg";

import {
  createRouter,
  hydrateMatchableRoutes,
  buildRouterIndex,
} from "../server/router";

import { bundle } from "../bundler";

import { createApplication } from "../server/create-application";

const args = arg({
  "--help": Boolean,
  "--pages-dir": String,
  "--public-dir": String,
  "--out-dir": String,
  "--port": Number,

  "-h": "--help",
});

const outDirectory = path.resolve(args["--out-dir"] || ".dynasty");
const publicDirectory = path.resolve(args["--public-dir"] || "./src/public");
const pagesDirectory = path.resolve(args["--pages-dir"] || "./src/pages");
const serverComponentsPagesDirectory = path.resolve(
  path.join(outDirectory, "server/pages"),
);
const pagesRouterIndex = await buildRouterIndex({
  directory: pagesDirectory,
});

const { clientManifest, serverManifest } = (await bundle({
  entrypoints: pagesRouterIndex.bundleEntryPoints,
  outDir: outDirectory,
  publicDir: publicDirectory,
}))!;

const serverComponentsRouterIndex = await buildRouterIndex({
  directory: serverComponentsPagesDirectory,
});

await hydrateMatchableRoutes(pagesRouterIndex.matchableRoutes);
await hydrateMatchableRoutes(serverComponentsRouterIndex.matchableRoutes);

const pagesRouter = await createRouter(pagesDirectory, pagesRouterIndex);
const serverComponentsRouter = await createRouter(
  serverComponentsPagesDirectory,
  serverComponentsRouterIndex,
);

createApplication({
  pagesRouter,
  serverComponentsRouter,
  clientManifest,
  serverManifest,
  publicDirectory: path.resolve(path.join(outDirectory, "client")),
  port: args["--port"] || 1337,
});
import { WebSocket } from "ws";

const requestUrl = "ws://localhost:21818/";

const socket = new WebSocket(requestUrl);

socket.on("open", () => {
  socket.send("build:complete");
  socket.close();
});

console.log("Server running at http://localhost:1337/");
