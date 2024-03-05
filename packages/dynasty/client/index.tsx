"use client";

import React from "react";
import { createRoot } from "react-dom/client";
import Router from "./router";

const root = createRoot(document.getElementById("__DYNASTY_MOUNT__")!);

root.render(<Router />);

const global = window;

const __bun__module_map__ = new Map();

global["__webpack_chunk_load__"] = async function (moduleId: string) {
  const module = await import(moduleId);
  __bun__module_map__.set(moduleId, module);
  return module;
};

global["__webpack_require__"] = function (moduleId: string) {
  console.log("require", moduleId);
  return __bun__module_map__.get(moduleId);
};
