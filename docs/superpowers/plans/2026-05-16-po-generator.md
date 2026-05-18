# PO Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack internal tool that extracts data from vendor quotation PDFs via Gemini and generates styled XLSX Purchase Orders matching BIOAI's canonical PO-027 template.

**Architecture:** FastAPI backend handles PDF extraction (Gemini 2.5 Flash), PO counter state (flat file), and XLSX generation (openpyxl template-based). Next.js 14 frontend provides upload → review → generate flow with per-field flagging for missing data.

**Tech Stack:** Python 3.11+, FastAPI, openpyxl, google-genai SDK, Next.js 14 App Router, TypeScript, Tailwind CSS.

---

## Critical Template Facts (from inspection of PO-027_Vasa_Sci.xlsx)

- **11 columns A–K**, item rows **14–18** (5 items), total at **row 20**
- **D14:E14** (and D{n}:E{n}) merged for item description
- **I{n} formula (standardized):** `=G{n}*(1-H{n}/100)*F{n}` (Dis Rate × Qty)
- **K{n} formula:** `=I{n}*(1+J{n}/100)` (Amt inc GST)
- **K20:** `=SUM(K14:K18)` (adjusts when rows are added/removed)
- Footer: A22 = "Prepared By: ...", A23 = "Authorized Signature: ..."
- T&Cs start at row 25 (full-width merged rows 25–56)
- Row 11 (A11:K11): empty separator before column headers
- Merged column headers span rows **12–13** (double-height)

---

## Repository Layout

```
po-generator/                         ← working directory
├── README.md
├── .env.example
├── .gitignore
├── reference/                        ← user's files, do not modify
│   ├── PO-027_Vasa_Sci.xlsx
│   ├── Vasa Sci Quotation.pdf
│   ├── Bionova Quotation.pdf
│   └── PO-023_Bionova.xlsx
├── backend/
│   ├── pyproject.toml
│   ├── main.py
│   ├── schemas.py
│   ├── gemini_extract.py
│   ├── po_generator.py
│   ├── po_counter.py
│   └── data/
│       ├── po_counter.txt            ← init with "30"
│       ├── po_template.xlsx          ← PO-027 with variable cells cleared
│       └── deliver_to.json
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
        ├── api.ts
        └── types.ts
```

---

## Phase 1 — Backend: Project Skeleton + xlsx Generation

### Task 1: Project scaffold and template preparation

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/data/deliver_to.json`
- Create: `backend/data/po_counter.txt`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `backend/scripts/prepare_template.py` (one-time script, run once, then discard)

- [ ] **Step 1.1: Create the backend Python project**

```toml
# backend/pyproject.toml
[project]
name = "po-generator-backend"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.111.0",
    "uvicorn[standard]>=0.29.0",
    "python-multipart>=0.0.9",
    "openpyxl>=3.1.2",
    "google-genai>=0.7.0",
    "pydantic>=2.7.0",
    "pytest>=8.2.0",
    "httpx>=0.27.0",
]
```

Run: `cd backend && pip install -e .`
Expected: packages install without errors.

- [ ] **Step 1.2: Create deliver_to.json**

```json
// backend/data/deliver_to.json
{
  "name": "BIOAI Innovations Private Limited",
  "address_line1": "Bangalore Bioinnovation centre",
  "address_line2": "Helix Biotech Park, IBAB Campus, Electronic City Phase I, Bangalore - 560100",
  "gstin": "GSTIN: 29AANCB6620M1Z5",
  "contact": "Contact: 9901580680; shilpa@lemnisca.bio"
}
```

- [ ] **Step 1.3: Create po_counter.txt**

```
30
```
Save to `backend/data/po_counter.txt`.

- [ ] **Step 1.4: Create .env.example**

```
GEMINI_API_KEY=your_key_here
```

- [ ] **Step 1.5: Create .gitignore**

```
__pycache__/
*.pyc
.env
backend/data/generated/
.next/
node_modules/
```

- [ ] **Step 1.6: Prepare the template — run the one-time script**

Create `backend/scripts/prepare_template.py`:

```python
"""One-time script: copy PO-027 and clear variable cells to produce po_template.xlsx."""
from pathlib import Path
from openpyxl import load_workbook

SRC = Path("../reference/PO-027_Vasa_Sci.xlsx")
DST = Path("../backend/data/po_template.xlsx")

wb = load_workbook(SRC)
ws = wb.active

# Clear PO meta block (A2 and E2)
ws["A2"] = None
ws["E2"] = None

# Clear vendor block
for row in range(5, 10):
    ws[f"A{row}"] = None

# Clear item rows 14–18 (serial#, catalog, brand, description, qty, rate, dis%, gst%)
for row in range(14, 19):
    for col in ("A", "B", "C", "D", "F", "G", "H", "J"):
        ws[f"{col}{row}"] = None
    # Leave I and K formulas intact — they will be overwritten during generation

DST.parent.mkdir(parents=True, exist_ok=True)
wb.save(DST)
print(f"Template written to {DST}")
```

Run from repo root:
```bash
cd /path/to/po-generator && python backend/scripts/prepare_template.py
```
Expected: `backend/data/po_template.xlsx` created, ~same file size as PO-027.

- [ ] **Step 1.7: Commit scaffold**

```bash
git init
git add backend/pyproject.toml backend/data/deliver_to.json backend/data/po_counter.txt \
        backend/data/po_template.xlsx .env.example .gitignore \
        backend/scripts/prepare_template.py
git commit -m "chore: project scaffold and PO template preparation"
```

---

### Task 2: Pydantic schemas

**Files:**
- Create: `backend/schemas.py`

- [ ] **Step 2.1: Write the schemas**

```python
# backend/schemas.py
from pydantic import BaseModel


class FlaggableStr(BaseModel):
    value: str = ""
    was_found: bool = False


class FlaggableFloat(BaseModel):
    value: float | None = None
    was_found: bool = False


class FlaggableInt(BaseModel):
    value: int | None = None
    was_found: bool = False


class LineItem(BaseModel):
    catalog_number: FlaggableStr
    brand: FlaggableStr
    description: FlaggableStr
    qty: FlaggableFloat
    rate: FlaggableFloat
    discount_percent: FlaggableFloat
    gst_percent: FlaggableFloat


class VendorBlock(BaseModel):
    name: FlaggableStr
    address_lines: list[FlaggableStr]
    gst: FlaggableStr
    contact_line: FlaggableStr


class POMeta(BaseModel):
    po_number: FlaggableStr
    date: FlaggableStr
    payment_terms: FlaggableStr
    delivery_date: FlaggableStr
    ref_number: FlaggableStr
    place_of_supply: FlaggableStr
    po_revision: FlaggableStr = FlaggableStr()
    po_type: FlaggableStr = FlaggableStr()
    inco_terms: FlaggableStr = FlaggableStr()
    dispatch_instructions: FlaggableStr = FlaggableStr()


