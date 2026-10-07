"""Audit MacauSplat auto-labels, sample a review bundle, evaluate manual truth.

This measures label quality, not building-recognition accuracy. One capture
session must stay in one split. No ground truth means no accuracy claim.
"""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import shutil


def valid_box(box):
    if not isinstance(box, list) or len(box) != 4 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in box):
        return False
    x, y, w, h = box
    return w > 0 and h > 0 and x - w/2 >= -1e-6 and y - h/2 >= -1e-6 and x + w/2 <= 1 + 1e-6 and y + h/2 <= 1 + 1e-6


def iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    intersection = max(0, min(ax+aw/2, bx+bw/2)-max(ax-aw/2, bx-bw/2)) * max(0, min(ay+ah/2, by+bh/2)-max(ay-ah/2, by-bh/2))
    return intersection / (aw*ah + bw*bh - intersection)


def audit(annotations):
    names, valid = set(), []
    errors = []
    for row in annotations:
        name = row.get('frame', '')
        if not name or Path(name).name != name or '\\' in name:
            errors.append('Unsafe frame name')
        if name in names:
            errors.append(f'Duplicate frame: {name}')
        names.add(name)
        accepted = row.get('accepted') is True
        if accepted and not valid_box(row.get('yolo')):
            errors.append(f'Invalid accepted box: {name}')
        if accepted and valid_box(row.get('yolo')):
            valid.append(row)
    return {'frames': len(annotations), 'accepted': len(valid),
            'acceptanceRate': len(valid)/len(annotations) if annotations else None,
            'rejected': len(annotations)-len(valid),
            'rejectionReasons': dict(Counter(row.get('reason') or 'unspecified' for row in annotations if not row.get('accepted'))),
            'errors': errors, 'qualityStatus': 'awaiting-independent-review'}


def evaluate(annotations, review):
    predictions = {r['frame']: r for r in annotations}
    labels = review.get('labels', [])
    seen = set()
    scores, positives, hits, emitted, negatives, false_positive = [], 0, 0, 0, 0, 0
    seconds = []
    for truth in labels:
        frame = truth['frame']
        if frame in seen or frame not in predictions:
            raise ValueError(f'Duplicate or unknown reviewed frame: {frame}')
        seen.add(frame)
        box = truth.get('bbox')
        if box is not None and not valid_box(box):
            raise ValueError(f'Invalid manual box: {frame}')
        prediction = predictions[frame]
        accepted = prediction.get('accepted') is True and valid_box(prediction.get('yolo'))
        emitted += int(accepted)
        if box is None:
            negatives += 1
            false_positive += int(accepted)
        else:
            positives += 1
            score = iou(prediction['yolo'], box) if accepted else 0
            scores.append(score)
            hits += int(score >= .5)
        elapsed = truth.get('seconds')
        if isinstance(elapsed, (int, float)) and not isinstance(elapsed, bool) and math.isfinite(elapsed) and elapsed >= 0:
            seconds.append(elapsed)
    divide = lambda n, d: n/d if d else None
    return {'status': 'reviewed' if labels else 'awaiting-independent-review',
            'reviewMode': review.get('mode'), 'reviewedFrames': len(labels),
            'positiveFrames': positives, 'negativeFrames': negatives,
            'meanIoUIncludingMisses': divide(sum(scores), positives),
            'recallAtIoU50': divide(hits, positives), 'precisionAtIoU50': divide(hits, emitted),
            'negativeFalseAcceptance': divide(false_positive, negatives),
            'annotationSeconds': sum(seconds) if seconds else None,
            'timedFrames': len(seconds), 'scope': 'reviewed sample only; not recognition accuracy'}


def check_split(manifest, session_id, split, hashes):
    for sample in manifest.get('samples', []):
        if sample.get('split') != split and (sample.get('sessionId') == session_id or sample.get('sha256') in hashes):
            raise ValueError('Capture session or identical image crosses train/val/test splits')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--annotations', required=True)
    ap.add_argument('--frames', help='Actual captured frames folder; required to create a review bundle')
    ap.add_argument('--building-id', required=True)
    ap.add_argument('--session-id', required=True)
    ap.add_argument('--scene-kind', choices=['building', 'indoor', 'object'], required=True)
    ap.add_argument('--split', choices=['train', 'val', 'test'], required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--review', help='Manual ground truth JSON exported by the review page')
    ap.add_argument('--manifest', help='Existing dataset manifest checked for split leakage')
    ap.add_argument('--max-samples', type=int, default=24)
    ap.add_argument('--review-template', help='Path to annotation-review.html')
    args = ap.parse_args()
    if args.max_samples <= 0:
        ap.error('--max-samples must be positive')
    annotations = json.loads(Path(args.annotations).read_text(encoding='utf-8'))
    report = audit(annotations)
    if report['errors']:
        raise ValueError('; '.join(report['errors']))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report.update({'schemaVersion': 1, 'buildingId': args.building_id, 'sessionId': args.session_id,
                   'sceneKind': args.scene_kind, 'split': args.split,
                   'annotationSha256': hashlib.sha256(Path(args.annotations).read_bytes()).hexdigest()})
    # Evenly distributed samples, separately from accepted and rejected frames.
    selected = []
    quota = max(1, args.max_samples//2)
    for group in [[r for r in annotations if r.get('accepted')], [r for r in annotations if not r.get('accepted')]]:
        n = min(len(group), quota)
        selected += [group[round(i*(len(group)-1)/max(1, n-1))] for i in range(n)]
    selected = selected[:args.max_samples]
    samples = []
    if args.frames:
        for row in selected:
            source = Path(args.frames) / row['frame']
            if not source.is_file():
                raise ValueError(f'Missing captured frame: {row["frame"]}')
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            samples.append({**row, 'sessionId': args.session_id, 'buildingId': args.building_id,
                            'split': args.split, 'sha256': digest, 'image': 'images/' + row['frame']})
        if args.manifest:
            check_split(json.loads(Path(args.manifest).read_text(encoding='utf-8')), args.session_id, args.split, {r['sha256'] for r in samples})
        (out / 'images').mkdir(exist_ok=True)
        for sample in samples:
            shutil.copyfile(Path(args.frames) / sample['frame'], out / sample['image'])
    if args.review:
        review = json.loads(Path(args.review).read_text(encoding='utf-8'))
        if review.get('sessionId') != args.session_id or review.get('annotationSha256') != report['annotationSha256']:
            raise ValueError('Manual review does not match this capture session and annotation version')
        report['manualComparison'] = evaluate(annotations, review)
    else:
        report['manualComparison'] = None
    bundle = {'schemaVersion': 1, 'report': report, 'samples': samples}
    (out / 'bundle.json').write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding='utf-8')
    if args.review_template and samples:
        template = Path(args.review_template).read_text(encoding='utf-8')
        payload = json.dumps(bundle, ensure_ascii=False).replace('<', '\\u003c')
        (out / 'review.html').write_text(template.replace('__BUNDLE_JSON__', payload), encoding='utf-8')
    (out / 'audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
