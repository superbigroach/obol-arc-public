#!/usr/bin/env node
// Obol MCP server — Streamable HTTP entry point (hosted remote server).
// Agents connect over HTTP instead of stdio: resumable, session-based, serverless-friendly.
// Run:  obol-mcp-http   (listens on $PORT, default 8787, path /mcp)
//
// Per-session isolation: each MCP session gets its own server instance, so a
// hosted deployment can serve many agents concurrently. Sessions are tracked by
// the `mcp-session-id` header the SDK negotiates on initialize.
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { buildServer, FACILITATOR } from "./server.js";

const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json());

// Live transports keyed by session id.
const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  let transport: StreamableHTTPServerTransport | undefined = sessionId ? transports[sessionId] : undefined;

  if (!transport) {
    if (sessionId || !isInitializeRequest(req.body)) {
      res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Bad Request: no valid session — send an initialize request first." } });
      return;
    }
    // New session: spin up a transport + its own server instance.
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => { transports[sid] = transport!; },
    });
    transport.onclose = () => {
      if (transport!.sessionId) delete transports[transport!.sessionId];
    };
    const server = buildServer();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

// GET = open the SSE stream for server→client notifications; DELETE = end session.
async function sessionRequest(req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports[sessionId] : undefined;
  if (!transport) { res.status(400).send("Invalid or missing session ID"); return; }
  await transport.handleRequest(req, res);
}
app.get("/mcp", sessionRequest);
app.delete("/mcp", sessionRequest);

// Simple health check for load balancers.
app.get("/healthz", (_req: Request, res: Response) => res.json({ ok: true, facilitator: FACILITATOR }));

app.listen(PORT, () => {
  console.error(`Obol MCP server (Streamable HTTP) on http://localhost:${PORT}/mcp → ${FACILITATOR}`);
});
