import { PluginBuilder } from "bun";
import parser from "@babel/parser";
import generate from "@babel/generator";
import traverse, { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import path from "path";
import { v4 } from "uuid";
import { ClientManifest } from "react-server-dom-webpack";
import { ServerReferencesMap } from "./rsc-client-plugin-babel";

export type ClientReference = {
  id: string;
  exportName: string;
  ssrId?: string | number;
};

export type ClientReferencesMap = Map<string, ClientReference[]>;

type ServerPluginOptions = {
  clientReferencesMap: ClientReferencesMap;
  serverReferencesMap: ServerReferencesMap;
  clientManifest: ClientManifest;
};

interface FunctionInfo {
  readonly name: string;
  readonly hasUseServerDirective: boolean;
}

interface ExportedFunctionInfo {
  readonly localName: string;
  readonly exportName: string;
  readonly hasUseServerDirective: boolean;
}

type RegisterReferenceType = "Server" | "Client";

export class ServerPlugin {
  name = "react-server-components-server-plugin";
  clientReferencesMap: ClientReferencesMap;
  serverReferencesMap: ServerReferencesMap;
  clientManifest: ClientManifest;

  constructor(options: ServerPluginOptions) {
    this.clientReferencesMap = options.clientReferencesMap;
    this.serverReferencesMap = options.serverReferencesMap;
    this.clientManifest = options.clientManifest;
  }

  setup = (build: PluginBuilder) => {
    build.onLoad({ filter: /\.(ts|tsx)$/ }, async (args) => {
      const source = await Bun.file(args.path).text();

      let directive: "use client" | "use server" | undefined;
      let addedRegisterReferenceCall: RegisterReferenceType;
      const unshiftedNodes = new Set<any>();
      const functions: FunctionInfo[] = [];
      const clientReferences: ClientReference[] = [];

      const ast = parser.parse(source, {
        sourceType: `module`,
        sourceFilename: args.path,
        plugins: ["typescript", "jsx"],
      });

      traverse(ast, {
        enter(nodePath) {
          const { node } = nodePath;

          if (t.isExportNamedDeclaration(node)) {
            return nodePath.skip();
          }

          const functionInfo = getFunctionInfo(node);

          if (functionInfo) {
            functions.push(functionInfo);
          }
        },
      });

      traverse(ast, {
        enter: (nodePath) => {
          const { node } = nodePath;

          if (t.isProgram(node)) {
            if (node.directives.some(isDirective(`use client`))) {
              directive = `use client`;
            } else if (node.directives.some(isDirective(`use server`))) {
              directive = `use server`;
            }

            return;
          }

          if (
            unshiftedNodes.has(node) ||
            (t.isDirective(node) && isDirective(`use client`)(node))
          ) {
            return nodePath.skip();
          }

          const exportedFunctions = getExportedFunctions(node, functions);

          if (directive === `use client`) {
            if (exportedFunctions.length === 0) {
              return nodePath.remove();
            }

            const exportedClientReferences: t.ExportNamedDeclaration[] = [];

            for (const { exportName } of exportedFunctions) {
              const cwdMinusOne = process
                .cwd()
                .split(path.sep)
                .slice(0, -1)
                .join(path.sep);

              const id = `/${path.relative(
                cwdMinusOne,
                args.path,
              )}#${exportName}`;
              clientReferences.push({ id, exportName });
              addedRegisterReferenceCall = `Client`;

              exportedClientReferences.push(
                createExportedClientReference(id, exportName),
              );

              const fileName = `/${path
                .relative(cwdMinusOne, args.path)
                .replace(".tsx", ".js")
                .replace(".ts", ".js")}`;

              this.clientManifest[id] = {
                id: fileName,
                chunks: [fileName],
                name: exportName,
              };
            }

            // I have no idea why the array of nodes needs to be duplicated for
            // replaceWithMultiple to work properly. ¯\_(ツ)_/¯
            nodePath.replaceWithMultiple([
              ...exportedClientReferences,
              ...exportedClientReferences,
            ]);

            nodePath.skip();
          } else {
            for (const functionInfo of exportedFunctions) {
              if (
                directive === `use server` ||
                functionInfo.hasUseServerDirective
              ) {
                addedRegisterReferenceCall = `Server`;
                this.serverReferencesMap.set(args.path, {
                  moduleId: path.relative(process.cwd(), args.path),
                  exportNames: exportedFunctions.map((f) => f.exportName),
                });

                nodePath.insertAfter(
                  createRegisterServerReference(functionInfo),
                );
              }
            }
          }
        },
        exit(nodePath) {
          if (!t.isProgram(nodePath.node) || !addedRegisterReferenceCall) {
            nodePath.skip();

            return;
          }

          const nodes: t.Node[] = [
            createRegisterReferenceImport(addedRegisterReferenceCall),
          ];

          if (addedRegisterReferenceCall === `Client`) {
            nodes.push(createClientReferenceProxyImplementation());
          }

          for (const node of nodes) {
            unshiftedNodes.add(node);
          }

          (nodePath as NodePath<t.Program>).unshiftContainer(
            `body`,
            nodes as any,
          );
        },
      });

      if (clientReferences.length > 0) {
        this.clientReferencesMap.set(args.path, clientReferences);
      }
      const { code } = generate(ast, { sourceFileName: args.path }, source);

      return {
        contents: code,
        loader: "tsx",
      };
    });
  };
}

function isDirective(
  value: "use client" | "use server",
): (directive: t.Directive) => boolean {
  return (directive) =>
    t.isDirectiveLiteral(directive.value) && directive.value.value === value;
}

function getExportedFunctions(
  node: t.Node,
  functions: FunctionInfo[],
): ExportedFunctionInfo[] {
  const exportedFunctions: ExportedFunctionInfo[] = [];

  if (t.isExportNamedDeclaration(node)) {
    if (node.declaration) {
      const functionInfo = getFunctionInfo(node.declaration);

      if (functionInfo) {
        exportedFunctions.push({
          localName: functionInfo.name,
          exportName: functionInfo.name,
          hasUseServerDirective: functionInfo.hasUseServerDirective,
        });
      }
    } else {
      for (const specifier of node.specifiers) {
        if (
          t.isExportSpecifier(specifier) &&
          t.isIdentifier(specifier.exported)
        ) {
          const functionInfo = functions.find(
            ({ name }) => name === specifier.local.name,
          );

          if (functionInfo) {
            exportedFunctions.push({
              localName: specifier.local.name,
              exportName: specifier.exported.name,
              hasUseServerDirective: functionInfo.hasUseServerDirective,
            });
          }
        }
      }
    }
  }

  return exportedFunctions;
}

function getFunctionInfo(node: t.Node): FunctionInfo | undefined {
  let name: string | undefined;
  let hasUseServerDirective = false;

  if (t.isFunctionDeclaration(node)) {
    name = node.id?.name;

    hasUseServerDirective = node.body.directives.some(
      isDirective(`use server`),
    );
  } else if (t.isVariableDeclaration(node)) {
    const [variableDeclarator] = node.declarations;

    if (variableDeclarator) {
      const { id, init } = variableDeclarator;

      if (
        t.isIdentifier(id) &&
        (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init))
      ) {
        name = id.name;

        if (t.isBlockStatement(init.body)) {
          hasUseServerDirective = init.body.directives.some(
            isDirective(`use server`),
          );
        }
      }
    }
  }

  return name ? { name, hasUseServerDirective } : undefined;
}

