"""Kontrollerar PDF:erna i tests/out (skapas av: node tests/pdf-render.mjs).

Kör: python tests/check_pdf.py   (kräver PyMuPDF: pip install pymupdf)
- all text inom sidan och marginalerna
- inga tecken som krockar med varandra (kollas per tecken via rawdict, eftersom PyMuPDF
  slår ihop text som krockar till ett och samma span)
- obligatoriska texter finns, f108 har flera sidor och varje rad finns exakt en gång
- sidorna sparas som PNG (tests/out/<namn>-p<sida>.png) för att granskas med ögonen
"""
import os
import sys

import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
MM = 72 / 25.4
MARGIN = 12 * MM          # ingen text närmare kanten än 12 mm (layouten använder 16 mm, sidfoten 14 mm)
DPI = 110

REQUIRED = {
    'f107': ['Faktura', '107', '1 700,00', '96,23', '1 603,77', 'Momsreg', 'F-skatt', 'Ange fakturanummer 107',
             'Fakturadatum', 'Förfallodag', 'Leveransdatum', '2026-05-19', 'Exempelbolaget AB', 'Sida 1 av 1'],
    'f108': ['Faktura', '108', 'Öresavrundning', 'Moms 25 % på 3 125,00', 'Moms 6 % på 20 635,20', '25 780,00',
             '2,5 tim', 'Projekt 4711', 'Sida 2 av', 'Ange fakturanummer 108'],
    'k109': ['Kreditfaktura', 'Avser faktura 107', '-1 700,00', '-96,23', 'Ingen betalning'],
    'd1': ['UTKAST', 'Cinnabuns'],
    'f108-fallback': ['Faktura', '108', '25 780,00', 'Sida 2 av'],
}
FORBIDDEN = {
    'k109': ['Att betala', 'Ange fakturanummer', 'Förfallodag'],
    'd1': ['Fakturanummer'],
}


def norm(s):
    return s.replace('\u00A0', ' ').replace('\u2212', '-')


def page_chars(page):
    """Alla synliga tecken på sidan: (bbox, tecken, horisontell?, span-id)."""
    chars = []
    raw = page.get_text('rawdict')
    sid = 0
    for block in raw['blocks']:
        if block.get('type') != 0:
            continue
        for line in block['lines']:
            horizontal = abs(line['dir'][0] - 1) < 1e-3 and abs(line['dir'][1]) < 1e-3
            for span in line['spans']:
                sid += 1
                for i, ch in enumerate(span['chars']):
                    if ch['c'].strip() == '':
                        continue
                    chars.append((pymupdf.Rect(ch['bbox']), ch['c'], horizontal, sid, i))
    return chars


def collisions(chars):
    """Par av tecken vars rutor överlappar mer än vad kerning ger."""
    hits = []
    flat = [c for c in chars if c[2]]
    flat.sort(key=lambda c: c[0].y0)
    for a_i, a in enumerate(flat):
        ra = a[0]
        for b in flat[a_i + 1:]:
            rb = b[0]
            if rb.y0 >= ra.y1:
                break
            if a[3] == b[3] and abs(a[4] - b[4]) == 1:
                continue    # grannar i samma ord
            ox = min(ra.x1, rb.x1) - max(ra.x0, rb.x0)
            oy = min(ra.y1, rb.y1) - max(ra.y0, rb.y0)
            if ox <= 0 or oy <= 0:
                continue
            if ox > 0.25 * min(ra.width, rb.width) and oy > 0.3 * min(ra.height, rb.height):
                hits.append((a[1], b[1], ra, rb))
    return hits


