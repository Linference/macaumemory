from pathlib import Path
import os,json,subprocess,wave,re,csv,math
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageOps
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'output/video/tujian-detailed'
FF=Path('D:/MacauSplat/engines/ffmpeg-full/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe');W,H,FPS,SR=2560,1440,30,48000
for d in ['graphics','shots','scenes','joins','qa','subtitles']:(OUT/d).mkdir(parents=True,exist_ok=True)
S=json.loads((ROOT/'tools/video/detailed/script.json').read_text(encoding='utf8'))['scenes']
OLD=ROOT/'output/video/macau-memory-film-v2-20261004';SHORT=ROOT/'output/video/tujian-promo-60s';CAP=OUT/'captures'
def font(n,b=False):return ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc' if b else 'C:/Windows/Fonts/msjh.ttc',n)
def run(args):
 r=subprocess.run([str(FF),'-hide_banner','-loglevel','error','-y',*map(str,args)],capture_output=True,text=True,encoding='utf8',errors='replace')
 if r.returncode:raise RuntimeError(r.stderr[-4000:])
def enc():return ['-c:v','h264_nvenc','-preset','p6','-rc','vbr','-cq','18','-b:v','0','-pix_fmt','yuv420p']
def fit(path,size):return ImageOps.fit(Image.open(path).convert('RGB'),size,method=Image.Resampling.LANCZOS)
def text(im,xy,s,n=40,color='#f4f1e8',bold=False):ImageDraw.Draw(im).text(xy,s,font=font(n,bold),fill=color)
def duration(path):
 with wave.open(str(path)) as f:return f.getnframes()/f.getframerate()
offset=0
for s in S:
 s['seconds']=math.ceil(max(s['duration'],duration(OUT/'audio'/f"{s['id']}.wav")+3)*30)/30
 s['start']=offset;s['voiceStart']=offset+.8;offset+=s['seconds']-.7
