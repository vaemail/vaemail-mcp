// Point d'entrée BIBLIOTHÈQUE du paquet `vaemail`.
//
// Le client HTTP existait déjà, mais il n'était accessible que par le serveur
// MCP et la CLI : un développeur qui voulait appeler VaEmail depuis son code
// devait écrire ses requêtes à la main. Ce fichier ne réimplémente rien, il
// expose l'existant sous des noms anglais, comme le reste de ce qui est public.
//
// Aucune dépendance, `fetch` est natif depuis Node 18.

import { ClientVaEmail, ErreurVaEmail, BASE_PAR_DEFAUT } from './client.js';

export const DEFAULT_BASE_URL = BASE_PAR_DEFAUT;

/** Erreur d'API. `forAgent()` rend le motif, l'action corrective et s'il faut réessayer. */
export class VaEmailError extends ErreurVaEmail {
  forAgent() {
    return this.pourAgent();
  }
}

export class VaEmail {
  /** @param {{apiKey?: string, baseUrl?: string, fetch?: typeof globalThis.fetch}} options */
  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, fetch: fetchImpl } = {}) {
    this.client = new ClientVaEmail({ cle: apiKey, base: baseUrl, fetchImpl });
  }

  capabilities() {
    return this.client.capacites();
  }

  health() {
    return this.client.sante();
  }

  /** Envoie un message. `idempotencyKey` rend l'appel rejouable sans doublon pendant 24 h. */
  send(message, idempotencyKey) {
    return this.client.envoyer(message, idempotencyKey);
  }

  /** Essai à blanc : mêmes contrôles que l'envoi, rien ne part. */
  validate(message) {
    return this.client.verifierAvantEnvoi(message);
  }

  getMessage(id) {
    return this.client.message(id);
  }

  listMessages(filters) {
    return this.client.messages(filters);
  }

  listDomains() {
    return this.client.domaines();
  }

  /** @param {{selector?: string, dkimTokens?: string[]}} [options] */
  addDomain(domain, options = {}, idempotencyKey) {
    return this.client.declarerDomaine(
      domain,
      { selecteur: options.selector, jetons: options.dkimTokens },
      idempotencyKey,
    );
  }

  verifyDomain(domain, selector) {
    return this.client.verifierDomaine(domain, selector);
  }

  dnsRecords(domain) {
    return this.client.enregistrementsDns(domain);
  }

  diagnoseDeliverability(domain) {
    return this.client.diagnostic(domain);
  }

  listSuppressions(filters) {
    return this.client.suppressions(filters);
  }

  usage() {
    return this.client.consommation();
  }

  auditLogs(filters) {
    return this.client.journal(filters);
  }
}

export default VaEmail;
export { ClientVaEmail, ErreurVaEmail };
