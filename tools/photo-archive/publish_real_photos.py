"""Publish curated local photographs as city-memory albums, without running ML.

Run with Python + Pillow. Keeps existing memory IDs and leaves recognition data
untouched. Coordinates identify the building, not the photographer's GPS.
"""
import csv
import hashlib
import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'public/data'


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def rows(path):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))


def taken_date(value):
    # Truncated natural-language dates in the source CSV are not reliable.
    match = re.match(r'^\d{4}-\d{2}-\d{2}(?=\b|T)', value or '')
    if not match:
        return None
    try:
        return datetime.strptime(match[0], '%Y-%m-%d').strftime('%Y-%m-%d')
    except ValueError:
        return None


def main():
    old = read_json(DATA / 'places.geojson')
    existing = {f['properties']['nearId']: f['properties'] for f in old['features']}
    spots = {a['id']: a for a in read_json(DATA / 'attractions.json')['attractions']}
    buildings = read_json(DATA / 'memory-embeddings.json')['buildings']
    grouped = defaultdict(list)
    for row in rows(ROOT / 'photos-src/cc/ATTRIBUTION.csv'):
        row['source'] = 'wikimedia_commons'
        grouped[row['building_id']].append(row)
    # These photographs were supplied and curated locally by the project owner.
    for row in rows(ROOT / 'photos-src/cc/ATTRIBUTION-user-provided.csv'):
        row['credit'] = '專案提供的建築實拍照片'
        grouped[row['building_id']].append(row)
    # Include the dataset's documented multi-year photographs for city memory.
    for row in rows(ROOT / 'datasets/macau-buildings/ATTRIBUTION.csv'):
        if 'Taipa Houses Museum' in row['commons_title']:
            row['source'] = 'wikimedia_commons'
            grouped['taipa-houses'].append(row)

    output = ROOT / 'public/photos/real'
    (output / 'thumb').mkdir(parents=True, exist_ok=True)
    features, single_photos, archive = [], [], []
    used_ids = {p['id'] for p in existing.values()}
    next_id = 1
    for building in sorted(buildings, key=lambda b: b['id']):
        spot = spots.get(building.get('spot'))
        if not spot:
            continue  # Never infer a building position from a nearby landmark.
        candidates, seen = [], set()
        for row in grouped[building['id']]:
            if row['source'] == 'wikimedia_commons' and not all(row.get(k) for k in ('author', 'license', 'source_page')):
                continue
            source = ROOT / row['file']
            if not source.is_file():
                continue
            fingerprint = hashlib.sha256(source.read_bytes()).hexdigest()
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            candidates.append((row, source, fingerprint))
        if not candidates:
            continue
        prior = existing.get(spot['id'], {})
        pid = prior.get('id')
        if not pid:
            while f'MM-{next_id:04}' in used_ids:
                next_id += 1
            pid = f'MM-{next_id:04}'
            used_ids.add(pid)
        photos = []
        # Curated Commons + local images; retain all documented dates and views.
        for row, source, fingerprint in candidates:
            name = f"{building['id']}-{fingerprint[:12]}.webp"
            if not (output / name).exists() or not (output / 'thumb' / name).exists():
                with Image.open(source) as original:
                    image = ImageOps.exif_transpose(original).convert('RGB')
                    image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
                    image.save(output / name, 'WEBP', quality=87)
                    image.thumbnail((420, 420), Image.Resampling.LANCZOS)
                    image.save(output / 'thumb' / name, 'WEBP', quality=80)
            author, license_name = row.get('author', ''), row.get('license', '')
            photos.append({
                'file': f'photos/real/{name}', 'thumb': f'photos/real/thumb/{name}',
                'orig': source.name, 'taken': taken_date(row.get('date') or row.get('taken')),
                'dateOriginal': row.get('date') or row.get('taken') or '',
                'source': row['source'], 'author': author, 'license': license_name,
                'sourcePage': row.get('source_page', ''),
                'credit': row.get('credit') or ' · '.join(filter(None, [author, license_name, 'Wikimedia Commons'])),
                'geoSource': 'building-catalog',
            })
        photos.sort(key=lambda ph: (ph['taken'] is None, ph['taken'] or '', ph['file']))
        dated = [ph['taken'] for ph in photos if ph['taken']]
        # Prefer a full exterior, not an interior/detail or an undocumented image.
        cover = next((ph for ph in photos if ph['source'] == 'wikimedia_commons'
                      and not re.search(r'interior|inside|door|board|baord|decoration|夜', ph['orig'], re.I)), photos[0])
        cls = building['cls']
        taxonomy = old['taxonomy'][cls]
        p = {
            'id': pid, 'zh': building['zh'], 'nearId': spot['id'], 'nearZh': spot['zh'],
            'cls': cls, 'clsZh': taxonomy['zh'], 'color': taxonomy['color'],
            'clsSource': 'catalog', 'clsWhy': '建築名錄與實拍照片來源對應',
            'caption': prior.get('caption') or spot.get('brief') or '',
            'tags': prior.get('tags', []), 'style': prior.get('style'),
            'cover': cover['file'], 'coverThumb': cover['thumb'],
            'photos': photos, 'photoCount': len(photos),
            'firstSeen': min(dated) if dated else None, 'lastSeen': max(dated) if dated else None,
            'lon': spot['coords'][0], 'lat': spot['coords'][1],
            'geoSource': 'building-catalog', 'needsReview': False,
        }
        geometry = {'type': 'Point', 'coordinates': spot['coords']}
        features.append({'type': 'Feature', 'properties': p, 'geometry': geometry})
        archive.append({**p, 'coords': spot['coords']})
        for i, ph in enumerate(photos):
            single_photos.append({'type': 'Feature', 'geometry': geometry,
                                  'properties': {**{k: v for k, v in p.items() if k not in ('photos', 'cover', 'coverThumb')},
                                                 **ph, 'id': f'{pid}-photo-{i + 1}'}})
    generated = datetime.now().isoformat(timespec='seconds')
    common = {'type': 'FeatureCollection', 'name': '澳門記憶 · 建築實拍照片',
              'generated': generated, 'taxonomy': old['taxonomy']}
    for filename, payload in [
        ('places.geojson', {**common, 'features': features}),
        ('photos.geojson', {**common, 'features': single_photos}),
        ('photo-archive.json', {'generated': generated, 'places': archive,
                                'counts': {'places': len(features), 'photos': len(single_photos)}}),
    ]:
        (DATA / filename).write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'Published {len(features)} building albums / {len(single_photos)} real photographs.')


if __name__ == '__main__':
    main()