TOTAL=round(offset+.7,3)
(OUT/'timeline.json').write_text(json.dumps({'duration':TOTAL,'voice':403007,'scenes':S},ensure_ascii=False,indent=2),encoding='utf8')
def assets():
 # Actual before/after outputs from the existing privacy pipeline.
 im=Image.new('RGB',(W,H),'#0c2226');im.paste(fit(OLD/'assets/privacy-before.png',(1180,920)),(70,210));im.paste(fit(OLD/'assets/privacy-after.png',(1180,920)),(1310,210));text(im,(80,105),'處理前',60,bold=True);text(im,(1320,105),'處理後',60,bold=True);text(im,(80,1180),'實際素材輸出 · 人臉區域模糊 · 保留建築內容',40);im.save(OUT/'graphics/privacy.png')
 # Enlarge the actual affected face region, not an invented blur example.
 meta=json.loads((OLD/'data/privacy.json').read_text());x0,y0,x1,y1=meta['affectedRegion'];box=(max(0,x0-30),max(0,y0-35),x1+30,y1+35)
 im=Image.new('RGB',(W,H),'#0c2226')
 for i,name in enumerate(['privacy-before.png','privacy-after.png']):
  crop=Image.open(OLD/'assets'/name).crop(box);im.paste(ImageOps.fit(crop,(760,980)),(380+i*1060,190));text(im,(380+i*1060,110),'處理前' if i==0 else '處理後',48)
 text(im,(380,1240),'同一人臉區域的實際處理對照',40);im.save(OUT/'graphics/privacy-close.png')
 im=Image.new('RGB',(W,H),'#0c2226');im.paste(fit(ROOT/'datasets/macau-buildings/runs/train-s/train_batch0.jpg',(1250,1080)),(80,100));text(im,(1420,200),'YOLO 建築偵測',60,bold=True)
 for i,line in enumerate(['建築區域與類型標註','訓練與驗證資料分工','既有訓練樣本展示','具體建築身份另由檢索確認']):text(im,(1420,400+i*140),line,39)
 im.save(OUT/'graphics/training.png')
 rows=[{k.strip():float(v) for k,v in r.items()} for r in csv.DictReader((ROOT/'datasets/macau-buildings/runs/train-s/results.csv').open(encoding='utf8'))]
 im=Image.new('RGB',(W,H),'#0c2226');d=ImageDraw.Draw(im);text(im,(110,85),'既有訓練紀錄 · 曲線回放',64,bold=True)
 for j,(key,label,color) in enumerate([('train/box_loss','建築框定位損失','#e3c277'),('metrics/mAP50(B)','驗證集 mAP@0.5','#79c6bf')]):
  x=120+j*1250;y=430;ww=1050;hh=600;v=[r[key] for r in rows];hi=max(v)*1.1
  text(im,(x,270),label,42)
  for k in range(5):d.line((x,y+k*hh/4,x+ww,y+k*hh/4),fill='#31484a',width=2)
  d.line([(x+i*ww/(len(v)-1),y+hh-z/hi*hh) for i,z in enumerate(v)],fill=color,width=5)
  text(im,(x,1080),f'{len(v)} 輪訓練紀錄',32)
 text(im,(120,1200),'偵測指標與具體建築身份檢索屬於不同任務',38);im.save(OUT/'graphics/curves.png')
 frames=sorted((next((OLD/'reconstruction').iterdir())/'work/frames').glob('*.jpg'))
 if not frames:frames=sorted((next((OLD/'reconstruction').iterdir())/'work/frames').glob('*.jpeg'))
 im=Image.new('RGB',(W,H),'#0c2226');text(im,(90,60),'多視角採集 · 實際抽取影格',58,bold=True)
 for i,q in enumerate([.05,.18,.34,.51,.7,.88]):
  p=frames[min(len(frames)-1,int(len(frames)*q))];x=90+(i%3)*800;y=210+(i//3)*480;im.paste(fit(p,(760,430)),(x,y));text(im,(x+12,y+365),p.stem,24)
 text(im,(90,1230),'FFmpeg 抽幀 → COLMAP 匹配與位姿 → Brush 高斯訓練',36);im.save(OUT/'graphics/frames.png')
 im=Image.new('RGB',(W,H),'#0c2226');text(im,(120,115),'GMVR 地理感知多視角辨識',65,bold=True)
 for i,(a,b) in enumerate([('影像','建築區域與影像特徵'),('位置','附近候選與定位品質'),('多照片','不同視角的一致性'),('人工確認','核對身份及建築座標')]):
  x=140+i*615;d=ImageDraw.Draw(im);d.rounded_rectangle((x,450,x+520,990),radius=30,fill='#17353a',outline='#8b825b',width=2);text(im,(x+45,520),a,55,color='#e5c983',bold=True);text(im,(x+35,720),b,30)
 im.save(OUT/'graphics/gmvr.png')
 im=Image.new('RGB',(W,H),'#0c2226');text(im,(150,300),'途見',150,color='#e5c983',bold=True);text(im,(150,530),'看見一座城，留下每一處記憶。',62);text(im,(150,700),'基於 3DGS 與 GMVR 的澳門文旅記憶系統',40);text(im,(150,1020),'空間記錄 · 融合辨識 · 普通建築建檔 · 居民共創',36);text(im,(150,1170),'實拍素材／CC BY-SA 照片；重建沿用 OOOSplat、COLMAP 與 Brush 工具鏈。',25);im.save(OUT/'graphics/ending.png')
def overlay(s):
 im=Image.new('RGBA',(W,H));d=ImageDraw.Draw(im)
 for y in range(1060,H):d.line((0,y,W,y),fill=(4,19,22,int(225*(y-1060)/380)))
 text(im,(90,1130),s['id']+' / TUJIAN',24,color='#e4c681');text(im,(90,1170),s['title'],58,bold=True);text(im,(90,1250),s['caption'],31)
 if s['visual']=='guide':d.rounded_rectangle((1900,45,2480,110),radius=15,fill=(5,19,22,210));text(im,(1930,57),'模擬定位觸發／佩戴體驗示意',27)
 if s['visual'] in ['ordinary','memory']:text(im,(2130,55),'操作表單示範',27,color='#efddac')
 im.save(OUT/'graphics'/f"overlay-{s['id']}.png")
def sources(s):
 v=s['visual'];real=ROOT/'output/pdf/assets';new=SHORT/'captures';ai=SHORT/'ai'
 return {
 'opening':[(ai/'opening.mp4',0),(real/'tonglau-real.jpg',0),(real/'stpaul-2010.jpg',0)],
 'system':[(CAP/'system.webm',3),(OUT/'graphics/gmvr.png',0)],
 'recognition':[(new/'recognition-2k.webm',4.3),(new/'recognition-result.png',0)],
 'multiview':[(new/'recognition-2k.webm',11),(OUT/'graphics/gmvr.png',0),(new/'multiview.png',0)],
 'ordinary':[(CAP/'ordinary.webm',3),(real/'tonglau-real.jpg',0)],
 'privacy':[(OUT/'graphics/privacy.png',0),(OUT/'graphics/privacy-close.png',0)],
 'training':[(OUT/'graphics/training.png',0),(OUT/'graphics/curves.png',0)],
 'reconstruction':[(next((OLD/'reconstruction').iterdir())/'source/input.mp4',4),(OUT/'graphics/frames.png',0)],
 'splat':[(new/'splat-2k.webm',3),(new/'splat-orbit.png',0)],
 'memory':[(CAP/'memory.webm',3)],'puzzle':[(CAP/'puzzle.webm',3)],
 'guide':[(CAP/'guide.webm',6),(ai/'rokid-hero.mp4',0),(ai/'rokid-experience.mp4',0)],
 'learning':[(CAP/'learning.webm',3),(CAP/'system.webm',8)],
 'ending':[(new/'splat-2k.webm',4),(OUT/'graphics/ending.png',0)]}[v]
def make_scene(s):
 dest=OUT/'scenes'/f"{s['id']}.mp4"
 if dest.exists():return dest
 overlay(s);srcs=sources(s);paths=[];d=s['seconds']/len(srcs)
 for i,(src,start) in enumerate(srcs):
  if not src.exists():raise FileNotFoundError(src)
  shot=OUT/'shots'/f"{s['id']}-{i}.mp4";paths.append(shot)
  if shot.exists():continue
  inp=['-ss',start,'-i',src] if src.suffix in ['.webm','.mp4'] else ['-loop','1','-i',src]
  vf=f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps=30,tpad=stop_mode=clone:stop_duration={d}'
  if src.suffix not in ['.mp4','.webm']:
   vf=f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},zoompan=z='min(1.035,1+on*0.00006)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={W}x{H}:fps=30,setsar=1"
  filters=f'[0:v]{vf}[v];[1:v]format=rgba,fade=t=in:st=0:d=0.4:alpha=1,fade=t=out:st=4:d=0.7:alpha=1[g];[v][g]overlay=0:0:shortest=1[out]'
  if src.parent==OUT/'graphics':filters=f'[0:v]{vf}[out]'
  run([*inp,'-loop','1','-i',OUT/'graphics'/f"overlay-{s['id']}.png",'-filter_complex_threads','2','-filter_complex',filters,'-map','[out]','-t',d,*enc(),'-an','-map_metadata','-1',shot])
 listing=OUT/'shots'/f"{s['id']}.txt";listing.write_text('\n'.join("file '"+p.as_posix()+"'" for p in paths),encoding='utf8')
 run(['-f','concat','-safe','0','-i',listing,'-c','copy',dest]);print('SCENE',s['id'],s['seconds'],flush=True);return dest
