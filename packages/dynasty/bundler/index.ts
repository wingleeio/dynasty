import path from "path";
import fs from "fs/promises";

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
  await fs.mkdir(path.join(outPath, "server", "routes"));
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
  const clientRouter = path.resolve(import.meta.dir, "../client/router.tsx");
  const hasher = new Bun.CryptoHasher("blake2b256");

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
    outdir: clientOutPath,
    minify: !noMinify,
    publicPath: "./",
    define: {
      "process.env.NODE_ENV": `"${environment}"`,
    },
  });
  if (!client.success) {
    console.error(client.logs);
    return;
  }

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

  const manifest = client.outputs.reduce(
    (acc, output) => {
      const fileName = output.path.slice(clientOutPath.length);
      const withoutExtension = fileName.split(".").slice(0, -1).join(".");

      if (withoutExtension in clientDepsMap) {
        const dep = clientDepsMap[withoutExtension];

        switch (dep.path) {
          case clientEntry:
            acc["client-entry"] = {
              id: fileName,
              chunks: [fileName],
              name: "default",
            };
            break;
          case clientRouter:
            acc["client-router"] = {
              id: fileName,
              chunks: [fileName],
              name: "default",
            };
          default:
            for (const exp of dep.exports) {
              acc[`${dep.fileName}#${exp}`] = {
                id: fileName,
                chunks: [fileName],
                name: exp,
              };
            }
        }
      }

      return acc;
    },
    {} as Record<string, { id: string; chunks: string[]; name: string }>,
  );

  if (isDebug) console.log("manifest", manifest);
  await Bun.write(
    path.join(outPath, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  const serverRoutes = await Bun.build({
    entrypoints,
    target: "bun",
    sourcemap: "none",
    splitting: true,
    format: "esm",
    outdir: path.join(outPath, "server", "routes"),
    minify: environment === "production",
    define: {
      "process.env.NODE_ENV": `"${environment}"`,
    },
    plugins: [
      {
        name: "rsc-server",
        setup(build) {
          build.onLoad({ filter: /\.(ts|tsx)$/ }, async (args) => {
            const code = await Bun.file(args.path).text();
            if (
              !code.startsWith(`"use client"`) &&
              !code.startsWith(`'use client'`)
            ) {
              // if not a client component, just return the code and let it be bundled
              return {
                contents: code,
                loader: "tsx",
              };
            }

            // if it is a client component, return a reference to the client bundle
            const outputKey = `/${args.path.slice(commonDirPath.length)}`;
            // const outputKey = args.path.slice(appRoot.length)

            if (isDebug) console.log("outputKey", outputKey);

            const moduleExports = transpiler.scan(code).exports;
            if (isDebug) console.log("exports", moduleExports);

            let refCode = "";
            for (const exp of moduleExports) {
              if (exp === "default") {
                refCode += `\nexport default { $$typeof: Symbol.for("react.client.reference"), $$async: false, $$id: "${outputKey}#default", name: "default" }`;
              } else {
                refCode += `\nexport const ${exp} = { $$typeof: Symbol.for("react.client.reference"), $$async: false, $$id: "${outputKey}#${exp}", name: "${exp}" }`;
              }
            }

            if (isDebug) console.log("generated code", refCode);

            return {
              contents: refCode,
              loader: "js",
            };
          });
        },
      },
    ],
  });

  if (!serverRoutes.success) {
    console.error(serverRoutes.logs);
    throw new Error("server routes build failed");
  }

  return {
    manifest,
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

function isClientComponent(code: string) {
  return code.startsWith('"use client"') || code.startsWith("'use client'");
}

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
    if (isClientComponent(contents)) {
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