class POPayload(BaseModel):
    meta: POMeta
    vendor: VendorBlock
    items: list[LineItem]
    prepared_by: str = "Leelakrishna"
    authorized_signature: str = "Shilpa Nargund"
```

- [ ] **Step 2.2: Verify import**

```bash
cd backend && python -c "from schemas import POPayload; print('OK')"
```
Expected: `OK`

- [ ] **Step 2.3: Commit**

```bash
git add backend/schemas.py
git commit -m "feat: Pydantic schemas for POPayload data contract"
```

---

### Task 3: xlsx generator (`po_generator.py`)

**Files:**
- Create: `backend/po_generator.py`

This is the core of Phase 1. It must produce a faithful replica of PO-027 from a `POPayload`.

- [ ] **Step 3.1: Create po_generator.py**

```python
# backend/po_generator.py
"""
Template-based PO xlsx generator using openpyxl.

NOTE: The original PO-027 template has a known inconsistency — row 14 uses
=G14*(1-H14/100)*F14 (includes qty multiplier) while rows 15–18 use
=G{n}*(1-H{n}/100) (qty multiplier absent). We deliberately standardize all
rows to include *F{n} so Dis Rate always reflects the total discounted cost.
"""
import json
from copy import copy
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from openpyxl.styles import Font, PatternFill, Alignment, Border

from schemas import POPayload

TEMPLATE_PATH = Path(__file__).parent / "data" / "po_template.xlsx"
DELIVER_TO_PATH = Path(__file__).parent / "data" / "deliver_to.json"

# Row indices (1-based, matching the template)
FIRST_ITEM_ROW = 14
TEMPLATE_ITEM_ROWS = 5       # PO-027 has rows 14–18


def _copy_cell_style(src_cell, dst_cell):
    """Copy font, fill, alignment, border, number_format from src to dst."""
    if src_cell.has_style:
        dst_cell.font = copy(src_cell.font)
        dst_cell.fill = copy(src_cell.fill)
        dst_cell.alignment = copy(src_cell.alignment)
        dst_cell.border = copy(src_cell.border)
        dst_cell.number_format = src_cell.number_format


def _item_formulas(row: int) -> tuple[str, str]:
    """Return (dis_rate_formula, amt_formula) for a given spreadsheet row."""
    dis_rate = f"=G{row}*(1-H{row}/100)*F{row}"
    amt = f"=I{row}*(1+J{row}/100)"
    return dis_rate, amt


def generate_po(payload: POPayload, output_path: Path) -> None:
    wb = load_workbook(TEMPLATE_PATH)
    ws = wb.active

    # ── 1. PO meta block (A2, merged A2:D2) ──────────────────────────────────
    meta = payload.meta
    ws["A2"] = (
        f"Purchase Order# : {meta.po_number.value}\n"
        f"Date : {meta.date.value}\n"
        f"Payment Terms : {meta.payment_terms.value}\n"
        f"Delivery Date : {meta.delivery_date.value}\n"
        f"Ref# : {meta.ref_number.value}"
    )

    # ── 2. Place-of-supply block (E2, merged E2:K2) ───────────────────────────
    ws["E2"] = (
        f"Place Of Supply : {meta.place_of_supply.value}\n"
        f"PO Revision : {meta.po_revision.value}\n"
        f"PO Type : {meta.po_type.value}\n"
        f"Inco Terms : {meta.inco_terms.value}\n"
        f"Dispatch Instructions : {meta.dispatch_instructions.value}"
    )

    # ── 3. Vendor block (A5–A9) ───────────────────────────────────────────────
    vendor = payload.vendor
    ws["A5"] = vendor.name.value
    address_lines = [fl.value for fl in vendor.address_lines]
    ws["A6"] = address_lines[0] if len(address_lines) > 0 else ""
    ws["A7"] = address_lines[1] if len(address_lines) > 1 else ""
    ws["A8"] = f"GST: {vendor.gst.value}"
    ws["A9"] = vendor.contact_line.value

    # ── 4. Deliver-To block (E5–E9) — always fixed ───────────────────────────
    dt = json.loads(DELIVER_TO_PATH.read_text())
    ws["E5"] = dt["name"]
    ws["E6"] = dt["address_line1"]
    ws["E7"] = dt["address_line2"]
    ws["E8"] = dt["gstin"]
    ws["E9"] = dt["contact"]

    # ── 5. Resize item rows ───────────────────────────────────────────────────
    n_items = len(payload.items)
    last_item_row = FIRST_ITEM_ROW + n_items - 1
    total_row_after = last_item_row + 2   # one blank gap row then total

    if n_items > TEMPLATE_ITEM_ROWS:
        # Insert extra rows after row 18 (end of template item block)
        rows_to_add = n_items - TEMPLATE_ITEM_ROWS
        insert_after = FIRST_ITEM_ROW + TEMPLATE_ITEM_ROWS - 1
        ws.insert_rows(insert_after + 1, rows_to_add)

        # Copy style from row 14 (style donor) into each new row
        donor_row = FIRST_ITEM_ROW
        for new_row in range(insert_after + 1, insert_after + 1 + rows_to_add):
            for col_idx in range(1, 12):  # cols A–K
                src = ws.cell(row=donor_row, column=col_idx)
                dst = ws.cell(row=new_row, column=col_idx)
                _copy_cell_style(src, dst)
            # Re-merge D:E for description on the new row
            ws.merge_cells(f"D{new_row}:E{new_row}")

    elif n_items < TEMPLATE_ITEM_ROWS:
        # Delete extra rows from the bottom of the item block
        rows_to_delete = TEMPLATE_ITEM_ROWS - n_items
        delete_start = FIRST_ITEM_ROW + n_items
        ws.delete_rows(delete_start, rows_to_delete)

    # ── 6. Write item data ────────────────────────────────────────────────────
    for idx, item in enumerate(payload.items):
        row = FIRST_ITEM_ROW + idx
        ws[f"A{row}"] = idx + 1
        ws[f"B{row}"] = item.catalog_number.value
        ws[f"C{row}"] = item.brand.value
        ws[f"D{row}"] = item.description.value
        ws[f"F{row}"] = item.qty.value
        ws[f"G{row}"] = item.rate.value
        ws[f"H{row}"] = item.discount_percent.value
        ws[f"J{row}"] = item.gst_percent.value
        dis_rate_formula, amt_formula = _item_formulas(row)
        ws[f"I{row}"] = dis_rate_formula
        ws[f"K{row}"] = amt_formula

    # ── 7. Total row ──────────────────────────────────────────────────────────
    # After row resize: total is at FIRST_ITEM_ROW + n_items + 1 (one blank row gap)
    total_row = FIRST_ITEM_ROW + n_items + 1
    ws[f"K{total_row}"] = f"=SUM(K{FIRST_ITEM_ROW}:K{last_item_row})"

    # ── 8. Footer — Prepared By / Authorized Signature ────────────────────────
    # Footer rows shift with item count. In the template they were at rows 22/23
    # (with 5 items). After resize: footer_offset = total_row + 2
    footer_base = total_row + 2
    ws[f"A{footer_base}"] = f"Prepared By: {payload.prepared_by}"
    ws[f"A{footer_base + 1}"] = f"Authorized Signature: {payload.authorized_signature}"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(output_path)
