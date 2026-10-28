// Layout-only preview. It deliberately returns 503 for every API request.
// Use Docker Compose for the functioning full-stack application.
import http from "node:http";
import { readFile } from "node:fs/promises";
const routes = {
  "/": ["index.html", "text/html"],
  "/app.js": ["app.js", "text/javascript"],
  "/styles.css": ["styles.css", "text/css"],
};
http
  .createServer(async (req, res) => {
    const asset = routes[req.url];
    if (!asset) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          error: "Layout preview only. Start Docker Compose for checkout.",
        }),
      );
    }
    res.writeHead(200, { "Content-Type": asset[1] });
    res.end(
      await readFile(new URL("../frontend/" + asset[0], import.meta.url)),
    );
  })
  .listen(8091, "127.0.0.1", () =>
    console.log("Layout preview http://localhost:8091 (no checkout backend)"),
  );
