type CreateApplicationParameters = {
  router: any;
  publicDir: string;
  port: number;
  middleware: any[];
};

const createApplication = ({
  router,
  publicDir,
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
      }

      return new Response("Route failed to resolve.", { status: 500 });
    },
  });
};

export default createApplication;
