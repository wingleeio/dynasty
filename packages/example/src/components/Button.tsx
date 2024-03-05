"use client";
import { test } from "../utils/test";

export const Button = () => {
  return (
    <button onClick={() => test("HELLO DARKNESS MY OLD FRIEND")}>
      Homes content
    </button>
  );
};
