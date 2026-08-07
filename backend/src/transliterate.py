#!/usr/bin/env python3
import sys
import json
import re

try:
    import pykakasi
    kakasi_inst = pykakasi.kakasi()
except Exception:
    kakasi_inst = None

try:
    import unidecode
except Exception:
    unidecode = None

def transliterate_text(text):
    if not text or not text.strip():
        return ""
    
    # Japanese check: Kana/Kanji script
    if re.search(r'[\u3040-\u30ff\u4e00-\u9faf]', text):
        if kakasi_inst:
            try:
                res = kakasi_inst.convert(text)
                return " ".join([item["hepburn"] for item in res if item.get("hepburn")])
            except Exception:
                pass

    # Generic unidecode for Persian, Arabic, Korean, Chinese, Cyrillic, Devanagari, Greek, etc.
    if unidecode:
        try:
            res = unidecode.unidecode(text).strip()
            # Clean up extra spaces
            res = re.sub(r'\s+', ' ', res)
            return res
        except Exception:
            pass

    return ""

def main():
    if len(sys.argv) > 1 and sys.argv[1] != "--stdin":
        lines = [sys.argv[1]]
    else:
        try:
            input_data = sys.stdin.read()
            lines = json.loads(input_data)
        except Exception as e:
            sys.stderr.write(f"Error parsing input: {e}\n")
            lines = []

    if isinstance(lines, str):
        lines = [lines]

    results = []
    for line in lines:
        results.append(transliterate_text(line))

    print(json.dumps(results))

if __name__ == "__main__":
    main()
