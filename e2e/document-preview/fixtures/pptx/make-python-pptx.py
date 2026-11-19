"""
Writes python-pptx.pptx: a deck python-pptx writes on its own default
template, the way decks are usually generated. deck.ts builds every other
fixture part by part on a small skeleton; this one holds what python-pptx
itself writes:

- a Title and Content slide with three bullets, whose placeholders carry no
  box and no text style of their own;
- a picture placeholder filled by insert_picture, which crops a picture wider
  than the placeholder to the placeholder's shape;
- a straight connector from add_connector, a rectangle whose outline sets
  only a width, as shape.line.width writes it, and an inverse line from
  add_shape, which runs from the bottom-left corner of its box to the
  top-right and carries the autoshape style's accent1 fill.

python-pptx stamps each zip entry with the time it saves, so the script writes
the archive again with one fixed date. The bytes then hold for one version of
python-pptx and one of Pillow, which encodes the picture: python-pptx 1.0.2
and Pillow 13.0.0 wrote the committed file.

Run it from the repository root with those two versions, for example:
  uv run --no-project --with python-pptx==1.0.2 --with pillow==13.0.0 python e2e/document-preview/fixtures/pptx/make-python-pptx.py
"""

import io
import zipfile
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.util import Inches, Pt

OUTPUT = Path(__file__).with_name('python-pptx.pptx')
# The date every zip entry carries, the one deck.ts gives the other fixtures.
ENTRY_DATE = (2020, 1, 1, 0, 0, 0)
# Layouts of python-pptx's default template, by index.
TITLE_AND_CONTENT = 1
TITLE_ONLY = 5
PICTURE_WITH_CAPTION = 8
# The picture placeholder and the caption under it on Picture with Caption.
PICTURE_IDX = 1
CAPTION_IDX = 2


def wide_picture() -> io.BytesIO:
    """A 64 by 16 PNG, blue on the left and orange on the right."""
    image = Image.new('RGB', (64, 16), (68, 114, 196))
    image.paste((237, 125, 49), (32, 0, 64, 16))
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    stream.seek(0)
    return stream


def build() -> bytes:
    deck = Presentation()
    # The default template names python-pptx's author as the last person to
    # change it. The fixture names no one.
    deck.core_properties.last_modified_by = ''

    slide = deck.slides.add_slide(deck.slide_layouts[TITLE_AND_CONTENT])
    slide.shapes.title.text = 'A deck python-pptx wrote'
    body = slide.placeholders[1].text_frame
    body.text = 'Bullets from the master'
    for text in ['Boxes from the layout', 'Fonts from the theme']:
        body.add_paragraph().text = text

    slide = deck.slides.add_slide(deck.slide_layouts[PICTURE_WITH_CAPTION])
    slide.shapes.title.text = 'A picture placeholder'
    slide.placeholders[PICTURE_IDX].insert_picture(wide_picture())
    slide.placeholders[CAPTION_IDX].text = 'The picture is cropped to the placeholder'

    slide = deck.slides.add_slide(deck.slide_layouts[TITLE_ONLY])
    slide.shapes.title.text = 'A connector and a wide outline'
    slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(1), Inches(5), Inches(4), Inches(2))
    box = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(5), Inches(2), Inches(3), Inches(2))
    box.line.width = Pt(6)
    box.text = 'A six point outline'
    line = slide.shapes.add_shape(MSO_SHAPE.LINE_INVERSE, Inches(5), Inches(4.75), Inches(3), Inches(1.5))
    line.text = 'An inverse line'

    saved = io.BytesIO()
    deck.save(saved)
    return saved.getvalue()


def with_fixed_dates(archive: bytes) -> bytes:
    """The archive's entries, in their order, each dated ENTRY_DATE."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(archive)) as source, zipfile.ZipFile(out, 'w') as target:
        for entry in source.infolist():
            info = zipfile.ZipInfo(entry.filename, ENTRY_DATE)
            info.compress_type = entry.compress_type
            info.external_attr = entry.external_attr
            target.writestr(info, source.read(entry.filename))
    return out.getvalue()


if __name__ == '__main__':
    data = with_fixed_dates(build())
    OUTPUT.write_bytes(data)
    print(f'wrote {OUTPUT.name} ({len(data)} bytes)')
