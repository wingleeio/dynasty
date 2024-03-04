import path from "path";
import fs from "fs/promises";
import { ServerPlugin } from "./rsc-server-plugin-babel";
import { ClientManifest, ServerManifest } from "react-server-dom-webpack";
import { ClientPlugin } from "./rsc-client-plugin-babel";

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
  const clientDependencies = await resolveClientComponentDependencies({
    entrypoints,
    ignoredClientDependencies,
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

  const clientDepsMap = [
    { entrypoint: clientEntry, exports: ["default"] },
    ...Array.from(clientDependencies.values()),
  ].reduce(
    (acc, dep) => {
      const fileName = dep.entrypoint.slice(commonDirPath.length - 1);
      const withoutExtension = fileName.split(".").slice(0, -1).join(".");
      acc[withoutExtension] = {
        path: dep.entrypoint,
        fileName,
        withoutExtension,
        exports: dep.exports,
      };
      return acc;
    },
    {} as Record<
      string,
      {
        path: string;
        fileName: string;
        withoutExtension: string;
        exports: string[];
      }
    >,
  );
  if (isDebug) console.log(clientDepsMap);

  const serverManifest: ServerManifest = {};
  const serverReferencesMap = new Map();
  const clientReferencesMap = new Map();
  const serverRoutes = await Bun.build({
    entrypoints: [
      ...entrypoints,
      ...Array.from(clientDependencies.values()).map((dep) => dep.entrypoint),
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

  if (!serverRoutes.success) {
    console.error(serverRoutes.logs);
    throw new Error("server routes build failed");
  }

  const client = await Bun.build({
    entrypoints: [
      clientEntry,
      ...Array.from(clientDependencies.values()).map((dep) => dep.entrypoint),
    ],
    target: "browser",
    sourcemap: "none",
    splitting: true,
    format: "esm",
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
};

const resolveClientComponentDependencies = async ({
  entrypoints,
  ignoredClientDependencies,
  clientDependencies = new Set(),
  resolutionCache = new Map(),
  processedFiles = new Set(),
  originalEntry = undefined,
  depth = 0,
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

    clientDependencies.add({ entrypoint, exports: dependencyScan.exports });
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
      await resolveClientComponentDependencies({
        entrypoints: dependencies,
        ignoredClientDependencies,
        clientDependencies,
        resolutionCache,
        processedFiles,
        originalEntry: entryKey,
        depth: depth + 1,
      });
    }
  }

  return clientDependencies;
};
