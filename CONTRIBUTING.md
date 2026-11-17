# Contributing

The most valuable contribution is a correction with a source. You do not need to write code.

## Fix a state record

1. Open `data/states/XX.json` (every state page has an "Edit this record" link).
2. Change the fact.
3. Add what you read to `sources`. Mark it `"kind": "primary"` only if it is the enacted law or the legislature's own page.
4. Set `last_verified` to today (`YYYY-MM-DD`).
5. If you settled something listed in `open_questions`, delete that line. If you found a new disagreement, add one.
6. If something happened (signed, vetoed, took effect), add an entry to `data/changelog.json`.
7. Open a pull request. CI runs `npm run validate` and the tests.

### Rules for law data

- **Cite it.** No source, no change.
- **Read the enacted version.** Introduced bills get amended. Caps and dates in early drafts are often wrong by the end.
- **When sources disagree, say so and show the cautious reading.** Put the disagreement in `open_questions`. Use the later effective date and the stricter rule until someone reads the enacted text.
- **Do not upgrade `verification` on trust.** `primary` means every fact in the record was read in an official source. `mixed` means the key facts were. Everything else is `secondary`.
- **Write for someone who is not a lawyer.** Plain sentences. Say what they can do and what they must do first.

### Status values

| Value | Meaning |
| --- | --- |
| `legal` | Signed and in effect. |
| `legal_soon` | Signed, effective date in the future. Flips to legal automatically on that date. |
| `awaiting_signature` | Passed both chambers, not signed. |
| `in_progress` | A bill is active. |
| `stalled` | A bill was introduced this session and did not pass. |
| `none` | No bill found. |

## Verify a product

A product is `verified` only when `certificate_url` links a public certificate or a lab's directory listing for that exact model. A press release, a product page, or a logo on a box is a claim. Note whether the certificate covers the whole kit or only the inverter (`scope`).

## Code

```bash
npm install
npm run dev
npm test
```

Logic lives in `src/lib/` as pure functions with tests beside them in `tests/`. If you change the solar model, the PVWatts comparison test must still pass, and say in the pull request what you compared against.
