#!/usr/bin/env node
// Obol MCP server — STDIO entry point (local clients: Claude Desktop, Cursor…).
// All tools live in ./server.ts so the STDIO and HTTP transports share one
// definition. For the hosted remote server, see ./http.ts.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, FACILITATOR } from "./server.js";

const server = buildServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Obol MCP server running on stdio →", FACILITATOR);
