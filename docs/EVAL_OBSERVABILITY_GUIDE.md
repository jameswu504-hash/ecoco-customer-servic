# ECOCO AI Customer Service Eval And Observability Guide

This guide explains how to check answer quality, trace production responses, and keep the Git knowledge JSON aligned with the PostgreSQL runtime database.

## Purpose

The normal test suite checks code behavior. It does not prove that AI replies are correct. The eval workflow adds a small golden set of customer questions so maintainers can check whether prompt, RAG, model, or knowledge-base changes hurt answer quality before deployment.

## Answer Quality Eval

Golden-set file:

- `evals/golden-set.json`

Run schema validation only:

```bash
npm run eval:validate
```

Run live evals against a deployed service:

```bash
$env:ECOCO_BASE_URL="https://ecoco-customer-servic.onrender.com"
npm run eval
```

Optional AI judge:

- Set `ANTHROPIC_API_KEY`.
- Set `EVAL_JUDGE_MODEL` to the company-approved judge model.

If no judge model is configured, the eval runner uses deterministic checks based on `must_include` and `must_not_include`.

Generated reports are written to `evals/reports/` and are intentionally ignored by Git.

## Chat Traces

Runtime chat traces are stored in PostgreSQL table `chat_traces`.

Each record stores:

- session id
- channel: `web` or `line`
- masked user question
- retrieval mode: `semantic`, `keyword`, `hybrid`, or `none`
- retrieved chunk ids, categories, scores, and risk levels
- latency
- token usage
- stop reason
- error message, if any

The table does not store full retrieved chunk content. This keeps debugging useful while reducing data exposure.

## Admin Audit Logs

Knowledge-base create, update, archive, and restore operations write to `admin_audit_logs`.

Operators should send an `x-admin-user` header when possible so the audit log can identify who changed the knowledge base. If the header is absent, the actor is stored as `admin`.

## Knowledge Drift Check

The project has two knowledge layers:

- Git JSON: `data/ecoco-knowledge-import.json`
- Runtime DB: PostgreSQL `knowledge_sections`

Check drift manually:

```bash
$env:ECOCO_BASE_URL="https://ecoco-customer-servic.onrender.com"
$env:ADMIN_KEY="..."
npm run knowledge:drift
```

The scheduled backup workflow also runs this check as a warning. If drift is found, download the latest JSON from the dashboard, review it, and commit it back to Git after approval.

## Synonym Suggestions

Generate a report from unresolved knowledge gaps:

```bash
$env:ECOCO_BASE_URL="https://ecoco-customer-servic.onrender.com"
$env:ADMIN_KEY="..."
npm run suggest:synonyms
```

Optional AI suggestions:

- Set `ANTHROPIC_API_KEY`.
- Set `SYNONYM_SUGGEST_MODEL` to the company-approved model.

The output is a report only. Human review is required before changing RAG synonym rules.

## CI

GitHub Actions runs:

- syntax checks
- tests
- eval golden-set validation
- PII scan
- whitespace diff check

This protects the main branch from broken code and unsafe public data.
