// @ts-expect-error - doesnt have any types, at least that i could find
import { renderToPipeableStream } from "react-server-dom-webpack/server.node";
import { MatchedRoute } from "./router";
import stream from "stream";

type RenderReactServerComponentParameters = {
  matchedRoute: MatchedRoute;
  manifest: any;
};

export const renderReactServerComponent = async ({
  matchedRoute,
  manifest,
}: RenderReactServerComponentParameters): Promise<Response> => {
  const route = matchedRoute.matched.matchable;
  const groups = matchedRoute.regexes.groups;
  if (!route.default) {
    throw new Error("No default export found for the matched module");
  }

  const Component = route.default;

  const params = {
    ...groups,
  };

  const reactServerComponent = renderToPipeableStream(
    <Component params={params} />,
    manifest,
  );

  const readableStream = new ReadableStream({
    start: (controller) => {
      reactServerComponent.pipe(
        new stream.Writable({
          write(chunk, _, callback) {
            controller.enqueue(chunk);
            callback();
          },
          destroy(error, callback) {
            if (error) {
              controller.error(error);
            } else {
              controller.close();
            }
            callback(error);
          },
        }),
      );
    },
  });

  return new Response(readableStream, {
    headers: {
      "Content-Type": "application/json",
    },
  });
};
