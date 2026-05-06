#!/usr/bin/env python3
"""
generate_qr_codes.py — QR code generator for the Frat Chore system.

Usage:
    python generate_qr_codes.py

You will be prompted for your Apps Script deployment URL.
QR code PNGs are saved to qr/output/ and a printable PDF to qr/output/all_qr_codes.pdf.

Required packages:
    pip install qrcode[pil] Pillow reportlab
"""

import os
import re
import sys
import json
from pathlib import Path
from urllib.parse import quote

try:
    import qrcode
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Missing dependency. Run:  pip install qrcode[pil] Pillow")

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas as rl_canvas
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False
    print("WARNING: reportlab not installed — PDF will be skipped.")
    print("         Install with:  pip install reportlab")

# ---- Configuration ------------------------------------------

# Chores list (mirrors chore_ratios.json)
CHORES = [
    "Monday Lunch Setup",
    "Monday Lunch Cleanup",
    "Monday Dinner Setup",
    "Monday Dinner Cleanup",
    "Tuesday Lunch Setup",
    "Tuesday Lunch Cleanup",
    "Tuesday Dinner Setup",
    "Tuesday Dinner Cleanup",
    "Wednesday Lunch Setup",
    "Wednesday Lunch Cleanup",
    "Wednesday Dinner Setup",
    "Wednesday Dinner Cleanup",
    "Thursday Lunch Setup",
    "Thursday Lunch Cleanup",
    "Thursday Dinner Setup",
    "Thursday Dinner Cleanup",
    "Friday Lunch Setup",
    "Friday Lunch Cleanup",
    "Monday Mail",
    "Wednesday Mail",
    "Friday Mail",
    "Chapter Setup/Cleanup",
    "Living Room/Chapter Room Cleanup",
    "Basement",
    "Brotherhood Kitchen",
    "1F Restrooms",
    "2F Restrooms",
    "3F Restrooms",
    "3rd Floor",
    "Laundry Room",
    "Outside",
]

OUTPUT_DIR = Path(__file__).parent / "output"
CONFIG_PATH = Path(__file__).parent.parent / "config" / "settings.json"

# QR code visual settings
QR_BOX_SIZE    = 10      # pixels per module
QR_BORDER      = 4       # quiet zone in modules
QR_ERROR_LEVEL = qrcode.constants.ERROR_CORRECT_H
CARD_WIDTH     = 400     # final PNG width in pixels
LABEL_FONT_SIZE = 18     # chore name label below QR


def load_deployment_id() -> str:
    """Try to read deployment ID from settings.json; fall back to prompt."""
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH) as f:
                cfg = json.load(f)
            did = cfg.get("deployment_id", "")
            if did and did != "YOUR_APPS_SCRIPT_DEPLOYMENT_ID":
                return did
        except Exception:
            pass
    return ""


def get_deployment_url() -> str:
    """Get the deployment base URL from the user."""
    existing = load_deployment_id()
    if existing:
        print(f"\nFound deployment_id in settings.json:\n  {existing}")
        use_it = input("Use this? (Y/n): ").strip().lower()
        if use_it != 'n':
            return f"https://script.google.com/macros/s/{existing}/exec"

    print("\nPaste your Apps Script web app URL.")
    print("It looks like:  https://script.google.com/macros/s/AKfycbXXXX.../exec")
    print("(Run 'Generate QR Codes' from the Chore System menu in Sheets to get it)\n")
    url = input("Deployment URL: ").strip()
    if not url:
        sys.exit("No URL provided.")
    return url.rstrip('/')


def chore_to_filename(chore: str) -> str:
    """Convert chore name to safe filename."""
    safe = re.sub(r'[^A-Za-z0-9]+', '_', chore).strip('_').lower()
    return f"{safe}.qr.png"


