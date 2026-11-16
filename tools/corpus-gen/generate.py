import argparse
import hashlib
import io
import json
import os
import re
import zipfile
from datetime import datetime

import docx
import openpyxl
import pptx
from docx.shared import Inches
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.comments import Comment
from openpyxl.drawing.image import Image as XlImage
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches as PInches
from PIL import Image

FIXED = datetime(2020, 1, 1, 0, 0, 0)
WORDS = ["alpha", "ledger", "harbor", "quarter", "signal", "margin", "vector", "summit", "copper", "lantern", "meadow", "thread", "anchor", "cipher", "ember", "fabric"]


def words(seed, count):
    out = []
    state = seed * 2654435761 % 4294967296
    for _ in range(count):
        state = (state * 1664525 + 1013904223) % 4294967296
        out.append(WORDS[(state >> 24) % len(WORDS)])
    return " ".join(out)


def png(seed):
    image = Image.new("RGB", (64, 48), ((seed * 37) % 256, (seed * 91) % 256, (seed * 53) % 256))
    for x in range(0, 64, 8):
        for y in range(0, 48, 8):
            if (x + y) // 8 % 2 == 0:
                image.putpixel((x, y), (255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer


def pin(name, data):
    if name == "word/comments.xml":
        return re.sub(rb'w:date="[^"]*"', b'w:date="2020-01-01T00:00:00Z"', data)
    if name == "docProps/core.xml":
        return re.sub(rb"(<dcterms:(created|modified)[^>]*>)[^<]*(</dcterms:(created|modified)>)", rb"\g<1>2020-01-01T00:00:00Z\g<3>", data)
    return data


def normalize_bytes(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as source:
        items = [(info.filename, source.read(info.filename)) for info in source.infolist()]
    pinned = []
    for name, data in items:
        if re.search(r"embeddings/[^/]+\.xlsx$", name):
            data = normalize_bytes(data)
        pinned.append((name, pin(name, data)))
    pinned.sort(key=lambda item: (item[0] != "[Content_Types].xml", item[0] != "_rels/.rels", item[0]))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for name, data in pinned:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            target.writestr(info, data)
    return out.getvalue()


def normalize(path):
    with open(path, "rb") as handle:
        raw = handle.read()
    with open(path, "wb") as handle:
        handle.write(normalize_bytes(raw))


def set_core(properties, author):
    properties.author = author
    properties.last_modified_by = author
    properties.created = FIXED
    properties.modified = FIXED


def make_docx(out, n):
    document = docx.Document()
    set_core(document.core_properties, "Seam corpus")
    document.add_heading(f"Quarterly notes {n}", level=1)
    for i in range(6):
        document.add_paragraph(words(n * 10 + i, 40))
    features = []
    if n % 6 == 0:
        document.add_paragraph("Plain document with headings and a list.")
        for i in range(5):
            document.add_paragraph(words(n + i, 6), style="List Bullet")
    elif n % 6 == 1:
        table = document.add_table(rows=4, cols=3)
        table.style = "Table Grid"
        for r in range(4):
            for c in range(3):
                table.cell(r, c).text = words(r * 3 + c + n, 2)
        document.add_picture(png(n), width=Inches(1.5))
    elif n % 6 == 2:
        section = document.sections[0]
        section.header.paragraphs[0].text = f"Header {n}"
        section.footer.paragraphs[0].text = f"Footer {n}"
        document.add_page_break()
        document.add_paragraph(words(n, 50))
    elif n % 6 == 3:
        paragraph = document.add_paragraph(words(n, 12))
        document.add_comment(paragraph.runs, text=f"Review comment {n}", author="Reviewer", initials="RV")
        features.append("comments")
    elif n % 6 == 4:
        paragraph = document.add_paragraph()
        for i in range(8):
            run = paragraph.add_run(words(n + i, 3) + " ")
            run.bold = i % 2 == 0
            run.italic = i % 3 == 0
    else:
        document.add_heading("Appendix", level=2)
        for i in range(3):
            document.add_paragraph(words(n + 40 + i, 60))
        document.add_picture(png(n + 1), width=Inches(1))
    path = os.path.join(out, f"python-docx-{n:02d}.docx")
    document.save(path)
    normalize(path)
    return path, "docx", "docx", f"python-docx {docx.__version__}", features


def make_xlsx(out, n):
    book = openpyxl.Workbook()
    book.properties.creator = "Seam corpus"
    book.properties.lastModifiedBy = "Seam corpus"
    book.properties.created = FIXED
    book.properties.modified = FIXED
    sheet = book.active
    sheet.title = "Data"
    sheet.append(["Item", "Qty", "Price", "Total"])
    for i in range(2, 22):
        sheet.append([words(n + i, 1), (i * 7 + n) % 50, round(((i * 13 + n) % 90) / 3 + 1, 2), f"=B{i}*C{i}"])
    features = []
    kind = n % 6
    if kind == 0:
        chart = BarChart()
        chart.title = f"Quantity {n}"
        chart.add_data(Reference(sheet, min_col=2, min_row=1, max_row=21), titles_from_data=True)
        chart.set_categories(Reference(sheet, min_col=1, min_row=2, max_row=21))
        sheet.add_chart(chart, "F2")
        features.append("charts")
    elif kind == 1:
        sheet["A1"].comment = Comment(f"Header note {n}", "Seam")
        sheet["B2"].comment = Comment("Check this value", "Reviewer")
        features.append("comments")
    elif kind == 2:
        validation = DataValidation(type="whole", operator="between", formula1=0, formula2=100)
        sheet.add_data_validation(validation)
        validation.add("B2:B21")
        sheet.merge_cells("F1:H1")
        sheet["F1"] = "Merged heading"
        sheet.conditional_formatting.add("C2:C21", CellIsRule(operator="greaterThan", formula=["20"], fill=PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")))
    elif kind == 3:
        second = book.create_sheet("Notes")
        for i in range(1, 12):
            second.append([words(n + i, 4), i])
        chart = LineChart()
        chart.add_data(Reference(second, min_col=2, min_row=1, max_row=11), titles_from_data=False)
        second.add_chart(chart, "D2")
        features.append("charts")
    elif kind == 4:
        sheet.add_image(XlImage(png(n)), "F2")
        for cell in sheet[1]:
            cell.font = Font(bold=True)
    else:
        from openpyxl.worksheet.table import Table, TableStyleInfo
        table = Table(displayName=f"Items{n}", ref="A1:D21")
        table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
        sheet.add_table(table)
    path = os.path.join(out, f"openpyxl-{n:02d}.xlsx")
    book.save(path)
    normalize(path)
    return path, "xlsx", "xlsx", f"openpyxl {openpyxl.__version__}", features


def make_pptx(out, n):
    deck = pptx.Presentation()
    set_core(deck.core_properties, "Seam corpus")
    layout = deck.slide_layouts[1]
    features = []
    for s in range(3):
        slide = deck.slides.add_slide(layout)
        slide.shapes.title.text = f"Slide {s + 1} of deck {n}"
        body = slide.placeholders[1].text_frame
        body.text = words(n * 5 + s, 6)
        for i in range(3):
            body.add_paragraph().text = words(n + s + i, 5)
    kind = n % 6
    last = deck.slides.add_slide(deck.slide_layouts[5])
    last.shapes.title.text = f"Detail {n}"
    if kind == 0:
        data = CategoryChartData()
        data.categories = ["A", "B", "C", "D"]
        data.add_series("Series", (n % 5 + 1, 4, 2, 6))
        last.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, PInches(1), PInches(2), PInches(6), PInches(4), data)
        features.append("charts")
    elif kind == 1:
        last.shapes.add_picture(png(n), PInches(1), PInches(2), PInches(3), PInches(2.25))
    elif kind == 2:
        table = last.shapes.add_table(4, 3, PInches(1), PInches(2), PInches(6), PInches(2)).table
        for r in range(4):
            for c in range(3):
                table.cell(r, c).text = words(r * 3 + c + n, 2)
    elif kind == 3:
        deck.slides[0].notes_slide.notes_text_frame.text = f"Speaker notes {n}: {words(n, 20)}"
    elif kind == 4:
        box = last.shapes.add_textbox(PInches(1), PInches(2), PInches(6), PInches(2))
        box.text_frame.text = words(n, 30)
    else:
        data = CategoryChartData()
        data.categories = ["Q1", "Q2", "Q3"]
        data.add_series("Revenue", (3, 5, 4))
        last.shapes.add_chart(XL_CHART_TYPE.LINE, PInches(1), PInches(2), PInches(6), PInches(4), data)
        features.append("charts")
    path = os.path.join(out, f"python-pptx-{n:02d}.pptx")
    deck.save(path)
    normalize(path)
    return path, "pptx", "pptx", f"python-pptx {pptx.__version__}", features


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="corpus/cache/generated")
    parser.add_argument("--per-library", type=int, default=6)
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    entries = []
    for maker in (make_docx, make_xlsx, make_pptx):
        for n in range(args.per_library):
            path, ext, family, producer, features = maker(args.out, n)
            data = open(path, "rb").read()
            entries.append({
                "id": os.path.splitext(os.path.basename(path))[0],
                "generated": True,
                "source": "generated",
                "licence": "MIT",
                "family": family,
                "ext": ext,
                "producer": producer,
                "producerClass": "python",
                "features": features,
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "broken": False,
                "brokenReason": None,
            })
    with open(os.path.join(args.out, "manifest.json"), "w") as handle:
        json.dump(entries, handle, indent=1)
    print(f"{len(entries)} generated files")


main()
