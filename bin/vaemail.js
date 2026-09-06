#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executer } from '../lib/cli.js';
import { demarrer } from '../lib/serveur-mcp.js';

const ici = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(ici, '..', 'package.json'), 'utf8'));

const argv = process.argv.slice(2);

// `vaemail mcp` lance le serveur : une seule installation à connaître, que
// l'appelant soit un humain ou un agent.
if (argv[0] === 'mcp') {
  demarrer({ version });
} else {
  process.exitCode = await executer(argv, {
    ecrire: (texte) => process.stdout.write(`${texte}\n`),
    version,
  });
}