```

- [ ] **Step 3.2: Commit po_generator.py**

```bash
git add backend/po_generator.py
git commit -m "feat: template-based xlsx PO generator with dynamic item rows"
```

---

### Task 4: Tests for the xlsx generator

**Files:**
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_generator.py`

- [ ] **Step 4.1: Write the failing tests**

```python
# backend/tests/test_generator.py
"""Tests for the xlsx generator. Run from the backend/ directory."""
import pytest
from pathlib import Path
from openpyxl import load_workbook
from schemas import POPayload, POMeta, VendorBlock, LineItem
from schemas import FlaggableStr, FlaggableFloat
from po_generator import generate_po

OUTPUT_DIR = Path("tests/output")


def _make_vasa_payload() -> POPayload:
    """Fixture matching the data in PO-027_Vasa_Sci.xlsx for smoke-test comparison."""
    return POPayload(
        meta=POMeta(
            po_number=FlaggableStr(value="PO-027", was_found=False),
            date=FlaggableStr(value="15 May 2026", was_found=False),
            payment_terms=FlaggableStr(value="30 days", was_found=False),
            delivery_date=FlaggableStr(value="30 May 2026", was_found=True),
            ref_number=FlaggableStr(value="2603122", was_found=True),
            place_of_supply=FlaggableStr(value="Karnataka", was_found=False),
        ),
        vendor=VendorBlock(
            name=FlaggableStr(value="Vasa Scientific Co.", was_found=True),
            address_lines=[
                FlaggableStr(value="95/1, 11th cross, 4th main, Malleshwaram", was_found=True),
                FlaggableStr(value="Bangalore, 560003", was_found=True),
            ],
            gst=FlaggableStr(value="29AAMPP7088B1Z8", was_found=True),
            contact_line=FlaggableStr(
                value="Telephone: (080) 43023447; M: 9611271358; enquiry@vasascientific.in",
                was_found=True,
            ),
        ),
        items=[
            LineItem(
                catalog_number=FlaggableStr(value="T460091", was_found=True),
                brand=FlaggableStr(value="Tarsons", was_found=True),
                description=FlaggableStr(value="PETRI DISH 90MM (6 x 1 = 6 NOS)", was_found=True),
                qty=FlaggableFloat(value=2, was_found=True),
                rate=FlaggableFloat(value=5592, was_found=True),
                discount_percent=FlaggableFloat(value=18, was_found=True),
                gst_percent=FlaggableFloat(value=18, was_found=True),
            ),
            LineItem(
                catalog_number=FlaggableStr(value="T560090", was_found=True),
                brand=FlaggableStr(value="Tarsons", was_found=True),
                description=FlaggableStr(value="WASH BOTTLE LDPE 500ML (SLEEVE OF 10)", was_found=True),
                qty=FlaggableFloat(value=1, was_found=True),
                rate=FlaggableFloat(value=1095, was_found=True),
                discount_percent=FlaggableFloat(value=18, was_found=True),
                gst_percent=FlaggableFloat(value=18, was_found=True),
            ),
            LineItem(
                catalog_number=FlaggableStr(value="T630090", was_found=True),
                brand=FlaggableStr(value="Tarsons", was_found=True),
                description=FlaggableStr(value="FUNNEL PP 160MM", was_found=True),
                qty=FlaggableFloat(value=1, was_found=True),
                rate=FlaggableFloat(value=966, was_found=True),
                discount_percent=FlaggableFloat(value=18, was_found=True),
                gst_percent=FlaggableFloat(value=18, was_found=True),
            ),
            LineItem(
                catalog_number=FlaggableStr(value="T202080", was_found=True),
                brand=FlaggableStr(value="Tarsons", was_found=True),
                description=FlaggableStr(value="UNIVERSAL COMBI RACK", was_found=True),
                qty=FlaggableFloat(value=1, was_found=True),
                rate=FlaggableFloat(value=3459, was_found=True),
                discount_percent=FlaggableFloat(value=18, was_found=True),
                gst_percent=FlaggableFloat(value=18, was_found=True),
            ),
            LineItem(
                catalog_number=FlaggableStr(value="T720510", was_found=True),
                brand=FlaggableStr(value="Tarsons", was_found=True),
                description=FlaggableStr(value="PINCH CLAMP PP", was_found=True),
                qty=FlaggableFloat(value=1, was_found=True),
                rate=FlaggableFloat(value=1027, was_found=True),
                discount_percent=FlaggableFloat(value=18, was_found=True),
                gst_percent=FlaggableFloat(value=18, was_found=True),
            ),
        ],
    )


@pytest.fixture(autouse=True)
def output_dir():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def test_generate_po_produces_file():
    payload = _make_vasa_payload()
    out = OUTPUT_DIR / "test_po_basic.xlsx"
    generate_po(payload, out)
    assert out.exists()
    assert out.stat().st_size > 10_000


def test_meta_block_written():
    payload = _make_vasa_payload()
    out = OUTPUT_DIR / "test_po_meta.xlsx"
    generate_po(payload, out)
    wb = load_workbook(out)
    ws = wb.active
    a2 = ws["A2"].value
    assert "PO-027" in a2
    assert "2603122" in a2
    assert "30 days" in a2


def test_vendor_block_written():
    payload = _make_vasa_payload()
    out = OUTPUT_DIR / "test_po_vendor.xlsx"
    generate_po(payload, out)
    wb = load_workbook(out)
    ws = wb.active
    assert ws["A5"].value == "Vasa Scientific Co."
    assert "29AAMPP7088B1Z8" in ws["A8"].value


def test_deliver_to_block_written():
    payload = _make_vasa_payload()
    out = OUTPUT_DIR / "test_po_deliver.xlsx"
    generate_po(payload, out)
    wb = load_workbook(out)
    ws = wb.active
    assert "BIOAI Innovations" in ws["E5"].value


def test_item_rows_written_with_formulas():
    payload = _make_vasa_payload()
    out = OUTPUT_DIR / "test_po_items.xlsx"
    generate_po(payload, out)
    wb = load_workbook(out)
    ws = wb.active
    # Row 14 — first item
    assert ws["B14"].value == "T460091"
    assert ws["G14"].value == 5592
    assert ws["H14"].value == 18
    assert "G14" in ws["I14"].value
    assert "F14" in ws["I14"].value   # standardized to include qty
    assert "I14" in ws["K14"].value
    # Row 18 — last item
    assert ws["B18"].value == "T720510"
    assert "F18" in ws["I18"].value   # all rows must have qty multiplier


def test_total_formula_correct():
    payload = _make_vasa_payload()
    out = OUTPUT_DIR / "test_po_total.xlsx"
    generate_po(payload, out)
    wb = load_workbook(out)
    ws = wb.active
    # Total row for 5 items is row 20
    total_cell = ws["K20"].value
    assert "SUM(K14:K18)" in total_cell


def test_footer_written():
    payload = _make_vasa_payload()
    out = OUTPUT_DIR / "test_po_footer.xlsx"
    generate_po(payload, out)
    wb = load_workbook(out)
    ws = wb.active
    # Footer at rows 22/23 for 5 items
    assert "Leelakrishna" in ws["A22"].value
    assert "Shilpa Nargund" in ws["A23"].value


def test_extra_items_inserts_rows():
    """Seven-item PO should produce item rows 14–20, total at row 22."""
    payload = _make_vasa_payload()
    extra_item = LineItem(
        catalog_number=FlaggableStr(value="EXTRA", was_found=True),
        brand=FlaggableStr(value="TestBrand", was_found=True),
        description=FlaggableStr(value="Extra item", was_found=True),
        qty=FlaggableFloat(value=1, was_found=True),
        rate=FlaggableFloat(value=100, was_found=True),
        discount_percent=FlaggableFloat(value=0, was_found=True),
        gst_percent=FlaggableFloat(value=18, was_found=True),
    )
    payload.items.extend([extra_item, extra_item])  # now 7 items
    out = OUTPUT_DIR / "test_po_7items.xlsx"
    generate_po(payload, out)
    wb = load_workbook(out)
    ws = wb.active
    # Row 20 should be last item (index 6 = row 14+6=20)
    assert ws["A20"].value == 7
    # Total at row 22
    assert "SUM(K14:K20)" in ws["K22"].value


def test_fewer_items_deletes_rows():
    """Two-item PO should have total at row 17 (rows 14–15 items, row 16 blank, 17 total)."""
    payload = _make_vasa_payload()
    payload.items = payload.items[:2]
    out = OUTPUT_DIR / "test_po_2items.xlsx"
    generate_po(payload, out)
    wb = load_workbook(out)
    ws = wb.active
    assert ws["A15"].value == 2
    assert "SUM(K14:K15)" in ws["K17"].value
```

