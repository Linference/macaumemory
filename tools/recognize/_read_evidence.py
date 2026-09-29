"""把存下來的政府頁面 HTML 抽成純文字，方便人工判讀授權條款（避開主控台編碼問題）。

用法：python tools/recognize/_read_evidence.py [關鍵詞...]
"""
from __future__ import annotations

import html as H
import re
import sys
from pathlib import Path

EVID = Path(__file__).resolve().parent / "out" / "gov-evidence"
OUTTXT = Path(__file__).resolve().parent / "out" / "gov-evidence-txt"


def text_of(raw: str) -> str:
    raw = re.sub(r"<script.*?</script>|<style.*?</style>|<!--.*?-->", " ", raw, flags=re.S | re.I)
    raw = re.sub(r"<br\s*/?>|</p>|</div>|</li>|</h\d>", "\n", raw, flags=re.I)
    raw = re.sub(r"<[^>]+>", " ", raw)
    raw = H.unescape(raw)
    raw = re.sub(r"[ \t\u00a0]+", " ", raw)
    raw = re.sub(r"\n\s*\n+", "\n", raw)
    return raw.strip()


def main() -> int:
    OUTTXT.mkdir(parents=True, exist_ok=True)
    keys = [k.lower() for k in sys.argv[1:]]
    for f in sorted(EVID.glob("*.html")):
        raw = f.read_text(encoding="utf-8", errors="replace")
        txt = text_of(raw)
        (OUTTXT / (f.stem + ".txt")).write_text(txt, encoding="utf-8")
        print("=" * 100)
        print(f"### {f.name}  ({len(txt)} 字)")
        if keys:
            low = txt.lower()
            shown = 0
            for k in keys:
                for m in re.finditer(re.escape(k), low):
                    a = max(0, m.start() - 200)
                    print("   …" + txt[a:m.end() + 320].replace("\n", " ") + "…")
                    shown += 1
                    if shown >= 12:
                        break
                if shown >= 12:
                    break
        else:
            print(txt[:1500])
    print(f"\n→ {OUTTXT}\\*.txt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
