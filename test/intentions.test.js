// Les quatre outils d'intention : ce qu'ils enchaînent, et ce qu'ils refusent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traiter } from '../lib/serveur-mcp.js';
import { ClientVaEmail } from '../lib/client.js';

/** Faux serveur : une réponse par motif d'URL, dans l'ordre des appels. */
function contexte(routes) {
  const appels = [];
  const client = new ClientVaEmail({
    cle: 'swm_test',
    base: 'https://exemple.test',
    fetchImpl: async (url, options) => {
      const u = url.toString();
      const corps = options.body ? JSON.parse(options.body) : null;
      appels.push({ methode: options.method, url: u, corps });
      const route = routes.find((r) => r.test(options.method, u));
      const rep = route ? route.reponse(corps, u) : { statut: 404, corps: { error: { code: 'NOT_FOUND', message: 'route' } } };

      return { ok: rep.statut < 400, status: rep.statut, text: async () => JSON.stringify(rep.corps) };
    },
  });

  return { ctx: { client, version: 'test' }, appels };
}

const route = (methode, motif, reponse) => ({
  test: (m, u) => m === methode && u.includes(motif),
  reponse: typeof reponse === 'function'
    ? reponse
    : () => (reponse && typeof reponse.statut === 'number' ? reponse : { statut: 200, corps: reponse }),
});

const LISTES = {
  lists: [
    { id: 50, name: "L'actu BienveNum (base Brevo)", totalSubscribers: 3761, folderId: 2 },
    { id: 51, name: 'Ont deja recu L actu #6', totalSubscribers: 2982 },
    { id: 53, name: 'Webinaire — inscrits', totalSubscribers: 120 },
  ],
  count: 3,
};

async function appeler(ctx, name, args) {
  const r = await traiter({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);

  return r.result;
}

test('envoyer_newsletter retrouve la liste par un bout de son nom, teste, puis programme', async () => {
  const { ctx, appels } = contexte([
    route('GET', '/v3/contacts/lists', LISTES),
    route('POST', '/v3/emailCampaigns/61/sendTest', { message: 'ok' }),
    route('POST', '/v3/emailCampaigns/61/schedule', {
      campaignId: 61, status: 'queued', scheduledAt: '2036-09-17T08:00:00Z', recipients: 3761,
      estimated: { recipients: 3761, warmupDays: 3, perDay: [1000, 2500, 261] },
    }),
    route('POST', '/v3/emailCampaigns', { statut: 201, corps: { id: 61 } }),
  ]);

  const r = await appeler(ctx, 'vaemail_envoyer_newsletter', {
    sujet: 'Budget formation', contenu: 'Bonjour,\n\nvoici la lettre.', liste: 'actu bienvenum (base',
    quand: '2036-09-17 10:00', test_vers: 'test@agencesw.com',
  });

  assert.equal(r.isError, false, JSON.stringify(r.content));
  assert.equal(r.structuredContent.statut, 'programmée');
  assert.equal(r.structuredContent.liste.id, 50);
  assert.match(r.structuredContent.resume, /3 jours/);
  assert.match(r.structuredContent.lien_admin, /admin\/campaigns\/61$/);

  const creation = appels.find((a) => a.methode === 'POST' && a.url.endsWith('/v3/emailCampaigns'));
  assert.deepEqual(creation.corps.recipients, { listIds: [50] });
  assert.match(creation.corps.htmlContent, /^<p>Bonjour,<\/p>\n<p>voici la lettre\.<\/p>$/);

  const prog = appels.find((a) => a.url.includes('/schedule'));
  // 10h00 à Paris en septembre (heure d'été) = 08:00 UTC.
  assert.equal(prog.corps.scheduledAt, '2036-09-17T08:00:00.000Z');
  assert.ok(appels.findIndex((a) => a.url.includes('/sendTest')) < appels.findIndex((a) => a.url.includes('/schedule')), 'le test part avant la programmation');
});

test('envoyer_newsletter sans « quand » laisse un brouillon et ne programme rien', async () => {
  const { ctx, appels } = contexte([
    route('GET', '/v3/contacts/lists', LISTES),
    route('POST', '/v3/emailCampaigns', { statut: 201, corps: { id: 62 } }),
  ]);

  const r = await appeler(ctx, 'vaemail_envoyer_newsletter', { sujet: 'S', contenu: '<p>x</p>', liste: '53' });

  assert.equal(r.structuredContent.statut, 'brouillon');
  assert.ok(!appels.some((a) => /schedule|sendNow/.test(a.url)));
});

test('envoyer_newsletter refuse une liste ambiguë et nomme les candidates', async () => {
  const { ctx, appels } = contexte([route('GET', '/v3/contacts/lists', LISTES)]);

  const r = await appeler(ctx, 'vaemail_envoyer_newsletter', { sujet: 'S', contenu: 'x', liste: 'actu', quand: 'maintenant' });

  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Plusieurs listes correspondent/);
  assert.match(r.content[0].text, /#50/);
  assert.ok(!appels.some((a) => a.methode === 'POST'), 'rien n\'est créé');
});

test('envoyer_newsletter refuse une date passée', async () => {
  const { ctx } = contexte([route('GET', '/v3/contacts/lists', LISTES)]);

  const r = await appeler(ctx, 'vaemail_envoyer_newsletter', { sujet: 'S', contenu: 'x', liste: '53', quand: '2020-01-01 10:00' });

  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /déjà passée/);
});

