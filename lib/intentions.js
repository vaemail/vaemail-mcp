// Les quatre outils d'intention, en français.
//
// Le 11/09/2026, un utilisateur interne a trouvé le MCP « très compliqué » : la
// surface exposée était celle de l'API transactionnelle, et rien ne parlait de
// newsletter. Pour envoyer une lettre à une liste, l'agent devait deviner
// l'enchaînement (créer la campagne, résoudre la liste, tester, programmer) et
// poser à l'humain des questions dont l'API connaît la réponse.
//
// Ces quatre outils sont nommés comme l'utilisateur parle et enchaînent seuls.
// Ils restent en français parce qu'ils s'adressent d'abord aux clients de
// l'agence ; les outils fins (vaemail_*) restent disponibles pour le reste.
//
// Règle tenue partout : un outil dit ce qu'il fait tout seul ET ce qu'il ne
// fait jamais. Rien ne part sans un « quand » explicite ; aucun import ne
// réabonne un désinscrit.

import { ErreurVaEmail } from './client.js';

/** Compare deux libellés sans accents, sans casse, sans espaces superflus. */
function normaliser(texte) {
  return String(texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function pluriel(n, singulier, plurielForme = `${singulier}s`) {
  return `${Number(n).toLocaleString('fr-FR')} ${n > 1 ? plurielForme : singulier}`;
}

function dateFr(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);

  return d.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function lienAdmin(client, id) {
  return `${client.base}/admin/campaigns/${id}`;
}

/**
 * Trouve une liste par son identifiant ou son nom (approximatif). Une seule
 * correspondance est acceptée : en cas de doute, l'erreur nomme les candidates
 * pour que l'agent choisisse sans inventer.
 */
async function resoudreListe(client, reference) {
  const { lists = [] } = await client.listes();

  if (lists.length === 0) {
    throw new ErreurVaEmail('Ce compte n\'a aucune liste de contacts. Créez-en une ou importez des contacts d\'abord (importer_contacts).', { code: 'NO_LIST' });
  }

  if (typeof reference === 'number' || /^\d+$/.test(String(reference).trim())) {
    const id = Number(reference);
    const exacte = lists.find((l) => l.id === id);
    if (exacte) return exacte;
  }

  const voulu = normaliser(reference);
  const exactes = lists.filter((l) => normaliser(l.name) === voulu);
  if (exactes.length === 1) return exactes[0];

  const proches = lists.filter((l) => normaliser(l.name).includes(voulu) || voulu.includes(normaliser(l.name)));
  if (proches.length === 1) return proches[0];

  const candidates = (proches.length ? proches : lists)
    .map((l) => `#${l.id} « ${l.name} » (${pluriel(l.totalSubscribers ?? 0, 'abonné')})`)
    .join(' · ');

  throw new ErreurVaEmail(
    proches.length
      ? `Plusieurs listes correspondent à « ${reference} » : ${candidates}. Précisez le numéro.`
      : `Aucune liste ne s'appelle « ${reference} ». Listes du compte : ${candidates}.`,
    { code: proches.length ? 'AMBIGUOUS_LIST' : 'LIST_NOT_FOUND' },
  );
}

/** Une campagne par son numéro ou par un bout de son sujet. */
async function resoudreCampagne(client, reference) {
  if (typeof reference === 'number' || /^\d+$/.test(String(reference).trim())) {
    return client.campagne(Number(reference));
  }

  const { campaigns = [] } = await client.campagnes({});
  const voulu = normaliser(reference);
  const proches = campaigns.filter((c) => normaliser(c.subject).includes(voulu) || normaliser(c.name).includes(voulu));

  if (proches.length === 1) return proches[0];

  if (proches.length === 0) {
    const recentes = campaigns.slice(0, 8).map((c) => `#${c.id} « ${c.subject} » (${c.status})`).join(' · ');
    throw new ErreurVaEmail(`Aucune campagne ne ressemble à « ${reference} ». Les plus récentes : ${recentes}.`, { code: 'CAMPAIGN_NOT_FOUND' });
  }

  const liste = proches.slice(0, 8).map((c) => `#${c.id} « ${c.subject} » (${c.status}, créée le ${dateFr(c.createdAt)})`).join(' · ');
  throw new ErreurVaEmail(`Plusieurs campagnes correspondent : ${liste}. Précisez le numéro.`, { code: 'AMBIGUOUS_CAMPAIGN' });
}

function enHtml(contenu) {
  const texte = String(contenu ?? '').trim();
  if (/<[a-z][\s\S]*>/i.test(texte)) return texte;

  // Du texte brut : un paragraphe par ligne vide, les sauts simples deviennent des <br>.
  const echapper = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return texte
    .split(/\n{2,}/)
    .map((p) => `<p>${echapper(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function interpreterQuand(quand) {
  const brut = String(quand ?? '').trim();
  if (normaliser(brut) === 'maintenant' || normaliser(brut) === 'now') return { maintenant: true };

  // « 2026-09-17 10:00 » sans fuseau est lu comme une heure de Paris, pas comme
  // l'heure de la machine qui héberge le serveur MCP.
  const sansFuseau = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(brut);
  const d = new Date(sansFuseau ? enHeureDeParis(brut) : brut);

  if (Number.isNaN(d.getTime())) {
    throw new ErreurVaEmail(`Je ne comprends pas la date « ${quand} ». Donnez « maintenant » ou une date au format 2026-09-17 10:00.`, { code: 'INVALID_DATE' });
  }
  if (d.getTime() < Date.now()) {
    throw new ErreurVaEmail(`La date ${dateFr(d.toISOString())} est déjà passée. Donnez une date à venir, ou « maintenant ».`, { code: 'DATE_IN_PAST' });
  }

  return { maintenant: false, iso: d.toISOString() };
}

/** Convertit « AAAA-MM-JJ HH:mm » lu à Paris en ISO 8601 UTC, heure d'été ou d'hiver comprise. */
function enHeureDeParis(brut) {
  const [date, heure] = brut.replace('T', ' ').split(' ');
  const [a, m, j] = date.split('-').map(Number);
  const [h, mi, sec = 0] = heure.split(':').map(Number);

  // On prend l'instant comme s'il était UTC, on lit l'heure murale de Paris à
  // cet instant : l'écart entre les deux est le décalage de Paris à cette date.
  const commeUtc = Date.UTC(a, m - 1, j, h, mi, sec);
  const muraleParis = new Date(new Date(commeUtc).toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const muraleUtc = new Date(new Date(commeUtc).toLocaleString('en-US', { timeZone: 'UTC' }));
  const decalage = muraleParis.getTime() - muraleUtc.getTime();

  return new Date(commeUtc - decalage).toISOString();
}

function decrireEtalement(estimation) {
  if (!estimation) return null;
  const jours = estimation.warmupDays ?? 1;
  if (jours <= 1) return 'Tout part le jour dit.';

  const parJour = (estimation.perDay ?? []).map((n) => n.toLocaleString('fr-FR')).join(', ');

  return `Le domaine est en chauffe : l'envoi s'étale sur ${pluriel(jours, 'jour')} (${parJour} par jour) pour protéger sa réputation.`;
}

export const INTENTIONS = [
  {
    name: 'vaemail_envoyer_newsletter',
    title: 'Envoyer ou programmer une newsletter',
    description:
      'Envoie ou programme une newsletter à une liste de contacts, en un seul appel. '
      + 'Fait tout seul : retrouve la liste par son nom, crée la campagne, envoie un test si demandé, '
      + 'puis programme à la date donnée ou envoie tout de suite, et rend la date, l\'audience abonnée à ce jour, '
      + 'l\'étalement prévu par la chauffe du domaine et le lien vers la campagne dans l\'admin. '
      + 'Ne fait jamais : envoyer sans « quand » explicite (sans ce champ, la campagne reste en brouillon, rien ne part) ; '
      + 'inventer une liste (si le nom est ambigu, l\'outil rend les candidates et vous choisissez avec l\'humain). '
      + 'Utilisez-le dès que quelqu\'un dit « envoie / programme la newsletter à … ». '
      + 'Exemple : { "sujet": "Votre budget formation 2026 se ferme le 31 décembre", "contenu": "<p>…</p>", '
      + '"liste": "L\'actu BienveNum", "quand": "2026-09-17 10:00", "test_vers": "hugo@agencesw.com" }.',
    inputSchema: {
      type: 'object',
      properties: {
        sujet: { type: 'string', description: 'Objet du mail, tel que le lecteur le verra.' },
        contenu: { type: 'string', description: 'Le mail : HTML complet, ou texte brut (mis en paragraphes automatiquement).' },
        liste: { type: 'string', description: 'À qui : le nom de la liste (approximatif accepté) ou son numéro.' },
        quand: { type: 'string', description: '« maintenant », ou une date à venir « 2026-09-17 10:00 » (heure de Paris). Absent = brouillon, rien ne part.' },
        test_vers: { type: 'string', format: 'email', description: 'Adresse qui reçoit un exemplaire de test AVANT l\'envoi ou la programmation.' },
        liste_exclue: { type: 'string', description: 'Liste dont les contacts ne doivent pas recevoir ce mail (nom ou numéro).' },
        nom_interne: { type: 'string', description: 'Nom de la campagne dans l\'admin. Par défaut, le sujet.' },
        apercu: { type: 'string', description: 'Texte d\'aperçu affiché à côté du sujet dans la boîte de réception.' },
      },
      required: ['sujet', 'contenu', 'liste'],
      additionalProperties: false,
    },
    executer: async (client, args) => {
      const liste = await resoudreListe(client, args.liste);
      const exclue = args.liste_exclue ? await resoudreListe(client, args.liste_exclue) : null;
      const quand = args.quand ? interpreterQuand(args.quand) : null;

      const corps = {
        name: args.nom_interne || args.sujet,
        subject: args.sujet,
        htmlContent: enHtml(args.contenu),
        recipients: { listIds: [liste.id], ...(exclue ? { exclusionListIds: [exclue.id] } : {}) },
      };
      if (args.apercu) corps.previewText = args.apercu;

      const { id } = await client.creerCampagne(corps);
      const etapes = [`Campagne #${id} créée pour la liste « ${liste.name} » (${pluriel(liste.totalSubscribers ?? 0, 'abonné')} à ce jour).`];

      if (args.test_vers) {
        await client.testerCampagne(id, [args.test_vers]);
        etapes.push(`Exemplaire de test parti vers ${args.test_vers}.`);
      }

      const resultat = {
        campagne: id,
        liste: { id: liste.id, nom: liste.name, abonnes: liste.totalSubscribers ?? null },
        lien_admin: lienAdmin(client, id),
      };

      if (!quand) {
        resultat.statut = 'brouillon';
        etapes.push('Aucun « quand » donné : la campagne reste en brouillon, rien n\'est parti. Rappelez l\'outil avec « quand » pour l\'envoyer ou la programmer.');
        resultat.resume = etapes.join(' ');

        return resultat;
      }

      if (quand.maintenant) {
        const envoi = await client.envoyerCampagneMaintenant(id, liste.totalSubscribers);
        if (envoi.code) {
          // Le service a refusé (audience différente de l'attendue, déjà programmée…) : on rend son motif tel quel.
          resultat.statut = 'non envoyée';
          resultat.motif = envoi.message;
          resultat.resume = `${etapes.join(' ')} Envoi refusé : ${envoi.message}`;

          return resultat;
        }
        resultat.statut = 'en cours d\'envoi';
        resultat.destinataires = envoi.recipients ?? liste.totalSubscribers;
        resultat.etalement = decrireEtalement(envoi.estimated);
        etapes.push(`Envoi lancé à ${pluriel(resultat.destinataires, 'destinataire')}.`);
        if (resultat.etalement) etapes.push(resultat.etalement);
        resultat.resume = etapes.join(' ');

        return resultat;
      }

      const prog = await client.programmerCampagne(id, quand.iso);
      resultat.statut = 'programmée';
      resultat.date = prog.scheduledAt ?? quand.iso;
      resultat.date_lisible = dateFr(resultat.date);
      resultat.destinataires_estimes = prog.recipients ?? liste.totalSubscribers;
      resultat.etalement = decrireEtalement(prog.estimated);
      etapes.push(`Programmée pour le ${resultat.date_lisible}, ${pluriel(resultat.destinataires_estimes, 'abonné')} à ce jour (le compte définitif est fait au moment de l'envoi).`);
      if (resultat.etalement) etapes.push(resultat.etalement);
      etapes.push(`À voir ou modifier ici : ${resultat.lien_admin}`);
      resultat.resume = etapes.join(' ');

      return resultat;
    },
  },

  {
    name: 'vaemail_ou_en_est_ma_campagne',
    title: 'Où en est ma campagne ?',
    description:
      'Dit où en est une newsletter, en phrases : brouillon, programmée (et pour quand), en cours d\'envoi (envoyés, restent), '
      + 'ou terminée (envoyés, ouverts, cliqués, rebonds, désinscriptions). '
      + 'Retrouve la campagne par son numéro ou par un bout de son sujet ; si plusieurs correspondent, rend la liste et vous choisissez. '
      + 'Lecture seule, ne change rien. Utilisez-le pour « ça en est où ? », « elle est partie ? », « combien ont ouvert ? ». '
      + 'Exemple : { "campagne": "budget formation" } ou { "campagne": 60 }.',
    inputSchema: {
      type: 'object',
      properties: { campagne: { type: 'string', description: 'Numéro de la campagne, ou un bout de son sujet.' } },
      required: ['campagne'],
      additionalProperties: false,
    },
    lectureSeule: true,
    executer: async (client, args) => {
      const c = await resoudreCampagne(client, args.campagne);
      const stats = (await client.statistiquesCampagne(c.id)).globalStats ?? {};
      const phrases = [`Campagne #${c.id} « ${c.subject} »`];

      switch (c.status) {
        case 'draft':
          phrases.push('est un brouillon : rien n\'est parti, elle n\'est pas programmée.');
          break;
        case 'queued':
          phrases.push(`est programmée pour le ${dateFr(c.scheduledAt)}. Rien n'est encore parti ; l'audience sera comptée au moment de l'envoi.`);
          break;
        case 'sending': {
          const restent = stats.queued ?? 0;
          phrases.push(`est en cours d'envoi : ${pluriel(stats.sent ?? 0, 'mail envoyé', 'mails envoyés')}, ${pluriel(restent, 'reste', 'restent')} à partir.`);
          if (restent > 0) phrases.push('Si le domaine est en chauffe, le reste part sur les prochains jours, par paliers.');
          break;
        }
        case 'sent':
          phrases.push(`est terminée : ${pluriel(stats.sent ?? 0, 'mail envoyé', 'mails envoyés')} sur ${pluriel(stats.recipients ?? 0, 'destinataire')}.`);
          break;
        default:
          phrases.push(`a le statut « ${c.status} ».`);
      }

      if ((stats.sent ?? 0) > 0) {
        phrases.push(`Ouvert par ${pluriel(stats.uniqueOpens ?? 0, 'personne')}, cliqué par ${pluriel(stats.uniqueClicks ?? 0, 'personne')}.`);
        const soucis = [];
        if (stats.hardBounces) soucis.push(pluriel(stats.hardBounces, 'rebond dur', 'rebonds durs'));
        if (stats.complaints) soucis.push(pluriel(stats.complaints, 'plainte'));
        if (stats.unsubscriptions) soucis.push(pluriel(stats.unsubscriptions, 'désinscription'));
        if (stats.failed) soucis.push(pluriel(stats.failed, 'échec'));
        if (soucis.length) phrases.push(`À noter : ${soucis.join(', ')}.`);
      }

      return {
        campagne: c.id,
        sujet: c.subject,
        statut: c.status,
        programmee_pour: c.scheduledAt ?? null,
        chiffres: stats,
        lien_admin: lienAdmin(client, c.id),
        resume: phrases.join(' '),
      };
    },
  },

  {
    name: 'vaemail_qui_est_abonne',
    title: 'Qui est abonné à quoi ?',
    description:
      'Sans paramètre : toutes les listes du compte, rangées par dossier, avec le nombre d\'abonnés de chacune. '
      + 'Avec une adresse : ses listes, et si elle est désinscrite (auquel cas aucun envoi ne l\'atteindra, et il ne faut pas la réabonner). '
      + 'Lecture seule. Utilisez-le avant d\'envoyer (pour choisir la liste) et pour « est-ce que untel est inscrit ? ». '
      + 'Exemple : {} ou { "adresse": "marie@exemple.fr" }.',
    inputSchema: {
      type: 'object',
      properties: { adresse: { type: 'string', format: 'email', description: 'Une adresse précise, pour connaître ses listes et son statut.' } },
      additionalProperties: false,
    },
    lectureSeule: true,
    executer: async (client, args) => {
      const { lists = [] } = await client.listes();

      if (args.adresse) {
        let contact;
        try {
          contact = await client.contact(args.adresse);
        } catch (e) {
          if (e instanceof ErreurVaEmail && e.statut === 404) {
            return { adresse: args.adresse, connu: false, resume: `${args.adresse} n'est dans aucune liste de ce compte.` };
          }
          throw e;
        }
        const siennes = lists.filter((l) => (contact.listIds ?? []).includes(l.id));
        const noms = siennes.map((l) => `« ${l.name} »`).join(', ') || 'aucune liste';
        const statut = contact.emailBlacklisted ? 'DÉSINSCRITE : aucun envoi ne l\'atteindra, ne pas la réabonner' : 'abonnée';

        return {
          adresse: contact.email,
          connu: true,
          desinscrit: Boolean(contact.emailBlacklisted),
          listes: siennes.map((l) => ({ id: l.id, nom: l.name })),
          attributs: contact.attributes ?? {},
          resume: `${contact.email} est ${statut}, dans ${noms}.`,
        };
      }

      const dossiers = await client.dossiers();
      const parDossier = new Map();
      const nomDossier = (id) => dossiers?.folders?.find((f) => f.id === id)?.name ?? null;

      for (const l of lists) {
        const cle = l.folderId ? (nomDossier(l.folderId) ?? `dossier #${l.folderId}`) : 'Sans dossier';
        if (!parDossier.has(cle)) parDossier.set(cle, []);
        parDossier.get(cle).push({ id: l.id, nom: l.name, abonnes: l.totalSubscribers ?? 0 });
      }

      const total = lists.reduce((n, l) => n + (l.totalSubscribers ?? 0), 0);
      const lignes = [];
      for (const [dossier, listes] of parDossier) {
        lignes.push(`${dossier} : ${listes.map((l) => `« ${l.nom} » (#${l.id}, ${pluriel(l.abonnes, 'abonné')})`).join(', ')}`);
      }

      return {
        dossiers: Object.fromEntries(parDossier),
        nombre_de_listes: lists.length,
        resume: `${pluriel(lists.length, 'liste')}, ${total.toLocaleString('fr-FR')} abonnements au total (une personne peut être dans plusieurs listes). ${lignes.join(' · ')}`,
      };
    },
  },

  {
    name: 'vaemail_importer_contacts',
    title: 'Importer des contacts dans une liste',
    description:
      'Ajoute des contacts (email, prénom, nom, attributs libres) à une liste, créée si elle n\'existe pas. '
      + 'Met à jour les contacts déjà connus. Ne fait jamais : réabonner quelqu\'un qui s\'est désinscrit '
      + '(il est ajouté à la liste mais reste désinscrit, aucun envoi ne l\'atteindra) ; supprimer quoi que ce soit. '
      + 'Rend un compte-rendu : lignes reçues, lignes ignorées (adresse invalide), abonnés de la liste avant et après. '
      + 'Utilisez-le pour « ajoute ces contacts à … », « importe ce fichier dans … ». '
      + 'Exemple : { "liste": "Prospects salon", "contacts": [{ "email": "a@b.fr", "prenom": "Anne", "nom": "Blin", "attributs": { "SOCIETE": "Blin SA" } }] }.',
    inputSchema: {
      type: 'object',
      properties: {
        liste: { type: 'string', description: 'Nom (ou numéro) de la liste cible. Créée si elle n\'existe pas.' },
        contacts: {
          type: 'array',
          minItems: 1,
          maxItems: 5000,
          items: {
            type: 'object',
            properties: {
              email: { type: 'string', format: 'email' },
              prenom: { type: 'string' },
              nom: { type: 'string' },
              attributs: { type: 'object', description: 'Autres champs, en majuscules de préférence (SOCIETE, VILLE…).' },
            },
            required: ['email'],
            additionalProperties: false,
          },
        },
      },
      required: ['liste', 'contacts'],
      additionalProperties: false,
    },
    executer: async (client, args) => {
      let liste;
      let creee = false;
      try {
        liste = await resoudreListe(client, args.liste);
      } catch (e) {
        if (!(e instanceof ErreurVaEmail) || !['LIST_NOT_FOUND', 'NO_LIST'].includes(e.code)) throw e;
        liste = await client.creerListe(String(args.liste));
        liste = { id: liste.id, name: String(args.liste), totalSubscribers: 0 };
        creee = true;
      }

      const valides = [];
      const ignores = [];
      for (const c of args.contacts) {
        const email = String(c.email ?? '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          ignores.push(c.email);
          continue;
        }
        const attributes = { ...(c.attributs ?? {}) };
        if (c.prenom) attributes.FIRSTNAME = c.prenom;
        if (c.nom) attributes.LASTNAME = c.nom;
        valides.push({ email, attributes });
      }

      const avant = creee ? 0 : ((await client.liste(liste.id)).totalSubscribers ?? liste.totalSubscribers ?? 0);
      if (valides.length) await client.importerContacts(valides, [liste.id]);
      const apres = (await client.liste(liste.id)).totalSubscribers ?? avant;

      const phrases = [
        `${pluriel(valides.length, 'contact envoyé', 'contacts envoyés')} vers la liste « ${liste.name }» (#${liste.id}${creee ? ', créée' : ''}).`,
        `Abonnés de la liste : ${avant.toLocaleString('fr-FR')} avant, ${apres.toLocaleString('fr-FR')} après.`,
      ];
      if (ignores.length) phrases.push(`${pluriel(ignores.length, 'ligne ignorée', 'lignes ignorées')} (adresse invalide) : ${ignores.join(', ')}.`);
      if (apres - avant < valides.length) phrases.push('L\'écart avec le nombre envoyé vient des adresses déjà présentes ou désinscrites : un désinscrit n\'est jamais réabonné.');

      return {
        liste: { id: liste.id, nom: liste.name, creee },
        recus: args.contacts.length,
        envoyes: valides.length,
        ignores,
        abonnes_avant: avant,
        abonnes_apres: apres,
        resume: phrases.join(' '),
      };
    },
  },
];
