# backend/main.py
import io
import tempfile
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

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
    errors = []
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
