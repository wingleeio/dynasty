import { readdir } from "fs/promises";
import { type Dirent } from "fs";

export type APIHandler = (
  req: Request,
  params: Record<string, string>,
) => Promise<Response>;

export type Metadata = {
  title?: string;
  description?: string;
  keywords?: string[];
  author?: string;
  openGraph?: {
    title?: string;
    description?: string;
    url?: string;
    siteName?: string;
    locale?: string;
    type?: string;
    images?: {
      url?: string;
      width?: number;
      height?: number;
      alt?: string;
    }[];
    video?: {
      url?: string;
      width?: number;
      height?: number;
      alt?: string;
    }[];
    audio?: string;
  };
};

export type GetMetadata = (params: Record<string, string>) => Promise<Metadata>;

export type Route = {
  filepath: string;
  getMetadata?: GetMetadata;
  default?: React.FC<{ params: Record<string, string> }>;
  GET?: APIHandler;
  POST?: APIHandler;
  PUT?: APIHandler;
  PATCH?: APIHandler;
  DELETE?: APIHandler;
};

export type MatchableRoute = {
  regex: RegExp;
  pathLength: number;
  parameters: number;
  matchable: Route;
};

export type MatchedRoute = {
  matched: MatchableRoute;
  regexes: RegExpMatchArray;
};

export type RouteNode = {
  route?: Route;
  parameter?: boolean;
  children: Record<string, RouteNode>;
};

export type RouterIndex = {
  node: RouteNode;
  matchableRoutes: MatchableRoute[];
  bundleEntryPoints: string[];
};

type BuildRouterIndexParameters = {
  directory: string;
  currentPath?: string[];
  matchableRoutes?: MatchableRoute[];
  node?: RouteNode;
  parameters?: number;
  depth?: number;
  bundleEntryPoints?: string[];
};

export const buildRouterIndex = async ({
  directory,
  currentPath = [],
  matchableRoutes = [],
  node = { children: {} },
  parameters = 0,
  depth = 0,
  bundleEntryPoints = [],
}: BuildRouterIndexParameters): Promise<RouterIndex> => {
  if (depth > 10) {
    console.warn(
      "buildRouterIndex: Maximum depth reached, returning early. Some routes may not be built.",
    );
  }
  const directoryEntities = await readdir(directory, { withFileTypes: true });
  const directoryEntityPairs: [Dirent[], Dirent[]] = [[], []];
  const [files, directories] = directoryEntities.reduce(
    ([files, directories], file) => {
      if (file.isDirectory()) {
        directories.push(file);
      } else if (file.isFile()) {
        files.push(file);
      }
      return [files, directories];
    },
    directoryEntityPairs,
  );
  const directoryPromises = directories.map((dir) => {
    const nextPath = [...currentPath, dir.name];
    const nextNode = node.children[dir.name] ?? { children: {} };
    if (dir.name.match(/^\[(.+)\]$/)) {
      nextNode.parameter = true;
      nextPath[nextPath.length - 1] = `(?<${dir.name.slice(1, -1)}>[^/]+)`;
    }
    node.children[dir.name] = nextNode;
    return buildRouterIndex({
      directory: `${directory}/${dir.name}`,
      matchableRoutes: matchableRoutes,
      node: nextNode,
      currentPath: nextPath,
      parameters: nextNode.parameter ? parameters + 1 : parameters,
      depth: depth + 1,
      bundleEntryPoints,
    });
  });

  await Promise.all(directoryPromises);

  const filePromises = files.map(async (file) => {
    const fileName = file.name.replace(/\.(js|jsx|ts|tsx)$/, "");
    const route: Route = {
      filepath: `${directory}/${file.name}`,
    };

    if (fileName === "index") {
      matchableRoutes.push({
        regex: new RegExp(`^${currentPath.join("/")}$`),
        pathLength: currentPath.length,
        parameters,
        matchable: route,
      });
    } else if (fileName.match(/^\[(.+)\]$/)) {
      const parameterName = fileName.match(/^\[(.+)\]$/)?.[1];
      if (!parameterName) {
        throw new Error("invalid param name");
      }
      node.children[parameterName] = {
        route,
        children: {},
        parameter: true,
      };
      matchableRoutes.push({
        regex: new RegExp(
          `^${[...currentPath, `(?<${fileName.slice(1, -1)}>[^/]+)`].join("/")}$`,
        ),
        pathLength: currentPath.length + 1,
        parameters: parameters + 1,
        matchable: route,
      });
    } else {
      node.children[fileName] = { route, children: {} };
      matchableRoutes.push({
        regex: new RegExp(`^${[...currentPath, fileName].join("/")}$`),
        pathLength: currentPath.length + 1,
        parameters,
        matchable: route,
      });
    }

    bundleEntryPoints.push(`${directory}/${file.name}`);
  });

  await Promise.all(filePromises);

  return { matchableRoutes, node, bundleEntryPoints };
};

const matchRoute = (
  path: string,
  matchableRoutes: MatchableRoute[],
): MatchedRoute | undefined => {
  const pathLength = path.split("/").filter((p) => p !== "").length;

  const viable = matchableRoutes
    .filter((r) => r.pathLength === pathLength)
    .sort((a, b) => a.parameters - b.parameters);

  for (const route of viable) {
    const match = route.regex.exec(path);
    if (match) {
      return { matched: route, regexes: match };
    }
  }
};

export const hydrateMatchableRoutes = async (
  matchableRoutes: MatchableRoute[],
) => {
  await Promise.all(
    matchableRoutes.map(async (matchableRoute) => {
      const route: Route = await import(matchableRoute.matchable.filepath);

      if ((route.default || route.getMetadata) && route.GET) {
        throw new Error(
          "hydrateMatchableRoutes: Route cannot have both a default export and a GET handler",
        );
      }

      matchableRoute.matchable = route;
    }),
  );
};

export const createRouter = async (
  directory: string,
  routerIndex?: RouterIndex,
): Promise<(path: string) => Promise<MatchedRoute | undefined>> => {
  const routes = routerIndex ?? (await buildRouterIndex({ directory }));
  const routesCache = new Map<string, MatchedRoute | undefined>();
  return async (path: string) => {
    if (routesCache.has(path)) {
      return routesCache.get(path);
    }
    // console.log(JSON.stringify(routes, null, 2));
    console.time("Match route: " + path);
    const matchedRoute = matchRoute(
      path.startsWith("/") ? path.slice(1) : path,
      routes.matchableRoutes,
    );
    console.timeEnd("Match route: " + path);

    routesCache.set(path, matchedRoute);

    return matchedRoute;
  };
};

export type Router = Awaited<ReturnType<typeof createRouter>>;
