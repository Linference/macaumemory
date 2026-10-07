"""Actual privacy inference and a separate YOLO training demonstration.
No production weights or original dataset files are modified.
"""
import json, importlib.util
from pathlib import Path
from PIL import Image,ImageOps
from ultralytics import YOLO
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/video/macau-memory-film-v2-20261004'
spec=importlib.util.spec_from_file_location('pipeline',ROOT/'tools/photo-archive/pipeline.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
source=ROOT/'photos-src/cc/guiuan-village/Taipa_Village_03-02-2023_1_.jpg'
im=ImageOps.exif_transpose(Image.open(source)).convert('RGB')
det=m.Detector(str(ROOT/'yolo11n.pt'))
result=det.face_model.predict(im,verbose=False,conf=.35)[0]
boxes=[b.xyxy[0].tolist() for b in result.boxes]
after,count=det.blur_yolo_faces(im)
method='yolo-face';detail={'faces':count,'persons':0}
im.save(OUT/'assets/privacy-before.png');after.save(OUT/'assets/privacy-after.png')
(OUT/'data/privacy.json').write_text(json.dumps({'boxes':boxes,'count':count,'method':method,'detail':detail,'imageSize':im.size,'affectedRegion':max(boxes,key=lambda b:(b[2]-b[0])*(b[3]-b[1])) if boxes else None,'source':str(source)}),encoding='utf8')
print('PRIVACY',count,method,flush=True)
data=OUT/'data/yolo-demo.yaml'
data.write_text('path: '+(ROOT/'datasets/macau-buildings').as_posix()+'\ntrain: images/train\nval: images/val\nnames:\n'+''.join(f'  {i}: {n}\n' for i,n in enumerate(['portuguese','temple','church','tong_lau','residential_tower','casino_hotel','civic','industrial','village','monument','market'])),encoding='utf8')
if __name__=='__main__':
 model=YOLO(str(ROOT/'datasets/macau-buildings/runs/train-s/weights/best.pt'))
 model.train(data=str(data),epochs=1,imgsz=384,batch=4,device=0,workers=0,project=str(OUT/'training'),name='operation-demo',exist_ok=True,plots=True,verbose=True,cache=False,save=True,amp=True)
