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

    # Delivery date resolution
    if extracted.delivery_date:
        delivery_date = FlaggableStr(value=extracted.delivery_date, was_found=True)
    elif extracted.delivery_period_days:
        computed = today + timedelta(days=extracted.delivery_period_days)
        delivery_date = FlaggableStr(value=computed.strftime("%d %b %Y"), was_found=True)
    else:
        delivery_date = FlaggableStr(value="", was_found=False)

    # Vendor block
    v = extracted.vendor or GeminiVendor()
    address_lines = [_flag(line) for line in (v.address_lines or [])]
    while len(address_lines) < 2:
        address_lines.append(FlaggableStr(value="", was_found=False))

    vendor = VendorBlock(
        name=_flag(v.name),
        address_lines=address_lines,
        gst=_flag(v.gst),
        contact_line=_flag(v.contact_line),
    )

    meta = POMeta(
        po_number=FlaggableStr(value=peek_next_po_number(), was_found=False),
        date=FlaggableStr(value=today.strftime("%d %b %Y"), was_found=False),
        payment_terms=FlaggableStr(value="30 days", was_found=False),
        delivery_date=delivery_date,
        ref_number=_flag(extracted.ref_number),
        place_of_supply=FlaggableStr(value="Karnataka", was_found=False),
    )

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
