// Ligne de commande VaEmail. Sortie lisible par défaut, `--json` pour un script.
//
// Elle sert deux publics à la fois : un humain qui vérifie une configuration en
// une commande, et un agent qui préfère un binaire à un appel HTTP. D'où la
// règle : chaque commande dit ce qui s'est passé ET ce qu'il reste à faire.

import { ClientVaEmail, ErreurVaEmail, BASE_PAR_DEFAUT } from './client.js';

export const AIDE = `vaemail — email infrastructure for applications and AI agents

Usage
  vaemail init                          Check the configuration and print the MCP snippet
  vaemail capabilities                  What the service can do (no API key needed)
  vaemail send --to <a> --subject <s> --html <h>
  vaemail status <id>                   Delivery status of a message
  vaemail messages [--status <s>]       Recent messages
  vaemail domains                       Sending domains and their authentication
  vaemail domains:add <domain>          Declare a domain, print the DNS records to add
  vaemail doctor [--domain <d>]         Why is my email not arriving?
  vaemail usage                         Quota, daily cap, what is left
  vaemail mcp                           Run the MCP server on stdio

Options
  --json        Machine-readable output
  --key <k>     API key (default: VAEMAIL_API_KEY)
  --base <url>  API base URL (default: VAEMAIL_BASE_URL or ${BASE_PAR_DEFAUT})

Environment
  VAEMAIL_API_KEY    Account API key. Created from the dashboard, under « Clés API ».
  VAEMAIL_BASE_URL   Override the API base URL.
`;

/** Découpe `--nom valeur` et `--drapeau` sans dépendance. */
export function analyser(argv) {
  const options = {};
  const positionnels = [];

  for (let i = 0; i < argv.length; i++) {
    const jeton = argv[i];

    if (jeton.startsWith('--')) {
      const nom = jeton.slice(2);
      const suivant = argv[i + 1];

      if (suivant === undefined || suivant.startsWith('--')) {
        options[nom] = true;
      } else {
        options[nom] = suivant;
        i++;
      }
    } else {
      positionnels.push(jeton);
    }
  }

  return { options, positionnels };
}

