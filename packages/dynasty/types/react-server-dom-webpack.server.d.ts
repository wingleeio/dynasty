declare module "react-server-dom-webpack/server.node" {
  import type { ReactElement, Thenable } from "react";
  import type {
    ReactFormState,
    RenderToPipeableStreamOptions,
  } from "react-dom/server";
  import type {
    ClientManifest,
    ReactClientValue,
    ReactServerValue,
    ServerManifest,
  } from "react-server-dom-webpack";

  export type ServerContextJSONValue =
    | string
    | boolean
    | number
    | null
    | ReadonlyArray<ServerContextJSONValue>
    | { [key: string]: ServerContextJSONValue };

  export type PipeableStream = {
    abort(reason: mixed): void;
    pipe<T extends Writable>(destination: T): T;
  };

  export function renderToPipeableStream(
    model: ReactClientValue,
    webpackMap?: ClientManifest | null,
    options?: RenderToPipeableStreamOptions,
  ): PipeableStream;

  export function decodeReply(body: string | FormData): Thenable<unknown[]>;

  export function decodeAction(
    body: FormData,
    serverManifest: ServerManifest,
  ): Promise<() => unknown> | null;

  export function decodeFormState(
    actionResult: unknown,
    body: FormData,
    serverManifest: ServerManifest,
  ): Promise<ReactFormState | null>;
}
