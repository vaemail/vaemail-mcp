// Le SDK est la porte d'entrée d'un développeur qui n'utilise ni la CLI ni MCP.
// Ces tests vérifient ce qui part sur le réseau, avec un fetch factice : c'est
// la seule chose qu'un appelant constate vraiment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VaEmail, DEFAULT_BASE_URL } from '../lib/index.js';

function espion(reponse = { success: true, data: {} }, statut = 200) {
  const appels = [];
  const faux = async (url, options) => {
    appels.push({ url: String(url), options });
    return {
      ok: statut < 400,
      status: statut,
      headers: { get: () => 'application/json' },
      json: async () => reponse,
      text: async () => JSON.stringify(reponse),
    };
  };

  return { appels, faux };
}

test('la clé d\'API part en en-tête et la base par défaut est la production', async () => {
  const { appels, faux } = espion();
  await new VaEmail({ apiKey: 'cle-test', fetch: faux }).capabilities();

  assert.equal(appels[0].url, `${DEFAULT_BASE_URL}/api/v1/capabilities`);
  assert.equal(appels[0].options.headers['api-key'], 'cle-test');
});

test('les jetons DKIM sont transmis à la déclaration de domaine', async () => {
  const { appels, faux } = espion();

  await new VaEmail({ apiKey: 'k', fetch: faux }).addDomain('news.exemple.fr', {
    dkimTokens: ['aaa111', 'bbb222', 'ccc333'],
  });

  const corps = JSON.parse(appels[0].options.body);
  assert.deepEqual(corps.dkim_tokens, ['aaa111', 'bbb222', 'ccc333']);
  assert.equal(corps.domain, 'news.exemple.fr');
});

test('l\'ancien appel avec un sélecteur seul continue de fonctionner', async () => {
  const { appels, faux } = espion();

  await new VaEmail({ apiKey: 'k', fetch: faux }).addDomain('news.exemple.fr', { selector: 'swm' });

  const corps = JSON.parse(appels[0].options.body);
  assert.equal(corps.dkim_selector, 'swm');
  assert.equal(corps.dkim_tokens, undefined);
});

test('la clé d\'idempotence part en en-tête sur un envoi', async () => {
  const { appels, faux } = espion();

  await new VaEmail({ apiKey: 'k', fetch: faux }).send(
    { to: 'x@exemple.fr', subject: 'Bonjour', html: '<p>Bonjour</p>' },
    'commande-42',
  );

  assert.equal(appels[0].options.headers['Idempotency-Key'], 'commande-42');
});

test('une erreur d\'API dit quoi faire et si l\'appel peut être rejoué', async () => {
  const { faux } = espion(
    {
      error: {
        code: 'DOMAIN_NOT_VERIFIED',
        message: 'Domaine non authentifié.',
        resolution: { action: 'verify_domain', endpoint: '/api/v1/domains/verify' },
        retryable: false,
      },
    },
    422,
  );

  await assert.rejects(
    () => new VaEmail({ apiKey: 'k', fetch: faux }).send({ to: 'x@exemple.fr' }),
    (erreur) => {
      assert.equal(erreur.code, 'DOMAIN_NOT_VERIFIED');
      assert.equal(erreur.retryable, false);
      assert.match(erreur.pourAgent(), /verify_domain/);
      return true;
    },
  );
});
