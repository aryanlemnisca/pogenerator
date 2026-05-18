# Claude Code Prompt — BIOAI Purchase Order Generator

## Context

I'm building an internal tool for **BIOAI Innovations Pvt Ltd** (a wetlab operations team). They currently get PDF quotations from vendors (Vasa Scientific, Bionova Supplies, etc.) and manually transcribe them into a fixed Excel-format Purchase Order. I want to automate this.

**The flow:**

1. User uploads a vendor quotation PDF.
2. Backend sends it to Gemini, which extracts structured data.
3. Frontend shows the extracted data in an editable form. Fields the model couldn't find in the PDF are highlighted yellow with a "⚠ Not found in quotation — please fill manually" message.
4. User reviews/edits, picks a PO number (auto-suggested), clicks Generate.
5. Backend produces a `.xlsx` file that matches the existing template **exactly** (styling, merged cells, formulas, T&Cs boilerplate).
6. User downloads the file.

## Reference files (drop these into the repo at `reference/` before starting)

You should `view` all of these before writing code:

- `reference/PO-027_Vasa_Sci.xlsx` — **THE canonical PO template.** Your generated files must match this byte-for-byte except for the variable data (PO#, dates, vendor block, items, ref#).
- `reference/Vasa_Sci_Quotation.pdf` — Sample input quotation that produced PO-027. Use this as the end-to-end test fixture.
- `reference/Bionova_Quotation.pdf` — A second-vendor sample. This quote has no discount column (only a final "Special Price"), so it exercises the "rate = quoted price, discount = 0%" fallback path.
- `reference/PO-023_Bionova.xlsx` — **Reference only, do NOT use this format.** This is an older variant in a different column structure. Included so you understand we're consolidating on PO-027's structure.

## Tech stack

- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS. Single page since the flow is linear.
- **Backend:** FastAPI (Python 3.11+), `uvicorn` for serving.
- **xlsx generation:** `openpyxl` (templated approach — see below).
- **PDF extraction:** Gemini API via the `google-genai` Python SDK. Model: `gemini-2.5-flash`. Use structured outputs (JSON schema mode) with `response_mime_type="application/json"` and a Pydantic-derived schema.
- **State:** No database. PO counter is a single text file (`backend/data/po_counter.txt`). Keep it simple.

## Repository layout (create this)

```
po-generator/
├── README.md
├── .env.example                  # GEMINI_API_KEY=...
├── .gitignore
├── reference/                    # (user drops files here)
│   ├── PO-027_Vasa_Sci.xlsx
│   ├── Vasa_Sci_Quotation.pdf
│   ├── Bionova_Quotation.pdf
│   └── PO-023_Bionova.xlsx
├── backend/
│   ├── pyproject.toml            # or requirements.txt
│   ├── main.py                   # FastAPI app, routes
│   ├── schemas.py                # Pydantic models (shared contract)
│   ├── gemini_extract.py         # Gemini API wrapper
│   ├── po_generator.py           # openpyxl xlsx generation
│   ├── po_counter.py             # next-PO# logic
│   ├── data/
│   │   ├── po_counter.txt        # holds the next PO# (init with "30")
│   │   ├── po_template.xlsx      # copy of PO-027 with variable cells cleared
│   │   └── deliver_to.json       # BIOAI's fixed delivery block
│   └── tests/
│       └── test_generator.py
└── frontend/
    ├── package.json
    ├── next.config.js
    ├── tsconfig.json
    ├── tailwind.config.ts
    ├── postcss.config.js
    ├── app/
    │   ├── layout.tsx
    │   ├── globals.css
    │   └── page.tsx
    ├── components/
    │   ├── UploadStep.tsx
    │   ├── ReviewForm.tsx
    │   ├── ItemsTable.tsx
    │   └── FieldWithFlag.tsx
    └── lib/
        ├── api.ts                # API client
        └── types.ts              # mirrors backend schemas.py
```

## Data contract (shared between frontend and backend)

Define this once in `backend/schemas.py` as Pydantic models and mirror in `frontend/lib/types.ts`. **Every user-editable field is a `Flaggable<T>` so the UI knows whether to highlight it.**

```python
# backend/schemas.py

class FlaggableStr(BaseModel):
    value: str = ""
    was_found: bool = False  # True if extracted from the PDF; False if defaulted or missing

class FlaggableFloat(BaseModel):
    value: float | None = None
    was_found: bool = False

class FlaggableInt(BaseModel):
    value: int | None = None
    was_found: bool = False

class LineItem(BaseModel):
    catalog_number: FlaggableStr
    brand: FlaggableStr
    description: FlaggableStr        # full item & description, including pack info like "(6 x 1 = 6 NOS)"
    qty: FlaggableFloat
    rate: FlaggableFloat              # pre-discount per-unit rate
    discount_percent: FlaggableFloat  # 0.0 if quote has no discount column
    gst_percent: FlaggableFloat

class VendorBlock(BaseModel):
    name: FlaggableStr
    address_lines: list[FlaggableStr]  # typically 2-3 lines
    gst: FlaggableStr
    contact_line: FlaggableStr        # "Telephone: ...; M: ...; email@..."

class POMeta(BaseModel):
    po_number: FlaggableStr           # was_found=False (always auto-generated)
    date: FlaggableStr                # was_found=False (today)
    payment_terms: FlaggableStr       # was_found=False (default "30 days")
    delivery_date: FlaggableStr       # was_found=True if quote stated a period/date
    ref_number: FlaggableStr          # vendor's quote number
    place_of_supply: FlaggableStr     # was_found=False (default "Karnataka")
    po_revision: FlaggableStr = ""
    po_type: FlaggableStr = ""
    inco_terms: FlaggableStr = ""
    dispatch_instructions: FlaggableStr = ""

class POPayload(BaseModel):
    meta: POMeta
    vendor: VendorBlock
    items: list[LineItem]
    prepared_by: str = "Leelakrishna"        # fixed default
    authorized_signature: str = "Shilpa Nargund"  # fixed default
```

## API endpoints

### `GET /api/next-po-number`

Returns: `{ "po_number": "PO-030" }`. **Does not increment** — that happens on `/generate`.

### `POST /api/extract`

Accepts `multipart/form-data` with a `file` field (the quotation PDF).

Flow:
1. Read PDF bytes.
2. Call Gemini with the PDF + extraction prompt + structured-output JSON schema (see below).
3. Map Gemini's response to a `POPayload`, setting `was_found` flags based on whether each field came back non-empty.
4. Auto-fill the deterministic defaults: today's date, "30 days" payment terms, "Karnataka" place of supply, next PO#, BIOAI delivery block.
5. If quote has a "delivery period" (e.g., "2 weeks"), compute delivery_date = today + that period. Mark `was_found=True`. If neither period nor date is given, leave blank with `was_found=False`.

Returns: a `POPayload` JSON.

### `POST /api/generate-po`

Accepts: a `POPayload` JSON in the body.

Flow:
1. Validate the payload (all required fields non-empty).
2. Reserve and increment the PO counter atomically.
3. Generate the xlsx using `po_generator.py`.
4. Return the file as `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` with `Content-Disposition: attachment; filename="PO-030_<vendor_slug>.xlsx"`.

## Gemini extraction — prompt & schema

In `gemini_extract.py`:

```python
EXTRACTION_PROMPT = """You are extracting data from a vendor quotation PDF to populate a Purchase Order.

Extract the following:

1. **Vendor block:**
   - name (company name)
   - address_lines (2-3 lines of postal address, excluding country/PIN if separate)
   - gst (the GSTIN — a 15-character alphanumeric code)
   - contact_line (combine telephone, mobile, and email into one line, formatted as "Telephone: <tel>; M: <mob>; <email>")

2. **Quote metadata:**
   - ref_number (the vendor's quotation/order number, e.g., "2603122" or "BN/26-27/SO-613")
   - delivery_period_days (if the quote states a delivery time like "2 weeks", "10 days", convert to days; null if not stated)
   - delivery_date (if the quote states an explicit date, use it; null if not stated)

3. **Line items** — for each item in the quotation table:
   - catalog_number (the part/catalog/SKU code)
   - brand (manufacturer brand, e.g., "Tarsons", "Sigma Aldrich")
   - description (the full item description INCLUDING any pack-size info like "(6 x 1 = 6 NOS)" or "(SLEEVE OF 10)")
   - qty (numeric)
   - rate (the pre-discount per-unit listed rate)
   - discount_percent (if the quote shows a discount %, extract it; if the quote shows only a final/special price with no separate list price, set discount_percent=0 and use the final price as `rate`)
   - gst_percent (the GST rate for this line, as a percentage — e.g., 18 not 0.18)

**Important rules:**
- If a field is not present in the quotation, return null or empty string. DO NOT INVENT VALUES.
- For Indian vendor PDFs, prices may have commas (e.g., "5,592.00") — strip them.
- Include the pack-size info inside `description`, not as a separate field.
- Maintain the original line order from the quotation.
"""
```

Schema: derive from a Pydantic `GeminiExtractionResult` model. Each field uses `Optional[]` so nulls are allowed. Convert Pydantic schema to Gemini's expected format using `model.model_json_schema()`.

Use the new `google-genai` SDK:

```python
from google import genai
from google.genai import types

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=[
        types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
        EXTRACTION_PROMPT,
    ],
    config=types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=GeminiExtractionResult,
    ),
)
extracted = GeminiExtractionResult.model_validate_json(response.text)
```

## xlsx generation strategy — `po_generator.py`

**Approach:** template-based. Don't recreate styling from scratch — load the existing PO-027 as a template, clear variable cells, inject new data.

### Setup (one-time, can be a script)

1. Copy `reference/PO-027_Vasa_Sci.xlsx` to `backend/data/po_template.xlsx`.
2. In the template, clear (set to None or ""): A2's PO#/date/etc. text, vendor block cells A5-A9, the 5 item rows (14-18). Leave everything else — column widths, fonts, merged cells, T&Cs, headers, footer — untouched.

### Generation flow

```python
def generate_po(payload: POPayload, output_path: Path) -> None:
    wb = load_workbook("backend/data/po_template.xlsx")
    ws = wb.active

    # 1. Write the PO meta block (A2) and place-of-supply block (E2)
    #    These are multi-line strings inside merged cells — use "\n".join(...)
    ws["A2"] = format_po_meta_block(payload.meta)
    ws["E2"] = format_place_of_supply_block(payload.meta)

    # 2. Vendor block (A5-A9)
    ws["A5"] = payload.vendor.name.value
    # ... address lines spread across A6-A7
    ws["A8"] = f"GST: {payload.vendor.gst.value}"
    ws["A9"] = f"Telephone: {payload.vendor.contact_line.value}"

    # 3. Deliver-To block (E5-E10) — load from data/deliver_to.json, FIXED

    # 4. Items — this is the tricky part. See below.

    # 5. Footer is already in the template (Prepared By, Auth Sig, T&Cs) —
    #    but verify the names match payload.prepared_by / payload.authorized_signature
    #    and update if needed (cells A22, A23).

    wb.save(output_path)
```

### Dynamic item rows (the tricky bit)

The template has 5 item rows (14–18) for the Vasa example. New PDFs may have any number of items.

**Strategy:**

- Take row 14 as the "style donor" row (it has the correct formulas, merged D:E, alignment, fonts).
- If `len(items) > 5`: use `ws.insert_rows()` to add rows after row 18, then copy row 14's styles + formulas (with adjusted row numbers) into each new row. Update the merged-cell range for the description column (`D{n}:E{n}`) on each new row.
- If `len(items) < 5`: delete the extra rows from the bottom of the item block using `ws.delete_rows()`.
- After resizing, the "Total" row and everything below shifts. Update the SUM formula at K{total_row} to reference the correct range, and update the merged-cell range for "Total" (I{n}:J{n}).

**Formulas to write per item row n (1-indexed in the item table):**

```
I{n} = =G{n}*(1-H{n}/100)*F{n}      # Dis Rate = Rate * (1 - Discount/100) * Qty
K{n} = =I{n}*(1+J{n}/100)            # Amt inc GST = Dis Rate * (1 + GST/100)
```

Note: this **standardizes** all rows to include the `*F{n}` qty multiplier. The original PO-027 only had it on row 14 — that was an inconsistency we're fixing.

**Total row:**

```
K{total_row} = =SUM(K{first_item_row}:K{last_item_row})
```

### Things to NOT touch

- Row 1 (company header), row 11 (border), the column header row (12-13)
- Rows for Prepared By, Signature, T&Cs (rows 22 onwards) — except updating the Prepared By and Signature names if they differ from defaults
- Any column widths
- Any font styling
- Any merged cells outside the items block

### Verification step

After generating, run the recalc script (or use LibreOffice headless) to compute formula values and verify no `#REF!` / `#VALUE!` errors. Compare against the original PO-027 numbers as a smoke test (generating from `Vasa_Sci_Quotation.pdf` should produce numbers within 0.5 of PO-027's values — the original has a row 14 inconsistency that our standardization corrects, hence the small delta on row 14).

## Frontend specification

### `app/page.tsx` — single page, two states

**State 1: Upload**

- Drag-and-drop or file picker for PDF
- Shows filename + size when selected
- "Extract" button → POST to `/api/extract` with a spinner during the ~5–10s call
- Display backend errors gracefully (Gemini timeouts, malformed PDFs)

**State 2: Review & Generate**

Form layout matching the PO sections:

1. **PO Metadata card:** PO#, Date, Payment Terms, Delivery Date, Ref#, Place of Supply, PO Revision, PO Type, Inco Terms, Dispatch Instructions
2. **Vendor card:** Name, Address (multi-line), GST, Contact
3. **Items table:** editable rows with columns matching PO-027 (Catalog #, Brand, Description, Qty, Rate, Dis %, GST %). Live-computed "Dis Rate" and "Amt inc GST" preview columns (read-only).
4. **Footer card:** Prepared By, Authorized Signature
5. **Generate PO** button → POST to `/api/generate-po`, triggers file download

Below the table, show a running computed **Total** preview using the same formula the backend will apply.

### `FieldWithFlag.tsx` component

Wraps any input. Props:
- `label: string`
- `value: T`
- `wasFound: boolean`
- `onChange: (v: T) => void`
- `helpText?: string`

If `wasFound === false`:
- Input has yellow background (`bg-yellow-50 border-yellow-400`)
- Below the input, render: `<p className="text-sm text-yellow-700">⚠ Not found in quotation — please fill manually</p>`
- When user edits the field, **flip `wasFound` to true** so the warning disappears (they've handled it).

Apply the same flagging treatment to items table cells.

### Styling

Keep it clean and minimal. Tailwind defaults are fine. If you want a brand touch, use these CSS variables in `globals.css` (Lemnisca's brand — this is an internal Lemnisca tool):

```css
:root {
  --accent: #38AFD8;  /* cyan */
  --accent-dark: #2A8BAD;
}
```

Use `text-sky-500` / `bg-sky-500` (Tailwind) as the closest Tailwind equivalent for primary CTAs.

### `api.ts`

Wrap the three endpoints with typed fetch calls. Backend base URL from `NEXT_PUBLIC_API_URL` env var, default `http://localhost:8000`.

## PO Counter logic — `po_counter.py`

```python
COUNTER_FILE = Path("backend/data/po_counter.txt")

def peek_next_po_number() -> str:
    if not COUNTER_FILE.exists():
        COUNTER_FILE.write_text("30")
    n = int(COUNTER_FILE.read_text().strip())
    return f"PO-{n:03d}"

def consume_next_po_number() -> str:
    n = int(COUNTER_FILE.read_text().strip())
    COUNTER_FILE.write_text(str(n + 1))
    return f"PO-{n:03d}"
```

Add a file lock (`fcntl.flock` on POSIX) around the consume call so concurrent requests don't collide.

## Acceptance criteria

When done, I should be able to:

1. `cd backend && uvicorn main:app --reload` — backend boots on :8000
2. `cd frontend && npm run dev` — frontend on :3000
3. Open the frontend, upload `reference/Vasa_Sci_Quotation.pdf`, click Extract.
4. See all 5 line items populated, vendor block filled, ref# `2603122`, delivery date computed as today+14d (quote says "2 WEEKS"). Payment Terms shows "30 days" with no yellow flag (it's a default but a sensible one — actually flag it yellow so user knows it's not from the PDF; only "Karnataka" place of supply should be unflagged since it's truly fixed).
5. PO# auto-populates as `PO-030` (first run).
6. Click Generate PO → a file downloads named `PO-030_vasa_scientific_co.xlsx`.
7. Open it: structure, fonts, merged cells, T&Cs are identical to PO-027. Items match the quotation. Totals compute correctly. PO# is `PO-030`, date is today, ref# is `2603122`.
8. Refresh, upload `reference/Bionova_Quotation.pdf`. Extracted items show `discount_percent = 0` and `rate` set to the quote's per-unit price. Generated PO totals match the quote's totals (modulo any rounding).
9. PO# auto-increments to `PO-031` on next generation.
10. Re-uploading a quote with a field missing (try removing the email line from a copy of the Vasa quote) — that field renders with the yellow ⚠ message in the UI.

## Phasing — build in this order

1. **Backend skeleton + xlsx generation** — Phase 1 is just making `po_generator.py` produce a faithful copy of PO-027 from hardcoded data (no Gemini, no API yet). Run it; diff the output against PO-027. Iterate until match.
2. **PO counter + FastAPI shell** — add the `/next-po-number` and stub the other endpoints.
3. **Gemini extraction** — get the extract endpoint working with the Vasa PDF; verify the JSON shape.
4. **Frontend** — scaffold Next.js, build UploadStep, then ReviewForm, then wire to backend.
5. **Polish** — error handling, loading states, the flag-on-edit behavior, file naming.
6. **Test with Bionova PDF** — second-vendor validation.

## Out of scope (don't build these unless I ask)

- Authentication / user accounts (this is internal, single-user assumption)
- Database / persistence beyond the counter file
- Google Sheets API push (user can upload the xlsx manually for now)
- Editing or regenerating past POs
- Multi-page PDFs with discontinuous item tables
- Currencies other than INR
- Multi-language quotations

## Setup tasks for me (the user) before running this prompt

I will:
1. Create the repo directory and run `claude` inside it.
2. Drop the four reference files into `reference/`.
3. Set `GEMINI_API_KEY` in my environment.

## Notes & guardrails

- **Do not** invent business data or default values I haven't specified. Anything not specified should either be flagged as "missing" in the UI or asked back to me.
- **Do not** add telemetry, analytics, or external dependencies beyond what's listed.
- When in doubt about styling/merged-cell behavior in openpyxl, inspect the template file with a small script and confirm before generating.
- Run `pytest` for the backend tests after Phase 1 to make sure the xlsx output is stable across runs.
- The original PO-027 has a known inconsistency in row 14's discount formula (qty multiplier present on row 14, absent on rows 15+). We are deliberately standardizing all rows to include the qty multiplier. Document this in a comment in `po_generator.py`.

That's it — start with Phase 1 (xlsx generation matching PO-027), and check in with me before moving to Phase 2 if anything is ambiguous.