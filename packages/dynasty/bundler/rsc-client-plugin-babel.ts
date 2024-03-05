import { PluginBuilder } from "bun";
import parser from "@babel/parser";
import generate from "@babel/generator";
import traverse from "@babel/traverse";
import * as t from "@babel/types";

import { ServerManifest } from "react-server-dom-webpack";

export interface ServerReferencesModuleInfo {
  readonly moduleId: string | number;
  readonly exportNames: string[];
}

export type ServerReferencesMap = Map<string, ServerReferencesModuleInfo>;

type ClientPluginOptions = {
  serverReferencesMap: ServerReferencesMap;
  serverManifest: ServerManifest;
};

export class ClientPlugin {
  name = "react-server-components-client-plugin";
  serverReferencesMap: ServerReferencesMap;
  serverManifest: ServerManifest;

  constructor(options: ClientPluginOptions) {
    this.serverReferencesMap = options.serverReferencesMap;
    this.serverManifest = options.serverManifest;
  }

  setup = (build: PluginBuilder) => {
    build.onLoad({ filter: /\.(ts|tsx)$/ }, async (args) => {
      const source = await Bun.file(args.path).text();

      const ast = parser.parse(source, {
        sourceType: `module`,
        sourceFilename: args.path,
        plugins: ["typescript", "jsx"],
      });

      let hasUseServerDirective = false;

      const { serverReferencesMap, serverManifest } = this;

      traverse(ast, {
        Program(path) {
          const { node } = path;

          if (!node.directives.some(isUseServerDirective)) {
            return;
          }

          hasUseServerDirective = true;

          const moduleInfo = serverReferencesMap.get(args.path);

          if (!moduleInfo) {
            new Error(
              `Could not find server references module info in \`serverReferencesMap\` for ${args.path}.`,
            );

            path.replaceWith(t.program([]));

            return;
          }

          const { moduleId, exportNames } = moduleInfo;

          path.replaceWith(
            t.program([
              t.importDeclaration(
                [
                  t.importSpecifier(
                    t.identifier(`createServerReference`),
                    t.identifier(`createServerReference`),
                  ),
                ],
                t.stringLiteral(`react-server-dom-webpack/client`),
              ),
              t.importDeclaration(
                [
                  t.importSpecifier(
                    t.identifier(`callServer`),
                    t.identifier(`callServer`),
                  ),
                ],
                t.stringLiteral("dynasty.js"),
              ),
              ...exportNames.map((exportName) => {
                const serverModuleId = moduleId.toString().replace("src/", "");
                serverManifest[
                  "/" +
                    serverModuleId +
                    `#${exportName}`
                      .replace(".tsx", ".js")
                      .replace(".ts", ".js")
                ] = {
                  id:
                    "/" +
                    serverModuleId.replace(".tsx", ".js").replace(".ts", ".js"),
                  chunks: [
                    "/" +
                      serverModuleId
                        .replace(".tsx", ".js")
                        .replace(".ts", ".js"),
                  ],
                  name: exportName,
                };
                return t.exportNamedDeclaration(
                  t.variableDeclaration(`const`, [
                    t.variableDeclarator(
                      t.identifier(exportName),
                      t.callExpression(t.identifier(`createServerReference`), [
                        t.stringLiteral(`/${serverModuleId}#${exportName}`),
                        t.identifier(`callServer`),
                      ]),
                    ),
                  ]),
                );
              }),
            ]),
          );
        },
      });

      if (!hasUseServerDirective) {
        return {
          contents: source,
          loader: "tsx",
        };
      }

      const { code } = generate(ast, { sourceFileName: args.path }, source);

      return {
        contents: code,
        loader: "tsx",
      };
    });
  };
}

function isUseServerDirective(directive: t.Directive): boolean {
  return (
    t.isDirectiveLiteral(directive.value) &&
    directive.value.value === `use server`
  );
}
