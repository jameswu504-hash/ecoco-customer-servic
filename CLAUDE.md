# CLAUDE.md

This file is for Claude, Codex, and other AI coding agents working on the ECOCO AI customer service project.

## Project Purpose

This repository is the ECOCO AI customer service backend and admin dashboard.

The system:

- Answers ECOCO customer questions with Claude.
- Uses PostgreSQL as the live knowledge database.
- Uses Git-tracked JSON files as the formal knowledge source.
- Records unresolved questions as knowledge gaps.
- Provides an internal dashboard for conversation review, knowledge editing, knowledge export, and unanswered-question cleanup.

## Important Rule Before Making Decisions

Before making changes that affect product behavior, data, deployment, Git history, or file deletion, explain the decision to the user first.

Do not silently:

- Delete files.
- Push to GitHub or GitLab.
- Change `.env`, API keys, tokens, `DATABASE_URL`, or Render environment variables.
- Change knowledge sync behavior.
- Archive or remove knowledge records.
- Change AI answer policies.
- Change production deployment assumptions.

Reading files, checking status, running tests, and producing reports are safe to do without asking.

## Key Files

| File or Folder | Purpose |
| --- | --- |
| `server.js` | Express backend, Claude API calls, PostgreSQL schema, RAG search, admin APIs |
| `public/dashboard.html` | Internal customer service dashboard |
| `data/ecoco-ai-customer-service-database.json` | Main structured knowledge source |
| `data/ecoco-knowledge-import.json` | Generated import file for PostgreSQL `knowledge_sections` |
| `data/ecoco-response-policies.json` | Response safety policies for high-risk cases |
| `data/knowledge-quality-audit.json` | Generated duplicate/conflict audit report |
| `knowledge.js` | Legacy fallback seed, still used if `knowledge_sections` is empty |
| `scripts/build-ecoco-knowledge-data.js` | Builds import JSON from the main database |
| `scripts/audit-knowledge-quality.js` | Audits active AI knowledge for duplicates and conflicts |
| `scripts/apply-knowledge-audit.js` | Archives duplicate records recommended by the audit |
| `scripts/import-knowledge-json.js` | Imports JSON sections into PostgreSQL |
| `docs/` | Internal documentation, PRD, flow, maintenance, deployment, RAG notes |

## Data Model

There are two important layers:

1. Git JSON files
   - Formal version-controlled source.
   - Main file: `data/ecoco-ai-customer-service-database.json`.
   - Generated import file: `data/ecoco-knowledge-import.json`.

2. PostgreSQL
   - Live runtime database used by the deployed service.
   - Important tables:
     - `knowledge_sections`
     - `knowledge_chunks`
     - `conversations`
     - `ratings`
     - `unanswered_questions`

PostgreSQL is not a file in Git. It is the online database connected through `DATABASE_URL`.

## Knowledge Update Flow

When updating formal knowledge, use this flow:

```bash
npm run audit:knowledge
npm run apply:knowledge-audit
npm run build:knowledge
```

Then inspect the generated files before committing:

- `data/ecoco-ai-customer-service-database.json`
- `data/ecoco-knowledge-import.json`
- `data/knowledge-quality-audit.json`
- `docs/KNOWLEDGE_QUALITY_AUDIT.md`

`apply:knowledge-audit` must not delete records. It marks duplicate records as:

```json
"status": "archived"
```

The build process only imports active AI-usable records.

## Knowledge Sync Behavior

The server can sync `data/ecoco-knowledge-import.json` into PostgreSQL on startup.

The default behavior should preserve dashboard edits:

- `insert_only`: add missing categories, do not overwrite existing same-name categories.

Be careful with:

- `upsert`: may overwrite dashboard edits.
- `replace`: clears and replaces PostgreSQL knowledge.
- `disable`: no Git JSON sync on startup.

Do not change `KNOWLEDGE_AUTO_SYNC` without explaining the tradeoff first.

## Backend Knowledge Export

The admin API:

```text
GET /api/knowledge/export
```

exports PostgreSQL `knowledge_sections` into JSON.

This is for bringing dashboard edits back toward Git review. It does not automatically update Git files.

## AI Answer Safety Rules

The AI must use Traditional Chinese and ECOCO-friendly tone.

Allowed:

- Answer normal FAQ directly when the knowledge base is clear.
- Explain point expiration, machine lights, accepted recycling items, App steps, and station lookup from official knowledge.
- Ask for required information when a backend check is needed.

Not allowed:

- Promise point compensation.
- Promise refunds.
- Promise coupon reissue.
- Say an engineer or staff member has already handled something unless the knowledge explicitly says so.
- Reveal internal operations, private user details, old tickets, or credentials.
- Invent station names, partner names, App versions, or policy details.

High-risk guardrails should trigger mainly from:

- Retrieved chunks marked `風險：High`.
- Explicit high-risk user intent such as compensation, refund, account suspension, blacklist, personal data, or temporary password.

Do not make broad words like `點數`, `帳號`, `登入`, `驗證碼`, `機台`, or `異常` trigger strict guardrails by themselves, because those appear in many normal ECOCO FAQ questions.

## Conflict Handling

`conflicts_pending_review` is for human review only.

Do not import unresolved conflicts into AI-facing knowledge.

Known conflict examples include:

- Point expiration.
- App version.
- Customer service hours.
- Accepted machine items.
- Internal information that should not be customer-facing.

If a conflict must be resolved, ask for confirmation from the user or official source before changing the formal answer.

## Git And Deployment

This project currently uses GitHub as the main deployment source.

- GitHub `origin` is connected to Render deployment unless changed by the user.
- GitLab may be used as a company backup or handoff repository.
- Before pushing, confirm whether the change should go to GitHub, GitLab, or both.
- Do not force push.

## Security

Never commit:

- `.env`
- API keys
- Claude / Anthropic keys
- database URLs
- Zendesk tokens
- Gmail credentials
- private SSH keys
- production secrets

Keep `.gitignore`; it protects secrets and generated local files.

## Local Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Production start:

```bash
npm start
```

Knowledge commands:

```bash
npm run audit:knowledge
npm run apply:knowledge-audit
npm run build:knowledge
npm run import:knowledge
```

## Documentation To Read First

Before large changes, read:

- `README.md`
- `docs/PROJECT_OVERVIEW.md`
- `docs/MAINTENANCE_GUIDE.md`
- `docs/knowledge-import.md`
- `docs/RAG_WORKFLOW.md`
- `docs/PRD_ECOCO_AI_CUSTOMER_SERVICE.md`
- `docs/CUSTOMER_SERVICE_FLOW.md`

## Current Maintenance Principle

This project should be easy for ECOCO internal staff to understand.

Prefer:

- Clear documentation.
- Conservative data changes.
- Traceable Git commits.
- Keeping original knowledge records while archiving duplicates.
- Explaining decisions before acting.

Avoid:

- Silent cleanup.
- Hidden behavior changes.
- Overly broad safety filters.
- Mixing old CommandCenter credentials or drafts into the new production AI customer service system.
