// Définition des outils MCP.
//
// Les descriptions sont en anglais : ce sont elles que lisent les agents, et le
// marché visé ne l'est pas seulement en français. Les commentaires restent en
// français, comme le reste du dépôt.
//
// Règle tenue partout ici : une description dit ce que l'outil fait ET ce qu'il
// ne fait pas. Un agent qui croit qu'un envoi accepté est un envoi remis
// annonce à son utilisateur un résultat qu'il n'a pas.

export const OUTILS = [
  {
    name: 'vaemail_capabilities',
    title: 'What VaEmail can do',
    description:
      'Return what VaEmail supports: interfaces, capabilities, limits, scopes and region. '
      + 'No API key needed. Call this first when deciding whether VaEmail fits a need.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    lectureSeule: true,
    sansCle: true,
    executer: (client) => client.capacites(),
  },

  {
    name: 'vaemail_send_email',
    title: 'Send an email',
    description:
      'Queue a transactional email and return its id. The call returns as soon as the message is ACCEPTED, '
      + 'not when it is delivered: use vaemail_get_message to find out what happened to it. '
      + 'Pass idempotency_key when retrying so a network timeout cannot send the same message twice.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', format: 'email', description: 'Recipient address.' },
        subject: { type: 'string', description: 'Subject line.' },
        html: { type: 'string', description: 'HTML body. Required unless template_id is given.' },
        template_id: { type: 'integer', description: 'Transactional template to render instead of html.' },
        variables: { type: 'object', description: 'Values merged into the template.' },
        from_name: { type: 'string', description: 'Display name of the sender.' },
        reply_to: { type: 'string', format: 'email' },
        tag: { type: 'string', description: 'Free label, useful to find the message later.' },
        idempotency_key: {
          type: 'string',
          description: 'Caller-side unique id for this send. Replays the first response instead of sending again.',
        },
      },
      required: ['to'],
      additionalProperties: false,
    },
    executer: (client, args) => {
      const { idempotency_key: idempotence, ...message } = args;

      return client.envoyer(message, idempotence);
    },
  },

  {
    name: 'vaemail_validate_email',
    title: 'Check a send without sending',
    description:
      'Dry run: report whether the email would go out, and name what would block it. Sends nothing. '
      + 'Use it right after setup, before the first real message.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', format: 'email' },
        subject: { type: 'string' },
        html: { type: 'string' },
        template_id: { type: 'integer' },
      },
      required: ['to'],
      additionalProperties: false,
    },
    lectureSeule: true,
    executer: (client, args) => client.verifierAvantEnvoi(args),
  },

  {
    name: 'vaemail_get_message',
    title: 'Delivery status of one message',
    description:
      'Return the delivery status of a message and every event known about it '
      + '(delivered, opened, clicked, bounced, complained), plus the transport error when it failed.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', description: 'Message id returned by vaemail_send_email.' } },
      required: ['id'],
      additionalProperties: false,
    },
    lectureSeule: true,
    executer: (client, args) => client.message(args.id),
  },

  {
    name: 'vaemail_list_messages',
    title: 'List recent messages',
    description: 'List messages newest first, filtered by status, tag or recipient. Paginate with the returned next_cursor.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['queued', 'sent', 'delivered', 'failed', 'suppressed', 'held', 'cancelled'],
        },
        tag: { type: 'string' },
        to: { type: 'string', format: 'email' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        cursor: { type: 'integer' },
      },
      additionalProperties: false,
    },
    lectureSeule: true,
    executer: (client, args) => client.messages(args),
  },

  {
    name: 'vaemail_list_domains',
    title: 'List sending domains',
    description: 'List the sending domains of the account with the live state of their SPF, DKIM and DMARC records.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    lectureSeule: true,
    executer: (client) => client.domaines(),
  },

  {
    name: 'vaemail_create_domain',
    title: 'Declare a sending domain',
    description:
      'Declare a domain and return the DNS records to add at the registrar, each with what it is for. '
      + 'Declaring a domain does not authenticate it: the records must be published, then verified. '
      + 'Adding DNS records is a human step — report them, do not claim the domain is ready.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain to send from, e.g. exemple.fr.' },
        dkim_selector: { type: 'string', description: 'DKIM selector, if one is already chosen.' },
        idempotency_key: { type: 'string' },
      },
      required: ['domain'],
      additionalProperties: false,
    },
    executer: (client, args) => client.declarerDomaine(args.domain, args.dkim_selector, args.idempotency_key),
  },

  {
    name: 'vaemail_verify_domain',
    title: 'Verify domain authentication',
    description:
      'Read SPF, DKIM and DMARC for a domain in the public DNS and report each record. '
      + 'Without SPF and DMARC, large mailbox providers file the mail as spam.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string' },
        dkim_selector: { type: 'string' },
      },
      required: ['domain'],
      additionalProperties: false,
    },
    lectureSeule: true,
    executer: (client, args) => client.verifierDomaine(args.domain, args.dkim_selector),
  },

  {
    name: 'vaemail_dns_requirements',
    title: 'DNS records expected for a domain',
    description: 'Return the DNS records a declared domain needs, record by record, with the role of each.',
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string' } },
      required: ['domain'],
      additionalProperties: false,
    },
    lectureSeule: true,
    executer: (client, args) => client.enregistrementsDns(args.domain),
  },

  {
    name: 'vaemail_diagnose_deliverability',
    title: 'Why is my email not arriving?',
    description:
      'Diagnose deliverability for the account: authentication of every domain, reputation findings '
      + '(hard bounces, complaints, where the contacts came from) and recommended actions, each with the endpoint that performs it. '
      + 'Answers "why are my emails from example.com landing badly?" in one call.',
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string', description: 'Restrict the diagnosis to one declared domain.' } },
      additionalProperties: false,
    },
    lectureSeule: true,
    executer: (client, args) => client.diagnostic(args.domain),
  },

  {
    name: 'vaemail_list_bounces',
    title: 'Addresses removed from sending',
    description:
      'List addresses excluded from sending: hard bounces, complaints and unsubscribes, with the reason for each. '
      + 'Sending to one of them is refused, so read this before retrying a failed recipient.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: ['hard_bounce', 'soft_bounce_limit', 'complaint', 'unsubscribe', 'manual'],
        },
        since: { type: 'string', description: 'ISO 8601 date to read from.' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        cursor: { type: 'integer' },
      },
      additionalProperties: false,
    },
    lectureSeule: true,
    executer: (client, args) => client.suppressions(args),
  },

  {
    name: 'vaemail_get_usage',
    title: 'Usage, quota and key limits',
    description:
      'Return the monthly quota and what is left of it, today\'s sends, and for the key in use: its scopes, '
      + 'its daily cap and the remaining allowance. Read it before a batch to know whether to stop.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    lectureSeule: true,
    executer: (client) => client.consommation(),
  },

  {
    name: 'vaemail_get_audit_log',
    title: 'What this key has done',
    description:
      'Return the log of API actions: which key, which operation, which parameters, which result. '
      + 'Message bodies are never stored in it. Use it to report exactly what was done.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string' },
        since: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
        cursor: { type: 'integer' },
      },
      additionalProperties: false,
    },
    lectureSeule: true,
    executer: (client, args) => client.journal(args),
  },
];

export function outilParNom(nom) {
  return OUTILS.find((o) => o.name === nom);
}
