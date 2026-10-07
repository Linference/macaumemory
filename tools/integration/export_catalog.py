"""Build the shared website/WeChat place contract from published real albums."""
import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def build_catalog():
    read = lambda name: json.loads((ROOT / 'public/data' / name).read_text(encoding='utf-8'))
    places = read('places.geojson')['features']
    buildings = read('memory-embeddings.json')['buildings']
    by_spot = {b['spot']: b for b in buildings if b.get('spot')}
    items = []
    for feature in places:
        p = feature['properties']
        b = by_spot.get(p['nearId'])
        if not b:
            raise ValueError(f"Unmapped memory place: {p['id']}")
        # Select a small real-photo gallery for the mini-program subpackage.
        ordered = [next(ph for ph in p['photos'] if ph['file'] == p['cover'])]
        dated = [ph for ph in p['photos'] if ph.get('taken')]
        ordered += dated[:1] + dated[-1:] + p['photos'][:3]
        gallery, seen = [], set()
        for ph in ordered:
            if ph['file'] in seen or len(gallery) >= 4:
                continue
            seen.add(ph['file'])
            gallery.append({k: ph.get(k) for k in ('file', 'thumb', 'taken', 'credit', 'sourcePage', 'source', 'author', 'license')})
        items.append({'id': b['id'], 'spotId': p['nearId'], 'memoryId': p['id'],
                      'name': p['zh'], 'category': p['cls'], 'categoryName': p['clsZh'],
                      'coordinates': feature['geometry']['coordinates'], 'summary': p['caption'],
                      'photoCount': p['photoCount'], 'cover': p['coverThumb'], 'gallery': gallery,
                      'mapPath': f"./?spot={p['nearId']}", 'recognizePath': './recognize.html'})
    return {'schemaVersion': 1, 'coordinateSystem': 'WGS84',
            'counts': {'places': len(items), 'photos': sum(p['photoCount'] for p in items)},
            'places': items}


def export(destination=None):
    catalog = build_catalog()
    (ROOT / 'public/data/system-catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    if destination:
        target = Path(destination)
        target.mkdir(parents=True, exist_ok=True)
        snapshot = json.loads(json.dumps(catalog))
        for p in snapshot['places']:
            for ph in p['gallery']:
                source = ROOT / 'public' / ph['thumb']
                name = source.name
                (target / 'photos').mkdir(exist_ok=True)
                shutil.copyfile(source, target / 'photos' / name)
                ph['image'] = '/pages2/city-memory/photos/' + name
                ph.pop('file', None)
                ph.pop('thumb', None)
            p['cover'] = p['gallery'][0]['image']
        (target / 'catalog.js').write_text('module.exports = ' + json.dumps(snapshot, ensure_ascii=False) + ';\n', encoding='utf-8')
    print(f"Shared catalog: {catalog['counts']['places']} places / {catalog['counts']['photos']} photos")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mini-out', help='WeChat pages2/city-memory destination (or staging directory)')
    export(parser.parse_args().mini_out)
