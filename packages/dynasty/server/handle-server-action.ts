import { ClientManifest, ServerManifest } from "react-server-dom-webpack";
import {
  decodeReply,
  renderToPipeableStream,
} from "react-server-dom-webpack/server.node";
import stream from "stream";
import path from "path";

export const handleServerAction = async (
  req: Request,
  serverManifest: ServerManifest,
  clientManifest: ClientManifest,
) => {
  const rscAction = req.headers.get("x-rsc-action")!;
  const contentType = req.headers.get("content-type");
  const body = contentType?.startsWith("multipart/form-data")
    ? await req.formData()
    : await req.text();
  const serverReference = serverManifest[rscAction];
  const root = path.resolve(__dirname, process.cwd());
  const modulePath = path.join(
    root + "/.dynasty/server",
    serverReference.id as string,
  );

  const module = await import(modulePath);
  const action = module[serverReference.name];

  const args = decodeReply(body);
  const actionPromise = action.apply(null, args);

  const pipeableStream = renderToPipeableStream(actionPromise, clientManifest);
  const readableStream = new ReadableStream({
    start: (controller) => {
      pipeableStream.pipe(
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
