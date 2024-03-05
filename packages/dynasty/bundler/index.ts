import path from "path";
import fs from "fs/promises";
import { ServerPlugin } from "./rsc-server-plugin-babel";
import { ClientManifest, ServerManifest } from "react-server-dom-webpack";
import { ClientPlugin } from "./rsc-client-plugin-babel";
import { BuildArtifact } from "bun";

const transpiler = new Bun.Transpiler({ loader: "tsx" });

export type Manifest = Record<
  string,
  { id: string; chunks: string[]; name: string }
>;

type BundleParameters = {
  entrypoints: string[];
  outDir: string;
  publicDir: string;
};

const environment = process.env.NODE_ENV || "development";
const noMinify = process.env.NO_MINIFY === "true";
const isDebug = process.env.DEBUG === "true";

export const bundle = async ({
  entrypoints,
  outDir,
  publicDir,
}: BundleParameters) => {
  const outPath = path.resolve(outDir);
  try {
    await fs.rm(outPath, { recursive: true });
  } catch (e) {
    console.error(e);
  }
  await fs.mkdir(outPath, { recursive: true });
  const ignoredClientDependencies = new Set<string>([]);
  const clientDependencies = await resolveComponentDependencies({
    entrypoints,
    ignoredClientDependencies,
    client: true,
  });

  const serverDependencies = await resolveComponentDependencies({
    entrypoints,
    ignoredClientDependencies,
    client: false,
  });

  const clientOutPath = path.resolve(outPath, "client");
  await fs.mkdir(clientOutPath, { recursive: true });
  if (publicDir && (await fs.exists(publicDir))) {
    await fs.cp(publicDir, clientOutPath, { recursive: true });
  }

  await fs.mkdir(path.join(outPath, "server"));
  const runDir = process.cwd().split(path.sep);
  const dynastyDir = (await Bun.resolve("dynasty", ".")).split(path.sep);

  let commonDirPath = "";
  for (let i = 0; i < runDir.length; i++) {
    if (runDir[i] !== dynastyDir[i]) {
      break;
    }
    commonDirPath += runDir[i] + path.sep;
  }
  const clientEntry = path.resolve(import.meta.dir, "../client/index.tsx");
  const clientManifest: ClientManifest = {};

  const serverManifest: ServerManifest = {};
  const serverReferencesMap = new Map();
  const clientReferencesMap = new Map();
  const server = await Bun.build({
    entrypoints: [
      ...entrypoints,
      ...Array.from(serverDependencies.values()).map((dep) => dep.entrypoint),
    ],
    target: "bun",
    sourcemap: "external",
    splitting: true,
    format: "esm",
    outdir: path.join(outPath, "server"),
    minify: true,
    define: {
      "process.env.NODE_ENV": `"${environment}"`,
    },
    plugins: [
      new ServerPlugin({
        clientReferencesMap,
        serverReferencesMap,
        clientManifest,
      }),
    ],
  });

  if (!server.success) {
    console.error(server.logs);
    throw new Error("server routes build failed");
  }

  const client = await Bun.build({
    entrypoints: [
      clientEntry,
      ...Array.from(clientDependencies.values()).map((dep) => dep.entrypoint),
    ],
    target: "browser",
    sourcemap: "external",
    splitting: true,
    format: "esm",
    root: commonDirPath,
    outdir: path.join(outPath, "client"),
    minify: !noMinify,
    publicPath: "./",
    define: {
      "process.env.NODE_ENV": `"${environment}"`,
    },
    plugins: [
      new ClientPlugin({
        serverManifest,
        serverReferencesMap,
      }),
    ],
  });

  if (!client.success) {
    console.error(client.logs);
    return;
  }

  await Bun.write(
    path.join(outPath, "client/manifest.json"),
    JSON.stringify(clientManifest, null, 2),
  );

  await Bun.write(
    path.join(outPath, "server/manifest.json"),
    JSON.stringify(serverManifest, null, 2),
  );

  return {
    clientManifest,
    serverManifest,
  };
};

type ClientDependency = {
  entrypoint: string;
  exports: string[];
};

type ResolveClientComponentDependenciesParameters = {
  entrypoints: string[];
  ignoredClientDependencies: Set<string>;
  clientDependencies?: Set<ClientDependency>;
  resolutionCache?: Map<string, string>;
  processedFiles?: Set<string>;
  originalEntry?: string | undefined;
  depth?: number;
  client: boolean;
};

function isClientComponent(code: string) {
  return code.startsWith('"use client"') || code.startsWith("'use client'");
}

const resolveComponentDependencies = async ({
  entrypoints,
  ignoredClientDependencies,
  clientDependencies = new Set(),
  resolutionCache = new Map(),
  processedFiles = new Set(),
  originalEntry = undefined,
  depth = 0,
  client = true,
}: ResolveClientComponentDependenciesParameters) => {
  if (depth > 25) {
    console.warn(
      "returning early from resolveClientComponentDependencies. Too many levels of dependency.",
    );
    return clientDependencies;
  }

  for (const entrypoint of entrypoints) {
    const entryKey = originalEntry || entrypoint;
    if (
      processedFiles.has(entrypoint) ||
      ignoredClientDependencies.has(entrypoint)
    ) {
      continue;
    }

    const file = Bun.file(entrypoint);
    const contents = await file.text();
    const dependencyScan = transpiler.scan(contents);

    if (client ? isClientComponent(contents) : true) {
      clientDependencies.add({ entrypoint, exports: dependencyScan.exports });
    }

    processedFiles.add(entrypoint);

    const parent = entrypoint.split("/").slice(0, -1).join("/");

    const dependenciesPromises = dependencyScan.imports.map(
      async (dependency) => {
        try {
          let resolved = resolutionCache.get(dependency.path);
          if (!resolved) {
            resolved = await Bun.resolve(dependency.path, parent);
          }
          return resolved;
        } catch (e) {
          console.warn(e);
        }
      },
    );

    const dependencies = (await Promise.all(dependenciesPromises)).filter(
      Boolean,
    ) as string[];

    if (dependencies.length) {
      await resolveComponentDependencies({
        entrypoints: dependencies,
        ignoredClientDependencies,
        clientDependencies,
        resolutionCache,
        processedFiles,
        originalEntry: entryKey,
        depth: depth + 1,
        client,
      });
    }
  }

  return clientDependencies;
};
