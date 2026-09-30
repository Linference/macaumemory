"""Freeze/audit independent photo queries before encoding. No training or threshold tuning.

python tools/recognize/independent_queries.py --init
python tools/recognize/independent_queries.py --manifest path/to/manifest.json --audit-only
python tools/recognize/independent_queries.py --manifest path/to/manifest.json

This evaluates full-image DINO retrieval, not YOLO detection or browser end-to-end accuracy.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIBRARY = ROOT / "public/data/memory-embeddings.json"
OUT = ROOT / "tools/recognize/out/independent"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def reference_path(bid, filename):
    for directory in (ROOT / "photos-src/cc" / bid, ROOT / "photos-src/demo", ROOT / "public/photos/demo"):
        path = directory / filename
        if path.is_file():
            return path
    return None


def audit_manifest(manifest, library, root=ROOT):
    """Fail closed on missing provenance or leakage; a blank manifest stays pending."""
    errors = []
    references = manifest.get("references", [])
    queries = manifest.get("queries", [])
    available = {f"{b['id']}/{f}" for b in library["buildings"] for f in b["files"]}
    hashes, groups, authors = set(), set(), set()
    seen_ids, query_hashes, reference_keys = set(), set(), set()
    if not references:
        errors.append("No frozen gallery references selected.")
    if not queries:
        errors.append("No independent queries supplied; metrics remain pending.")

    def check_provenance(record, kind):
        for name in ("captureGroup", "photographer", "capturedAt", "source"):
            if not isinstance(record.get(name), str) or not record[name].strip():
                errors.append(f"{kind}: missing {name}")
        try:
            datetime.fromisoformat(str(record.get("capturedAt", "")).replace("Z", "+00:00"))
        except ValueError:
            errors.append(f"{kind}: capturedAt must be an ISO date/time")
        path = root / record.get("path", "")
        if not path.is_file():
            errors.append(f"{kind}: file missing")
            return None
        return digest(path)

    for ref in references:
        key = ref.get("key")
        if key not in available or key in reference_keys:
            errors.append(f"Invalid/duplicate reference key: {key}")
        reference_keys.add(key)
        # Verify that metadata points to the image used in the frozen embedding library.
        if key in available:
            bid, filename = key.split("/", 1)
            original = reference_path(bid, filename) if root == ROOT else root / ref.get("path", "")
            proposed = root / ref.get("path", "")
            if original is None or not proposed.is_file() or digest(original) != digest(proposed):
                errors.append(f"Reference does not match library image: {key}")
        h = check_provenance(ref, f"reference {key}")
        if h:
            if h in hashes:
                errors.append(f"reference {key}: duplicate gallery image bytes")
            hashes.add(h)
        groups.add(str(ref.get("captureGroup", "")).strip().casefold())
        authors.add(str(ref.get("photographer", "")).strip().casefold())

    split_groups, split_authors = {}, {}
    for query in queries:
        qid = query.get("id")
        if not qid or qid in seen_ids:
            errors.append(f"Missing/duplicate query id: {qid}")
        seen_ids.add(qid)
        if query.get("split") not in ("test", "calibration"):
            errors.append(f"query {qid}: split must be test or calibration")
        gallery_ids = {key.split("/", 1)[0] for key in reference_keys if isinstance(key, str)}
        bid = query.get("buildingId")
        if not isinstance(bid, str) or not bid or (bid not in gallery_ids and not (bid.startswith("unknown:") and len(bid) > 8)):
            errors.append(f"query {qid}: buildingId required (use unknown:<id> for out-of-gallery buildings)")
        if query.get("independentCapture") is not True:
            errors.append(f"query {qid}: independentCapture must be explicitly confirmed")
        h = check_provenance(query, f"query {qid}")
        if h in hashes:
            errors.append(f"query {qid}: exact reference image reused")
        if h and h in query_hashes:
            errors.append(f"query {qid}: duplicate query image")
        if h:
            query_hashes.add(h)
        group = str(query.get("captureGroup", "")).strip().casefold()
        author = str(query.get("photographer", "")).strip().casefold()
        if group in groups or author in authors:
            errors.append(f"query {qid}: capture group/photographer overlaps gallery")
        for label, value, index in (("captureGroup", group, split_groups), ("photographer", author, split_authors)):
            old_split = index.setdefault(value, query.get("split"))
            if old_split != query.get("split"):
                errors.append(f"query {qid}: {label} spans calibration and test")
        if query.get("location") and query.get("confirmedPhotoLocation") is not True:
            errors.append(f"query {qid}: location must correspond to this photo, not an unrelated GPS reading")
    if not any(q.get("split") == "test" for q in queries):
        errors.append("No test queries supplied.")
    return {"ok": not errors, "status": "audited" if not errors else "pending", "errors": errors,
            "queries": len(queries), "references": len(references),
            "scope": "full-image DINO retrieval; provenance declared by collector; exact-byte duplicates checked; near-duplicates require manual review"}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--init", action="store_true")
    ap.add_argument("--manifest", type=Path)
    ap.add_argument("--audit-only", action="store_true")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    library = json.loads(LIBRARY.read_text(encoding="utf-8"))
    if args.init:
        refs = []
        for building in library["buildings"]:
            for filename in building["files"]:
                path = reference_path(building["id"], filename)
                refs.append({"key": f"{building['id']}/{filename}",
                             "path": path.relative_to(ROOT).as_posix() if path else "",
                             "captureGroup": "", "photographer": "", "capturedAt": "", "source": ""})
        template = {"librarySha256": digest(LIBRARY), "references": refs, "queries": []}
        target = args.out / "manifest.template.json"
        if target.exists():
            raise SystemExit(f"Refusing to overwrite {target}; choose another --out directory.")
        target.write_text(json.dumps(template, ensure_ascii=False, indent=2), encoding="utf-8")
        print(target)
        return 0
    if not args.manifest:
        ap.error("provide --manifest or --init")
    manifest = json.loads(args.manifest.read_text(encoding="utf-8-sig"))
    audit = audit_manifest(manifest, library)
    if manifest.get("librarySha256") != digest(LIBRARY):
        audit["ok"] = False
        audit["status"] = "pending"
        audit["errors"].append("Gallery changed after manifest freeze; freeze a new gallery before testing.")
    (args.out / "audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in audit.items() if k != "errors"}, ensure_ascii=False))
    if not audit["ok"]:
        print("Metrics not computed. See audit.json; no accuracy claim is available.")
        return 2
    if args.audit_only:
        return 0
    # Import heavy dependencies only after provenance passes.
    from PIL import Image, ImageOps
    from build_embeddings import OnnxEncoder
    model = ROOT / "public/models" / library["encoder"]["source"]
    if digest(model) != library["encoder"]["onnx_sha256"]:
        raise SystemExit("Model hash differs from frozen gallery encoder.")
    enc = OnnxEncoder(model)
    rows = []
    for query in manifest["queries"]:
        with Image.open(ROOT / query["path"]) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            vector = enc.embed([image])[0].tolist()
        rows.append({**query, "sha256": digest(ROOT / query["path"]), "vector": vector})
    result = {"audit": audit, "librarySha256": digest(LIBRARY), "encoderSha256": digest(model),
              "referenceKeys": [r["key"] for r in manifest["references"]], "queries": rows,
              "protocol": "full_image_three_crops_flip_tta"}
    (args.out / "queries.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(args.out / "queries.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
