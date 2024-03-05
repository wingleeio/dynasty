const __bun__module_map__ = new Map();

window["__webpack_chunk_load__"] = async function (moduleId: string) {
  const module = await import(moduleId);
  __bun__module_map__.set(moduleId, module);
  return module;
};

window["__webpack_require__"] = function (moduleId: string) {
  console.log("require", moduleId);
  return __bun__module_map__.get(moduleId);
};
