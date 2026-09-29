"""修正 subagent 留下的 model 欄位 bug。

問題：嵌入庫的 model 欄位用了 SPOT_MODEL.get(spot, spot) 這個 fallback，
      spot id 不存在時就把 spot id 當成 model id 寫進去。結果 21 棟裡有 13 棟
      指向不存在的模型——前端「看三維模型」按鈕會直接失敗。

正確語意：model 應該等於「建築自己的 id，且在 manifest.models 裡確實存在」，
          否則為 null。

同時修 build_embeddings.py，避免下次重建又寫壞。
"""
import json
import re
from pathlib import Path

root = Path(r"D:\Users\LINKIT\Desktop\澳门记忆")
emb_path = root / "public/data/memory-embeddings.json"
man_path = root / "public/models/manifest.json"

emb = json.loads(emb_path.read_text(encoding="utf-8"))
man = json.loads(man_path.read_text(encoding="utf-8"))
models = set((man.get("models") or {}).keys())
print(f"  manifest 模型 {len(models)} 個：{sorted(models)}")

fixed, cleared, kept = 0, 0, 0
for b in emb["buildings"]:
    bid = b["id"]
    if bid in models:
        if b.get("model") != bid:
            b["model"] = bid
            fixed += 1
        else:
            kept += 1
    else:
        if b.get("model") is not None:
            b["model"] = None
            cleared += 1

# 記一筆說明，讓後來的人知道為什麼有些是 null
emb["model_note"] = (
    "model 欄位＝該建築在 public/models/manifest.json 裡的模型 id；"
    "沒有對應模型時為 null（前端據此隱藏「看三維模型」按鈕，而不是給出會失敗的連結）。"
)

emb_path.write_text(json.dumps(emb, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"  已修正 {fixed} 棟（設為自身 id）、清空 {cleared} 棟（改為 null）、本來就正確 {kept} 棟")

# 驗證
chk = json.loads(emb_path.read_text(encoding="utf-8"))
bad = [b for b in chk["buildings"] if b.get("model") and b["model"] not in models]
withmodel = [b for b in chk["buildings"] if b.get("model")]
print(f"  驗證：仍指向不存在模型 {len(bad)} 棟（應為 0）｜有模型 {len(withmodel)} 棟（應為 "
      f"{len([b for b in chk['buildings'] if b['id'] in models])}）")
for b in withmodel:
    print(f"    ✓ {b['zh']:<20} model={b['model']}")

# ---------------------------------------------------------------- 修建庫腳本
bp = root / "tools/recognize/build_embeddings.py"
if bp.is_file():
    s = bp.read_text(encoding="utf-8")
    hits = [m for m in re.finditer(r".*SPOT_MODEL.*", s)]
    if hits:
        print(f"\n  build_embeddings.py 找到 {len(hits)} 處 SPOT_MODEL：")
        for m in hits:
            print("   ", m.group(0).strip())
    else:
        print("\n  build_embeddings.py 已無 SPOT_MODEL 參照")
