"""MacauSplat -> TUJIAN memory scene: original PLY bytes, dated sidecar, provenance.

python memory-project.py export --project <project> --settings <json> --out <new directory>
python memory-project.py inspect --project <project>
Python 3.10+, standard library only. Does not modify reconstruction or model files.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import sys
import uuid


def read_json(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def sha256(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def validate_pose(camera):
    if not isinstance(camera, dict):
        raise ValueError('观察视角应为 JSON 对象。')
    for key in ('position', 'target', 'up'):
        values = camera.get(key)
        if not isinstance(values, list) or len(values) != 3 or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values):
            raise ValueError('相机 position / target / up 必须为有限三维向量。')
    fov = camera.get('fov', 52)
    if not isinstance(fov, (int, float)) or not math.isfinite(fov) or not 10 <= fov <= 120:
        raise ValueError('相机 FOV 必须在 10–120 度。')
    if math.dist(camera['position'], camera['target']) < 1e-5 or math.hypot(*camera['up']) < 1e-5:
        raise ValueError('相机方向无效。')
    direction = [camera['position'][i]-camera['target'][i] for i in range(3)]
    up = camera['up']
    cross = [direction[1]*up[2]-direction[2]*up[1],direction[2]*up[0]-direction[0]*up[2],direction[0]*up[1]-direction[1]*up[0]]
    if math.hypot(*cross)/(math.hypot(*direction)*math.hypot(*up)) < 1e-5:
        raise ValueError('相机上方向不能与观察方向平行。')
    return {key: camera[key] for key in ('position', 'target', 'up')} | {'fov': fov}


def ply_info(file):
    types = {'float': 'f', 'float32': 'f', 'double': 'd', 'float64': 'd', 'uchar': 'B', 'uint8': 'B', 'char': 'b', 'int8': 'b', 'short': 'h', 'ushort': 'H', 'int': 'i', 'uint': 'I'}
    with file.open('rb') as stream:
        lines = []
        while stream.tell() <= 65536:
            line = stream.readline()
            if not line: raise ValueError('PLY 文件头不完整。')
            lines.append(line.decode('ascii').strip())
            if lines[-1] == 'end_header': break
        else: raise ValueError('PLY 文件头过大。')
        if lines[0] != 'ply': raise ValueError('文件不是 PLY。')
        count = 0; properties = []; in_vertex = False; fmt = None
        for line in lines:
            parts = line.split()
            if parts[:1] == ['format']: fmt = parts[1]
            elif parts[:2] == ['element', 'vertex']: count = int(parts[2]); in_vertex = True
            elif parts[:1] == ['element']: in_vertex = False
            elif parts[:1] == ['property'] and in_vertex:
                if len(parts) != 3 or parts[1] not in types: raise ValueError('暂不支持该 PLY 顶点布局。')
                properties.append((parts[2], types[parts[1]]))
        if count < 1 or not {'x','y','z'}.issubset({k for k, _ in properties}): raise ValueError('缺少有效 PLY 顶点。')
        if fmt not in ('binary_little_endian','binary_big_endian'): raise ValueError('记忆发布包当前需要二进制高斯 PLY。')
        parser = struct.Struct(('<' if fmt == 'binary_little_endian' else '>') + ''.join(t for _,t in properties))
        offset = stream.tell()
        if file.stat().st_size < offset + count * parser.size: raise ValueError('PLY 数据长度不足。')
        indices = [next(i for i,(name,_) in enumerate(properties) if name == k) for k in ('x','y','z')]
        points = []; step = max(1, count // 10000)
        for i in range(0, count, step):
            stream.seek(offset + i * parser.size); row = parser.unpack(stream.read(parser.size)); xyz = [row[j] for j in indices]
            if all(math.isfinite(v) for v in xyz): points.append([-xyz[0],-xyz[1],xyz[2]])
        if not points: raise ValueError('PLY 未找到有限坐标。')
        axes = [sorted(p[i] for p in points) for i in range(3)]
        target = [a[len(a)//2] for a in axes]
        radius = max(.01, math.hypot(*(a[int((len(a)-1)*.95)]-a[int((len(a)-1)*.05)] for a in axes)))
        camera = {'position':[target[0]+radius*.5,target[1]+radius*.25,target[2]+radius*1.2],'target':target,'up':[0,1,0],'fov':52}
        return {'splatCount':count,'shBands':3 if any(name=='f_rest_44' for name,_ in properties) else None,'camera':camera}


def inspect(project):
    meta_file = next((project/f for f in ('project.json','metadata.json') if (project/f).is_file()),None)
    meta = read_json(meta_file) if meta_file else {}
    reports = []
    for file in [project/'precision-report.json', project/'annotation'/'review-quality.json']:
        if file.is_file(): reports.append({'file':str(file.relative_to(project)),'report':read_json(file)})
    sidecar = project/'memory-project.json'
    return {'schemaVersion':1,'memory':read_json(sidecar) if sidecar.exists() else None,'qualityReports':reports,'projectName':meta.get('name',project.name),'modelPath':(meta.get('output') or {}).get('finalPly'),'registeredImages':(meta.get('output') or {}).get('registeredImages'),'inputImages':(meta.get('output') or {}).get('inputImages'),'scope':'既有工程和质量报告；不表示重建精度提升'}


def export(project, settings, out):
    if out.exists(): raise ValueError('输出目录已存在，请选择新的记忆发布目录。')
    if out == project or project in out.parents: raise ValueError('发布目录须放在原工程之外。')
    place_id = settings.get('placeId','').strip(); name = settings.get('name','').strip()
    if not place_id or len(place_id)>160 or not name or len(name)>120: raise ValueError('请填写建筑编号和名称。')
    date = settings.get('capturedAt') or None
    if date: dt.date.fromisoformat(date)
    label = settings.get('versionLabel','').strip()
    if not label or len(label)>120: raise ValueError('请填写采集版本名称。')
    old = project/'memory-project.json'
    previous = read_json(old) if old.exists() else None
    if previous and previous.get('placeId') != place_id:
        raise ValueError('这个工程已绑定其他建筑，请先核对编号。原始工程和版本记录未被覆盖。')
    assessment = inspect(project)
    candidate = Path(settings.get('modelPath') or assessment.get('modelPath') or project/'final.ply')
    if not candidate.is_absolute(): candidate = project/candidate
    candidate = candidate.resolve(strict=True)
    if not candidate.is_file() or candidate.suffix.lower()!='.ply': raise ValueError('请选择已生成的原始 PLY。')
    info = ply_info(candidate)
    pose = validate_pose(settings['camera']) if settings.get('camera') else info['camera']
    digest = sha256(candidate)
    manifest = {'schemaVersion':1,'kind':'tujian-memory-scene','createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'place':{'id':place_id,'name':name},'scene':{'title':name,'file':'scene.ply','sha256':digest,'fileSize':candidate.stat().st_size,'splatCount':info['splatCount'],'shBands':info['shBands'],'capturedAt':date,'versionLabel':label,'camera':pose,'coordinateConvention':'original PLY + viewer Z rotation 180 degrees','cameraSource':'user-confirmed-view' if settings.get('camera') else 'automatic-preview-check-required','source':settings.get('source',''),'description':settings.get('description','')},'quality':inspect(project)}
    out.mkdir(parents=True)
    shutil.copyfile(candidate,out/'scene.ply')
    if sha256(out/'scene.ply')!=digest: raise ValueError('模型复制校验失败。')
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    (out/'README.txt').write_text('在途见共创记忆页面选择对应建筑，导入 manifest.json 和 scene.ply。\n模型为原始字节。自动观察视角需在网站核对；可在实景页面导出确认后的相机 JSON。\n采集日期由作者填写，未填写即为未知。\n',encoding='utf-8')
    if previous:
        shutil.copyfile(old,project/f'memory-project.backup-{uuid.uuid4().hex[:12]}.json')
    sidecar = {'schemaVersion':1,'placeId':place_id,'name':name,'latestExport':str(out),'versions':(previous or {}).get('versions',[])+[manifest['scene']]}
    temporary = project/f'memory-project-{uuid.uuid4().hex}.tmp'
    temporary.write_text(json.dumps(sidecar,ensure_ascii=False,indent=2),encoding='utf-8'); temporary.replace(old)
    return {'bundlePath':str(out),'manifestPath':str(out/'manifest.json'),'sha256':digest,'bytes':candidate.stat().st_size,'splatCount':info['splatCount'],'cameraSource':manifest['scene']['cameraSource']}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('action',choices=['inspect','export']); parser.add_argument('--project',required=True); parser.add_argument('--settings'); parser.add_argument('--out'); args=parser.parse_args()
    project=Path(args.project).resolve(strict=True)
    if not project.is_dir(): raise ValueError('工程目录不存在。')
    if args.action=='inspect': result=inspect(project)
    else:
        if not args.settings or not args.out: raise ValueError('导出需要 --settings 和 --out。')
        result=export(project,read_json(Path(args.settings)),Path(args.out).resolve())
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':
    try: main()
    except Exception as error: print(str(error),file=sys.stderr); sys.exit(1)
