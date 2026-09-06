// Serveur MCP sur stdio, en JSON-RPC 2.0, sans aucune dépendance.
//
// Le SDK officiel ferait la même chose, mais un paquet qu'un agent installe
// tout seul a intérêt à ne rien tirer derrière lui : moins de surface, une
// installation qui ne peut pas échouer sur un arbre de dépendances, et un
// serveur qu'on peut lire en entier avant de lui confier une clé d'API.

import { ClientVaEmail, ErreurVaEmail, BASE_PAR_DEFAUT } from './client.js';
import { OUTILS, outilParNom } from './outils.js';

export const VERSION_PROTOCOLE = '2025-06-18';
export const VERSIONS_ACCEPTEES = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** Traite un message JSON-RPC et rend la réponse, ou null pour une notification. */
export async function traiter(message, contexte) {
  const { id, method, params } = message ?? {};

  // Une notification n'a pas d'identifiant : elle n'attend aucune réponse.
  const notification = id === undefined || id === null;

  try {
    switch (method) {
      case 'initialize':
        return reponse(id, {
          // On renvoie la version demandée si on la connaît : c'est le client
          // qui mène la négociation, pas nous.
          protocolVersion: VERSIONS_ACCEPTEES.includes(params?.protocolVersion)
            ? params.protocolVersion
            : VERSION_PROTOCOLE,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'vaemail', version: contexte.version },
          instructions:
            'VaEmail sends email for applications and AI agents. '
            + 'A send is accepted, not delivered: check vaemail_get_message for the outcome. '
            + 'Before the first real send, run vaemail_validate_email. '
            + 'When mail lands badly, run vaemail_diagnose_deliverability rather than guessing. '
            + 'Publishing DNS records and paying for a plan are human steps: report them, never claim them done.',
        });

      case 'notifications/initialized':
        return null;

      case 'ping':
        return reponse(id, {});

      case 'tools/list':
        return reponse(id, {
          tools: OUTILS.map((outil) => ({
            name: outil.name,
            title: outil.title,
            description: outil.description,
            inputSchema: outil.inputSchema,
            annotations: {
              readOnlyHint: Boolean(outil.lectureSeule),
              // Rien ici n'efface de donnée : le pire cas est un envoi, qui
              // ajoute. On ne prétend pas pour autant que c'est sans effet.
              destructiveHint: false,
              idempotentHint: Boolean(outil.lectureSeule),
              openWorldHint: true,
            },
          })),
        });

      case 'tools/call':
        return reponse(id, await appelerOutil(params, contexte));

      default:
        if (notification) return null;

        return erreur(id, -32601, `Méthode inconnue : ${method}`);
    }
  } catch (e) {
    if (notification) return null;

    return erreur(id, -32603, e.message);
  }
}

async function appelerOutil(params, contexte) {
  const outil = outilParNom(params?.name);

  if (!outil) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text: `Unknown tool: ${params?.name}. Available: ${OUTILS.map((o) => o.name).join(', ')}`,
      }],
    };
  }

  if (!contexte.client.cle && !outil.sansCle) {
    return {
      isError: true,
      content: [{
        type: 'text',
        text:
          'No API key configured. Set VAEMAIL_API_KEY in the MCP server environment. '
          + 'A key is created from the VaEmail dashboard (Clés API), and creating one is a human step.',
      }],
    };
  }

  try {
    const resultat = await outil.executer(contexte.client, params?.arguments ?? {});

    return {
      // Le texte pour l'agent, la structure pour le code qui l'entoure.
      content: [{ type: 'text', text: JSON.stringify(resultat, null, 2) }],
      structuredContent: resultat,
      isError: false,
    };
  } catch (e) {
    const texte = e instanceof ErreurVaEmail
      ? e.pourAgent()
      : `Call failed: ${e.message}`;

    // isError plutôt qu'une erreur JSON-RPC : l'agent doit VOIR le motif et
    // pouvoir corriger, pas recevoir un échec de transport opaque.
    return { isError: true, content: [{ type: 'text', text: texte }] };
  }
}

function reponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function erreur(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Boucle de lecture stdio : un message JSON par ligne (délimitation retenue par
 * MCP sur stdio). Les lignes vides sont ignorées, une ligne illisible est
 * signalée sans arrêter le serveur.
 */
export function demarrer({ entree = process.stdin, sortie = process.stdout, env = process.env, version = '1.0.0' } = {}) {
  const contexte = {
    version,
    client: new ClientVaEmail({
      cle: env.VAEMAIL_API_KEY,
      base: env.VAEMAIL_BASE_URL || BASE_PAR_DEFAUT,
    }),
  };

  let tampon = '';

  entree.setEncoding('utf8');
  entree.on('data', async (morceau) => {
    tampon += morceau;

    let saut;
    while ((saut = tampon.indexOf('\n')) !== -1) {
      const ligne = tampon.slice(0, saut).trim();
      tampon = tampon.slice(saut + 1);

      if (ligne === '') continue;

      let message;
      try {
        message = JSON.parse(ligne);
      } catch {
        ecrire(sortie, erreur(null, -32700, 'JSON invalide.'));
        continue;
      }

      const reponseMessage = await traiter(message, contexte);
      if (reponseMessage) ecrire(sortie, reponseMessage);
    }
  });

  return contexte;
}

function ecrire(sortie, objet) {
  sortie.write(`${JSON.stringify(objet)}\n`);
}
