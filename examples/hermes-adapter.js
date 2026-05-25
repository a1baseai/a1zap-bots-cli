#!/usr/bin/env node
import http from "node:http";

const port = Number(process.env.PORT || 8787);

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function messageText(event) {
  return (
    event?.message?.text ||
    event?.message?.content ||
    event?.text ||
    event?.content ||
    ""
  );
}

const server = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/a1zap") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  try {
    const payload = await readJson(request);
    const text = messageText(payload.event);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        messages: [
          {
            text: text
              ? `Hermes heard: ${text}`
              : "Hermes received the A1Zap event.",
            metadata: {
              source: "hermes-adapter-example",
            },
          },
        ],
      }),
    );
  } catch (error) {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(port, () => {
  console.log(`Hermes adapter example listening on http://localhost:${port}/a1zap`);
});