def check(name, path):
    problems = []
    doc = pymupdf.open(path)
    full = ''
    for pno, page in enumerate(doc, 1):
        W, H = page.rect.width, page.rect.height
        chars = page_chars(page)
        inner = pymupdf.Rect(MARGIN, MARGIN, W - MARGIN, H - MARGIN)
        for r, c, horizontal, _, _ in chars:
            bounds = inner if horizontal else page.rect
            if not (r.x0 >= bounds.x0 - 0.5 and r.x1 <= bounds.x1 + 0.5 and r.y0 >= bounds.y0 - 0.5 and r.y1 <= bounds.y1 + 0.5):
                problems.append(f'sida {pno}: "{c}" utanför marginalen vid {tuple(round(v / MM, 1) for v in r)} mm')
        for img in page.get_image_info():
            r = pymupdf.Rect(img['bbox'])
            if not inner.contains(r):
                problems.append(f'sida {pno}: bild utanför marginalen {tuple(round(v / MM, 1) for v in r)} mm')
        for a, b, ra, rb in collisions(chars)[:10]:
            problems.append(f'sida {pno}: "{a}" krockar med "{b}" vid {round(ra.x0 / MM, 1)},{round(ra.y0 / MM, 1)} mm')
        full += norm(page.get_text()) + '\n'
        pix = page.get_pixmap(dpi=DPI)
        pix.save(os.path.join(OUT, f'{name}-p{pno}.png'))
    for s in REQUIRED.get(name, []):
        if s not in full:
            problems.append(f'saknar texten "{s}"')
    for s in FORBIDDEN.get(name, []):
        if s in full:
            problems.append(f'texten "{s}" ska inte finnas')
    title = doc.metadata.get('title', '')
    want = {'f107': 'Faktura 107', 'f108': 'Faktura 108', 'k109': 'Kreditfaktura 109', 'd1': 'Utkast'}.get(name)
    if want and title != want:
        problems.append(f'PDF-titeln är "{title}", väntade "{want}"')
    if name.startswith('f108'):
        if doc.page_count < 2:
            problems.append(f'f108 har {doc.page_count} sida, väntade minst 2')
        rows = table_names(doc)
        for item in expected_f108_names():
            n = rows.count(item)
            if n != 1:
                problems.append(f'raden "{item}" finns {n} gånger, väntade 1')
        extra = [r for r in rows if r not in expected_f108_names()]
        if extra:
            problems.append(f'okända rader i tabellen: {extra[:3]}')
    return doc.page_count, problems


def table_names(doc):
    """Benämningskolumnen (x = 19 mm) ihopfogad per tabellrad. Ombrutna rader ligger 4,3 mm isär,
    nästa tabellrad minst 7,8 mm."""
    names = []
    for page in doc:
        lines = []
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                x0 = line['bbox'][0] / MM
                if 18 <= x0 <= 20.5 and abs(line['dir'][1]) < 1e-3:
                    txt = norm(''.join(sp['text'] for sp in line['spans'])).strip()
                    if txt.replace(' ', '') != 'BENÄMNING':   # tabellhuvudet
                        lines.append((line['spans'][0]['origin'][1] / MM, txt))
        lines.sort()
        prev = None
        for y, txt in lines:
            if prev is not None and y - prev < 6:
                names[-1] += ' ' + txt
            else:
                names.append(txt)
            prev = y
    return names


def expected_f108_names():
    """Radnamnen i f108, i samma ordning som tests/fixture.js bygger dem."""
    items = ['Tiramisu Cupcakes', 'Cinnabuns med kardemumma och extra pärlsocker på toppen, glutenfria',
             'Brownie, klassisk', 'Kaffe, termos 2,5 liter', 'Leverans till kontoret', 'Uthyrning av tårtfat',
             'Cookies, chocolate chip', 'Minicakes, citron']
    names = []
    for i in range(4):
        names += [n if i == 0 else f'{n} (omgång {i + 1})' for n in items]
    names += ['Leverans fredag 8 maj kl. 08:00, ring Per vid ankomst.', 'Provsmak, gratis', 'Timdebitering, dekoration']
    return names


def main():
    pymupdf.TOOLS.set_small_glyph_heights(True)   # teckenrutor = teckenstorlek, inte hela radhöjden
    files = sorted(f for f in os.listdir(OUT) if f.endswith('.pdf'))
    if not files:
        print('Inga PDF:er i tests/out. Kör först: node tests/pdf-render.mjs')
        return 1
    bad = 0
    for f in files:
        name = f[:-4]
        pages, problems = check(name, os.path.join(OUT, f))
        status = 'OK ' if not problems else 'FEL'
        print(f'{status} {f}: {pages} sida/sidor')
        for p in problems:
            print('    ' + p)
        bad += bool(problems)
    print(f'\n{len(files) - bad} av {len(files)} PDF:er utan anmärkning. PNG-bilder i {OUT}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
