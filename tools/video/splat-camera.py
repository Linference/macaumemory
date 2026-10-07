import struct,json,numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'output/video/macau-memory-film-v2-20261004'
f=(OUT/'splat-training/dataset/sparse/0/images.bin').open('rb');n=struct.unpack('<Q',f.read(8))[0];cams=[]
for i in range(n):
 id,*values=struct.unpack('<I7dI',f.read(64));q=np.array(values[:4]);t=np.array(values[4:7]);name=b''
 while (b:=f.read(1))!=b'\0':name+=b
 pts=struct.unpack('<Q',f.read(8))[0];f.seek(pts*24,1)
 w,x,y,z=q;R=np.array([[1-2*y*y-2*z*z,2*x*y-2*w*z,2*x*z+2*w*y],[2*x*y+2*w*z,1-2*x*x-2*z*z,2*y*z-2*w*x],[2*x*z-2*w*y,2*y*z+2*w*x,1-2*x*x-2*y*y]])
 center=-R.T@t;direction=R.T@np.array([0,0,1]);up=R.T@np.array([0,-1,0]);flip=np.array([-1,-1,1]);cams.append({'id':id,'name':name.decode(),'position':(center*flip).tolist(),'direction':(direction*flip).tolist(),'up':(up*flip).tolist()})
(OUT/'assets/cameras.json').write_text(json.dumps(sorted(cams,key=lambda a:a['name'])))
print(n,'cameras')
