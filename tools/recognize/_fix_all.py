from pathlib import Path

p = Path(r"D:\Users\LINKIT\Desktop\澳门记忆\tools\recognize\visualize_all.py")
s = p.read_text(encoding="utf-8")

# ① 攤平時一併記下每條向量對應的來源檔名（原本用 index/tolist 反查，既繞又會錯）
old_flat = """    owner, vecs = [], []
    for i, b in enumerate(blds):
        for v in b["vectors"]:
            owner.append(i)
            vecs.append(v)"""
new_flat = """    owner, vecs, src = [], [], []
    for i, b in enumerate(blds):
        for k, v in enumerate(b["vectors"]):
            owner.append(i)
            vecs.append(v)
            # 每個向量對應的來源檔名（長度可能不一致，取不到就退回第一張）
            src.append(b["files"][k] if k < len(b["files"]) else b["files"][0])"""
assert old_flat in s, "① 攤平區塊"
s = s.replace(old_flat, new_flat, 1)

# ② 失敗清單改用 src[q]
old_file = """                "file": blds[own]["files"][blds[own]["vectors"].index(vecs[q].tolist())
                                            if vecs[q].tolist() in blds[own]["vectors"] else 0],"""
new_file = """                "file": src[q],"""
assert old_file in s, "② file 欄位"
s = s.replace(old_file, new_file, 1)

p.write_text(s, encoding="utf-8")
print("  OK 已修正：改為直接建 src 平行清單")