function createExportedClientReference(
  id: string,
  exportName: string,
): t.ExportNamedDeclaration {
  return t.exportNamedDeclaration(
    t.variableDeclaration(`const`, [
      t.variableDeclarator(
        t.identifier(exportName),
        t.callExpression(t.identifier(`registerClientReference`), [
          t.callExpression(t.identifier(`createClientReferenceProxy`), [
            t.stringLiteral(exportName),
          ]),
          t.stringLiteral(id),
          t.stringLiteral(exportName),
        ]),
      ),
    ]),
  );
}

function createClientReferenceProxyImplementation(): t.FunctionDeclaration {
  return t.functionDeclaration(
    t.identifier(`createClientReferenceProxy`),
    [t.identifier(`exportName`)],
    t.blockStatement([
      t.returnStatement(
        t.arrowFunctionExpression(
          [],
          t.blockStatement([
            t.throwStatement(
              t.newExpression(t.identifier(`Error`), [
                t.templateLiteral(
                  [
                    t.templateElement({ raw: `Attempted to call ` }),
                    t.templateElement({ raw: `() from the server but ` }),
                    t.templateElement(
                      {
                        raw: ` is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.`,
                      },
                      true,
                    ),
                  ],
                  [t.identifier(`exportName`), t.identifier(`exportName`)],
                ),
              ]),
            ),
          ]),
        ),
      ),
    ]),
  );
}

function createRegisterServerReference(
  functionInfo: ExportedFunctionInfo,
): t.CallExpression {
  return t.callExpression(t.identifier(`registerServerReference`), [
    t.identifier(functionInfo.localName),
    t.stringLiteral(v4()),
    t.stringLiteral(functionInfo.exportName),
  ]);
}

function createRegisterReferenceImport(
  type: RegisterReferenceType,
): t.ImportDeclaration {
  return t.importDeclaration(
    [
      t.importSpecifier(
        t.identifier(`register${type}Reference`),
        t.identifier(`register${type}Reference`),
      ),
    ],
    t.stringLiteral(`react-server-dom-webpack/server.node`),
  );
}
