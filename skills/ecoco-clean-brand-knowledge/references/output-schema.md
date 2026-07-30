# Cleaning package schema

The package format is `ecoco-partner-cleaning-package/v1`.

Required top-level fields:

- `company`: selected partner identity.
- `source`: filename, `line_txt` or `markdown`, SHA-256, and character count.
- `policy`: personal-data preservation, external-AI usage, raw-upload status, and local-only status.
- `skill`: name and version.
- `report`: counts and privacy-safe warnings.
- `sections`: human-readable approved knowledge documents.
- `chunks`: company-scoped deterministic RAG chunks.
- `markdown`: local review artifact; omit it from the SQL import request.

Each section includes:

- `companyId`
- `title`
- `category`
- `content`
- `contentHash`
- `metadata`

Each chunk includes:

- `companyId`
- `sectionIndex`
- `chunkIndex`
- `topic`
- `content`
- `searchText`
- `contentHash`
- `metadata`
- `sourceReferences`

The SQL import endpoint must derive the company from the URL and apply that company ID to every inserted row. It must never trust a different company ID from the package.
