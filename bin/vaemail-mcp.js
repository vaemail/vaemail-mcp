#!/usr/bin/env node
// Serveur MCP VaEmail. Se branche sur un agent par stdio.
//
//   claude mcp add vaemail --env VAEMAIL_API_KEY=swm_... -- npx -y vaemail mcp
//
// Variables lues : VAEMAIL_API_KEY (obligatoire pour tout sauf capabilities)
// et VAEMAIL_BASE_URL (pour pointer ailleurs que la production).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demarrer } from '../lib/serveur-mcp.js';

const ici = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(ici, '..', 'package.json'), 'utf8'));

demarrer({ version });
