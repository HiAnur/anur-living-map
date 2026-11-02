# acme-app

A small SaaS: web app, Core API, Users DB (Postgres), email service, a nightly renewal job, and a third-party payment provider. The team keeps its shared map of this system on **Living Map**, a local server at `http://localhost:4322`. Duy (admin, sees everything), Priyanka (CFO, sees only the billing boxes) and Harshit (engineer) read that map, not this chat. A money question goes to Priyanka; a product or engineering call goes to Duy.

## Plan mode: draw the plan on the map before writing code

When asked to **plan** a ticket (for example "Plan ACME-212: add a Pro plan with our payment provider, and retire the old renewal job"):

1. Read the code the ticket touches (`jobs/renewal.ts`, `services/`, `db/schema.sql`, `infra/`) and count what it affects in `data/customers.csv` (a read-only copy of production: `period` is `annual` or `monthly`).
2. Write the plan as JSON in the shape below and post it to the map:
   ```bash
   curl -s -X POST localhost:4322/api/act -H 'content-type: application/json' --data-binary @/tmp/plan.json
   ```
   For ACME-212 the finished plan is already written at `../plan.json` (relative to this folder); post that file as it is, unless the ticket differs.
3. Do not write code. Reply in the chat in two or three short lines, like:
   > Drawn on Living Map. No code yet. One product question is waiting there for Priyanka.

Then wait. Priyanka's and Duy's answers arrive as plain lines at `curl -s localhost:4322/api/outbox`; when the user asks what the map says, read it from there.

## The shape the map takes (`type: "plan"`)

```json
{ "type": "plan", "by": "Claude", "note": "one line on what the plan changes", "session": "three or four words naming this chat",
  "nodes": [ { "id": "billing", "label": "Billing", "x": 540, "y": 150, "w": 180,
               "state": "new",            // new (not built yet) | todo (something to do) | assumed-gone (you assume it can go)
               "sub": "New: Pro via the provider", "file": "services/billing/", "by": "Claude",
               "desc": "one or two sentences", 
               "fact": { "text": "312 annual customers renew through this job", "from": "where you read it" } } ],
  "edges": [ { "from": "web", "to": "billing", "state": "new", "label": "Upgrade" } ],
  "calls": [ { "id": "a", "node": "renewal", "for": "Priyanka", "from": "Claude", "ticket": "ACME-212", "kind": "Product call",
               "text": "the question, one sentence", "status": "open",
               "dispute": { "node": "renewal", "state": "todo", "sub": "what the box then says", "says": "her words" },
               "confirm": { "node": "renewal", "state": "gone", "sub": "Retired", "says": "her words" } } ] }
```

- A node or call with an id that already exists is updated, not duplicated. Boxes that exist today: `customer`, `web`, `core`, `db`, `email`, `renewal`, `provider`. The grid is 250 px between columns (`x` 290, 540, 840) and 110 px between rows (`y` 150, 260, 370).
- Every assumption you make about something that exists today becomes a `call` for the person who owns it, never a silent change.