export async function executer(argv, { env = process.env, ecrire, version = '1.0.0' }) {
  const { options, positionnels } = analyser(argv);
  const commande = positionnels[0];

  if (!commande || commande === 'help' || options.help) {
    ecrire(AIDE);

    return 0;
  }

  if (commande === 'version' || options.version) {
    ecrire(version);

    return 0;
  }

  const client = new ClientVaEmail({
    cle: options.key ?? env.VAEMAIL_API_KEY,
    base: options.base ?? env.VAEMAIL_BASE_URL ?? BASE_PAR_DEFAUT,
  });

  const json = Boolean(options.json);
  const rendre = (donnees, texte) => ecrire(json ? JSON.stringify(donnees, null, 2) : texte);

  try {
    switch (commande) {
      case 'init':
        return await initialiser(client, { ecrire, json, options, env });

      case 'capabilities': {
        const r = await client.capacites();
        rendre(r, resumerCapacites(r));

        return 0;
      }

      case 'send': {
        exigerCle(client);

        if (!options.to) throw new ErreurVaEmail('Missing --to.', { code: 'MISSING_ARGUMENT' });
        if (!options.html && !options['template-id']) {
          throw new ErreurVaEmail('Missing --html or --template-id.', { code: 'CONTENT_REQUIRED' });
        }

        const r = await client.envoyer({
          to: options.to,
          subject: options.subject,
          html: options.html,
          template_id: options['template-id'] ? Number(options['template-id']) : undefined,
          tag: options.tag,
        }, options['idempotency-key']);

        rendre(r, `Accepted — message ${r.data.id} (${r.data.status}).\n`
          + `Accepted is not delivered: vaemail status ${r.data.id}`);

        return 0;
      }

      case 'status': {
        exigerCle(client);
        const id = positionnels[1];
        if (!id) throw new ErreurVaEmail('Usage: vaemail status <id>.', { code: 'MISSING_ARGUMENT' });

        const r = await client.message(id);
        const d = r.data;
        const evenements = d.events.length
          ? d.events.map((e) => `  ${e.at} ${e.type}${e.classification ? ` (${e.classification})` : ''}`).join('\n')
          : '  (no event yet)';

        rendre(r, `Message ${d.id} — ${d.status}\nTo: ${d.to}\nSubject: ${d.subject ?? ''}`
          + `${d.error ? `\nError: ${d.error}` : ''}\nEvents:\n${evenements}`);

        return 0;
      }

      case 'messages': {
        exigerCle(client);
        const r = await client.messages({ status: options.status, tag: options.tag, limit: options.limit });

        rendre(r, r.data.length
          ? r.data.map((m) => `${String(m.id).padStart(6)}  ${m.status.padEnd(10)}  ${m.to}  ${m.subject ?? ''}`).join('\n')
          : 'No message.');

        return 0;
      }

      case 'domains': {
        exigerCle(client);
        const r = await client.domaines();

        rendre(r, r.data.length
          ? r.data.map((d) => {
            const a = d.authentication;

            return `${d.domain}\n  SPF   ${etat(a.spf.present)}\n  DKIM  ${etat(a.dkim.present)}`
              + `\n  DMARC ${etat(a.dmarc.present)}`;
          }).join('\n')
          : 'No sending domain declared. Add one: vaemail domains:add <domain>');

        return 0;
      }

      case 'domains:add': {
        exigerCle(client);
        const domaine = positionnels[1];
        if (!domaine) throw new ErreurVaEmail('Usage: vaemail domains:add <domain>.', { code: 'MISSING_ARGUMENT' });

        const r = await client.declarerDomaine(domaine, options['dkim-selector'], options['idempotency-key']);
        const lignes = r.data.dns_records
          .map((e) => `  ${e.publishable ? ' ' : '!'} ${e.type.padEnd(6)} ${e.host.padEnd(28)} ${e.value}\n           ${e.role}`)
          .join('\n');

        // Un enregistrement marqué « ! » contient encore un gabarit : le publier
        // tel quel casserait l'authentification du domaine.
        const avertissement = r.data.dns_note ? `\n\n! ${r.data.dns_note}` : '';

        rendre(r, `Domain ${r.data.domain} declared.\n\nDNS records to add at your registrar:\n${lignes}${avertissement}\n\n`
          + `${r.data.next_step}\n\nPublishing DNS records is a human step — nothing is authenticated until they are live.`);

        return 0;
      }

      case 'doctor': {
        exigerCle(client);
        const r = await client.diagnostic(options.domain);
        rendre(r, resumerDiagnostic(r.data));

        return r.data.status === 'critical' ? 1 : 0;
      }

      case 'usage': {
        exigerCle(client);
        const r = await client.consommation();
        const m = r.data.month;
        const c = r.data.api_key;

        rendre(r, `This month: ${m.used}${m.quota ? ` / ${m.quota}` : ''} sent`
          + `${m.remaining === null ? ' (no quota)' : `, ${m.remaining} left`}\n`
          + `Today: ${r.data.today.messages} messages`
          + `${c?.daily_remaining !== null && c?.daily_remaining !== undefined ? `, ${c.daily_remaining} left on this key` : ''}`);

        return 0;
      }

      default:
        ecrire(`Unknown command: ${commande}\n\n${AIDE}`);

        return 1;
    }
  } catch (e) {
    if (e instanceof ErreurVaEmail) {
      ecrire(json ? JSON.stringify({ error: { code: e.code, message: e.message, retryable: e.retryable } }, null, 2) : e.pourAgent());

      return 1;
    }

    ecrire(`Call failed: ${e.message}`);

    return 1;
  }
}

function exigerCle(client) {
  if (!client.cle) {
    throw new ErreurVaEmail(
      'No API key. Set VAEMAIL_API_KEY, or pass --key. A key is created from the VaEmail dashboard, under « Clés API ».',
      { code: 'UNAUTHORIZED' },
    );
  }
}

