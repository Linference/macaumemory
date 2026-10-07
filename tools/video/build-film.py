"""1080p film: real recordings, per-frame Pillow/NumPy motion, 0.7 s transitions.
Run with the bundled Python. Common picture master is rendered once; language
tracks are mixed independently at their original speed. Original editions remain.
"""
import argparse,csv,json,math,re,subprocess,wave,functools,collections,os
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageOps,ImageFilter
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'output/video/macau-memory-film-v2-20261004'
W,H,FPS,SR=1920,1080,30,48000;TRANS=21
FF='D:/MacauSplat/engines/ffmpeg-full/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe'
A=OUT/'assets';CAP=A/'captures';OLD=ROOT/'docs/video/_work/web3min/assets/video'
SOURCE=Path('D:/Users/LINKIT/Desktop/屏幕录制 2026-10-04 183621.mp4')
SCENES=json.loads((OUT/'data/script.json').read_text(encoding='utf8'))['scenes']
WHITE='#f5f1e8';GOLD='#dfbd79';TEAL='#78cad2';DIM='#9baeb6';INK='#091219'
for d in ['renders','subtitles','qa']: (OUT/d).mkdir(exist_ok=True)
@functools.lru_cache(None)
def font(n,bold=False):return ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc' if bold else 'C:/Windows/Fonts/msjh.ttc',n)
def tx(im,xy,s,n=34,color=WHITE,bold=False):ImageDraw.Draw(im).text(xy,s,font=font(n,bold),fill=color,stroke_width=0)
def ease(x):x=max(0,min(1,x));return x*x*(3-2*x)
def duration(p):
 with wave.open(str(p)) as f:return f.getnframes()/f.getframerate()
offset=0;TIMES=[]
for i,s in enumerate(SCENES):
 voice=max(duration(A/'audio'/lang/(s['id']+'.wav')) for lang in ['mandarin','cantonese'])
 frames=math.ceil((voice+2.0+(1.2 if i==0 else 0)+(2.1 if i==len(SCENES)-1 else 0))*FPS)
 TIMES.append({'id':s['id'],'start':offset/FPS,'frames':frames,'duration':frames/FPS,'voiceStart':(offset/FPS)+(.95 if i else 1.6)})
 offset+=frames-(TRANS if i<len(SCENES)-1 else 0)
TOTAL=offset/FPS
(OUT/'data/picture-timeline.json').write_text(json.dumps({'duration':TOTAL,'fps':FPS,'transition':TRANS/FPS,'scenes':TIMES},ensure_ascii=False,indent=2),encoding='utf8')

@functools.lru_cache(32)
def picture(p):return Image.open(p).convert('RGB')
def fill(im,size=(W,H),focus=(.5,.5)):return ImageOps.fit(im,size,method=Image.Resampling.BICUBIC,centering=focus)
def pan(im,t,scale=1.07,focus=(.5,.5)):
 z=1+(scale-1)*ease(t);cw,ch=im.width/z,im.height/z
 x=max(0,min(im.width-cw,(im.width-cw)*focus[0]));y=max(0,min(im.height-ch,(im.height-ch)*focus[1]))
 return im.crop((int(x),int(y),int(x+cw),int(y+ch))).resize((W,H),Image.Resampling.BICUBIC)
def gradient():
 arr=np.zeros((H,W,4),np.uint8);arr[:,:,:3]=[4,10,15]
 arr[:,:,3]=(np.maximum(np.linspace(.48,0,W)[None,:],np.clip((np.arange(H)[:,None]-760)/320,0,.68))*255).astype(np.uint8)
 return Image.fromarray(arr)
SHADE=gradient()
def overlay(im,layer):return Image.alpha_composite(im.convert('RGBA'),layer).convert('RGB')
def headline(im,s,t,idx):
 layer=Image.new('RGBA',(W,H));d=ImageDraw.Draw(layer)
 alpha=1 if t<2.3 else max(0,1-(t-2.3)/1.0)
 if alpha:
  x=70; y=int(104+(1-ease(t/.75))*35)
  d.text((x,56),f'{idx+1:02}   /   MACAU MEMORY',font=font(18),fill=(226,191,127,int(alpha*255)))
  d.text((x,y),s['title'],font=font(47,True),fill=(247,243,234,int(alpha*255)),stroke_width=1,stroke_fill=(0,0,0,int(alpha*100)))
  d.line((x,y+75,x+160*ease(t/.7),y+75),fill=(226,191,127,int(alpha*255)),width=3)
 return overlay(im,layer)