- [ ] **Step 4.2: Run tests to verify they FAIL (no implementation yet)**

```bash
cd backend && pytest tests/test_generator.py -v 2>&1 | head -40
```
Expected: Several tests fail (ImportError or assertion errors).

- [ ] **Step 4.3: Run tests after generator is implemented**

```bash
cd backend && pytest tests/test_generator.py -v
```
Expected: All 9 tests pass.

- [ ] **Step 4.4: Commit tests**

```bash
git add backend/tests/ 
git commit -m "test: xlsx generator test suite (Phase 1)"
```

---

## Phase 2 — PO Counter + FastAPI Shell

### Task 5: PO counter module

**Files:**
- Create: `backend/po_counter.py`

- [ ] **Step 5.1: Write po_counter.py**

```python
# backend/po_counter.py
import fcntl
from pathlib import Path

COUNTER_FILE = Path(__file__).parent / "data" / "po_counter.txt"


def peek_next_po_number() -> str:
    if not COUNTER_FILE.exists():
        COUNTER_FILE.parent.mkdir(parents=True, exist_ok=True)
        COUNTER_FILE.write_text("30")
    n = int(COUNTER_FILE.read_text().strip())
    return f"PO-{n:03d}"


def consume_next_po_number() -> str:
    with open(COUNTER_FILE, "r+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        n = int(f.read().strip())
        f.seek(0)
        f.write(str(n + 1))
        f.truncate()
    return f"PO-{n:03d}"
```

- [ ] **Step 5.2: Verify manually**

```bash
cd backend && python -c "from po_counter import peek_next_po_number, consume_next_po_number; print(peek_next_po_number()); print(consume_next_po_number()); print(peek_next_po_number())"
```
Expected: `PO-030`, `PO-030`, `PO-031` (counter increments on consume).

- [ ] **Step 5.3: Reset counter**

```bash
echo "30" > backend/data/po_counter.txt
```

- [ ] **Step 5.4: Commit**

```bash
git add backend/po_counter.py
git commit -m "feat: PO counter with file locking"
```

---

### Task 6: FastAPI application

**Files:**
- Create: `backend/main.py`

- [ ] **Step 6.1: Write main.py with all three endpoints**

```python
# backend/main.py
import io
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from gemini_extract import extract_from_pdf
from po_counter import consume_next_po_number, peek_next_po_number
from po_generator import generate_po
from schemas import POPayload

app = FastAPI(title="PO Generator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/next-po-number")
def next_po_number():
    return {"po_number": peek_next_po_number()}


@app.post("/api/extract")
async def extract(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    pdf_bytes = await file.read()
    try:
        payload = await extract_from_pdf(pdf_bytes)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Extraction failed: {exc}") from exc
    return payload


@app.post("/api/generate-po")
def generate(payload: POPayload):
    po_number = consume_next_po_number()
    payload.meta.po_number.value = po_number

    vendor_slug = (
        payload.vendor.name.value.lower()
        .replace(" ", "_")
        .replace(".", "")
        .replace(",", "")[:30]
    )
    filename = f"{po_number}_{vendor_slug}.xlsx"

    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = Path(tmpdir) / filename
        generate_po(payload, out_path)
        xlsx_bytes = out_path.read_bytes()

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
```

- [ ] **Step 6.2: Create a stub gemini_extract.py (placeholder so the server starts)**

```python
# backend/gemini_extract.py  — STUB, will be replaced in Phase 3
from schemas import POPayload


async def extract_from_pdf(pdf_bytes: bytes) -> POPayload:
    raise NotImplementedError("Gemini extraction not yet implemented")
```

- [ ] **Step 6.3: Start the server and verify it boots**

```bash
cd backend && uvicorn main:app --reload
```
Expected: `INFO: Application startup complete.` No errors.

- [ ] **Step 6.4: Test the GET endpoint**

```bash
curl http://localhost:8000/api/next-po-number
```
Expected: `{"po_number":"PO-030"}`

- [ ] **Step 6.5: Commit**

```bash
git add backend/main.py backend/gemini_extract.py
git commit -m "feat: FastAPI app with three API endpoints (gemini stub)"
```

---

## Phase 3 — Gemini Extraction

### Task 7: Gemini extraction module

**Files:**
- Modify: `backend/gemini_extract.py` (replace stub)

- [ ] **Step 7.1: Write the real gemini_extract.py**

