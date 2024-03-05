import path from "path";
import { BunFile } from "bun";
import { renderReactServerComponent } from "./render-react-server-component";
import { renderServerSide } from "./render-server-side";
import { Router } from "./router";
import { ClientManifest, ServerManifest } from "react-server-dom-webpack";
import { handleServerAction } from "./handle-server-action";

type CreateApplicationParameters = {
  pagesRouter: Router;
  serverComponentsRouter: Router;
  port: number;
  clientManifest: ClientManifest;
  serverManifest: ServerManifest;
  publicDirectory: string;
};

export const createApplication = ({
  pagesRouter,
  serverComponentsRouter,
  port,
  publicDirectory,
  clientManifest,
  serverManifest,
}: CreateApplicationParameters) => {
  const fileCache = new Map<string, BunFile>();

  return Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);
      const pathname = url.pathname;

      if (req.headers.get("x-rsc-action")) {
        return handleServerAction(req, serverManifest, clientManifest);
      }

      if (pathname === "/__dynasty__") {
        const location = url.searchParams.get("location");
        const matchedRoute = await serverComponentsRouter(
          decodeURIComponent(location ?? "/"),
        );
        if (!matchedRoute) return new Response("Not found", { status: 404 });
        return renderReactServerComponent({
          matchedRoute,
          manifest: clientManifest,
        });
      } else {
        const matchedRoute = await pagesRouter(pathname);
        if (!matchedRoute) {
          const file = fileCache.has(url.pathname)
            ? fileCache.get(url.pathname)
            : Bun.file(path.join(publicDirectory, url.pathname));
          if (file) {
            fileCache.set(url.pathname, file);
            return new Response(file);
          }

          return new Response("Not found", { status: 404 });
        }
        const route = matchedRoute.matched.matchable;
        const groups = matchedRoute.regexes.groups;
        const params = {
          ...groups,
        };

        switch (req.method) {
          case "GET":
            if (route.default) {
              return renderServerSide({
                route,
                params,
                manifest: clientManifest,
              });
            }
            return route.GET
              ? route.GET(req, params)
              : new Response("Method not allowed", { status: 405 });
          case "POST":
            return route.POST
              ? route.POST(req, params)
              : new Response("Method not allowed", { status: 405 });
          case "PUT":
            return route.PUT
              ? route.PUT(req, params)
              : new Response("Method not allowed", { status: 405 });
          case "PATCH":
            return route.PATCH
              ? route.PATCH(req, params)
              : new Response("Method not allowed", { status: 405 });
          case "DELETE":
            return route.DELETE
              ? route.DELETE(req, params)
              : new Response("Method not allowed", { status: 405 });
          default:
            return new Response("Method not allowed", { status: 405 });
        }
      }
    },
  });
};
