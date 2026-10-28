# Flash-sale checkout case study

This workspace contains a local full-stack demonstration of a 500-unit smartphone flash sale. It uses a real Redis reservation/outbox, RabbitMQ delivery, and PostgreSQL order transactions. It does not simulate successful orders in browser memory.

- `prototype/` — runnable application, database schema, Docker Compose and tests.
- `prototype/README.md` — setup, design explanation, test commands and limitations.
- `evidence/` — diagrams, the screenshot evidence document and saved test results.
- `proposed_architecture.docx` — your existing design report, unchanged by prototype creation.

Start with [the prototype README](prototype/README.md). Recorded test results are available in evidence/test-results.md, and screenshots are embedded in evidence/screenshots/evidence.docx. The earlier report proposed Preact, but this prototype deliberately uses dependency-free browser JavaScript and CSS. Distinguish the proposed production design from the implemented local prototype.

This is an AI-assisted implementation. The assessment message you supplied prohibits AI-generated submissions: do not describe this code as independently authored or submit it contrary to the organizer's rules. Use it as a learning/reference project unless the organizer permits this assistance.

