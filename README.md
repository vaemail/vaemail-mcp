# VaEmail — email infrastructure for AI agents

[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/vaemail/vaemail-mcp)

MCP server and CLI for [VaEmail](https://vaemail.fr). Give an agent the ability to
send email, authenticate a sending domain, track delivery and diagnose
deliverability — without a human reading a dashboard in between.

European infrastructure: servers in Germany, sending through Amazon SES Europe.

## Install

```bash
# Claude Code
claude mcp add vaemail --env VAEMAIL_API_KEY=swm_your_key -- npx -y vaemail mcp

# Any MCP client
npx -y vaemail mcp
```

Or as a config block:

```json
{
  "mcpServers": {
    "vaemail": {
      "command": "npx",
      "args": ["-y", "vaemail", "mcp"],
      "env": { "VAEMAIL_API_KEY": "swm_your_key" }
    }
  }
}
```

Check everything is wired up:

```bash
npx vaemail init
```

## Tools

| Tool | What it does |
| --- | --- |
| `vaemail_envoyer_newsletter` | Newsletter to a contact list, in French: resolves the list by name, creates, tests, schedules or sends. No "quand" = draft. |
| `vaemail_ou_en_est_ma_campagne` | Where a campaign stands, in plain sentences: scheduled, sending, sent, opens, clicks. |
| `vaemail_qui_est_abonne` | Lists by folder with subscriber counts, or the lists and status of one address. |
| `vaemail_importer_contacts` | Adds contacts to a list (created if missing). Never re-subscribes an unsubscribed address. |
| `vaemail_capabilities` | What the service supports. No API key needed. |
| `vaemail_send_email` | Queue a transactional email, return its id. |
| `vaemail_validate_email` | Dry run: would this send go out, and what would block it. |
| `vaemail_get_message` | Delivery status and every event for one message. |
| `vaemail_list_messages` | Recent messages, filtered by status, tag or recipient. |
| `vaemail_list_domains` | Sending domains with live SPF, DKIM and DMARC state. |
| `vaemail_create_domain` | Declare a domain, return the DNS records to publish. |
| `vaemail_verify_domain` | Re-read the DNS and report what is authenticated. |
| `vaemail_dns_requirements` | The records a declared domain still needs. |
| `vaemail_diagnose_deliverability` | Why mail is landing badly, with the actions that fix it. |
| `vaemail_list_bounces` | Addresses excluded from sending, and why. |
| `vaemail_get_usage` | Quota, daily cap on the key, what is left. |
| `vaemail_get_audit_log` | What this key has done, to report it accurately. |

## What this is built to prevent

An agent fails differently from a person. It retries, it does not read a
dashboard, and it reports success from a 200. The API is shaped around that:

- **A send is accepted, not delivered.** `vaemail_send_email` returns 202 and an
  id. Only `vaemail_get_message` says what became of it. The tool descriptions
  say so, so an agent does not announce a delivery it cannot know about.
- **Retries do not duplicate.** Pass `idempotency_key` and a repeat call replays
  the first response for 24 hours instead of sending twice.
- **Errors say what to do.** Every failure carries a stable `code`, whether it is
  `retryable`, and the corrective action with the endpoint that performs it.
- **Keys are bounded.** Scopes, a daily send cap, a cap on recipients per email
  and an allow-list of sender domains. An agent cannot spend more than the key
  allows.
- **Every call is logged.** Which key, which operation, which parameters, which
  result — message bodies excluded. Autonomous, but accountable.
- **Human steps are named as such.** Publishing DNS records is one. A record
  whose value still contains a placeholder is flagged `publishable: false`,
  because publishing it would break the domain's authentication.

## CLI

```bash
vaemail init                          # check config, print the MCP snippet
vaemail capabilities                  # what the service can do (no key needed)
vaemail send --to a@b.fr --subject Hi --html '<p>Hello</p>'
vaemail status 42                     # delivery status of a message
vaemail domains:add exemple.fr        # declare a domain, print DNS records
vaemail doctor                        # why is my email not arriving?
vaemail usage                         # quota and remaining allowance
vaemail mcp                           # run the MCP server on stdio
```

Add `--json` to any command for machine-readable output.

## Use it as a library

The same client the MCP server and the CLI run on is exported, so an application
can call VaEmail directly. No dependencies.

```js
import { VaEmail } from 'vaemail';

const client = new VaEmail({ apiKey: process.env.VAEMAIL_API_KEY });

await client.send(
  {
    to: 'customer@example.com',
    subject: 'Your order is on its way',
    html: '<p>Tracking number: 1Z999</p>',
  },
  'order-4711', // idempotency key: safe to replay for 24 hours
);
```

Errors carry what to do next, not just a status code:

```js
try {
  await client.send({ to: 'customer@example.com' });
} catch (error) {
  error.code;        // DOMAIN_NOT_VERIFIED
  error.retryable;   // false
  error.pourAgent(); // reason, corrective action, whether to retry
}
```

Also: `capabilities()`, `health()`, `validate()`, `getMessage()`,
`listMessages()`, `listDomains()`, `addDomain()`, `verifyDomain()`,
`dnsRecords()`, `diagnoseDeliverability()`, `listSuppressions()`, `usage()`,
`auditLogs()`.

A Python SDK with the same surface is available: `pip install vaemail`
(<https://github.com/vaemail/vaemail-python>).

## Environment

| Variable | Meaning |
| --- | --- |
| `VAEMAIL_API_KEY` | Account API key. Created from the dashboard, under « Clés API ». |
| `VAEMAIL_BASE_URL` | API base URL. Defaults to `https://app.vaemail.fr`. |

## Also available

- OpenAPI specification: <https://app.vaemail.fr/openapi.json>
- Capabilities endpoint: <https://app.vaemail.fr/api/v1/capabilities>
- Agent documentation: <https://vaemail.fr/agents>

## Skill and examples

- Agent skill (rules an agent should follow before its first call): `npx skills add vaemail/skills`, source https://github.com/vaemail/skills
- Examples for curl, Node, Python, Claude Code, Codex, OpenAI Agents, LangChain, CrewAI and n8n: https://github.com/vaemail/examples
- Registry entry: `io.github.vaemail/vaemail` (see `server.json`)

## Dependencies

None. Node 18+ for the built-in `fetch`, and nothing else — a package an agent
installs on its own should not pull a dependency tree behind it.

## License

MIT
