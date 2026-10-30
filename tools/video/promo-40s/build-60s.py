"""60-second 2K promo. Uses real UI recordings and individually approved Dreamina clips."""
from pathlib import Path
import subprocess,json,wave,math,argparse,re
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'output/video/tujian-promo-60s';OUT.mkdir(parents=True,exist_ok=True)
FF=Path('D:/MacauSplat/engines/ffmpeg-full/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe')
PROBE=FF.with_name('ffprobe.exe');W,H,FPS=2560,1440,30
for name in ['ai','segments','graphics','qa']:(OUT/name).mkdir(exist_ok=True)
def run(args):
 p=subprocess.run([str(FF),'-hide_banner','-loglevel','error','-y',*map(str,args)],capture_output=True,text=True,encoding='utf8',errors='replace')
 if p.returncode:raise RuntimeError(p.stderr[-5000:])
def encode():return ['-c:v','h264_nvenc','-preset','p6','-rc','vbr','-cq','18','-b:v','0','-pix_fmt','yuv420p']
def font(n,bold=False):return ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc' if bold else 'C:/Windows/Fonts/msjh.ttc',n)
def graphic(key,kicker,title,description='',示意=False):
 im=Image.new('RGBA',(W,H));d=ImageDraw.Draw(im)
 # Legible lower-third, keeping software results visible above it.
 for y in range(1040,H):d.line((0,y,W,y),fill=(5,19,22,int(220*(y-1040)/(H-1040))))
 d.text((105,1125),kicker,font=font(22),fill='#e5c983')
 d.text((100,1170),title,font=font(58,True),fill='#fff9ed')
 if description:d.text((105,1250),description,font=font(27),fill='#e3e5df')
 if 示意:d.rounded_rectangle((2190,55,2450,108),radius=20,fill=(10,20,20,185));d.text((2220,65),'體驗示意',font=font(28),fill='white')
 im.save(OUT/'graphics'/f'{key}.png')
SCENES=[
 ('opening',6.7,'ai/opening.mp4',0,'','TUJIAN / MACAU','每一處，都值得被記住','澳門的記憶，從地標延伸至日常街巷'),
 ('recognition',11.7,'captures/recognition-2k.webm',4.5,'crop=1600:900:500:260,','GMVR / PLACE IDENTITY','辨識眼前，連回記憶','照片 × 地理位置 × 多視角線索'),
 ('splat',12.7,'captures/splat-2k.webm',4,'','3DGS / MACAUSPLAT','把建築的面貌，留在時間裡','實拍採集 → COLMAP 位姿 → Brush 高斯訓練'),
 ('memory',14.7,'captures/memory-2k.webm',1,'crop=2200:1238:220:0,','CO-CREATION / CITY MEMORY','從單向導覽，到共創敘事','真實照片 · 在地原聲 · 記憶拼圖 · 探究研學'),
 ('rokid-hero',4.7,'ai/rokid-hero.mp4',0,'','ROKID / EXPERIENCE','讓文化探索，走進真實街道','Rokid 導覽觀看與聆聽載體'),
 ('rokid-experience',8.7,'ai/rokid-experience.mp4',0,'','CONNECTED JOURNEY','看見街巷，聽見故事','網站 × 小程序 × Rokid 導覽體驗'),
 ('ending',5,'',0,'','TUJIAN','途見','基於 3DGS 與 GMVR 的澳門文旅記憶系統')]
def segment(s):
 key,dur,src,seek,crop,kicker,title,desc=s
 target=OUT/'segments'/f'{key}.mp4'
 if target.exists():return target
 graphic(key,kicker,title,desc,key=='rokid-experience')
 if key=='ending':
  im=Image.new('RGB',(W,H),'#0c2226');d=ImageDraw.Draw(im)
  d.text((1110,470),'途見',font=font(140,True),fill='#e8cd8e')
  text='看見一座城，留下每一處記憶。';box=d.textbbox((0,0),text,font=font(48));d.text(((W-box[2])/2,680),text,font=font(48),fill='#fff9ec')
  text='基於 3DGS 與 GMVR 的澳門文旅記憶系統';box=d.textbbox((0,0),text,font=font(33));d.text(((W-box[2])/2,790),text,font=font(33),fill='#b9c9c8');im.save(OUT/'graphics/ending-card.png')
  run(['-loop','1','-i',OUT/'graphics/ending-card.png','-t',dur,'-vf','fps=30,fade=t=in:st=0:d=0.35',*encode(),'-an',target]);return target
 if not (OUT/src).exists():raise FileNotFoundError(OUT/src)
 run(['-ss',seek,'-i',OUT/src,'-loop','1','-i',OUT/'graphics'/f'{key}.png','-filter_complex',f'[0:v]{crop}scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=2[v];[v][1:v]overlay=0:0:shortest=1[out]','-map','[out]','-t',dur,*encode(),'-an',target]);return target
