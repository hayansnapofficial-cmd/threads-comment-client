#!/usr/bin/env node
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {buildClientServer} from './server.mjs';

serveStdio(() => buildClientServer(), {onerror() { process.stderr.write('[Threads MCP] Transport error\n'); }});
