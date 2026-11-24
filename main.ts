// main.ts — entrypoint. Running `node main.ts` (or `node serve.ts`)
// starts the static server from serve.ts and serves the game in
// game/ at http://localhost:8734/.

import { startServer } from "./serve.ts";

const portArg = process.argv.find((a) => a.startsWith("--port="));
const port = portArg ? Number(portArg.slice("--port=".length)) : 8734;

startServer(Number.isFinite(port) && port > 0 ? port : 8734);
