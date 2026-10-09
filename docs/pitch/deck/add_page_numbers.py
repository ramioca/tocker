"""Add a page number (bottom right) to every slide but the cover, and keep pinned footers clear of it.
Run: python3 -I pagenum.py <deck project dir>"""
import json, re, sys
root = sys.argv[1]
order = json.load(open(f"{root}/deck.json"))["order"]
total = len(order)
for i, sid in enumerate(order, 1):
    p = f"{root}/slides/{sid}.html"
    s = open(p).read()
    s = re.sub(r'\s*<p style="position:absolute; right:128px; bottom:64px;[^"]*">\d\d / \d\d</p>', "", s)
    # footers: pinned at left:128 bottom:64 — narrow them so they never run under the number
    s = re.sub(r'(<p style="position:absolute; ?(?:bottom:64px; ?left:128px|left:128px; ?bottom:64px); ?width:)1664px', r"\g<1>1440px", s)
    if sid != "cover":
        num = (f'<p style="position:absolute; right:128px; bottom:64px; font-family:\'Geist Mono\', \'Courier New\', monospace; '
               f'font-size:22px; line-height:1.35; letter-spacing:2px; white-space:nowrap; font-variant-numeric:tabular-nums; '
               f'color:#818180">{i:02d} / {total:02d}</p>')
        s = s.replace("<aside>", num + "\n  <aside>", 1)
    open(p, "w").write(s)
    print(sid, i, "footer" if "width:1440px" in s else "-")