def make_qr_image(url: str, chore: str) -> Image.Image:
    """Generate a QR code PNG with the chore name labeled below it."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=QR_ERROR_LEVEL,
        box_size=QR_BOX_SIZE,
        border=QR_BORDER,
    )
    qr.add_data(url)
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="#003087", back_color="white").convert("RGB")

    # Add labeled banner below the QR
    qr_w, qr_h = qr_img.size
    banner_h = 60
    total_h  = qr_h + banner_h

    final = Image.new("RGB", (qr_w, total_h), "white")
    final.paste(qr_img, (0, 0))

    draw = ImageDraw.Draw(final)

    # Try to use a decent font; fall back to default
    font = None
    font_bold = None
    for font_path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]:
        if os.path.exists(font_path):
            try:
                font      = ImageFont.truetype(font_path, LABEL_FONT_SIZE)
                font_bold = ImageFont.truetype(font_path, LABEL_FONT_SIZE)
                break
            except Exception:
                pass
    if font is None:
        font = font_bold = ImageFont.load_default()

    # Center the chore name text
    # Pillow ≥ 10 uses textlength; older uses textsize
    try:
        text_w = draw.textlength(chore, font=font)
    except AttributeError:
        text_w, _ = draw.textsize(chore, font=font)

    x = max(0, (qr_w - text_w) / 2)
    y = qr_h + 10

    # Gold background strip
    draw.rectangle([(0, qr_h), (qr_w, total_h)], fill="#FFD700")
    draw.text((x, y), chore, fill="#003087", font=font)

    return final


def generate_all_qrs(base_url: str) -> list[Path]:
    """Generate one QR PNG per chore. Returns list of paths."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    generated = []

    for chore in CHORES:
        encoded_chore = quote(chore)
        url = f"{base_url}?app=submit&chore={encoded_chore}"
        img = make_qr_image(url, chore)

        out_path = OUTPUT_DIR / chore_to_filename(chore)
        img.save(str(out_path), "PNG", dpi=(150, 150))
        generated.append(out_path)
        print(f"  ✓  {chore}")

    return generated


def generate_pdf(image_paths: list[Path]) -> None:
    """Generate a printable PDF with all QR codes in a grid."""
    if not REPORTLAB_AVAILABLE:
        return

    pdf_path = OUTPUT_DIR / "all_qr_codes.pdf"
    c = rl_canvas.Canvas(str(pdf_path), pagesize=letter)
    page_w, page_h = letter

    # Grid: 2 columns × 4 rows per page
    cols, rows_per_page = 2, 4
    margin  = 0.5 * inch
    cell_w  = (page_w - 2 * margin) / cols
    cell_h  = (page_h - 2 * margin) / rows_per_page
    qr_size = min(cell_w, cell_h) * 0.80  # QR image takes 80% of cell

    page_num = 0
    for idx, img_path in enumerate(image_paths):
        if idx % (cols * rows_per_page) == 0:
            if idx > 0:
                c.showPage()
            page_num += 1
            # Page header
            c.setFont("Helvetica-Bold", 14)
            c.setFillColorRGB(0, 0.188, 0.529)
            c.drawCentredString(page_w / 2, page_h - margin + 12,
                                "Chore QR Codes — Print & Laminate")
            c.setFont("Helvetica", 10)
            c.setFillColorRGB(0.4, 0.4, 0.4)
            c.drawCentredString(page_w / 2, page_h - margin - 4,
                                f"Scan with phone to submit your chore photo")

        slot    = idx % (cols * rows_per_page)
        col_idx = slot % cols
        row_idx = slot // cols

        x0 = margin + col_idx * cell_w + (cell_w - qr_size) / 2
        y0 = page_h - margin - (row_idx + 1) * cell_h + (cell_h - qr_size) / 2 + 16

        # Draw QR image
        c.drawImage(str(img_path), x0, y0, width=qr_size, height=qr_size,
                    preserveAspectRatio=True, mask='auto')

        # Draw chore name below
        chore_name = CHORES[idx]
        c.setFont("Helvetica-Bold", 9)
        c.setFillColorRGB(0, 0.188, 0.529)
        c.drawCentredString(x0 + qr_size / 2, y0 - 14, chore_name)

        # Light border around cell
        c.setStrokeColorRGB(0.85, 0.85, 0.85)
        c.setLineWidth(0.5)
        c.rect(margin + col_idx * cell_w + 4,
               page_h - margin - (row_idx + 1) * cell_h + 4,
               cell_w - 8, cell_h - 8)

    c.save()
    print(f"\nPDF saved → {pdf_path}")


def main():
    print("=" * 55)
    print("  Frat Chore System — QR Code Generator")
    print("=" * 55)

    base_url = get_deployment_url()
    print(f"\nBase URL: {base_url}")
    print(f"\nGenerating {len(CHORES)} QR codes...")

    paths = generate_all_qrs(base_url)

    print(f"\nAll QR codes saved to:  {OUTPUT_DIR}/")

    if REPORTLAB_AVAILABLE:
        print("Generating printable PDF...")
        generate_pdf(paths)
    else:
        print("\nSkipping PDF (reportlab not installed).")

    print("\nDone! Print, laminate, and post the QR codes in each chore area.")
    print("Members scan them to submit their weekly photo proof.")


if __name__ == "__main__":
    main()
