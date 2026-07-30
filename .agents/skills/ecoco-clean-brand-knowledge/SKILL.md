---
name: ecoco-clean-brand-knowledge
description: Locally clean ECOCO partner LINE TXT exports and Markdown knowledge files into reviewed, company-scoped B2B knowledge sections and RAG chunks. Use when preparing brand conversation or knowledge data for AI use while preserving internal names, phone numbers, and email addresses without sending raw content to Claude, OpenAI, embedding APIs, or any external AI service.
---

# ECOCO Brand Knowledge Cleaning

## Safety invariants

- Process raw `.txt` and `.md` content only with the bundled deterministic local script.
- Never open, quote, summarize, paste, or send raw content into model context.
- Never call Claude, OpenAI, an embedding API, web search, or another remote service with raw or cleaned private content.
- Preserve internal names, phone numbers, and email addresses.
- Keep the original file at its existing local path; do not upload, move, overwrite, or delete it.
- Scope every section and chunk to the selected `company_id`.
- Require human preview and approval before SQL import.
- Reject packages whose policy does not declare `externalAiUsed=false` and `rawContentUploaded=false`.

## Workflow

1. Confirm the selected partner company and obtain its `id`, `name`, and `slug`.
2. Confirm the source extension is `.txt` or `.md`.
3. Run `scripts/clean-file.js` without reading the source file through the model.
4. Read only the script's privacy-safe summary from stdout.
5. Give the user the generated Markdown and JSON package paths.
6. Have the user review the local Markdown or the B2B admin preview.
7. Import only after explicit approval through the protected partner admin API or UI.
8. Report section count, chunk count, warnings, source hash prefix, and company scope without printing private content.

## Command

```powershell
node scripts/clean-file.js `
  --input "C:\path\brand-chat.txt" `
  --company-id 1 `
  --company-name "全家便利商店（測試）" `
  --company-slug "familymart-test" `
  --out-dir "C:\path\cleaned-output"
```

The script writes:

- `<source>-ai-cleaned.md` for human review.
- `<source>-ai-cleaned.json` for approved SQL import and backup.

## References

- Read `references/cleaning-rules.md` when changing normalization, LINE parsing, chunking, or privacy behavior.
- Read `references/output-schema.md` when changing the JSON package or SQL import contract.
