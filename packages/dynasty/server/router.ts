import { readdir } from "fs/promises";
import { type Dirent } from "fs";

export type APIHandler = (
  req: Request,
  params: Record<string, string>,
) => Promise<Response | undefined>;

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

export type GetMetadata = () => Promise<Metadata>;

export type Route = {
  filepath: string;
  getMetadata?: GetMetadata;
  default?: React.FC<{ params: Record<string, string> }> | APIHandler;
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
  match: RegExpMatchArray;
};

export type RouteNode = {
  route?: Route;
  parameter?: boolean;
  children: Record<string, RouteNode>;
};

export type RouteIndex = {
  tree: RouteNode;
  matchableRoutes: MatchableRoute[];
  bundleEntryPoints: string[];
};

type BuildRouterIndexParameters = {
  directory: string;
  currentPath: string[];
  matchableRoutes: MatchableRoute[];
  node: RouteNode;
  parameters: number;
  depth: number;
  bundleEntryPoints: string[];
};

export const buildRouterIndex = async ({
  directory,
  currentPath = [],
  matchableRoutes = [],
  node = { children: {} },
  parameters = 0,
  depth = 0,
  bundleEntryPoints = [],
}: BuildRouterIndexParameters) => {
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

  const directoryPromises = directories.map((directory) => {
    const nextPath = [...currentPath, directory.name];
    const nextNode = node.children[directory.name] ?? { children: {} };
    if (directory.name.match(/^\[(.+)\]$/)) {
      nextNode.parameter = true;
      nextPath[nextPath.length - 1] =
        `(?<${directory.name.slice(1, -1)}>[^/]+)`;
    }
    node.children[directory.name] = nextNode;
    return buildRouterIndex({
      directory: `${directory}/${directory.name}`,
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