def strap(im,text,second=None):
 l=Image.new('RGBA',(W,H));d=ImageDraw.Draw(l);d.rounded_rectangle((64,864,64+min(1300,40+font(27).getlength(text)),920),12,fill=(6,14,20,218));d.text((84,876),text,font=font(27),fill=WHITE)
 if second:d.text((84,939),second,font=font(20),fill=(217,196,157,255))
 return overlay(im,l)
class Video:
 def __init__(self,path,start=0):
  self.log=(OUT/'qa/decode.log').open('ab');self.p=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-threads','2','-stream_loop','-1','-ss',str(start),'-i',str(path),'-an','-vf',f'fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1','-threads','2','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE,stderr=self.log);self.last=None
 def frame(self):
  raw=self.p.stdout.read(W*H*3)
  if len(raw)!=W*H*3:
   if self.last is None:raise RuntimeError('Decoder failed')
   return self.last.copy()
  self.last=Image.frombytes('RGB',(W,H),raw);return self.last.copy()
 def close(self):
  self.p.stdout.close();self.p.terminate()
  try:self.p.wait(timeout=4)
  except subprocess.TimeoutExpired:self.p.kill()
  self.log.close()
class Shots:
 def __init__(self,shots,frames):self.shots=shots;self.frames=frames;self.segment=max(1,frames//len(shots));self.active=-1;self.video=None;self.tail=None
 def frame(self,f):
  i=min(len(self.shots)-1,f//self.segment);k=f-i*self.segment
  if i!=self.active:
   if self.video:self.video.close()
   item=self.shots[i];self.video=Video(item[0],item[1]) if Path(item[0]).suffix.lower() in ['.mp4','.webm'] else None;self.active=i
  item=self.shots[i];im=self.video.frame() if self.video else fill(picture(str(item[0])))
  im=pan(im,min(1,k/self.segment),item[2] if len(item)>2 else 1.05,item[3] if len(item)>3 else (.5,.5))
  if i>0 and k<TRANS and self.tail is not None:im=Image.blend(self.tail,im,ease(k/(TRANS-1)))
  if k==self.segment-1:self.tail=im.copy()
  return im
 def close(self):
  if self.video:self.video.close()

CURVES=list(csv.DictReader((ROOT/'datasets/macau-buildings/runs/train-s/results.csv').open(encoding='utf8')))
CURVES=[{k.strip():float(v) for k,v in row.items()} for row in CURVES]
PRIV=json.loads((OUT/'data/privacy.json').read_text())
def privacy(f,n):
 t=f/FPS;q=f/n;before=fill(picture(str(A/'privacy-before.png')));after=fill(picture(str(A/'privacy-after.png')))
 split=int(W*(1-ease((t-2.7)/5)));im=after.copy();im.paste(before.crop((0,0,split,H)),(0,0))
 d=ImageDraw.Draw(im);d.line((split,0,split,H),fill=GOLD,width=3)
 # A close-up of the region actually changed by the privacy pipeline.
 bx=PRIV['affectedRegion'];x0,y0,x1,y1=bx;crop=(max(0,x0-44),max(0,y0-68),x1+66,min(PRIV['imageSize'][1],y1+90))
 if t>5:
  z=ease((t-5)/.8);w,h=int(440*z),int(585*z)
  if w>2:
   face=picture(str(A/'privacy-after.png')).crop(crop).resize((w,h),Image.Resampling.BICUBIC)
   if t<8:
    front=picture(str(A/'privacy-before.png')).crop(crop).resize((w,h),Image.Resampling.BICUBIC);cut=int(w*(1-ease((t-5)/3)));face.paste(front.crop((0,0,cut,h)),(0,0));ImageDraw.Draw(face).line((cut,0,cut,h),fill=GOLD,width=3)
   im.paste(face,(W-w-90,220));d=ImageDraw.Draw(im);d.rectangle((W-w-90,220,W-90,220+h),outline=GOLD,width=3);tx(im,(W-w-80,220+h+15),'實際路人人臉 · 處理前後',23,GOLD)
 im=overlay(im,SHADE);return strap(im,'YOLO-face → 區域模糊 → 保留建築影像',f"本次示範：{PRIV['count']} 張人臉已處理")
def chart(im,box,values,title,color,q):
 x,y,w,h=box;d=ImageDraw.Draw(im);tx(im,(x,y-48),title,30,WHITE,True)
 for i in range(5):d.line((x,y+i*h/4,x+w,y+i*h/4),fill='#243843',width=1)
 hi=max(values)*1.13;lo=0;count=max(2,min(len(values),int(len(values)*ease(q))))
 pts=[(x+i*w/(len(values)-1),y+h-values[i]/hi*h) for i in range(count)]
 d.line(pts,fill=color,width=4);px,py=pts[-1];d.ellipse((px-6,py-6,px+6,py+6),fill=color)
 tx(im,(x,y+h+15),'1',20,DIM);tx(im,(x+w-50,y+h+15),str(len(values)),20,DIM);tx(im,(x+w//2-35,y+h+15),'Epoch',20,DIM)
def curves(f,n):
 q=f/n;im=Image.new('RGB',(W,H),INK)
 chart(im,(95,360,790,350),[r['train/box_loss'] for r in CURVES],'訓練框定位損失',GOLD,q*1.4)
 chart(im,(1040,360,790,350),[r['metrics/mAP50(B)'] for r in CURVES],'验证检测指标 · mAP@0.5',TEAL,q*1.4)
 count=min(len(CURVES),max(1,int(len(CURVES)*ease(q*1.4))));tx(im,(98,212),f'{count:03}',88,GOLD,True);tx(im,(282,259),'/ 142 轮既有训练记录',28,DIM)
 tx(im,(1040,236),'451 / 117',64,WHITE,True);tx(im,(1440,258),'训练 / 验证图像',27,DIM)
 return strap(im,'11 種建築類型 · 檢測模型與建築身份匹配分工協作','142 輪既有訓練曲線回放')
LOG=(OUT/'qa/yolo-operation.log').read_text(encoding='utf8',errors='replace')
LOGLINES=[re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',v).strip() for v in LOG.splitlines() if re.search(r'\s1/1\s|mAP50|\ball\s+\d|epoch|CUDA:0',v)]
def training(f,n):
 t=f/FPS;im=Image.new('RGB',(W,H),INK);batch=picture(str(ROOT/'datasets/macau-buildings/runs/train-s/train_batch0.jpg'))
 batch=ImageOps.fit(batch,(950,700));im.paste(batch,(70,210));d=ImageDraw.Draw(im);d.line((1050,230,1050,850),fill='#344753',width=1)
 tx(im,(1100,215),'LOCAL TRAINING',25,GOLD);tx(im,(1100,260),'YOLO · 实际运行日志',36,WHITE,True)
 end=max(1,min(len(LOGLINES),int(ease(f/n)*len(LOGLINES))));lines=LOGLINES[max(0,end-10):end]
 for i,line in enumerate(lines):tx(im,(1100,340+i*44),line[:49],20,TEAL if i==len(lines)-1 else DIM)
 tx(im,(1100,827),'独立训练试跑 / 日志回放',23,GOLD)
 return strap(im,'标注建筑 → 划分数据 → 运行训练 → 验证结果')
def extracts(f,n):
 im=Image.new('RGB',(W,H),INK);frames=sorted((next((OUT/'reconstruction').iterdir())/'work/frames').glob('*.jpg'))
 if not frames:frames=sorted((next((OUT/'reconstruction').iterdir())/'work/frames').glob('*.jpeg'))
 indices=[int(len(frames)*q) for q in [.05,.18,.34,.51,.7,.88]]
 for j,k in enumerate(indices):
  x,y=80+(j%3)*590,235+(j//3)*325;enter=ease((f/FPS-j*.1)/.75);yy=int(y+40*(1-enter));im.paste(ImageOps.fit(picture(str(frames[k])),(560,295)),(x,yy));tx(im,(x+12,yy+257),frames[k].stem,19,WHITE)
 return strap(im,'243 帧真实抽帧 · 同一场景，多视角采集','输入：用户提供的大三巴航拍片段')
def opening(im,t,closing=False):
 im=overlay(im,SHADE);l=Image.new('RGBA',(W,H));d=ImageDraw.Draw(l);a=ease(t/.9);dy=int(35*(1-a));x=95
 d.text((x,275+dy),'MACAU MEMORY',font=font(28),fill=(231,198,142,int(a*255)))
 d.text((x,336+dy),'澳 門 記 憶',font=font(102,True),fill=(247,243,234,int(a*255)))
 title='城市的記憶，從你開始。' if closing else '從影像，到城市記憶。'
 d.text((x,500+dy),title,font=font(49),fill=(247,243,234,int(a*255)))
 d.line((x,603,x+580*ease((t-.3)/.9),603),fill=(226,191,127,int(a*255)),width=3)
 return overlay(im,l)
def scene_frames(idx):
 s=SCENES[idx];n=TIMES[idx]['frames'];typ=s['type'];shots=None
 paths={
 'opening':[(SOURCE,2,1.03)],
 'map':[(OLD/'map-city.mp4',0,1.03),(CAP/'map-operation.webm',8,1.05)],
 'recognize':[(CAP/'recognize-operation.webm',5,1.08,(.25,.65))],
 'result':[(CAP/'recognize-operation.webm',14,1.14,(.74,.42)),(CAP/'extended-operation.webm',23,1.12,(.7,.6))],
 'archive':[(ROOT/'public/photos/real/red-market-f1bf06a963c7.webp',0,1.13),(CAP/'extended-operation.webm',29,1.08,(.67,.6))],
 'splat-input':[(SOURCE,12,1.03)],
 'splat-cloud':[(CAP/'splat-operation.webm',4,1.04)],
 'connection':[(CAP/'map-operation.webm',12,1.06),(CAP/'recognize-operation.webm',13,1.1),(CAP/'splat-operation.webm',7,1.04)],
 'ending':[(SOURCE,10,1.025)]}
 if typ in paths:shots=Shots(paths[typ],n)
 try:
  for f in range(n):
   t=f/FPS
   if typ=='privacy':im=privacy(f,n)
   elif typ=='training':im=training(f,n)
   elif typ=='curves':im=curves(f,n)
   elif typ=='splat-input' and f>n*.55:im=extracts(f-int(n*.55),n-int(n*.55))
   else:im=shots.frame(f)
   if typ in ['opening','ending']:im=opening(im,t,typ=='ending')
   else:
    if typ not in ['privacy','training','curves','recognize','result','archive','map'] and not (typ=='splat-input' and f>n*.55):im=overlay(im,SHADE)
    im=headline(im,s,t,idx)
   if typ=='result' and 1<t<7:im=strap(im,'實測候選：大三巴牌坊 · 圖像相似度 0.741','显示候选与参考照片，再由使用者确认')
   if typ=='archive' and t>n/FPS/2:im=strap(im,'建檔操作示範 · 編號 / 名稱 / 位置 / 記錄')
   if typ=='splat-cloud':im=strap(im,'MacauSplat · 本次素材的三维高斯训练输出','实际模型查看与视角操作')
   if typ=='ending' and f>n-150:
    tx(im,(95,761),'影像来源',20,GOLD);tx(im,(95,799),'大三巴航拍：用户提供素材，保留原片水印',20,WHITE)
    tx(im,(95,831),'示范照片：Ank Kumar · CC BY-SA 4.0；氹仔街景：LN9267 · CC BY-SA 4.0',20,WHITE);tx(im,(95,863),'红街市：Doraemon.tvb · CC BY-SA 3.0',20,WHITE)
    tx(im,(95,901),'重建工具基于 OOOSplat / COLMAP / Brush。',19,DIM)
   if f==min(n-1,90):im.save(OUT/'qa'/f'{s["id"]}.jpg',quality=91)
   yield im
 finally:
  if shots:shots.close()
def transition(a,b,q):
 # Cubic ease, subtle push, brief soft-focus and a restrained light sweep.
 e=ease(q);aa=pan(a,e,1.025);bb=pan(b,1-e,1.02);im=Image.blend(aa,bb,e)
 blur=1.0*math.sin(math.pi*q)
 if blur>.15:im=im.filter(ImageFilter.GaussianBlur(blur))
 l=Image.new('RGBA',(W,H));d=ImageDraw.Draw(l);x=int((-300+(W+600)*e));alpha=int(25*math.sin(math.pi*q));d.polygon([(x-180,0),(x-60,0),(x+230,H),(x+110,H)],fill=(234,204,153,alpha));return overlay(im,l)
def render():
 log=(OUT/'qa/picture-render.log').open('w');cmd=[FF,'-y','-hide_banner','-loglevel','warning','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-an','-c:v','h264_nvenc','-preset','p5','-cq','18','-b:v','0','-pix_fmt','yuv420p','-bf','0','-movflags','+faststart',str(OUT/'renders/picture-master.mp4')]
 p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log);pending=[];written=0
 try:
  for idx,s in enumerate(SCENES):
   gen=scene_frames(idx);q=collections.deque()
   print('RENDER',s['id'],TIMES[idx]['duration'],flush=True)
   for f,im in enumerate(gen):
    if idx and f<TRANS:
     out=transition(pending[f],im,f/(TRANS-1));p.stdin.write(out.tobytes());written+=1
    else:
     q.append(im)
     if len(q)>TRANS:p.stdin.write(q.popleft().tobytes());written+=1
   pending=list(q)
  for im in pending:p.stdin.write(im.tobytes());written+=1
 finally:p.stdin.close();p.wait();log.close()
 if p.returncode:raise RuntimeError('NVENC render failed')
 assert written==offset,(written,offset);print('PICTURE_DONE',written,TOTAL,flush=True)

def read_audio(p):
 with wave.open(str(p)) as f:
  a=np.frombuffer(f.readframes(f.getnframes()),'<i2').astype(np.float32)/32768;a=a.reshape(-1,f.getnchannels()).mean(axis=1);rate=f.getframerate()
 return np.interp(np.arange(round(len(a)*SR/rate))*rate/SR,np.arange(len(a)),a).astype(np.float32)
def write_audio(p,a):
 with wave.open(str(p),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes((np.clip(a,-.98,.98)*32767).astype('<i2').tobytes())
def synth_music(seconds):
 rng=np.random.default_rng(22);length=round(seconds*SR);music=np.zeros((length,2),np.float32);beat=60/92
 chords=[[50,57,62,65],[46,53,58,62],[48,55,60,64],[45,52,57,60]]
 def add(note,start,dur,amp,pan=0):
  nonlocal music
  n=round(dur*SR);t=np.arange(n,dtype=np.float32)/SR;freq=440*2**((note-69)/12)
  env=(1-np.exp(-t*50))*np.exp(-t*2.7)*np.clip((dur-t)/.16,0,1)
  v=(np.sin(2*np.pi*freq*t)+.30*np.sin(4*np.pi*freq*t)+.12*np.sin(6*np.pi*freq*t))*env*amp
  k=round(start*SR);n=min(n,length-k)
  if n>0:music[k:k+n,0]+=v[:n]*(1-pan*.4);music[k:k+n,1]+=v[:n]*(1+pan*.4)
 for b in range(math.ceil(seconds/beat)):
  chord=chords[(b//16)%4];add(chord[b%4]+12,b*beat,2.8,.043,(-1 if b%2 else 1)*.5)
  if b%4==0:add(chord[0]-12,b*beat,2.6,.052,0)
  if b%8==4:add(chord[2]+24,b*beat,3,.02,.6)
 for b in range(0,math.ceil(seconds/beat),16):
  chord=chords[(b//16)%4];dur=beat*17;n=min(round(dur*SR),length-round(b*beat*SR));t=np.arange(n,dtype=np.float32)/SR;env=np.clip(np.minimum(t/.9,(dur-t)/1.3),0,1);k=round(b*beat*SR)
  for note in chord:
   freq=440*2**((note-69)/12);music[k:k+n,0]+=np.sin(2*np.pi*freq*t)*env*.015;music[k:k+n,1]+=np.sin(2*np.pi*(freq+.13)*t)*env*.015
 return music
def chunks(text,max_chars=21):
 out=[];pos=0
 for m in re.finditer(r'[^，。！？；：]+[，。！？；：]?',text):
  v=m.group();start=m.start()
  while v:
   part=v[:max_chars];out.append((start,start+len(part),part));v=v[max_chars:];start+=len(part)
 return out
def cues(lang,s,a):
 text=s[lang];meta=json.loads((A/'audio'/lang/(s['id']+'.json')).read_text(encoding='utf8'));parts=chunks(text)
 if meta.get('subtitles'):
  items=meta['subtitles'];out=[]
  for l,r,v in parts:
   hits=[x for x in items if x.get('BeginIndex',0)<r and x.get('EndIndex',0)>l]
   if hits:out.append((hits[0]['BeginTime']/1000,hits[-1]['EndTime']/1000,v))
  return out
 # Mandarin YunLeo supplies no timestamps. Local RMS silence boundaries are
 # matched to punctuation boundaries; no cloud ASR upload is performed.
 win=480;pad=(-len(a))%win;v=np.pad(a,(0,pad));energy=np.sqrt(np.mean(v.reshape(-1,win)**2,axis=1));active=np.where(energy>.008)[0]
 start=active[0]*.01 if len(active) else 0;end=(active[-1]+1)*.01 if len(active) else len(a)/SR
 silence=energy<.007;groups=[];begin=None
 for i,z in enumerate(silence):
  if z and begin is None:begin=i
  if not z and begin is not None:
   if i-begin>=12 and start<begin*.01<end:groups.append((begin+i)*.005)
   begin=None
 boundaries=[start];weights=[len(re.sub(r'\W','',v)) or 1 for _,_,v in parts];total=sum(weights);cumulative=0
 for w in weights[:-1]:
  cumulative+=w;ideal=start+(end-start)*cumulative/total;near=[x for x in groups if abs(x-ideal)<.5 and x>boundaries[-1]+.2];boundaries.append(min(near,key=lambda x:abs(x-ideal)) if near else ideal)
 boundaries.append(end);return [(boundaries[i],boundaries[i+1],v) for i,(_,_,v) in enumerate(parts)]
def ass_time(t):
 cs=round(t*100);h,cs=divmod(cs,360000);m,cs=divmod(cs,6000);s,cs=divmod(cs,100);return f'{h}:{m:02}:{s:02}.{cs:02}'
def audio_and_captions(lang):
 count=round(TOTAL*SR);voice=np.zeros(count,np.float32);captions=[];activity=np.zeros(count,np.float32)
 for s,t in zip(SCENES,TIMES):
  a=read_audio(A/'audio'/lang/(s['id']+'.wav'));rms=np.sqrt(np.mean(a*a));a*=min(2,.13/max(rms,1e-7));k=round(t['voiceStart']*SR);voice[k:k+len(a)]+=a;activity[max(0,k-9600):min(count,k+len(a)+14400)]=1
  for l,r,text in cues(lang,s,a):captions.append([t['voiceStart']+l,t['voiceStart']+r,text])
 music=synth_music(TOTAL);small=activity[::480];smooth=np.convolve(small,np.ones(31)/31,mode='same');duck=np.interp(np.arange(count)/480,np.arange(len(smooth)),smooth);music*=((1-duck*.5)*.7)[:,None]
 mask=activity>.9;vr=float(np.sqrt(np.mean(voice[mask]**2)));mr=float(np.sqrt(np.mean(music[mask]**2)));gain=min(3.0,vr/(10**(16/20)*max(mr,1e-7)));music*=gain
 (OUT/'qa'/f'{lang}-mix-balance.json').write_text(json.dumps({'speechMusicDifferenceDb':float(20*np.log10(vr/max(mr*gain,1e-7))),'musicGain':gain,'duckingDuringSpeech':.5},indent=2))
 mix=music+voice[:,None]
 rng=np.random.default_rng(9)
 for t in TIMES[1:]:
  n=round(.6*SR);tt=np.arange(n)/SR;wavelet=rng.normal(0,1,n).astype(np.float32);wavelet=np.convolve(wavelet,np.ones(18)/18,'same')*np.sin(np.pi*tt/.6)**2*.065;k=round(t['start']*SR);mix[k:k+n]+=wavelet[:,None]
 fade=np.minimum(np.arange(count)/SR/1.1,(count-np.arange(count))/SR/2);mix*=np.clip(fade,0,1)[:,None]
 write_audio(A/'audio'/f'{lang}-mix.wav',mix)
 ass='[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft JhengHei,36,&H00F5F2EB,&H00D4B678,&H0020180C,&H850B1007,0,0,0,0,100,100,1,0,1,2.0,0,2,100,100,36,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
 for st,en,txt in captions:ass+=f'Dialogue: 0,{ass_time(st)},{ass_time(en)},Default,,0,0,0,,{{\\fad(100,100)}}{txt}\n'
 (OUT/'subtitles'/f'{lang}.ass').write_text(ass,encoding='utf-8-sig');(OUT/'data'/f'{lang}-timeline.json').write_text(json.dumps({'duration':TOTAL,'captions':captions,'voice':403007 if lang=='mandarin' else 101019,'speed':0,'alignment':'local RMS/punctuation' if lang=='mandarin' else 'Tencent subtitle timestamps'},ensure_ascii=False,indent=2),encoding='utf8')
def export(lang):
 audio_and_captions(lang);audio=A/'audio'/f'{lang}-mix.wav';log=OUT/'qa'/f'{lang}-levels.log'
 r=subprocess.run([FF,'-hide_banner','-i',str(audio),'-af','loudnorm=I=-14:TP=-2:LRA=9:print_format=json','-f','null','-'],stdout=subprocess.PIPE,stderr=subprocess.PIPE);txt=r.stderr.decode(errors='replace');log.write_text(txt);levels=json.loads(txt[txt.rfind('{'):txt.rfind('}')+1])
 filt=f"loudnorm=I=-14:TP=-2:LRA=9:measured_I={levels['input_i']}:measured_TP={levels['input_tp']}:measured_LRA={levels['input_lra']}:measured_thresh={levels['input_thresh']}:offset={levels['target_offset']}:linear=true,aresample=48000"
 label='普通話' if lang=='mandarin' else '粵語預覽';dest=OUT/f'澳門記憶-電影版-{label}-1080p.mp4';relative=f'output/video/macau-memory-film-v2-20261004/subtitles/{lang}.ass'
 with (OUT/'qa'/f'{lang}-export.log').open('w') as err:subprocess.run([FF,'-y','-hide_banner','-threads','2','-filter_threads','2','-i',str(OUT/'renders/picture-master.mp4'),'-i',str(audio),'-vf',f"subtitles=filename='{relative}',fade=t=in:d=0.6,fade=t=out:st={TOTAL-.6}:d=0.6",'-af',filt,'-c:v','h264_nvenc','-preset','p5','-cq','18','-b:v','0','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-t',str(TOTAL),'-movflags','+faststart',str(dest)],stderr=err,check=True)
 print('FINAL',dest.name,flush=True)
def storyboard():
 lines=['# 澳門記憶電影版 · 分鏡與旁白\n','1920 × 1080 / 30 fps；主要转场 0.7 秒；正常语速。\n']
 for s,t in zip(SCENES,TIMES):lines+=['\n## '+s['id']+' '+s['title'],f"时间：{t['start']:.2f}–{t['start']+t['duration']:.2f} 秒；画面：{s['type']}",'\n普通话：'+s['mandarin'],'\n粤语：'+s['cantonese']]
 (OUT/'分镜与旁白.md').write_text('\n'.join(lines),encoding='utf8')
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--mode',choices=['all','picture','audio','samples','mix'],default='all');ap.add_argument('--lang',choices=['mandarin','cantonese']);args=ap.parse_args();storyboard()
 if args.mode=='samples':
  for i in range(len(SCENES)):
   g=scene_frames(i)
   for f,im in enumerate(g):
    if f==90:break
   im.save(OUT/'qa'/f'{SCENES[i]["id"]}.jpg',quality=91);g.close();print('SAMPLE',SCENES[i]['id'],flush=True)
 elif args.mode in ['all','picture']:render()
 if args.mode=='mix':
  for lang in [args.lang] if args.lang else ['mandarin','cantonese']:audio_and_captions(lang);print('MIX_DONE',lang,flush=True)
 if args.mode in ['all','audio']:
  for lang in [args.lang] if args.lang else ['mandarin','cantonese']:export(lang)
