"use client";

import { test } from "../utils/test";

function myFunction() {
  console.log("myFunction");
}

const myFunction2 = () => {
  console.log("myFunction2");
};

export const Button = () => {
  return <button onClick={test}>Homes content</button>;
};
