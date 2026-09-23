from pathlib import Path
p = Path("tools/photo-archive/pipeline.py")
s = p.read_text(encoding="utf-8-sig")
s = s.replace(
    '        pooled = getattr(out, "pooler_output", None) or out.last_hidden_state[:, 0]',
    '        pooled = getattr(out, "pooler_output", None)\n        if pooled is None:\n            pooled = out.last_hidden_state[:, 0]'
)
p.write_text(s, encoding="utf-8")
print("已修正 tensor 布林判斷")