```python
# backend/gemini_extract.py
import os
from datetime import date, timedelta
from typing import Optional

from google import genai
from google.genai import types
from pydantic import BaseModel

from po_counter import peek_next_po_number
from schemas import (
    FlaggableFloat,
    FlaggableStr,
    LineItem,
    POMeta,
    POPayload,
    VendorBlock,
)

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
   - delivery_date (if the quote states an explicit date, use it as a string; null if not stated)

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


class GeminiLineItem(BaseModel):
    catalog_number: Optional[str] = None
    brand: Optional[str] = None
    description: Optional[str] = None
    qty: Optional[float] = None
    rate: Optional[float] = None
    discount_percent: Optional[float] = None
    gst_percent: Optional[float] = None


class GeminiVendor(BaseModel):
    name: Optional[str] = None
    address_lines: Optional[list[str]] = None
    gst: Optional[str] = None
    contact_line: Optional[str] = None


class GeminiExtractionResult(BaseModel):
    vendor: Optional[GeminiVendor] = None
    ref_number: Optional[str] = None
    delivery_period_days: Optional[int] = None
    delivery_date: Optional[str] = None
    items: Optional[list[GeminiLineItem]] = None


def _flag(value: str | None) -> FlaggableStr:
    if value:
        return FlaggableStr(value=value.strip(), was_found=True)
    return FlaggableStr(value="", was_found=False)


def _flag_float(value: float | None) -> FlaggableFloat:
    if value is not None:
        return FlaggableFloat(value=value, was_found=True)
    return FlaggableFloat(value=None, was_found=False)


async def extract_from_pdf(pdf_bytes: bytes) -> POPayload:
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

    today = date.today()

    # ── Delivery date resolution ──────────────────────────────────────────────
    if extracted.delivery_date:
        delivery_date = FlaggableStr(value=extracted.delivery_date, was_found=True)
    elif extracted.delivery_period_days:
        computed = today + timedelta(days=extracted.delivery_period_days)
        delivery_date = FlaggableStr(
            value=computed.strftime("%d %b %Y"), was_found=True
        )
    else:
        delivery_date = FlaggableStr(value="", was_found=False)

    # ── Vendor block ─────────────────────────────────────────────────────────
    v = extracted.vendor or GeminiVendor()
    address_lines = [_flag(line) for line in (v.address_lines or [])]
    # Ensure at least 2 address line slots
    while len(address_lines) < 2:
        address_lines.append(FlaggableStr(value="", was_found=False))

    vendor = VendorBlock(
        name=_flag(v.name),
        address_lines=address_lines,
        gst=_flag(v.gst),
        contact_line=_flag(v.contact_line),
    )

    # ── Meta block ────────────────────────────────────────────────────────────
    meta = POMeta(
        po_number=FlaggableStr(value=peek_next_po_number(), was_found=False),
        date=FlaggableStr(value=today.strftime("%d %b %Y"), was_found=False),
        payment_terms=FlaggableStr(value="30 days", was_found=False),
        delivery_date=delivery_date,
        ref_number=_flag(extracted.ref_number),
        place_of_supply=FlaggableStr(value="Karnataka", was_found=False),
    )

    # ── Line items ────────────────────────────────────────────────────────────
    items = []
    for gi in (extracted.items or []):
        items.append(
            LineItem(
                catalog_number=_flag(gi.catalog_number),
                brand=_flag(gi.brand),
                description=_flag(gi.description),
                qty=_flag_float(gi.qty),
                rate=_flag_float(gi.rate),
                discount_percent=_flag_float(gi.discount_percent),
                gst_percent=_flag_float(gi.gst_percent),
            )
        )

    return POPayload(meta=meta, vendor=vendor, items=items)
```

- [ ] **Step 7.2: Test extraction with Vasa PDF (requires GEMINI_API_KEY in env)**

```bash
cd backend && python -c "
import asyncio, json, os
from pathlib import Path
from gemini_extract import extract_from_pdf

pdf = Path('../reference/Vasa Sci Quotation.pdf').read_bytes()
result = asyncio.run(extract_from_pdf(pdf))
print(json.dumps(result.model_dump(), indent=2))
"
```
Expected: JSON with vendor name "Vasa Scientific Co.", 5 line items, ref_number "2603122", delivery_date ~14 days from today.

- [ ] **Step 7.3: Test extraction with Bionova PDF**

```bash
cd backend && python -c "
import asyncio, json
from pathlib import Path
from gemini_extract import extract_from_pdf

pdf = Path('../reference/Bionova Quotation.pdf').read_bytes()
result = asyncio.run(extract_from_pdf(pdf))
print(json.dumps(result.model_dump(), indent=2))
"
```
Expected: Items have `discount_percent: 0.0`, `rate` set to the special price.

- [ ] **Step 7.4: Commit**

```bash
git add backend/gemini_extract.py
git commit -m "feat: Gemini 2.5 Flash PDF extraction with flagging"
```

---

## Phase 4 — Frontend

### Task 8: Next.js scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/next.config.js`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.js`
- Create: `frontend/app/globals.css`
- Create: `frontend/app/layout.tsx`

- [ ] **Step 8.1: Bootstrap Next.js project**

```bash
cd frontend && npx create-next-app@latest . --typescript --tailwind --app --no-src-dir --no-import-alias --eslint
```
When prompted, answer: Yes to App Router, No to src directory, No to import alias.

- [ ] **Step 8.2: Add brand variables to globals.css**

Open `frontend/app/globals.css` and add inside `:root`:

```css
:root {
  --accent: #38AFD8;
  --accent-dark: #2A8BAD;
}
```

- [ ] **Step 8.3: Create .env.local**

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- [ ] **Step 8.4: Verify dev server starts**

```bash
cd frontend && npm run dev
```
Open http://localhost:3000. Expected: Next.js default page loads.

- [ ] **Step 8.5: Commit scaffold**

```bash
git add frontend/
git commit -m "chore: Next.js 14 app scaffold with Tailwind"
```

---

### Task 9: TypeScript types and API client

**Files:**
- Create: `frontend/lib/types.ts`
- Create: `frontend/lib/api.ts`

- [ ] **Step 9.1: Write types.ts (mirrors backend schemas.py)**

```typescript
// frontend/lib/types.ts

export interface FlaggableStr {
  value: string;
  was_found: boolean;
}

export interface FlaggableFloat {
  value: number | null;
  was_found: boolean;
}

export interface LineItem {
  catalog_number: FlaggableStr;
  brand: FlaggableStr;
  description: FlaggableStr;
  qty: FlaggableFloat;
  rate: FlaggableFloat;
  discount_percent: FlaggableFloat;
  gst_percent: FlaggableFloat;
}

export interface VendorBlock {
  name: FlaggableStr;
  address_lines: FlaggableStr[];
  gst: FlaggableStr;
  contact_line: FlaggableStr;
}

export interface POMeta {
  po_number: FlaggableStr;
  date: FlaggableStr;
  payment_terms: FlaggableStr;
  delivery_date: FlaggableStr;
  ref_number: FlaggableStr;
  place_of_supply: FlaggableStr;
  po_revision: FlaggableStr;
  po_type: FlaggableStr;
  inco_terms: FlaggableStr;
  dispatch_instructions: FlaggableStr;
}

export interface POPayload {
  meta: POMeta;
  vendor: VendorBlock;
  items: LineItem[];
  prepared_by: string;
  authorized_signature: string;
}
```

