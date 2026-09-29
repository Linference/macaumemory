"""把 DINOv2 ViT-S/14（facebook/dinov2-small）匯出成「網頁可用」的 ONNX 模型。

為什麼要自己包一層 wrapper：
    HuggingFace 上的 Dinov2Model 吃的是 pixel_values（已經是模型前處理過的張量），
    但它的 forward 裡會呼叫 interpolate_pos_encoding()，那個分支會依 input 尺寸
    動態 reshape。匯出成固定 336×336 時我們要的是最短路徑：
        正規化（ImageNet mean/std）→ patch embedding → encoder → CLS token
    因此本檔把「正規化 + 位置編碼內插」都寫成固定尺寸的等價寫法，讓 ONNX 圖單純、
    沒有動態形狀，onnxruntime-web 的 wasm EP 才能穩定吃下來。

輸入輸出契約（重要，前端與 Python 都必須照這個走）：
    pixel_values : (B, 3, 336, 336) float32，**已經做過 ImageNet 正規化**
                   ((v/255 - mean) / std)，與 HF processor 的輸出等價
    cls          : (B, 384) float32，最後一層 layernorm 後的 CLS token（未 L2 正規化）
    注意：正規化「不在」圖裡做 —— 早期版本把正規化寫進 forward，結果 Python 端
    又餵了已經正規化的張量（等於正規化兩次），導致同一張圖的 ONNX 與 PyTorch 特徵
    餘弦只有 0.06~0.18。契約寫在圖外面就不會再發生（見 debug_onnx_vs_torch.py）。

    位置編碼的等價改寫（關鍵）：
        facebook/dinov2-* 的權重是在 518×518 訓練的，position_embeddings 是 37×37+1。
        餵 336×336 時 HF 的 interpolate_pos_encoding() 會做 bicubic 內插成 24×24+1，
        而且它為了相容 torch.jit 寫了 `if not torch.jit.is_tracing()`，匯出時會被當成
        動態分支。這裡在 PyTorch 端先算好同樣的 bicubic 內插（完全複製 HF 的演算法：
        align_corners=False、float32 精度），再把它當常數註冊進圖裡。
        結果與 HF 前向「數值完全相同」，但 ONNX 圖是靜態的、沒有 Resize 動態尺寸。

輸出（預設寫到 tools/recognize/out/）：
    dinov2-small-336.onnx          fp32，約 87 MB，與 PyTorch 餘弦 1.000000
    dinov2-small-336.int8.onnx     動態量化，約 23 MB，與 fp32 餘弦 0.9856
    export-report.json             匯出與數值比對結果（給驗收用）

用法：
    python tools/recognize/export_dino_onnx.py                 # 匯出 + 量化 + 數值比對
    python tools/recognize/export_dino_onnx.py --no-quant      # 只匯出 fp32
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = Path(__file__).resolve().parent / "out"

MODEL_ID = "facebook/dinov2-small"        # ViT-S/14, hidden 384, 12 layers
SIZE = 336                                # 336 / 14 = 24 → 576 patches + 1 cls
MEAN = [0.485, 0.456, 0.406]
STD = [0.229, 0.224, 0.225]

# 匯出後的檔名與「前端實際載入的位置」。
# 檔名刻意用純 ASCII（vits14）避免任何路徑編碼問題；
# 而且一定要同步複製到 public/models/，否則前端載入的可能是舊檔 ——
# 這正是先前「查詢相似度只有 0.06」的事故根因（見 build_embeddings.py 的雜湊檢查）。
PUBLIC_NAME = "dinov2-vits14-336.onnx"
PUBLIC_DIR = ROOT / "public" / "models"


def interpolate_pos_embed(pos: "torch.Tensor", size: int, patch: int) -> "torch.Tensor":
    """完全複製 HF Dinov2Embeddings.interpolate_pos_encoding 的計算，回傳 (1, 1+N, C) 常數。"""
    import torch
    import torch.nn.functional as F

    n_target = (size // patch) ** 2
    num_positions = pos.shape[1] - 1
    if n_target == num_positions:
        return pos.clone()

    class_pos = pos[:, :1]
    patch_pos = pos[:, 1:]
    dim = pos.shape[-1]
    grid = int(round(num_positions ** 0.5))
    assert grid * grid == num_positions, f"位置編碼 {num_positions} 不是完全平方數"

    x = patch_pos.reshape(1, grid, grid, dim).permute(0, 3, 1, 2)
    dtype = x.dtype
    x = F.interpolate(x.to(torch.float32), size=(size // patch, size // patch),
                      mode="bicubic", align_corners=False).to(dtype)
    x = x.permute(0, 2, 3, 1).reshape(1, -1, dim)
    return torch.cat((class_pos, x), dim=1)


def build_onnx_model(model_id: str, size: int, opset: int):
    """回傳 (torch.nn.Module wrapper, hidden_size)。"""
    import torch
    import torch.nn as nn
    from transformers import AutoModel

    backbone = AutoModel.from_pretrained(model_id).eval()
    hidden = int(backbone.config.hidden_size)
    patch = int(backbone.config.patch_size)
    assert size % patch == 0, f"size {size} 必須是 patch {patch} 的整數倍"
    n_patches = (size // patch) ** 2

    class Dinov2Onnx(nn.Module):
        """固定尺寸的 DINOv2：pixel_values(**已正規化** NCHW) → CLS 嵌入（未正規化）。"""

        def __init__(self, backbone):
            super().__init__()
            self.backbone = backbone
            # 位置編碼：複製 HF interpolate_pos_encoding() 的 bicubic 內插，算成常數
            pos = backbone.embeddings.position_embeddings.detach()
            self.register_buffer("pos_embed", interpolate_pos_embed(pos, size, patch), persistent=False)

        def forward(self, pixel_values):
            emb = self.backbone.embeddings
            x = emb.patch_embeddings(pixel_values)            # (B, N, C) 已含 flatten
            cls = emb.cls_token.expand(x.shape[0], -1, -1)    # HF 在前向裡自己接上 cls token
            x = torch.cat((cls, x), dim=1)                    # (B, 1+N, C)
            x = x + self.pos_embed                            # 常數相加，靜態圖
            x = emb.dropout(x)
            out = self.backbone.encoder(x)                    # ViT encoder（含 layernorm）
            return self.backbone.layernorm(out.last_hidden_state[:, 0])

    return Dinov2Onnx(backbone).eval(), hidden


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--size", type=int, default=SIZE)
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--no-quant", action="store_true", help="跳過 int8 動態量化")
    ap.add_argument("--fixed-batch", action="store_true",
                    help="匯出成固定 batch=1（預設是動態 batch，可一次算完 TTA 的多個視圖）")
    ap.add_argument("--out", default=str(OUT_DIR))
    args = ap.parse_args()

    import numpy as np
    import torch

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "model_id": args.model,
        "size": args.size,
        "opset": args.opset,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }

    print(f"[1/5] 載入 {args.model} …")
    net, hidden = build_onnx_model(args.model, args.size, args.opset)
    n_params = sum(p.numel() for p in net.parameters())
    report["hidden_size"] = hidden
    report["params"] = n_params
    print(f"      hidden={hidden} · 參數量={n_params/1e6:.1f}M")

    fp32_path = out_dir / PUBLIC_NAME
    print(f"[2/5] 匯出 ONNX → {fp32_path.name}")
    # 驗證用的輸入必須是「已正規化」的張量（契約見檔頭）；用隨機像素 + 真前處理都測一次
    dummy = torch.rand(1, 3, args.size, args.size) * 2 - 1
    with torch.no_grad():
        torch_out = net(dummy).numpy()
    dynamic_axes = None if args.fixed_batch else {"pixel_values": {0: "batch"}, "cls": {0: "batch"}}
    torch.onnx.export(
        net,
        (dummy,),
        str(fp32_path),
        input_names=["pixel_values"],
        output_names=["cls"],
        opset_version=args.opset,
        do_constant_folding=True,
        dynamic_axes=dynamic_axes,
        dynamo=False,                      # 舊版匯出器：圖較單純，wasm EP 相容性最好
    )
    report["fp32_bytes"] = fp32_path.stat().st_size
    report["fp32_mb"] = round(fp32_path.stat().st_size / 1e6, 1)
    print(f"      {report['fp32_mb']} MB")

    # ------------------------------------------------------------------ 驗證
    print("[3/5] 驗證 ONNX 與 PyTorch 數值一致 …")
    import onnxruntime as ort

    numeric: dict = {}
    try:
        sess = ort.InferenceSession(str(fp32_path), providers=["CPUExecutionProvider"])
        got = sess.run(None, {"pixel_values": dummy.numpy()})[0]
        cos = float(np.dot(torch_out[0], got[0]) / (np.linalg.norm(torch_out[0]) * np.linalg.norm(got[0])))
        numeric["fp32_cosine_vs_torch"] = round(cos, 6)
        numeric["fp32_max_abs_diff"] = float(np.abs(torch_out - got).max())
        numeric["output_shape"] = list(got.shape)
        numeric["dynamic_batch"] = not args.fixed_batch
        print(f"      餘弦={cos:.6f} · 最大絕對差={numeric['fp32_max_abs_diff']:.2e} · 形狀={list(got.shape)}")
        if not args.fixed_batch:
            b4 = sess.run(None, {"pixel_values": np.repeat(dummy.numpy(), 4, axis=0)})[0]
            numeric["batch4_shape"] = list(b4.shape)
            # 逐張與整批的結果必須一致（TTA 平均才不會因批次而變）
            one = sess.run(None, {"pixel_values": dummy.numpy()})[0][0]
            d = float(np.abs(one - b4[0]).max())
            numeric["batch_consistency_max_abs_diff"] = d
            print(f"      batch=4 → {list(b4.shape)}；與單張最大差 {d:.2e}")
    except Exception as e:  # pragma: no cover
        numeric["error"] = repr(e)
        print(f"      !! 驗證失敗：{e}")
    report["numeric"] = numeric

    # ------------------------------------------------------------------ 真照片端到端比對
    # 隨機張量只能驗「圖對不對」，驗不出「前處理契約有沒有錯」。
    # 這裡用真的澳門照片，同一份前處理跑 ONNX 與 HF PyTorch，兩邊餘弦必須 = 1。
    print("[3.5/5] 用真實照片比對 ONNX ↔ HuggingFace PyTorch …")
    try:
        import numpy as _np
        from PIL import Image
        from transformers import AutoModel

        cc = ROOT / "photos-src" / "cc"
        picks = []
        for d in sorted(cc.iterdir()) if cc.is_dir() else []:
            if d.is_dir():
                for f in sorted(d.iterdir()):
                    if f.suffix.lower() in (".jpg", ".jpeg", ".png") and "night" not in f.name.lower():
                        picks.append(f)
                        break
            if len(picks) >= 5:
                break
        if not picks:
            print("      （找不到 photos-src/cc 的照片，跳過）")
            numeric["real_image_check"] = "skipped"
        else:
            mean = _np.array(MEAN, _np.float32)
            std = _np.array(STD, _np.float32)

            def prep(p):
                im = Image.open(p).convert("RGB")
                w, h = im.size
                s = args.size / min(w, h)
                im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.BICUBIC)
                w, h = im.size
                im = im.crop(((w - args.size) // 2, (h - args.size) // 2,
                              (w - args.size) // 2 + args.size, (h - args.size) // 2 + args.size))
                a = _np.asarray(im, _np.float32) / 255.0
                return ((a - mean) / std).transpose(2, 0, 1)[None]

            arr = _np.concatenate([prep(p) for p in picks], 0)
            sess2 = ort.InferenceSession(str(fp32_path), providers=["CPUExecutionProvider"])
            got2 = sess2.run(None, {"pixel_values": arr})[0]
            hf = AutoModel.from_pretrained(args.model).eval()
            import torch as _torch
            with _torch.no_grad():
                ref = hf(pixel_values=_torch.from_numpy(arr),
                         interpolate_pos_encoding=True).last_hidden_state[:, 0].numpy()
            cos_each = [float(a @ b / (_np.linalg.norm(a) * _np.linalg.norm(b))) for a, b in zip(got2, ref)]
            numeric["real_image_cosine_min"] = round(min(cos_each), 6)
            numeric["real_image_cosine_mean"] = round(float(_np.mean(cos_each)), 6)
            numeric["real_image_n"] = len(picks)
            ok = min(cos_each) > 0.9999
            print(f"      {len(picks)} 張真照片，ONNX↔PyTorch 餘弦 min={min(cos_each):.6f} → "
                  f"{'通過' if ok else '!! 不通過（前處理或匯出有問題）'}")
    except Exception as e:  # pragma: no cover
        numeric["real_image_error"] = repr(e)
        print(f"      !! 真照片比對失敗：{e}")

    # ------------------------------------------------------------------ 量化
    quant_path = out_dir / PUBLIC_NAME.replace(".onnx", ".int8.onnx")
    if not args.no_quant:
        print("[4/5] int8 動態量化 …")
        try:
            import tempfile

            from onnxruntime.quantization import QuantType, quantize_dynamic

            # onnxruntime 的量化中間檔會寫到「模型所在目錄」，本專案路徑含中文，
            # 某些版本的 quantize_dynamic 會組出找不到的路徑；先複製到純 ASCII 暫存目錄再量化。
            with tempfile.TemporaryDirectory(prefix="dinoq_") as td:
                src = Path(td) / "model.onnx"
                dst = Path(td) / "model.int8.onnx"
                src.write_bytes(fp32_path.read_bytes())
                # 注意：ViT 整顆全量化精度掉很快，這裡只量化 Conv/MatMul/Gemm 主體。
                quantize_dynamic(
                    model_input=str(src),
                    model_output=str(dst),
                    weight_type=QuantType.QInt8,
                    op_types_to_quantize=["MatMul", "Gemm", "Conv"],
                    extra_options={"ActivationSymmetric": False, "WeightSymmetric": True},
                )
                quant_path.write_bytes(dst.read_bytes())
            report["int8_bytes"] = quant_path.stat().st_size
            report["int8_mb"] = round(quant_path.stat().st_size / 1e6, 1)
            report["int8_ratio"] = round(quant_path.stat().st_size / fp32_path.stat().st_size, 3)
            print(f"      {report['int8_mb']} MB（{report['int8_ratio']*100:.0f}% of fp32）")
            sess_q = ort.InferenceSession(str(quant_path), providers=["CPUExecutionProvider"])
            got_q = sess_q.run(None, {"pixel_values": dummy.numpy()})[0]
            cos_q = float(np.dot(torch_out[0], got_q[0]) / (np.linalg.norm(torch_out[0]) * np.linalg.norm(got_q[0])))
            numeric["int8_cosine_vs_torch"] = round(cos_q, 6)
            numeric["int8_cosine_vs_fp32"] = round(
                float(np.dot(got[0], got_q[0]) / (np.linalg.norm(got[0]) * np.linalg.norm(got_q[0]))), 6)
            print(f"      與 torch 餘弦={cos_q:.6f} · 與 fp32 餘弦="
                  f"{numeric['int8_cosine_vs_fp32']:.6f}")
        except Exception as e:  # pragma: no cover
            numeric["int8_error"] = repr(e)
            print(f"      !! 量化失敗：{e}")
    else:
        print("[4/5] 跳過量化")

    # ------------------------------------------------------------------ 複製到 public/models/
    # 這一步很重要：前端載入的是 public/models/ 這一份，
    # 若兩份不同檔，查詢向量與嵌入庫會落在不同分布（實際發生過，見檔頭說明）。
    print("[4.5/5] 複製到 public/models/（前端實際載入的位置）…")
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    copied = []
    for src in [fp32_path] + ([quant_path] if quant_path.is_file() else []):
        dst = PUBLIC_DIR / src.name
        shutil.copy2(src, dst)
        copied.append(str(dst.relative_to(ROOT)))
        print(f"      → {dst.relative_to(ROOT)}（{dst.stat().st_size/1e6:.1f} MB）")
    report["public_copies"] = copied
    report["fp32_sha256"] = hashlib.sha256(fp32_path.read_bytes()).hexdigest()

    print("[5/5] 寫出報告")
    (out_dir / "export-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"      → {out_dir / 'export-report.json'}")
    print(json.dumps(report, ensure_ascii=False, indent=1))
    print("\n下一步：python tools/recognize/build_embeddings.py --eval   # 重建嵌入庫（會自動比對雜湊）")
    print("        python tools/recognize/verify_query_path.py           # 驗證查詢路徑")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
