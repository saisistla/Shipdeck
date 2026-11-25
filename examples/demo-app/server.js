import http from "node:http";

const port = Number(process.env.PORT || 8080);

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "shipdeck-demo-app" }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(port, () => {
  console.log(`demo-app listening on ${port}`);
});