- [ ] **Step 9.2: Write api.ts**

```typescript
// frontend/lib/api.ts
import { POPayload } from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function getNextPoNumber(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/next-po-number`);
  if (!res.ok) throw new Error("Failed to fetch PO number");
  const data = await res.json();
  return data.po_number as string;
}

export async function extractFromPdf(file: File): Promise<POPayload> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_URL}/api/extract`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? "Extraction failed");
  }
  return res.json() as Promise<POPayload>;
}

export async function generatePo(payload: POPayload): Promise<Blob> {
  const res = await fetch(`${BASE_URL}/api/generate-po`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? "Generation failed");
  }
  return res.blob();
}
```

- [ ] **Step 9.3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 9.4: Commit**

```bash
git add frontend/lib/
git commit -m "feat: TypeScript types and typed API client"
```

---

### Task 10: FieldWithFlag component

**Files:**
- Create: `frontend/components/FieldWithFlag.tsx`

- [ ] **Step 10.1: Write FieldWithFlag.tsx**

```tsx
// frontend/components/FieldWithFlag.tsx
"use client";
import { useState } from "react";

interface Props {
  label: string;
  value: string;
  wasFound: boolean;
  onChange: (v: string, nowFound: boolean) => void;
  helpText?: string;
  multiline?: boolean;
}

export default function FieldWithFlag({
  label,
  value,
  wasFound,
  onChange,
  helpText,
  multiline = false,
}: Props) {
  const flagged = !wasFound;

  const inputClasses = [
    "w-full rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400",
    flagged
      ? "border-yellow-400 bg-yellow-50"
      : "border-gray-300 bg-white",
  ].join(" ");

  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs font-medium text-gray-600">{label}</label>
      {multiline ? (
        <textarea
          className={inputClasses}
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value, true)}
        />
      ) : (
        <input
          type="text"
          className={inputClasses}
          value={value}
          onChange={(e) => onChange(e.target.value, true)}
        />
      )}
      {flagged && (
        <p className="text-xs text-yellow-700">
          ⚠ Not found in quotation — please fill manually
        </p>
      )}
      {helpText && !flagged && (
        <p className="text-xs text-gray-400">{helpText}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 10.2: Commit**

```bash
git add frontend/components/FieldWithFlag.tsx
git commit -m "feat: FieldWithFlag component with yellow flag for missing fields"
```

---

### Task 11: UploadStep component

**Files:**
- Create: `frontend/components/UploadStep.tsx`

- [ ] **Step 11.1: Write UploadStep.tsx**

```tsx
// frontend/components/UploadStep.tsx
"use client";
import { useState, useRef, DragEvent } from "react";

interface Props {
  onExtracted: (payload: import("../lib/types").POPayload) => void;
}

export default function UploadStep({ onExtracted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") setFile(f);
  }

  async function handleExtract() {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const { extractFromPdf } = await import("../lib/api");
      const payload = await extractFromPdf(file);
      onExtracted(payload);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 py-16">
      <h1 className="text-2xl font-semibold text-gray-800">
        BIOAI PO Generator
      </h1>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          "w-full max-w-md cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition",
          dragging ? "border-sky-400 bg-sky-50" : "border-gray-300 hover:border-sky-300",
        ].join(" ")}
      >
        <p className="text-gray-500">
          {file ? (
            <span className="font-medium text-gray-800">
              {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </span>
          ) : (
            "Drag & drop a PDF quotation here, or click to browse"
          )}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && (
        <p className="max-w-md text-sm text-red-600">{error}</p>
      )}

      <button
        onClick={handleExtract}
        disabled={!file || loading}
        className="rounded-lg bg-sky-500 px-8 py-2.5 font-medium text-white hover:bg-sky-600 disabled:opacity-50"
      >
        {loading ? "Extracting…" : "Extract"}
      </button>
    </div>
  );
}
```

- [ ] **Step 11.2: Commit**

```bash
git add frontend/components/UploadStep.tsx
git commit -m "feat: UploadStep with drag-and-drop and extract button"
```

---

### Task 12: ItemsTable component

**Files:**
- Create: `frontend/components/ItemsTable.tsx`

- [ ] **Step 12.1: Write ItemsTable.tsx**

```tsx
// frontend/components/ItemsTable.tsx
"use client";
import { LineItem } from "../lib/types";

interface Props {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
}

function disRate(item: LineItem): number {
  const rate = item.rate.value ?? 0;
  const dis = item.discount_percent.value ?? 0;
  const qty = item.qty.value ?? 0;
  return rate * (1 - dis / 100) * qty;
}

function amtIncGst(item: LineItem): number {
  const gst = item.gst_percent.value ?? 0;
  return disRate(item) * (1 + gst / 100);
}

function flagCell(wasFound: boolean) {
  return wasFound
    ? "border border-gray-200 px-1 py-0.5"
    : "border border-yellow-400 bg-yellow-50 px-1 py-0.5";
}

