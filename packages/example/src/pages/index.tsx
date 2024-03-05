import { Button } from "../components/Button";

export const getMetadata = async () => ({
  title: "Dynasty Example",
  description: "And example using dynasty, the best framework ever!",
});

export default async () => {
  const test: string = await new Promise((resolve) =>
    setTimeout(() => {
      resolve("Hello world!");
    }, 1),
  );
  return (
    <div>
      <h1>Hot reloading!</h1>
      <p>{test}</p>
      <Button />
    </div>
  );
};