def ass_time(t):
 return f'{int(t//3600)}:{int(t//60)%60:02}:{int(t)%60:02}.{int(round(t%1*100)):02}'
def mix_and_subtitles():
 data=json.loads((ROOT/'tools/video/promo-40s/narration-60s.json').read_text(encoding='utf8'))
 sr=48000;total=np.zeros(60*sr,np.float64)
 # Gentle ambient bed with long envelopes, ducked under every narration segment.
 time=np.arange(total.size)/sr
 bed=np.zeros_like(time)
 for k in range(15):
  begin=k*4;u=time-begin;env=np.where(u>=0,np.exp(-np.maximum(u,0)/3.5)*(1-np.exp(-np.maximum(u,0)*12)),0)
  for midi in ([48,55,60,64] if k%2==0 else [45,52,57,60]):
   hz=440*2**((midi-69)/12);bed+=.006*env*(np.sin(2*np.pi*hz*time)+.25*np.sin(2*np.pi*2*hz*time))
 duck=np.ones_like(time);cues=[]
 for scene in data['scenes']:
  p=OUT/'audio'/f"{scene['id']}.wav"
  with wave.open(str(p)) as f:rate=f.getframerate();channels=f.getnchannels();a=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(float).reshape(-1,channels).mean(1)/32768
  a=np.interp(np.arange(round(len(a)*sr/rate))*rate/sr,np.arange(len(a)),a)
  duration=len(a)/sr;limit=scene['end']-scene['start']-.15
  if duration>limit:raise ValueError(f"Narration too long: {scene['id']} {duration}>{limit}")
  # Normalize speech RMS, keeping natural speed and dynamics.
  rms=np.sqrt(np.mean(a*a));a*=min(3,.13/max(rms,1e-6));a=np.clip(a,-.85,.85)
  start=round(scene['start']*sr);total[start:start+len(a)]+=a
  duck[start:start+len(a)]=.35
  clauses=re.findall(r'[^，。；]+[，。；]?',scene['mandarin']);parts=[];line=''
  for clause in clauses:
   if line and len(line+clause)>34:parts.append(line);line=''
   line+=clause
   if clause.endswith('。'):parts.append(line);line=''
  if line:parts.append(line)
  weights=[len(x) for x in parts];cursor=scene['start']
  for part,n in zip(parts,weights):
   end=cursor+duration*n/sum(weights);cues.append((cursor,end,part));cursor=end
 total+=bed*duck*np.minimum(time,1)*np.minimum(60-time,1)
 for at in [6,17,29,43,47,55]:
  u=np.arange(int(.6*sr))/sr;noise=np.random.default_rng(int(at)).normal(size=len(u));swish=.009*noise*np.sin(np.pi*u/.6)**2
  ix=int((at-.25)*sr);total[ix:ix+len(u)]+=swish
 with wave.open(str(OUT/'audio/mandarin-mix.wav'),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(sr);f.writeframes((np.clip(total,-.98,.98)*32767).astype('<i2').tobytes())
 header='[Script Info]\nScriptType: v4.00+\nPlayResX: 2560\nPlayResY: 1440\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft JhengHei,42,&H00FFFFFF,&H00FFFFFF,&H00202020,&H85000000,0,0,0,0,100,100,0,0,3,1,0,2,100,100,42,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
 (OUT/'mandarin.ass').write_text(header+''.join(f'Dialogue: 0,{ass_time(a)},{ass_time(b)},Default,,0,0,0,,{s}\n' for a,b,s in cues),encoding='utf-8-sig')
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--prepare',action='store_true');parser.add_argument('--available',action='store_true');parser.add_argument('--prefix',action='store_true');args=parser.parse_args()
 mix_and_subtitles()
 if args.prepare:return
 if args.available:
  for s in SCENES:
   if not s[2] or (OUT/s[2]).exists():segment(s)
  return
 chosen=SCENES[:4] if args.prefix else SCENES
 files=[segment(s) for s in chosen];current=files[0];length=chosen[0][1]
 for i in range(1,len(files)):
  out=OUT/'segments'/f'master-{i}.mp4';offset=round(length-.7,3)
  if not out.exists():run(['-i',current,'-i',files[i],'-filter_complex',f'[0:v]settb=AVTB[a];[1:v]settb=AVTB[b];[a][b]xfade=transition=fade:duration=0.7:offset={offset}[v]','-map','[v]',*encode(),'-an',out])
  current=out;length+=chosen[i][1]-.7;print('Transition',i,round(length,2),flush=True)
 if args.prefix:return
 run(['-i',current,'-i',OUT/'audio/mandarin-mix.wav','-vf','ass=mandarin.ass','-af','loudnorm=I=-16:TP=-1.5:LRA=9','-t','60',*encode(),'-c:a','aac','-b:a','256k','-ar','48000','-movflags','+faststart',OUT/'途見_60秒宣傳片_普通話_2K.mp4'])
if __name__=='__main__':
 # Relative ASS path avoids drive-colon filter escaping.
 import os;os.chdir(OUT);main()
