"""檢查 subagent 最後提到的 bug：嵌入庫的 model 欄位是否指向不存在的模型。"""
import json
from pathlib import Path

root = Path(r"D:\Users\LINKIT\Desktop\澳门记忆")
d = json.loads((root / "public/data/memory-embeddings.json").read_text(encoding="utf-8"))
man_path = root / "public/models/manifest.json"
man = json.loads(man_path.read_text(encoding="utf-8")) if man_path.is_file() else {}
models = set((man.get("models") or {}).keys())

blds = d["buildings"]
bad = [b for b in blds if b.get("model") and b["model"] not in models]
no_model = [b for b in blds if not b.get("model")]

print(f"  建築 {len(blds)} 棟｜manifest 模型 {len(models)} 個")
print(f"  model 指向不存在的模型：{len(bad)} 棟")
print(f"  沒有 model 欄位：{len(no_model)} 棟")
if bad:
    print("\n  錯誤對照（建築 → 它指的 model）：")
    for b in bad:
        print(f"    {b['zh']:<20} spot={str(b.get('spot')):<22} model={b['model']}")
if no_model:
    print("\n  無 model：", ", ".join(b["zh"] for b in no_model))
# 反向：manifest 有模型但沒有建築指向它
used = {b["model"] for b in blds if b.get("model")}
print(f"\n  manifest 有但沒被指到的模型（{len(models - used)} 個）：")
for m in sorted(models - used)[:12]:
    print("   ", m)
