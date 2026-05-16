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
