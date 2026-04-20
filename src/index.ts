#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFreeAgentMcpServer } from './server.js';
import { config } from './config.js';

async function main() {
  // Create server
  const { server, tokenStore, getAuthorizationUrl, handleAuthorizationCode, isAuthenticated } =
    createFreeAgentMcpServer();

  // Load persisted tokens if available
  await tokenStore.load();

  // Log startup info
  console.error('FreeAgent MCP Server starting...');
  console.error(`Environment: ${config.freeagent.environment}`);

  if (!isAuthenticated()) {
    console.error('');
    console.error('Not authenticated. To authorize, visit:');
    console.error(getAuthorizationUrl());
    console.error('');
    console.error('After authorization, provide the code via the auth_callback tool.');
  } else {
    console.error('Authenticated and ready.');
  }

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.error('Shutting down...');
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.error('Shutting down...');
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