test('ou_en_est_ma_campagne parle en phrases et retrouve par le sujet', async () => {
  const { ctx } = contexte([
    route('GET', '/v3/emailCampaigns/57/statistics', { globalStats: { sent: 250, queued: 3466, uniqueOpens: 80, uniqueClicks: 4, hardBounces: 2 } }),
    route('GET', '/v3/emailCampaigns', {
      campaigns: [
        { id: 60, name: 'Budget', subject: 'Votre budget formation 2026', status: 'queued', scheduledAt: '2026-09-17T08:00:00Z' },
        { id: 57, name: 'Elementor', subject: 'Votre site tourne-t-il sous Elementor ?', status: 'sending' },
      ],
    }),
  ]);

  const r = await appeler(ctx, 'vaemail_ou_en_est_ma_campagne', { campagne: 'elementor' });

  assert.equal(r.isError, false);
  assert.match(r.structuredContent.resume, /en cours d'envoi : 250 mails envoyés, 3\D466 restent/);
  assert.match(r.structuredContent.resume, /Ouvert par 80 personnes/);
  assert.match(r.structuredContent.resume, /2 rebonds durs/);
});

test('qui_est_abonne range les listes par dossier', async () => {
  const { ctx } = contexte([
    route('GET', '/v3/contacts/lists', LISTES),
    route('GET', '/v3/contacts/folders', { folders: [{ id: 2, name: 'Newsletters' }] }),
  ]);

  const r = await appeler(ctx, 'vaemail_qui_est_abonne', {});

  assert.deepEqual(Object.keys(r.structuredContent.dossiers), ['Newsletters', 'Sans dossier']);
  assert.match(r.structuredContent.resume, /3 listes/);
});

test('qui_est_abonne survit à un service sans dossiers et dit le statut d\'une adresse', async () => {
  const { ctx } = contexte([
    route('GET', '/v3/contacts/lists', LISTES),
    route('GET', '/v3/contacts/folders', { statut: 404, corps: { error: { code: 'NOT_FOUND', message: 'no route' } } }),
    route('GET', '/v3/contacts/marie%40exemple.fr', { email: 'marie@exemple.fr', emailBlacklisted: true, listIds: [50], attributes: {} }),
  ]);

  const sans = await appeler(ctx, 'vaemail_qui_est_abonne', {});
  assert.deepEqual(Object.keys(sans.structuredContent.dossiers), ['dossier #2', 'Sans dossier']);

  const marie = await appeler(ctx, 'vaemail_qui_est_abonne', { adresse: 'marie@exemple.fr' });
  assert.equal(marie.structuredContent.desinscrit, true);
  assert.match(marie.structuredContent.resume, /DÉSINSCRITE/);
});

test('importer_contacts crée la liste absente, n\'envoie jamais emailBlacklist, rend avant/après', async () => {
  let abonnes = 0;
  const { ctx, appels } = contexte([
    route('GET', '/v3/contacts/lists/90', () => ({ statut: 200, corps: { id: 90, name: 'Prospects salon', totalSubscribers: abonnes } })),
    route('GET', '/v3/contacts/lists', LISTES),
    route('POST', '/v3/contacts/lists', { statut: 201, corps: { id: 90 } }),
    route('POST', '/v3/contacts/import', () => { abonnes = 2; return { statut: 202, corps: { processId: 1 } }; }),
  ]);

  const r = await appeler(ctx, 'vaemail_importer_contacts', {
    liste: 'Prospects salon',
    contacts: [
      { email: 'A@B.fr', prenom: 'Anne', nom: 'Blin', attributs: { SOCIETE: 'Blin SA' } },
      { email: 'c@d.fr' },
      { email: 'pas-une-adresse' },
    ],
  });

  assert.equal(r.isError, false, JSON.stringify(r.content));
  assert.equal(r.structuredContent.liste.creee, true);
  assert.deepEqual(r.structuredContent.ignores, ['pas-une-adresse']);
  assert.equal(r.structuredContent.abonnes_apres, 2);

  const imp = appels.find((a) => a.url.includes('/contacts/import'));
  assert.equal(imp.corps.emailBlacklist, undefined);
  assert.deepEqual(imp.corps.listIds, [90]);
  assert.deepEqual(imp.corps.jsonBody[0], { email: 'a@b.fr', attributes: { SOCIETE: 'Blin SA', FIRSTNAME: 'Anne', LASTNAME: 'Blin' } });
});
