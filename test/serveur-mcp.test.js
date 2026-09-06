import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traiter, VERSION_PROTOCOLE } from '../lib/serveur-mcp.js';
import { ClientVaEmail } from '../lib/client.js';
import { OUTILS } from '../lib/outils.js';

/** Contexte de test : un faux `fetch` qui rend ce qu'on lui dit. */
function contexte({ cle = 'swm_test', reponses = [] } = {}) {
  const appels = [];
  const file = [...reponses];

  const client = new ClientVaEmail({
    cle,
    base: 'https://exemple.test',
    fetchImpl: async (url, options) => {
      appels.push({ url: url.toString(), options });
      const suivante = file.shift() ?? { statut: 200, corps: { success: true } };

      return {
        ok: suivante.statut < 400,
        status: suivante.statut,
        text: async () => JSON.stringify(suivante.corps),
      };
    },
  });

  return { ctx: { client, version: '1.0.0' }, appels };
}

test('initialize reprend la version de protocole demandée par le client', async () => {
  const { ctx } = contexte();

  const r = await traiter(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    ctx,
  );

  assert.equal(r.result.protocolVersion, '2024-11-05');
  assert.equal(r.result.serverInfo.name, 'vaemail');
  assert.match(r.result.instructions, /accepted, not delivered/);
});

test('une version de protocole inconnue retombe sur la nôtre', async () => {
  const { ctx } = contexte();

  const r = await traiter(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
    ctx,
  );

  assert.equal(r.result.protocolVersion, VERSION_PROTOCOLE);
});

test('tools/list décrit chaque outil avec un schéma exploitable', async () => {
  const { ctx } = contexte();

  const r = await traiter({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx);

  assert.equal(r.result.tools.length, OUTILS.length);

  for (const outil of r.result.tools) {
    assert.ok(outil.name.startsWith('vaemail_'), `nom hors convention : ${outil.name}`);
    assert.ok(outil.description.length > 40, `description trop courte : ${outil.name}`);
    assert.equal(outil.inputSchema.type, 'object');
    assert.equal(typeof outil.annotations.readOnlyHint, 'boolean');
  }

  // Une lecture doit être annoncée comme telle : un agent s'en sert pour savoir
  // ce qu'il peut appeler sans demander la permission.
  const lecture = r.result.tools.find((o) => o.name === 'vaemail_get_message');
  assert.equal(lecture.annotations.readOnlyHint, true);

  const envoi = r.result.tools.find((o) => o.name === 'vaemail_send_email');
  assert.equal(envoi.annotations.readOnlyHint, false);
});

test('une notification ne reçoit aucune réponse', async () => {
  const { ctx } = contexte();

  assert.equal(await traiter({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx), null);
});

test('un envoi passe la clé d\'idempotence en en-tête, pas dans le corps', async () => {
  const { ctx, appels } = contexte({ reponses: [{ statut: 202, corps: { success: true, data: { id: 7, status: 'queued' } } }] });

  const r = await traiter({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'vaemail_send_email',
      arguments: { to: 'client@exemple.fr', html: '<p>Bonjour</p>', idempotency_key: 'tache-1' },
    },
  }, ctx);

  assert.equal(r.result.isError, false);
  assert.equal(r.result.structuredContent.data.id, 7);

  const envoye = appels[0];
  assert.equal(envoye.options.headers['Idempotency-Key'], 'tache-1');
  assert.equal(JSON.parse(envoye.options.body).idempotency_key, undefined);
  assert.equal(JSON.parse(envoye.options.body).to, 'client@exemple.fr');
});

test('une erreur de l\'API revient lisible, avec l\'action corrective', async () => {
  const { ctx } = contexte({
    reponses: [{
      statut: 422,
      corps: {
        success: false,
        message: 'Destinataire dans la liste de suppression.',
        error: {
          code: 'RECIPIENT_SUPPRESSED',
          message: 'Destinataire dans la liste de suppression.',
          retryable: false,
          resolution: { action: 'remove_from_suppression_list', endpoint: '/v3/smtp/blockedContacts' },
        },
      },
    }],
  });

  const r = await traiter({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'vaemail_send_email', arguments: { to: 'bloque@exemple.fr', html: '<p>x</p>' } },
  }, ctx);

  assert.equal(r.result.isError, true);

  const texte = r.result.content[0].text;
  assert.match(texte, /RECIPIENT_SUPPRESSED/);
  assert.match(texte, /remove_from_suppression_list/);
  // L'agent doit comprendre que relancer à l'identique ne sert à rien.
  assert.match(texte, /ne changera rien/);
});

test('sans clé, tout est refusé sauf la découverte', async () => {
  const { ctx } = contexte({ cle: null });

  const refus = await traiter({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'vaemail_send_email', arguments: { to: 'a@exemple.fr', html: '<p>x</p>' } },
  }, ctx);

  assert.equal(refus.result.isError, true);
  assert.match(refus.result.content[0].text, /VAEMAIL_API_KEY/);

  const decouverte = await traiter({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: { name: 'vaemail_capabilities', arguments: {} },
  }, ctx);

  assert.equal(decouverte.result.isError, false);
});

test('un outil inconnu liste ceux qui existent', async () => {
  const { ctx } = contexte();

  const r = await traiter({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'vaemail_envoyer_tout', arguments: {} },
  }, ctx);

  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /vaemail_send_email/);
});

test('une méthode inconnue rend une erreur JSON-RPC normalisée', async () => {
  const { ctx } = contexte();

  const r = await traiter({ jsonrpc: '2.0', id: 8, method: 'resources/list' }, ctx);

  assert.equal(r.error.code, -32601);
});

test('les filtres de liste partent en paramètres de requête', async () => {
  const { ctx, appels } = contexte({ reponses: [{ statut: 200, corps: { success: true, data: [] } }] });

  await traiter({
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: { name: 'vaemail_list_messages', arguments: { status: 'failed', limit: 10 } },
  }, ctx);

  assert.match(appels[0].url, /status=failed/);
  assert.match(appels[0].url, /limit=10/);
});
