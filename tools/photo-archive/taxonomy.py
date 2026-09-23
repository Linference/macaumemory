"""
澳門特色建築照片檔案 · 分類標籤與提示詞

為什麼用 CLIP 零樣本分類而不是 YOLO？
  YOLO 是物件偵測器（人、車、狗…），COCO 預訓練沒有「葡式建築」「騎樓」這些類別；
  要它分類就得自己標註幾百張照片訓練。CLIP 可以用「文字描述」直接比對圖片，
  零樣本就能分出你自訂的類別，而且改類別只要改這個檔案。

輸出類別會寫進 photos.geojson，網站的圖層與篩選都用這裡的 id。
"""

# id, 中文名, 顏色（網站圖示）, 給 CLIP 的英文提示詞（越多越準）
TAXONOMY = [
    ("portuguese", "葡式殖民建築", "#c96b4a", [
        "a photo of a Portuguese colonial building in Macau with pastel walls and arched windows",
        "a colonial European style building with white trim and a tiled roof",
        "an old Portuguese-style house with shutters and a veranda",
    ]),
    ("temple", "中式廟宇", "#d8a13a", [
        "a photo of a traditional Chinese temple with red walls and a tiled roof",
        "a Chinese temple with incense, stone lions and curved eaves",
        "a small Chinese shrine on a street corner",
    ]),
    ("church", "天主教教堂", "#7f8fd0", [
        "a photo of a Catholic church with a bell tower in Macau",
        "a baroque church facade painted yellow and white",
        "a church interior with an altar",
    ]),
    ("tong_lau", "騎樓與唐樓", "#b08a5a", [
        "a photo of a shophouse with an arcade over the pavement (qilou)",
        "an old low-rise Chinese tenement building with balconies and air conditioners",
        "a narrow old residential block along a busy street",
    ]),
    ("residential_tower", "現代高層住宅", "#8fa0ad", [
        "a photo of a modern high-rise residential tower with many windows",
        "a dense cluster of apartment blocks in a city",
    ]),
    ("casino_hotel", "酒店與娛樂場", "#c9a227", [
        "a photo of a large luxury casino hotel building with a glass facade",
        "a tall modern hotel tower with a golden or mirrored exterior",
        "a resort building with a fountain in front",
    ]),
    ("civic", "公共建築", "#6f9bbf", [
        "a photo of a government or civic building with columns and a formal facade",
        "a public building such as a library, museum or town hall",
    ]),
    ("industrial", "工業與倉庫", "#7c8894", [
        "a photo of an industrial building or warehouse with metal roof",
        "a factory or workshop building",
    ]),
    ("village", "圍里與村落民居", "#8fae76", [
        "a photo of a traditional village house in Macau",
        "a small old house with a tiled roof in a village lane",
    ]),
    ("monument", "牌坊與紀念物", "#d8b45a", [
        "a photo of a stone archway or memorial monument facade",
        "the ruins of a church facade used as a monument",
        "a statue or memorial in a public square",
    ]),
    ("market", "街市與市集", "#c98b5a", [
        "a photo of a traditional market building or food street stalls",
        "a wet market building with red brick",
    ]),
    ("street", "街景與其他", "#9aa6b2", [
        "a photo of a street scene in Macau with mixed buildings",
        "a general city street with shops and signs",
    ]),
]

CLASS_IDS = [t[0] for t in TAXONOMY]
CLASS_ZH = {t[0]: t[1] for t in TAXONOMY}
CLASS_COLOR = {t[0]: t[2] for t in TAXONOMY}


def class_prompts():
    """展開成 (class_id, prompt) 清單，供 CLIP 逐條編碼"""
    out = []
    for cid, _zh, _color, prompts in TAXONOMY:
        for p in prompts:
            out.append((cid, p))
    return out
