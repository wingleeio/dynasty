"use client";

import { test } from "../utils/test";
import { useRouter } from "dynasty.js";

export const Button = () => {
  const { navigate } = useRouter();
  return (
    <button
      onClick={async () => {
        await test("HELLO");
        navigate("/about");
      }}
    >
      Homes content
    </button>
  );
};
