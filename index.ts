import homepage from "./index.html";
import { compilePaneRequest } from "./src/compile.ts";

const server = Bun.serve({
  routes: {
    "/": homepage,
    "/_tape/compile": {
      GET: (request) => compilePaneRequest(request),
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log(`niri-js at ${server.url}`);
