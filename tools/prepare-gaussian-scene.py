"""Register the actual St Paul reconstruction and a calibrated camera pose."""
import json,struct
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
PROJECT=ROOT/'output/video/macau-memory-film-v2-20261004/reconstruction/20261004-184530_屏幕录制 2026-10-04 183621'
SPARSE=PROJECT/'work/colmap/sparse/0'
with (SPARSE/'images.bin').open('rb') as f:
 count=struct.unpack('<Q',f.read(8))[0]
 for _ in range(count):
  image_id,*values=struct.unpack('<I7dI',f.read(64));q=values[:4];t=np.array(values[4:7]);name=b''
  while (b:=f.read(1))!=b'\0':name+=b
  n=struct.unpack('<Q',f.read(8))[0];points=np.frombuffer(f.read(n*24),dtype=[('x','<f8'),('y','<f8'),('id','<i8')])
  if name.decode()=='frame_000144.jpg':record=(q,t,points.copy());break
q,t,observations=record
positions={}
with (SPARSE/'points3D.bin').open('rb') as f:
 count=struct.unpack('<Q',f.read(8))[0]
 for _ in range(count):
  values=struct.unpack('<Q3d3BdQ',f.read(51));positions[values[0]]=values[1:4];f.seek(values[-1]*8,1)
valid=observations[observations['id']>=0]
cx,cy=np.median(valid['x']),np.median(valid['y'])
chosen=sorted(valid,key=lambda p:((p['x']-cx)/max(cx,1))**2+((p['y']-cy)/max(cy,1))**2)[:40]
target=np.median([positions[int(p['id'])] for p in chosen if int(p['id']) in positions],axis=0)
w,x,y,z=q
R=np.array([[1-2*y*y-2*z*z,2*x*y-2*w*z,2*x*z+2*w*y],[2*x*y+2*w*z,1-2*x*x-2*z*z,2*y*z-2*w*x],[2*x*z-2*w*y,2*y*z+2*w*x,1-2*x*x-2*y*y]])
flip=np.array([-1,-1,1]);eye=(-R.T@t)*flip;up=(R.T@np.array([0,-1,0]))*flip
scene={'id':'ruins-st-paul','title':'大三巴牌坊 · 實景記憶','description':'使用航拍多視角影像重建，旋轉或縮放探索建築與周邊街巷。','file':'gaussian/stpaul/scene.ply','splatCount':657492,'fileSize':155169663,'shBands':3,'camera':{'position':eye.tolist(),'target':(target*flip).tolist(),'up':up.tolist(),'fov':52},'source':'使用者提供的大三巴航拍素材；MacauSplat / COLMAP / Brush 實際訓練輸出','storage':'Original PLY bytes; all Gaussian points and original SH coefficients retained. No model conversion or downsampling.','sourceCamera':'frame_000144.jpg'}
(ROOT/'public/data/gaussian-scenes.json').write_text(json.dumps({'version':1,'scenes':[scene]},ensure_ascii=False,indent=2),encoding='utf8')
print('Calibrated scene registered:',scene['camera'])
