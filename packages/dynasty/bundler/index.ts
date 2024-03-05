import path from "path";
import fs from "fs/promises";
import { ServerPlugin } from "./rsc-server-plugin-babel";
import { ClientManifest, ServerManifest } from "react-server-dom-webpack";
import { ClientPlugin } from "./rsc-client-plugin-babel";
import Postcss from "postcss";

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
  const [clientDependencies, cssImports] = await resolveComponentDependencies({
    entrypoints,
    ignoredClientDependencies,
    client: true,
  });

  const [serverDependencies] = await resolveComponentDependencies({
    entrypoints,
    ignoredClientDependencies,
    client: false,
  });

  const clientOutPath = path.resolve(outPath, "client");
  const cssOutDir = path.join(outPath, "client", "css");
  await fs.mkdir(clientOutPath, { recursive: true });
  await fs.mkdir(cssOutDir);
  if (publicDir && (await fs.exists(publicDir))) {
    await fs.cp(publicDir, clientOutPath, { recursive: true });
  }

  await fs.mkdir(path.join(outPath, "server"));
  const runDir = process.cwd().split(path.sep);
  const dynastyDir = (await Bun.resolve("dynasty.js", ".")).split(path.sep);

  let commonDirPath = "";
  for (let i = 0; i < runDir.length; i++) {
    if (runDir[i] !== dynastyDir[i]) {
      break;
    }
    commonDirPath += runDir[i] + path.sep;
  }

  const postcssPlugins: Postcss.AcceptedPlugin[] = [];

  if (await fs.exists("./postcss.config.js")) {
    const config = require("./postcss.config.js");
    Object.entries(config.plugins).forEach(([name, options]) => {
      const plugin = require(name);
      postcssPlugins.push(plugin(options));
    });
  }

  const cssFiles = Array.from(Object.values(cssImports)).flat();
  const postcss = Postcss(postcssPlugins);
  const cssMap = new Map<string, string>();
  const hasher = new Bun.CryptoHasher("blake2b256");
  for (const cssFile of cssFiles) {
    const css = await Bun.file(cssFile).text();
    const hash = hasher.digest("base64").slice(0, 24);
    const cssFileOutPath = path.join(cssOutDir, `${hash}.css`);
    const result = await postcss.process(css, {
      from: cssFile,
      to: cssFileOutPath,
    });
    await Bun.write(cssFileOutPath, result.css);
    cssMap.set(cssFile, cssFileOutPath.slice(clientOutPath.length));
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
      {
        name: "postcss",
        setup(build) {
          build.onLoad({ filter: /\.css$/ }, async (args) => {
            if (!cssMap.has(args.path))
              throw new Error("Failed to reslove css import");
            return {
              contents: cssMap.get(args.path) ?? "",
              loader: "text",
            };
          });
        },
      },
    ],
  });

  await Bun.plugin({
    name: "dynasty-css-bundle",
    async setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const cssPath = cssMap.has(args.path)
          ? cssMap.get(args.path)
          : args.path;
        return {
          contents: `export default '${cssPath}'`,
          loader: "js",
        };
      });
    },
  });
  if (!client.success) {
    console.error(client.logs);
    return;
  }

  await Bun.write(
    path.join(outPath, "server/css-map.json"),
    JSON.stringify(Array.from(cssMap.entries()), null, 2),
  );

  await Bun.write(
    path.join(outPath, "server/client-manifest.json"),
    JSON.stringify(clientManifest, null, 2),
  );

  await Bun.write(
    path.join(outPath, "server/server-manifest.json"),
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
  cssImports?: Record<string, string[]>;
  originalEntry?: string | undefined;
  depth?: number;
  client: boolean;
};

function isClientComponent(code: string) {
  return code.startsWith('"use client"') || code.startsWith("'use client'");
}

function isExternalImport(importPath: string): boolean {
  // This will return true if the import path does not start with './' or '../'
  return !importPath.startsWith(".") && !importPath.startsWith("..");
}

const resolveComponentDependencies = async ({
  entrypoints,
  ignoredClientDependencies,
  clientDependencies = new Set(),
  resolutionCache = new Map(),
  processedFiles = new Set(),
  cssImports = {},
  originalEntry = undefined,
  depth = 0,
  client = true,
}: ResolveClientComponentDependenciesParameters): Promise<
  [Set<ClientDependency>, Record<string, string[]>]
> => {
  if (depth > 25) {
    console.warn(
      "returning early from resolveClientComponentDependencies. Too many levels of dependency.",
    );
    return [clientDependencies, cssImports];
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

    const dependenciesPromises = dependencyScan.imports
      .filter((dependency) => !isExternalImport(dependency.path))
      .map(async (dependency) => {
        try {
          if (dependency.path.endsWith(".css")) {
            if (!cssImports[entryKey]) cssImports[entryKey] = [];
            const resolved = await Bun.resolve(dependency.path, parent);
            cssImports[entryKey].push(resolved);
            return;
          }
          let resolved = resolutionCache.get(dependency.path);
          if (!resolved) {
            resolved = await Bun.resolve(dependency.path, parent);
          }
          return resolved;
        } catch (e) {
          console.warn(e);
        }
      });

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
        cssImports,
        originalEntry: entryKey,
        depth: depth + 1,
        client,
      });
    }
  }

  return [clientDependencies, cssImports];
};
