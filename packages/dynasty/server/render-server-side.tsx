import { StrictMode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { Route } from "./router";
import { Manifest } from "../bundler";

type RenderServerSideParameters = {
  route: Route;
  params: Record<string, string>;
  manifest: Manifest;
};

export const renderServerSide = async ({
  route,
  params,
  manifest,
}: RenderServerSideParameters) => {
  if (!route.default) return new Response("Not found", { status: 404 });

  const Component = route.default;

  // TODO: Implement getMetadata
  const hasMetadata = "getMetadata" in route && route.getMetadata;
  const metadata = hasMetadata ? await route.getMetadata!(params) : {};

  const clientEntryScript = manifest["client-entry"]?.chunks[0];
  const clientRouterScript = manifest["client-router"]?.chunks[0];

  const mount = (
    <StrictMode>
      <html>
        <head>
          <title>{metadata.title}</title>
          <meta name="description" content={metadata.description} />
        </head>
        <body>
          <main id="__DYNASTY_MOUNT__">
            <Component params={params} />
          </main>
          <script
            dangerouslySetInnerHTML={{
              __html: [
                "global = window;",
                "",
                "const __bun__module_map__ = new Map();",
                "",
                "global.__webpack_chunk_load__ = async function(moduleId) {",
                "    const mod = await import(moduleId);",
                "    __bun__module_map__.set(moduleId, mod);",
                "    return mod;",
                "};",
                "",
                "global.__webpack_require__ = function(moduleId) {",
                '    console.log("require", moduleId)',
                "    return __bun__module_map__.get(moduleId);",
                "};",
                ...(process.env.DYNASTY_DEV
                  ? [
                      "const requestUrl = 'ws://localhost:21818/';",
                      "let socket, reconnectionTimerId;",
                      "",
                      "const connect = (callback) => {",
                      "    if (socket) {",
                      "        socket.close();",
                      "    }",
                      "",
                      "    socket = new WebSocket(requestUrl);",
                      "",
                      "    socket.addEventListener('open', callback);",
                      "",
                      "    socket.addEventListener('message', (event) => {",
                      "        if (event.data === 'refresh') {",
                      "            log('refreshing...');",
                      "            refresh();",
                      "        }",
                      "    });",
                      "",
                      "    socket.addEventListener('close', () => {",
                      "        log('connection lost - reconnecting...');",
                      "",
                      "        clearTimeout(reconnectionTimerId);",
                      "",
                      "        reconnectionTimerId = setTimeout(() => {",
                      "            connect(refresh);",
                      "        }, 1000);",
                      "    });",
                      "};",
                      "",
                      "const log = (message) => {",
                      "    console.info('[refresh] ', message);",
                      "};",
                      "",
                      "const refresh = () => {",
                      "    window.location.reload();",
                      "};",
                      "",
                      "connect(() => {",
                      "    console.log('Live reload connected on', requestUrl);",
                      "});",
                    ]
                  : []),
              ].join("\n"),
            }}
          />
          <script type="module" src={clientEntryScript} />
        </body>
      </html>
    </StrictMode>
  );

  const stream = await renderToReadableStream(mount);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/html",
    },
  });
};
