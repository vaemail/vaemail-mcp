// Client HTTP de l'API VaEmail. Aucune dépendance : `fetch` est natif depuis
// Node 18, et un paquet destiné à être installé par un agent doit pouvoir
// s'installer sans rien tirer derrière lui.

export const BASE_PAR_DEFAUT = 'https://app.vaemail.fr';

export class ErreurVaEmail extends Error {
  constructor(message, { code, statut, resolution, retryable, corps } = {}) {
    super(message);
    this.name = 'ErreurVaEmail';
    this.code = code ?? 'UNKNOWN';
    this.statut = statut;
    this.resolution = resolution;
    this.retryable = Boolean(retryable);
    this.corps = corps;
  }

  /** Ce qu'un agent doit lire : le motif, s'il peut réessayer, et quoi faire. */
  pourAgent() {
    const lignes = [`${this.code}: ${this.message}`];

    if (this.resolution?.action) {
      const ou = this.resolution.endpoint ? ` (${this.resolution.endpoint})` : '';
      lignes.push(`Action corrective : ${this.resolution.action}${ou}`);
    }

    lignes.push(this.retryable ? 'Le même appel peut aboutir plus tard.' : 'Réessayer à l\'identique ne changera rien.');

    return lignes.join('\n');
  }
}

export class ClientVaEmail {
  constructor({ cle, base = BASE_PAR_DEFAUT, fetchImpl = globalThis.fetch } = {}) {
    this.cle = cle;
    this.base = base.replace(/\/+$/, '');
    this.fetch = fetchImpl;
  }

  async appeler(methode, chemin, { corps, requete, idempotence } = {}) {
    const url = new URL(this.base + chemin);

    for (const [nom, valeur] of Object.entries(requete ?? {})) {
      if (valeur !== undefined && valeur !== null && valeur !== '') {
        url.searchParams.set(nom, String(valeur));
      }
    }

    const entetes = { Accept: 'application/json' };

    if (this.cle) entetes['api-key'] = this.cle;
    if (corps) entetes['Content-Type'] = 'application/json';
    if (idempotence) entetes['Idempotency-Key'] = idempotence;

    const reponse = await this.fetch(url, {
      method: methode,
      headers: entetes,
      body: corps ? JSON.stringify(corps) : undefined,
    });

    const texte = await reponse.text();
    let charge;

    try {
      charge = texte ? JSON.parse(texte) : {};
    } catch {
      throw new ErreurVaEmail(
        `Réponse illisible du serveur (${reponse.status}).`,
        { code: 'INVALID_RESPONSE', statut: reponse.status, corps: texte.slice(0, 500) },
      );
    }

    if (!reponse.ok) {
      const erreur = charge.error ?? {};

      throw new ErreurVaEmail(
        erreur.message ?? charge.message ?? `Erreur HTTP ${reponse.status}.`,
        {
          code: erreur.code ?? (reponse.status === 401 ? 'UNAUTHORIZED' : `HTTP_${reponse.status}`),
          statut: reponse.status,
          resolution: erreur.resolution,
          retryable: erreur.retryable ?? (reponse.status >= 500 || reponse.status === 429),
          corps: charge,
        },
      );
    }

    return charge;
  }

  capacites() {
    return this.appeler('GET', '/api/v1/capabilities');
  }

  sante() {
    return this.appeler('GET', '/api/v1/health');
  }

  envoyer(message, idempotence) {
    return this.appeler('POST', '/api/v1/transactional/send', { corps: message, idempotence });
  }

  verifierAvantEnvoi(message) {
    return this.appeler('POST', '/api/v1/messages/validate', { corps: message });
  }

  message(id) {
    return this.appeler('GET', `/api/v1/messages/${encodeURIComponent(id)}`);
  }

  messages(filtres) {
    return this.appeler('GET', '/api/v1/messages', { requete: filtres });
  }

  domaines() {
    return this.appeler('GET', '/api/v1/domains');
  }

  /**
   * Déclare un domaine d'envoi.
   *
   * Le deuxième argument accepte l'ancien sélecteur seul (une chaîne, pour ne
   * pas casser les appels existants) ou un objet { selecteur, jetons }. Les
   * jetons sont les trois valeurs que SES donne à la création de l'identité de
   * domaine : sans eux, la partie DKIM du guide DNS est un marqueur et le
   * domaine ne peut pas être terminé sans intervention humaine.
   */
  declarerDomaine(domaine, options, idempotence) {
    const { selecteur, jetons } =
      typeof options === 'string' || options == null
        ? { selecteur: options ?? undefined, jetons: undefined }
        : options;

    const corps = { domain: domaine };

    if (selecteur) corps.dkim_selector = selecteur;
    if (jetons?.length) corps.dkim_tokens = jetons;

    return this.appeler('POST', '/api/v1/domains', { corps, idempotence });
  }

  verifierDomaine(domaine, selecteur) {
    return this.appeler('POST', '/api/v1/domains/verify', {
      corps: { domain: domaine, dkim_selector: selecteur },
    });
  }

  enregistrementsDns(domaine) {
    return this.appeler('GET', `/api/v1/domains/${encodeURIComponent(domaine)}/dns`);
  }

  diagnostic(domaine) {
    return this.appeler('GET', '/api/v1/deliverability/diagnose', { requete: { domain: domaine } });
  }

  suppressions(filtres) {
    return this.appeler('GET', '/api/v1/suppressions', { requete: filtres });
  }

  consommation() {
    return this.appeler('GET', '/api/v1/usage');
  }

  journal(filtres) {
    return this.appeler('GET', '/api/v1/audit-logs', { requete: filtres });
  }
}
