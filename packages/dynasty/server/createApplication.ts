import { renderReactServerComponent } from "./renderReactServerComponent";
import { renderServerSide } from "./renderServerSide";
import { Router } from "./router";

type CreateApplicationParameters = {
  router: Router;
  port: number;
  middleware: any[];
};

export const createApplication = ({
  router,
  port,
  middleware,
}: CreateApplicationParameters) => {
  return Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url);
      const pathname = url.pathname;

      if (pathname === "/__dynasty__") {
        const location = url.searchParams.get("location");
        const matchedRoute = await router(decodeURIComponent(location ?? "/"));
        if (!matchedRoute) return new Response("Not found", { status: 404 });
        return renderReactServerComponent({
          matchedRoute,
          manifest: "?",
        });
      } else {
        const matchedRoute = await router(pathname);
        if (!matchedRoute) return new Response("Not found", { status: 404 });
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
                manifest: "?",
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
