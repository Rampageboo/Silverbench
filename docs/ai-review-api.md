# Model API review (development)

Use this optional API to get approximate, independent box proposals. It does not
write labels or certify negative samples. Existing local inference works as before.

## Local setup

The backend reads `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` from its environment or
the developer checkout's ignored `.env.local`. Never send keys through REST or MCP.
The installer staging script copies explicit source folders and does not bundle
this file. A packaged installation should supply keys through the environment;
an OS credential-vault UI remains planned.

Open a v3 workspace in the app first. Cloud mode is disabled by default. Read
`GET /api/ai/settings`, then POST a settings object to `/api/ai/settings` with
`cloud_enabled: true` only when cloud uploads are intended. Set current USD per
million input/output token rates in `prices`, indexed by `provider:model`. There
are no assumed prices. An unpriced model is blocked.

Example price-table shape (values below are placeholders; replace from your
provider's current pricing before enabling cloud mode):

```json
{"cloud_enabled": false, "request_limit_usd": 0.05, "batch_limit_usd": 1,
 "monthly_limit_usd": 5, "prices": {"openai:YOUR_MODEL": {"input": 1, "output": 1}}}
```

## Request

The Label workbench now has an **AI review** dock tab. Select an image, open
**Open full review**, configure cloud settings/prices, explicitly allow the
upload, and request a review. Accepting a box validates that the image and class
taxonomy still match, then uses the existing label importer (deduplication and
undo included). Rejecting changes only the proposal decision. Image-wide review
status is not automatically approved. Decisions survive reloads in the ledger.

The Gallery image inspector has **AI caption & tag review**. Suggested captions
and tags are editable; proposed removals are unchecked by default. **Apply
suggestions to draft** changes only the draft. **Save** persists through the
existing gallery edit endpoint and records the accepted provenance. **Discard**
undoes unsaved edits; **Reject suggestions** persists rejection without changing
the saved image record. Original generation metadata is retained.

`POST /api/ai/review`:

```json
{"workspace_root": "C:/path/to/open-workspace", "filename": "example.png",
 "provider": "openai", "model": "YOUR_MODEL", "allow_cloud_upload": true,
 "batch_id": "review-001", "detail": "low", "max_output_tokens": 2048}
```

`filename` is relative to `media/`. Preview images are RGB JPEG, at most 1280 pixels
per edge, with source metadata stripped. Coordinates use the stored image pixels
(no EXIF rotation), matching the workspace label coordinate system. Results have
normalized corner boxes, original-pixel boxes, evidence, `pending` review status,
and `approximate` geometry. The ledger stores original SHA256, dimensions, preview
transform, taxonomy, model, usage and result. Labels remain unchanged.

For Claude, choose `provider: "claude"` and a configured compatible model.
For Decisions, choose `provider: "openai_decisions"`, a supported model (currently
`gpt-6-luna` according to the official documentation), and `questions`:

```json
[{"type":"predicate","name":"suspected_missing_object","instructions":"Could this image contain an object requiring manual review?"},
 {"type":"choice","name":"route","instructions":"Select a review route.","choices":["local_only","tile","vision_review","manual_review"]},
 {"type":"score","name":"difficulty","instructions":"Rate annotation difficulty.","levels":["easy","medium","hard"]}]
```

The local adapter expands choices/levels into the provider's object schema.
Raw answers and questions are saved; action routing stays `manual_review` until
thresholds have been calibrated on verified samples. A score may be fractional.

`POST /api/ai/caption` accepts `asset_id`, provider/model/upload consent, batch,
detail and output-token options. It resolves only indexed gallery assets and
returns `caption`, `tags`, `remove_tags`, `uncertainty` and a pending request ID.
It shares the same providers, upload gates and budget ledger as YOLO review.

`GET /api/ai/requests/{id}` reads a result, `/verify` checks whether its YOLO image
and taxonomy are still current, and `/decision` records `{index, decision}` for
human box review. These decision endpoints record review state; box labels are
written by the existing editor after a human acceptance, not by the model.
`/caption-decision` records `{decision}` and snapshots the currently saved
caption/tags when accepted. It does not edit the gallery image itself.

`GET /api/ai/ledger?limit=50` reads recent records. `POST
/api/ai/batches/{batch_id}/stop` blocks new requests for that batch. It cannot
retract a provider request already submitted. To turn cloud mode off globally,
POST `{"cloud_enabled":false}` to settings.

## MCP

`review_image_with_api` has the same input fields and calls this same backend.
It is stateful, non-idempotent and open-world because cloud requests may incur
cost. Explicit upload consent and configured backend budgets still apply. Set
`YWB_MCP_BACKEND_TIMEOUT_SECONDS` to at least 60 for the 45-second provider timeout.
Do not automatically repeat a timed-out tool call: inspect the ledger first.

## Verification limits

Configured rates and reported token usage produce estimates, not a provider
invoice. Conservative preflight allowances reserve a budget under a SQLite
transaction. Unknown billing retains the reservation across restarts. No automatic
retries. An allowance overrun is recorded and affects later requests; the service
does not claim a strict provider-side spend cap. Reconcile cache pricing and bills
before wider paid batches. Use provider account limits as well.

Default `local` or disabled-cloud results explicitly say that no local model was
run. Invoke the existing local inference jobs to actually run YOLO. Pending box
results are available through REST/MCP/ledger and the desktop review UI; trained
geometry refinement, Mask export, automatic calibrated routing and a real-data
quality benchmark remain unimplemented. Desktop review UI and live OpenAI
connectivity have been verified using a synthetic geometric image; this does not
establish performance on a user's dataset. Claude live calls are unverified.
