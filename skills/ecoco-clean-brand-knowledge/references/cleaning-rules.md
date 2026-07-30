# Cleaning rules

## Privacy

- Preserve names, phone numbers, email addresses, speaker labels, dates, and company context.
- Do not transmit content to external AI or embedding providers.
- Do not include private content in logs, stdout, audit details, errors, or chat responses.
- Store only approved cleaned sections and chunks in SQL.
- Store source filename, hash, size, type, and status in SQL; do not store raw source content.

## TXT

- Accept UTF-8 LINE exports.
- Remove export headers, save-date headers, repeated blank lines, and attachment placeholders.
- Preserve message text, date headings, timestamps, and speakers.
- Group for review by LINE date, then split only when the section size limit is exceeded.
- Mark undated input with a warning instead of inventing a date.

## Markdown

- Preserve headings and their bodies.
- Start a new section on level 1–3 headings.
- Treat pre-heading content as a source-level section.
- Split oversized sections without changing text.

## RAG chunks

- Create chunks from approved cleaned sections, never directly from raw input.
- Keep company ID, source hash, section index, chunk index, topic, and source references.
- Use deterministic keyword `search_text`.
- Keep external embeddings empty until a company-approved local embedding service exists.

## Review

- Preview before import.
- Show counts, source hash prefix, warnings, and a readable Markdown view.
- Reject duplicate source hashes for the same company.
- Never replace or delete existing knowledge during import.
