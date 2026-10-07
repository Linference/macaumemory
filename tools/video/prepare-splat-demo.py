from pathlib import Path
import shutil,json,struct,subprocess
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/video/macau-memory-film-v2-20261004'
project=next((OUT/'reconstruction').iterdir())
snapshots=project/'work/colmap/sparse/snapshots'
snapshot=sorted(x for x in snapshots.iterdir() if x.is_dir())[-1]
dataset=OUT/'splat-training/dataset';target=dataset/'sparse/0';target.mkdir(parents=True,exist_ok=True);images=dataset/'images';images.mkdir(parents=True,exist_ok=True)
for name in ['images.bin','cameras.bin','points3D.bin']:shutil.copy2(snapshot/name,target/name)
for f in (project/'work/frames').iterdir():shutil.copy2(f,images/f.name)
with (target/'images.bin').open('rb') as f:n=struct.unpack('<Q',f.read(8))[0]
metadata={'inputFrames':len(list(images.iterdir())),'registeredCameras':n,'snapshot':snapshot.name,'steps':3000,'maxResolution':960,'source':'user supplied St Paul aerial recording','engine':'Brush used by MacauSplat'}
(OUT/'data/splat-demo.json').write_text(json.dumps(metadata,indent=2))
print(metadata,flush=True)
log=(OUT/'qa/brush-demo.log').open('wb')
result=subprocess.run(['D:/MacauSplat/engines/brush/brush_app.exe','--total-steps','3000','--max-resolution','960','--export-every','1000','--export-path',str(OUT/'splat-training'),'--export-name','stpaul-{iter}.ply',str(dataset)],stdout=log,stderr=subprocess.STDOUT)
print('BRUSH_EXIT',result.returncode,flush=True)
raise SystemExit(result.returncode)