export default function ItemsTable({ items, onChange }: Props) {
  function update<K extends keyof LineItem>(
    idx: number,
    field: K,
    value: LineItem[K]
  ) {
    const next = [...items];
    next[idx] = { ...next[idx], [field]: value };
    onChange(next);
  }

  function updateFlagStr(idx: number, field: keyof LineItem, value: string) {
    update(idx, field, { value, was_found: true } as never);
  }

  function updateFlagFloat(idx: number, field: keyof LineItem, value: string) {
    update(idx, field, { value: value === "" ? null : parseFloat(value), was_found: true } as never);
  }

  const total = items.reduce((sum, item) => sum + amtIncGst(item), 0);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100 text-gray-600 text-xs">
            {["#", "Catalog #", "Brand", "Description", "Qty", "Rate", "Dis %", "GST %", "Dis Rate", "Amt inc GST"].map((h) => (
              <th key={h} className="border border-gray-200 px-2 py-1 text-left whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx} className="hover:bg-gray-50">
              <td className="border border-gray-200 px-2 py-1 text-center">{idx + 1}</td>
              <td className="border border-gray-200 p-0">
                <input
                  className={`w-24 ${flagCell(item.catalog_number.was_found)}`}
                  value={item.catalog_number.value}
                  onChange={(e) => updateFlagStr(idx, "catalog_number", e.target.value)}
                />
              </td>
              <td className="border border-gray-200 p-0">
                <input
                  className={`w-24 ${flagCell(item.brand.was_found)}`}
                  value={item.brand.value}
                  onChange={(e) => updateFlagStr(idx, "brand", e.target.value)}
                />
              </td>
              <td className="border border-gray-200 p-0">
                <input
                  className={`w-64 ${flagCell(item.description.was_found)}`}
                  value={item.description.value}
                  onChange={(e) => updateFlagStr(idx, "description", e.target.value)}
                />
              </td>
              <td className="border border-gray-200 p-0">
                <input
                  type="number"
                  className={`w-16 ${flagCell(item.qty.was_found)}`}
                  value={item.qty.value ?? ""}
                  onChange={(e) => updateFlagFloat(idx, "qty", e.target.value)}
                />
              </td>
              <td className="border border-gray-200 p-0">
                <input
                  type="number"
                  className={`w-20 ${flagCell(item.rate.was_found)}`}
                  value={item.rate.value ?? ""}
                  onChange={(e) => updateFlagFloat(idx, "rate", e.target.value)}
                />
              </td>
              <td className="border border-gray-200 p-0">
                <input
                  type="number"
                  className={`w-16 ${flagCell(item.discount_percent.was_found)}`}
                  value={item.discount_percent.value ?? ""}
                  onChange={(e) => updateFlagFloat(idx, "discount_percent", e.target.value)}
                />
              </td>
              <td className="border border-gray-200 p-0">
                <input
                  type="number"
                  className={`w-16 ${flagCell(item.gst_percent.was_found)}`}
                  value={item.gst_percent.value ?? ""}
                  onChange={(e) => updateFlagFloat(idx, "gst_percent", e.target.value)}
                />
              </td>
              <td className="border border-gray-200 px-2 py-1 text-right font-mono">
                {disRate(item).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </td>
              <td className="border border-gray-200 px-2 py-1 text-right font-mono">
                {amtIncGst(item).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 font-semibold">
            <td colSpan={9} className="border border-gray-200 px-2 py-1 text-right">
              Total
            </td>
            <td className="border border-gray-200 px-2 py-1 text-right font-mono">
              ₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
```

- [ ] **Step 12.2: Commit**

```bash
git add frontend/components/ItemsTable.tsx
git commit -m "feat: editable items table with live Dis Rate and Amt inc GST preview"
```

---

### Task 13: ReviewForm component

**Files:**
- Create: `frontend/components/ReviewForm.tsx`

- [ ] **Step 13.1: Write ReviewForm.tsx**

```tsx
// frontend/components/ReviewForm.tsx
"use client";
import { useState } from "react";
import { POPayload, FlaggableStr, FlaggableFloat } from "../lib/types";
import FieldWithFlag from "./FieldWithFlag";
import ItemsTable from "./ItemsTable";

interface Props {
  initialPayload: POPayload;
  onGenerated: (blob: Blob, filename: string) => void;
}

export default function ReviewForm({ initialPayload, onGenerated }: Props) {
  const [payload, setPayload] = useState<POPayload>(initialPayload);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setMeta(key: keyof POPayload["meta"], value: string, wasFound: boolean) {
    setPayload((prev) => ({
      ...prev,
      meta: {
        ...prev.meta,
        [key]: { value, was_found: wasFound } satisfies FlaggableStr,
      },
    }));
  }

  function setVendorStr(key: keyof Omit<POPayload["vendor"], "address_lines">, value: string) {
    setPayload((prev) => ({
      ...prev,
      vendor: { ...prev.vendor, [key]: { value, was_found: true } satisfies FlaggableStr },
    }));
  }

  function setAddressLine(idx: number, value: string) {
    setPayload((prev) => {
      const lines = [...prev.vendor.address_lines];
      lines[idx] = { value, was_found: true };
      return { ...prev, vendor: { ...prev.vendor, address_lines: lines } };
    });
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const { generatePo } = await import("../lib/api");
      const blob = await generatePo(payload);
      const vendorSlug = payload.vendor.name.value
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 30);
      onGenerated(blob, `${payload.meta.po_number.value}_${vendorSlug}.xlsx`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const m = payload.meta;
  const v = payload.vendor;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-gray-800">Review & Edit Purchase Order</h2>

      {/* PO Metadata */}
      <section className="rounded-xl border border-gray-200 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">PO Metadata</h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {(["po_number","date","payment_terms","delivery_date","ref_number","place_of_supply","po_revision","po_type","inco_terms","dispatch_instructions"] as const).map((key) => (
            <FieldWithFlag
              key={key}
              label={key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
              value={m[key].value}
              wasFound={m[key].was_found}
              onChange={(v, f) => setMeta(key, v, f)}
            />
          ))}
        </div>
      </section>

      {/* Vendor */}
      <section className="rounded-xl border border-gray-200 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Vendor</h3>
        <div className="grid grid-cols-2 gap-4">
          <FieldWithFlag label="Name" value={v.name.value} wasFound={v.name.was_found} onChange={(val) => setVendorStr("name", val)} />
          <FieldWithFlag label="GST" value={v.gst.value} wasFound={v.gst.was_found} onChange={(val) => setVendorStr("gst", val)} />
          <FieldWithFlag label="Contact" value={v.contact_line.value} wasFound={v.contact_line.was_found} onChange={(val) => setVendorStr("contact_line", val)} />
          {v.address_lines.map((line, i) => (
            <FieldWithFlag
              key={i}
              label={`Address Line ${i + 1}`}
              value={line.value}
              wasFound={line.was_found}
              onChange={(val) => setAddressLine(i, val)}
            />
          ))}
        </div>
      </section>

      {/* Items */}
      <section className="rounded-xl border border-gray-200 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Line Items</h3>
        <ItemsTable
          items={payload.items}
          onChange={(items) => setPayload((prev) => ({ ...prev, items }))}
        />
      </section>

      {/* Footer */}
      <section className="rounded-xl border border-gray-200 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Signatories</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-medium text-gray-600">Prepared By</label>
            <input className="w-full rounded border border-gray-300 px-2 py-1 text-sm" value={payload.prepared_by}
              onChange={(e) => setPayload((prev) => ({ ...prev, prepared_by: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-xs font-medium text-gray-600">Authorized Signature</label>
            <input className="w-full rounded border border-gray-300 px-2 py-1 text-sm" value={payload.authorized_signature}
              onChange={(e) => setPayload((prev) => ({ ...prev, authorized_signature: e.target.value }))} />
          </div>
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="self-start rounded-lg bg-sky-500 px-8 py-2.5 font-medium text-white hover:bg-sky-600 disabled:opacity-50"
      >
        {loading ? "Generating…" : "Generate PO"}
      </button>
    </div>
  );
}
```

- [ ] **Step 13.2: Commit**

```bash
git add frontend/components/ReviewForm.tsx
git commit -m "feat: ReviewForm component with all PO sections editable"
```

---

### Task 14: Main page (`app/page.tsx`)

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 14.1: Write page.tsx**

```tsx
// frontend/app/page.tsx
"use client";
import { useState } from "react";
import { POPayload } from "../lib/types";
import UploadStep from "../components/UploadStep";
import ReviewForm from "../components/ReviewForm";

type Stage = "upload" | "review" | "done";

export default function Home() {
  const [stage, setStage] = useState<Stage>("upload");
  const [payload, setPayload] = useState<POPayload | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string>("");

  function handleExtracted(p: POPayload) {
    setPayload(p);
    setStage("review");
  }

  function handleGenerated(blob: Blob, fname: string) {
    const url = URL.createObjectURL(blob);
    setDownloadUrl(url);
    setFilename(fname);
    // Trigger download automatically
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.click();
    setStage("done");
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {stage === "upload" && <UploadStep onExtracted={handleExtracted} />}
      {stage === "review" && payload && (
        <ReviewForm initialPayload={payload} onGenerated={handleGenerated} />
      )}
      {stage === "done" && (
        <div className="flex flex-col items-center gap-4 py-16">
          <p className="text-green-700 font-medium text-lg">✓ PO generated!</p>
          <a href={downloadUrl ?? "#"} download={filename}
            className="text-sky-600 underline text-sm">
            Download again: {filename}
          </a>
          <button
            onClick={() => { setStage("upload"); setPayload(null); setDownloadUrl(null); }}
            className="mt-4 rounded-lg border border-gray-300 px-6 py-2 text-sm hover:bg-gray-100"
          >
            Generate another PO
          </button>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 14.2: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 14.3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat: main page with upload → review → done flow"
```

---

## Phase 5 — Polish & Error Handling

### Task 15: Backend robustness

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/po_generator.py`

- [ ] **Step 15.1: Add validation to generate endpoint**

In `backend/main.py`, add before calling `generate_po`:

```python
# In the generate() function, after setting po_number:
errors = []
if not payload.meta.delivery_date.value:
    errors.append("delivery_date is required")
if not payload.vendor.name.value:
    errors.append("vendor name is required")
if not payload.items:
    errors.append("at least one line item is required")
for i, item in enumerate(payload.items):
    if not item.description.value:
        errors.append(f"item {i+1} description is required")
    if item.qty.value is None:
        errors.append(f"item {i+1} qty is required")
    if item.rate.value is None:
        errors.append(f"item {i+1} rate is required")
if errors:
    raise HTTPException(status_code=422, detail="; ".join(errors))
```

- [ ] **Step 15.2: Handle address_lines edge cases in po_generator.py**

In `generate_po`, the address_lines write should safely handle 0, 1, or 3+ lines without crashing:

Ensure the vendor address block write in `po_generator.py` looks like:
```python
address_lines = [fl.value for fl in vendor.address_lines]
ws["A6"] = address_lines[0] if len(address_lines) > 0 else ""
ws["A7"] = address_lines[1] if len(address_lines) > 1 else ""
# A8 is GST — don't overwrite with address_line[2]
```
(This is already in the original po_generator.py in Task 3 — verify it's correct and not overwriting A8.)

- [ ] **Step 15.3: Commit**

```bash
git add backend/main.py backend/po_generator.py
git commit -m "fix: validation on generate endpoint and address_lines edge cases"
```

---

### Task 16: End-to-end smoke test

- [ ] **Step 16.1: Start both servers**

Terminal 1:
```bash
cd backend && uvicorn main:app --reload
```

Terminal 2:
```bash
cd frontend && npm run dev
```

- [ ] **Step 16.2: Test Vasa flow**

1. Open http://localhost:3000
2. Upload `reference/Vasa Sci Quotation.pdf`
3. Click Extract — wait ~5–10 seconds
4. Verify:
   - 5 line items populated
   - Vendor: "Vasa Scientific Co."
   - Ref#: "2603122" (green — found)
   - Delivery Date: today+14 days (green — computed from "2 WEEKS")
   - PO#: "PO-030" (yellow — auto-generated, not from PDF)
   - Payment Terms: "30 days" (yellow — default)
   - Place of Supply: "Karnataka" (yellow — default)
5. Click Generate PO
6. Verify download: `PO-030_vasa_scientific_co.xlsx`
7. Open in Excel/LibreOffice: structure matches PO-027, formulas compute, total is correct

- [ ] **Step 16.3: Test Bionova flow**

```bash
echo "30" > backend/data/po_counter.txt  # reset for clean test
```

1. Upload `reference/Bionova Quotation.pdf`
2. Click Extract
3. Verify: items have `discount_percent = 0`, `rate` = quoted unit price
4. Click Generate PO → PO-030 downloads with Bionova data
5. Reset counter back to 31 after test:
```bash
echo "31" > backend/data/po_counter.txt
```

- [ ] **Step 16.4: Test PO# auto-increment**

1. Upload any PDF, extract, generate → PO-031 downloads
2. Repeat → PO-032
3. Verify `backend/data/po_counter.txt` contains the next number

- [ ] **Step 16.5: Commit final state**

```bash
git add -u
git commit -m "feat: complete PO generator — end-to-end Vasa and Bionova validated"
```

---

## Self-Review Checklist

### Spec coverage

| Requirement | Task(s) |
|---|---|
| PDF upload → Gemini extract | Task 7, 11 |
| Missing fields flagged yellow with ⚠ | Task 10, 13 |
| User edits clear yellow flag | Task 10 (onChange flips was_found) |
| PO# auto-suggested (not incremented until Generate) | Task 5, 6 |
| Generate produces .xlsx matching PO-027 | Task 3, 4 |
| Dynamic item rows (insert/delete) | Task 3 |
| Standardized I-column formula with *F | Task 3 (documented) |
| Total row SUM formula updates | Task 3 |
| Deliver-To block fixed from JSON | Task 1, 3 |
| Bionova: discount_percent=0, rate=special price | Task 7 |
| Delivery date computed from delivery_period_days | Task 7 |
| Counter file locked against concurrent writes | Task 5 |
| CORS configured for localhost:3000 | Task 6 |
| Acceptance criteria 1–10 | Task 16 |

### No placeholders — all code is complete in tasks above.

### Type consistency check

- `FlaggableStr`, `FlaggableFloat` defined in Task 2 (Python) and Task 9 (TypeScript) — consistent.
- `generate_po(payload: POPayload, output_path: Path)` — defined in Task 3, called in Task 6 with matching signature.
- `extract_from_pdf(pdf_bytes: bytes) -> POPayload` — stub in Task 6, real in Task 7.
- `peek_next_po_number()` / `consume_next_po_number()` — defined Task 5, used in Task 6 and Task 7.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-16-po-generator.md`.**