function etat(present) {
  if (present === null) return 'not checked';

  return present ? 'ok' : 'MISSING';
}

function resumerCapacites(c) {
  const oui = Object.entries(c.capabilities).filter(([, v]) => v).map(([k]) => k);

  return `${c.service} — ${c.purpose.join(', ')}\nRegion: ${c.region}\n`
    + `Interfaces: ${Object.entries(c.interfaces).filter(([, v]) => v).map(([k]) => k).join(', ')}\n`
    + `Capabilities: ${oui.join(', ')}\nOpenAPI: ${c.openapi}`;
}

function resumerDiagnostic(d) {
  const lignes = [`Deliverability: ${d.status.toUpperCase()}`];

  for (const auth of d.authentication) {
    lignes.push(`\n${auth.domain}`, `  SPF ${etat(auth.spf.present)} · DKIM ${etat(auth.dkim.present)} · DMARC ${etat(auth.dmarc.present)}`);
  }

  if (d.issues.length) {
    lignes.push('\nFindings:');
    for (const c of d.issues) lignes.push(`  [${c.level}] ${c.title}`, `      ${c.summary ?? ''}`);
  }

  if (d.recommended_actions.length) {
    lignes.push('\nRecommended actions:');
    for (const a of d.recommended_actions) lignes.push(`  ${a.code} on ${a.domain} — ${a.reason}`);
  }

  if (!d.issues.length && !d.recommended_actions.length) lignes.push('\nNothing to fix.');

  return lignes.join('\n');
}

async function initialiser(client, { ecrire, json, options, env }) {
  const etapes = [];
  let capacites = null;

  try {
    capacites = await client.capacites();
    etapes.push({ etape: 'service', ok: true, detail: `${capacites.service} reachable at ${client.base}` });
  } catch (e) {
    etapes.push({ etape: 'service', ok: false, detail: e.message });
  }

  if (!client.cle) {
    etapes.push({
      etape: 'api_key',
      ok: false,
      detail: 'No API key. Create one from the VaEmail dashboard (« Clés API »), then set VAEMAIL_API_KEY.',
    });
  } else {
    try {
      const usage = await client.consommation();
      etapes.push({ etape: 'api_key', ok: true, detail: `Key accepted${usage.data.api_key ? ` (${usage.data.api_key.name})` : ''}` });
    } catch (e) {
      etapes.push({ etape: 'api_key', ok: false, detail: e.message });
    }

    try {
      const domaines = await client.domaines();
      const authentifies = domaines.data.filter((d) => d.authentication.ok);

      etapes.push({
        etape: 'domains',
        ok: authentifies.length > 0,
        detail: domaines.data.length === 0
          ? 'No sending domain. Declare one: vaemail domains:add <domain>'
          : `${authentifies.length}/${domaines.data.length} domain(s) authenticated`,
      });
    } catch (e) {
      etapes.push({ etape: 'domains', ok: false, detail: e.message });
    }
  }

  const extrait = {
    mcpServers: {
      vaemail: {
        command: 'npx',
        args: ['-y', 'vaemail', 'mcp'],
        env: { VAEMAIL_API_KEY: client.cle ? '***' : 'swm_your_key_here' },
      },
    },
  };

  if (json) {
    ecrire(JSON.stringify({ steps: etapes, mcp: extrait }, null, 2));
  } else {
    ecrire(etapes.map((e) => `${e.ok ? '✓' : '✗'} ${e.etape.padEnd(10)} ${e.detail}`).join('\n'));
    ecrire('\nMCP configuration:\n');
    ecrire(JSON.stringify(extrait, null, 2));
    ecrire('\nOr, with Claude Code:\n  claude mcp add vaemail --env VAEMAIL_API_KEY=$VAEMAIL_API_KEY -- npx -y vaemail mcp');
  }

  return etapes.every((e) => e.ok) ? 0 : 1;
}
