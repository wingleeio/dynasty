import { StrictMode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { Route } from "./router";

type RenderServerSideParameters = {
  route: Route;
  params: Record<string, string>;
  manifest: any;
};

export const renderServerSide = async ({
  route,
  params,
}: RenderServerSideParameters) => {
  if (!route.default) return new Response("Not found", { status: 404 });

  const Component = route.default;

  // TODO: Implement getMetadata
  const metadata = route.getMetadata ? await route.getMetadata(params) : {};

  const mount = (
    <StrictMode>
      <Component params={params} />
    </StrictMode>
  );

  const stream = await renderToReadableStream(mount, {
    bootstrapScripts: ["/public/index.js"],
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/html",
    },
  });
};
