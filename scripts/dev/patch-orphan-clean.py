from pathlib import Path
p = Path("tools/photo-archive/pipeline.py")
s = p.read_text(encoding="utf-8-sig")
# 產線結束後清掉不再被引用的舊圖（避免改名後留下孤兒檔）
s = s.replace(
    '''    log("\\n================ 完成 ================")''',
    '''    # 清掉不再被任何記憶點引用的舊圖檔
    used = {Path(ph["file"]).name for pl in places.values() for ph in pl["photos"]}
    removed = 0
    for d in (OUT_PHOTOS, OUT_THUMB):
        for f in d.glob("*.jpg"):
            if f.name not in used:
                f.unlink()
                removed += 1
    if removed:
        log(f"（已清理 {removed} 個不再使用的舊圖檔）")

    log("\\n================ 完成 ================")'''
)
p.write_text(s, encoding="utf-8")
print("已加入孤兒檔清理")
