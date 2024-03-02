"use client";

import React from "react";
import { createRoot } from "react-dom/client";
import Router from "./router";

const root = createRoot(document.getElementById("__DYNASTY_MOUNT__")!);

root.render(<Router />);