def read_audio(path):
 with wave.open(str(path)) as f:a=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(np.float32).reshape(-1,f.getnchannels()).mean(1)/32768;rate=f.getframerate()
 return np.interp(np.arange(round(len(a)*SR/rate))*rate/SR,np.arange(len(a)),a).astype(np.float32)
def ts(t):
 cs=round(t*100);h,cs=divmod(cs,360000);m,cs=divmod(cs,6000);sec,cs=divmod(cs,100);return f'{h}:{m:02}:{sec:02}.{cs:02}'
def audio():
 n=round(TOTAL*SR);voice=np.zeros(n,np.float32);active=np.zeros(n,np.float32);cues=[]
 for s in S:
  a=read_audio(OUT/'audio'/f"{s['id']}.wav");a*=min(2,.13/max(np.sqrt(np.mean(a*a)),1e-7));k=round(s['voiceStart']*SR);voice[k:k+len(a)]+=a;active[k:k+len(a)]=1
  parts=[]
  for m in re.finditer(r'[^，。；！？]+[，。；！？]?',s['text']):
   z=m.group()
   while z:parts.append(z[:26]);z=z[26:]
  weights=[len(p) for p in parts];bounds=[0];acc=0;dur=len(a)/SR
  energy=np.sqrt(np.mean(np.pad(a,(0,(-len(a))%480)).reshape(-1,480)**2,axis=1));silence=[];begin=None
  for i,e in enumerate(energy):
   if e<.007 and begin is None:begin=i
   if e>=.007 and begin is not None:
    if i-begin>=10:silence.append((begin+i)*.005)
    begin=None
  for w in weights[:-1]:
   acc+=w;ideal=dur*acc/sum(weights);near=[z for z in silence if abs(z-ideal)<.35 and z>bounds[-1]+.1];bounds.append(min(near,key=lambda z:abs(z-ideal)) if near else ideal)
  bounds.append(dur)
  for i,p in enumerate(parts):cues.append((s['voiceStart']+bounds[i],s['voiceStart']+bounds[i+1],p))
 music=np.zeros(n,np.float32)
 for j in range(math.ceil(TOTAL/4)):
  k=j*4*SR;nn=min(8*SR,n-k);t=np.arange(nn,dtype=np.float32)/SR;env=np.minimum(t/.4,1)*np.exp(-t/3)
  for midi in ([48,55,60,64] if j%2==0 else [45,52,57,60]):music[k:k+nn]+=.007*env*np.sin(2*np.pi*440*2**((midi-69)/12)*t)
 music*=1-.65*active;mix=voice+music;mix*=np.clip(np.minimum(np.arange(n)/SR,(n-np.arange(n))/SR/2),0,1)
 with wave.open(str(OUT/'audio/mix.wav'),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(SR);f.writeframes((np.clip(mix,-.98,.98)*32767).astype('<i2').tobytes())
 header='[Script Info]\nScriptType: v4.00+\nPlayResX: 2560\nPlayResY: 1440\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft JhengHei,46,&H00FFFFFF,&H00FFFFFF,&H00202020,&H85000000,0,0,0,0,100,100,0,0,3,1,0,2,100,100,45,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
 (OUT/'subtitles/普通話.ass').write_text(header+''.join(f'Dialogue: 0,{ts(a)},{ts(b)},Default,,0,0,0,,{p}\n' for a,b,p in cues),encoding='utf-8-sig')
 def srt(t):return ts(t).replace('.',',').rjust(11,'0')+'0'
 (OUT/'subtitles/普通話.srt').write_text('\n'.join(f'{i+1}\n{srt(a)} --> {srt(b)}\n{p}\n' for i,(a,b,p) in enumerate(cues)),encoding='utf-8-sig')
 (OUT/'旁白與分鏡.md').write_text('# 途見詳細講解影片\n\n'+f'長度 {TOTAL:.1f} 秒；2560×1440；30 fps；YunLeo 403007；正常語速。\n'+''.join(f"\n## {s['id']} {s['title']}\n\n{s['start']:.1f}–{s['start']+s['seconds']:.1f} 秒\n\n{s['text']}\n" for s in S),encoding='utf8')
def join(files):
 # Encode only the 0.7 s overlaps; concatenate the main bodies at original quality.
 parts=[]
 for i,(s,p) in enumerate(zip(S,files)):
  body=OUT/'joins'/f'body-{i}.mp4';start=.7 if i else 0;length=s['seconds']-start-(.7 if i<len(S)-1 else 0)
  if not body.exists():run(['-ss',start,'-i',p,'-t',length,*enc(),'-an',body])
  parts.append(body)
  if i<len(S)-1:
   trans=OUT/'joins'/f'fade-{i}.mp4'
   if not trans.exists():run(['-ss',s['seconds']-.7,'-i',p,'-i',files[i+1],'-filter_complex_threads','2','-filter_complex','[0:v]setpts=PTS-STARTPTS,settb=AVTB[a];[1:v]trim=duration=0.7,setpts=PTS-STARTPTS,settb=AVTB[b];[a][b]xfade=transition=fade:duration=0.7:offset=0[v]','-map','[v]','-t','0.7',*enc(),'-an',trans])
   parts.append(trans)
 listing=OUT/'joins/concat.txt';listing.write_text('\n'.join("file '"+p.as_posix()+"'" for p in parts),encoding='utf8')
 run(['-f','concat','-safe','0','-i',listing,'-c','copy',OUT/'picture-master.mp4'])
def main():
 assets();audio();files=[make_scene(s) for s in S];join(files)
 run(['-i',OUT/'picture-master.mp4','-i',OUT/'audio/mix.wav','-filter_threads','2','-vf','ass=subtitles/普通話.ass','-af','loudnorm=I=-16:TP=-1.5:LRA=9','-t',TOTAL,*enc(),'-c:a','aac','-b:a','256k','-ar','48000','-map_metadata','-1','-movflags','+faststart',OUT/'途見_詳細講解_普通話_2K.mp4']);print('FINAL',TOTAL,flush=True)
if __name__=='__main__':os.chdir(OUT);main()
