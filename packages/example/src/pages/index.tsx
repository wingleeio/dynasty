import { Button } from "../components/Button";
import "../index.css";
export const getMetadata = async () => ({
  title: "Dynasty Example",
  description: "And example using dynasty, the best framework ever!",
});

export default () => {
  return (
    <div className="test">
      <h1>Hot reloading!</h1>
      <Button />
    </div>
  );
};
