import path from "node:path";
import { createServer } from "vite";

/** Serves the app on the port the harness expects, once for the whole run. */
export default async function setup() {
  const server = await createServer({
    configFile: path.resolve(import.meta.dirname, "../../vite.config.ts"),
    server: { port: 1430, strictPort: true, hmr: false },
    logLevel: "error",
  });
  await server.listen();
  return async () => {
    await server.close();
  };
}
