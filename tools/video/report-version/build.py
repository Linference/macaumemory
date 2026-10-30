from pathlib import Path
import os,json,wave,re,math,subprocess
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageOps
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'output/video/tujian-report-version';FF=Path('D:/MacauSplat/engines/ffmpeg-full/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe');W,H,FPS,SR=1920,1080,30,48000
FRAMED=os.environ.get('TUJIAN_FRAMING_VERSION')=='2'
CACHE=OUT/'layout-fix' if FRAMED else OUT
for d in ['graphics','shots','scenes','joins','qa','subtitles']:(OUT/d).mkdir(parents=True,exist_ok=True)
for d in ['shots','scenes','joins','qa']:(CACHE/d).mkdir(parents=True,exist_ok=True)
S=json.loads((ROOT/'tools/video/report-version/script.json').read_text(encoding='utf8'))['scenes'];CAP=OUT/'captures';PREV=ROOT/'output/video/tujian-detailed';SHORT=ROOT/'output/video/tujian-promo-60s';REAL=ROOT/'output/pdf/assets'
def font(n,b=False):return ImageFont.truetype('C:/Windows/Fonts/msjhbd.ttc' if b else 'C:/Windows/Fonts/msjh.ttc',n)
def txt(im,xy,s,n=36,col='#163b3d',bold=False):ImageDraw.Draw(im).text(xy,s,font=font(n,bold),fill=col)
def wrap(im,xy,s,n=38,width=600,col='#163b3d',bold=False,leading=1.45):
 line='';y=xy[1]
 for c in s:
  if font(n,bold).getlength(line+c)>width:txt(im,(xy[0],y),line,n,col,bold);y+=n*leading;line=''
  line+=c
 if line:txt(im,(xy[0],y),line,n,col,bold)
def run(args):
 r=subprocess.run([str(FF),'-hide_banner','-loglevel','error','-y',*map(str,args)],capture_output=True,text=True,encoding='utf8',errors='replace')
 if r.returncode:raise RuntimeError(r.stderr[-3000:])
def enc():return ['-c:v','h264_nvenc','-preset','p6','-rc','vbr','-cq','19','-b:v','0','-pix_fmt','yuv420p']
def dur(p):
 with wave.open(str(p)) as f:return f.getnframes()/f.getframerate()
start=0
for s in S:s['duration']=math.ceil((dur(OUT/'audio'/f"{s['id']}.wav")+1.7)*30)/30;s['start']=start;s['voiceStart']=start+.45;start+=s['duration']-.6
TOTAL=round(start+.6,3)
(OUT/'timeline.json').write_text(json.dumps({'duration':TOTAL,'source':'使用者指定作品 PDF','scenes':S},ensure_ascii=False,indent=2),encoding='utf8')
def fit(p,size):return ImageOps.fit(Image.open(p).convert('RGB'),size,method=Image.Resampling.LANCZOS)
def panel(name,title,sub=''):
 im=Image.new('RGB',(W,H),'#f5f2ea');d=ImageDraw.Draw(im);d.line((75,115,1845,115),fill='#baab83',width=2);txt(im,(75,48),'TUJIAN  /  澳門文旅記憶',27,col='#8a794b');txt(im,(75,155),title,58,bold=True)
 if sub:txt(im,(75,245),sub,29,col='#6e8584')
 return im
def assets():
 im=Image.new('RGB',(W,H),'#f5f2ea');photo=fit(REAL/'stpaul-2010.jpg',(1030,H));im.paste(photo,(890,0));txt(im,(85,95),'TUJIAN / MACAU MEMORY',26,col='#887546');txt(im,(80,275),'途見',116,bold=True);wrap(im,(85,470),'基於 3DGS 與 GMVR 的澳門文旅記憶系統',45,710,bold=True);txt(im,(85,775),'看見一座城，留下每一處記憶。',36);im.save(OUT/'graphics/cover.png')
 im=panel('system','一個地點，連接多種資料','永久編號讓不同入口回到同一棟建築');d=ImageDraw.Draw(im)
 nodes=[('MacauSplat','重建與採集版本'),('網站','辨識、實景與共創'),('小程序','查詢、清單與行程'),('Rokid','現場觀看與聆聽')]
 for i,(a,b) in enumerate(nodes):
  x=75+i*455;d.rounded_rectangle((x,390,x+405,680),25,fill='#ffffff',outline='#d7d5c8',width=2);txt(im,(x+25,450),a,44,bold=True);wrap(im,(x+25,550),b,29,360)
 d.rounded_rectangle((650,790,1270,950),25,fill='#16464a');txt(im,(730,835),'同一份地點檔案',45,col='#fff9e9',bold=True)
 for i in range(4):d.line((275+i*455,690,960,775),fill='#c9b27a',width=3)
 im.save(OUT/'graphics/system.png')
 im=panel('gmvr','照片 × 位置 × 多視角','候選可查看，位置可核對，身份由人確認');d=ImageDraw.Draw(im)
 for i,(a,b) in enumerate([('YOLO','找出建築區域'),('DINOv2','檢索參考照片'),('地理與多視角','確認位置與一致性')]):
  x=75+i*610;d.rounded_rectangle((x,410,x+560,820),28,fill=['#e4eee9','#e8ece3','#f0e8d5'][i]);txt(im,(x+35,480),a,45,bold=True);txt(im,(x+35,605),b,33);txt(im,(x+35,730),str(i+1).zfill(2),45,col='#9d8756')
 im.save(OUT/'graphics/gmvr.png')
 im=panel('data','參考庫內部的檢索表現','38 棟建築 · 335 張參考照片');d=ImageDraw.Draw(im)
 for i,(v,a,b) in enumerate([('88.96%','Top-1','首位候選命中率'),('94.93%','Top-3','前三候選命中率')]):
  x=100+i*940;d.rounded_rectangle((x,380,x+850,840),30,fill='#ffffff');txt(im,(x+55,440),a,32,col='#8d7d50');txt(im,(x+45,505),v,116,bold=True);txt(im,(x+55,690),b,34)
 txt(im,(100,920),'測試條件：參考庫留一法；獨立遊客照片需另行分組測試。',28,col='#597473');im.save(OUT/'graphics/data.png')
 im=panel('innov','從確認建築，走向持續記錄地點','空間面貌與生活故事，回到同一份城市記憶');d=ImageDraw.Draw(im)
 for i,(a,b) in enumerate([('普通建築','庫外也可建立永久身份'),('融合確認','視覺、位置、多照片與覆核'),('空間記憶','三維實景連接版本與故事'),('共創探究','居民敘事與學生問題探索')]):
  x=75+(i%2)*930;y=360+(i//2)*265;d.rounded_rectangle((x,y,x+875,y+225),22,fill='#ffffff');txt(im,(x+35,y+30),a,42,bold=True);txt(im,(x+35,y+115),b,31)
 txt(im,(75,970),'文化保存 · 文化教育 · 社區探索 · 澳門「1+4」方向',31,col='#8a794b');im.save(OUT/'graphics/innovation.png')
 im=panel('tools','從現場影像，到可重訪的實景','MacauSplat 工具鏈與幾何輔助標註');d=ImageDraw.Draw(im)
 for i,(a,b) in enumerate([('FFmpeg','影片整理與抽幀'),('COLMAP','相機位姿與點雲'),('Brush','三維高斯訓練'),('位姿投影','可複核建築標註')]):
  y=335+i*140;d.rounded_rectangle((80,y,1840,y+115),18,fill='#ffffff');txt(im,(115,y+28),a,38,bold=True);txt(im,(650,y+30),b,35)
 im.save(OUT/'graphics/tools.png')
 im=Image.new('RGB',(W,H),'#123c40');txt(im,(120,155),'TUJIAN / MACAU MEMORY',30,col='#d2bb82');txt(im,(115,325),'途見',112,col='#fff9e8',bold=True);txt(im,(120,520),'看見一座城，留下每一處記憶。',57,col='#fff9e8');txt(im,(120,720),'文化保存  ·  共同理解  ·  持續傳播',36,col='#d2bb82');txt(im,(120,910),'基於 3DGS 與 GMVR 的澳門文旅記憶系統',32,col='#ccdbd7');im.save(OUT/'graphics/ending.png')
def chapter_overlay(s,label=''):
 im=Image.new('RGBA',(W,H));d=ImageDraw.Draw(im);d.rounded_rectangle((45,35,780,102),18,fill=(245,242,234,238));txt(im,(65,51),s['id']+'  '+s['section'],32)
 if label:d.rounded_rectangle((1330,35,1875,100),18,fill=(18,54,58,224));txt(im,(1350,52),label,24,col='#f4ecd8')
 im.save(OUT/'graphics'/f"overlay-{s['id']}.png")
def focus_assets():
 f=OUT/'focus'
 def focus_panel(key,image,title,items,crop=None):
  im=Image.new('RGB',(W,H),'#f5f2ea');pic=Image.open(f/image).convert('RGB')
  if crop:pic=pic.crop(crop)
  pic=ImageOps.contain(pic,(1100,930),method=Image.Resampling.LANCZOS);mask=Image.new('L',pic.size);ImageDraw.Draw(mask).rounded_rectangle((0,0,pic.width-1,pic.height-1),radius=28,fill=255);im.paste(pic,(65+(1100-pic.width)//2,55+(930-pic.height)//2),mask);txt(im,(1230,95),'TUJIAN / 功能展示',24,col='#8a794b');wrap(im,(1230,185),title,48,600,bold=True)
  for i,(a,b) in enumerate(items):
   y=370+i*175;txt(im,(1230,y),a,35,bold=True);wrap(im,(1230,y+60),b,28,610,col='#5d7674')
  txt(im,(1230,945),'網站實際操作畫面',25,col='#8a794b');im.save(OUT/'graphics'/f'{key}.png')
 focus_panel('ordinary-focus','ordinary.png','普通建築，也有記憶入口',[('01 確認位置','區分拍攝者位置與建築位置'),('02 檢查重複','確認附近是否已有同一建築'),('03 建立編號','讓照片與故事回到同一檔案')])
 focus_panel('story-focus','story.png','留下文字、照片與原聲',[('文字與照片','保存個人的觀察和生活經歷'),('私人保存','記憶可以先留在自己的檔案'),('授權與審核','申請公開後再經內容審核')])
 focus_panel('learning-focus','learning.png','把一次參觀變成探究',[('遊前','提出問題，查閱地點資料'),('遊中','觀察建築，採集照片與記錄'),('遊後','整理拼圖，表達與交流成果')],(0,130,776,960))
 im=Image.new('RGB',(W,H),'#f5f2ea');txt(im,(70,50),'記憶拼圖：來源資料 → 故事關係 → 個人解讀',50,bold=True);pic=Image.open(f/'puzzle.png').convert('RGB');left=pic.crop((0,798,650,1235));right=pic.crop((723,400,1407,874));interpret=pic.crop((718,938,1407,1098))
 for p,box in [(left,(70,230,850,580)),(right,(990,230,850,580)),(interpret,(990,840,850,198))]:
  x,y,w,h=box;p=ImageOps.contain(p,(w,h),method=Image.Resampling.LANCZOS);im.paste(p,(x,y))
 txt(im,(70,155),'有出處的事件與人物線索',37,bold=True);txt(im,(990,155),'編排卡片，寫下自己的解讀',37,bold=True);txt(im,(70,870),'核對來源 · 調整順序 · 留下解讀',32,col='#597473');im.save(OUT/'graphics/puzzle-focus.png')
 im=Image.new('RGB',(W,H),'#f5f2ea');photo=fit(REAL/'ama-2023.jpg',(1220,930));im.paste(photo,(50,55));guide=ImageOps.contain(Image.open(f/'guide.png').convert('RGB'),(560,930),method=Image.Resampling.LANCZOS);im.paste(guide,(1320,55));txt(im,(65,970),'媽閣廟 · 到點介紹與小澳',28);txt(im,(1330,970),'模擬定位觸發',23,col='#8a794b');im.save(OUT/'graphics/guide-focus.png')
def sources(s):
 if FRAMED:
  special={
   '03':[(CAP/'recognition.webm',31.5,8),(CAP/'recognition-result.png',0,0),(OUT/'graphics/gmvr.png',0,6)],
   '04':[(REAL/'tonglau-real.jpg',0,5),(OUT/'graphics/ordinary-focus.png',0,0)],
   '05':[(CAP/'memory.webm',3,11),(CAP/'memory-sources.png',0,5),(OUT/'graphics/story-focus.png',0,0)],
   '06':[(CAP/'puzzle.webm',2,7),(OUT/'graphics/puzzle-focus.png',0,0)],
   '07':[(OUT/'graphics/guide-focus.png',0,7),(SHORT/'ai/rokid-experience.mp4',0,5),(OUT/'graphics/learning-focus.png',0,0)]}
  if s['id'] in special:return special[s['id']]
 return {
 '01':[(OUT/'graphics/cover.png',0,7),(REAL/'tonglau-real.jpg',0,7),(REAL/'taipa-2023.jpg',0,0)],
 '02':[(OUT/'graphics/system.png',0,0)],
 '03':[(CAP/'recognition.webm',12,8),(CAP/'recognition-result.png',0,0),(OUT/'graphics/gmvr.png',0,6)],
 '04':[(REAL/'tonglau-real.jpg',0,5),(CAP/'ordinary.webm',3,0),(CAP/'ordinary-form.png',0,6)],
 '05':[(CAP/'memory.webm',3,11),(CAP/'memory-sources.png',0,5),(CAP/'memory-story-form.png',0,0)],
 '06':[(CAP/'puzzle.webm',2,7),(CAP/'puzzle-card.png',0,7),(CAP/'puzzle-interpretation.png',0,0)],
 '07':[(PREV/'captures/guide.webm',13,7),(SHORT/'ai/rokid-experience.mp4',0,5),(PREV/'captures/learning-tasks.png',0,0)],
 '08':[(OUT/'graphics/tools.png',0,9),(CAP/'gaussian-ready.png',0,5),(CAP/'gaussian.webm',5,0)],
 '09':[(OUT/'graphics/data.png',0,0)],
 '10':[(OUT/'graphics/innovation.png',0,0)],
 '11':[(REAL/'tonglau-real.jpg',0,4),(OUT/'graphics/ending.png',0,0)]}[s['id']]
def encode_scene(s):
 dest=CACHE/'scenes'/f"{s['id']}.mp4"
 if dest.exists():return dest
 items=sources(s);remaining=s['duration']-sum(x[2] for x in items);parts=[]
 for i,(src,seek,length) in enumerate(items):
  d=remaining if length==0 else length;out=CACHE/'shots'/f"{s['id']}-{i}.mp4";parts.append(out)
  if out.exists():continue
  if not src.exists():raise FileNotFoundError(src)
  video=src.suffix in ['.mp4','.webm'];inputs=['-ss',seek,'-i',src] if video else ['-loop','1','-i',src]
  if video:vf=f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps=30,tpad=stop_mode=clone:stop_duration={d}'
  else:vf=f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},zoompan=z='min(1.018,1+on*0.000025)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s={W}x{H}:fps=30,setsar=1"
  # Playwright pads videos when recordVideo.size exceeds the viewport. These
  # recordings contain a 1280x720 viewport at (0,0); remove that padding first.
  if FRAMED and video and src.parent==CAP:vf='crop=1280:720:0:0,'+vf
  if src.parent!=OUT/'graphics':
   label='模擬定位觸發／佩戴體驗示意' if s['id']=='07' else ('表單操作示範' if s['id']=='04' else '')
   chapter_overlay(s,label);inputs+=['-loop','1','-i',OUT/'graphics'/f"overlay-{s['id']}.png"]
   graph=f'[0:v]{vf}[v];[1:v]format=rgba,fade=t=out:st=2:d=0.5:alpha=1[g];[v][g]overlay=0:0:shortest=1[out]'
  else:graph=f'[0:v]{vf}[out]'
  run([*inputs,'-filter_complex_threads','2','-filter_complex',graph,'-map','[out]','-t',d,*enc(),'-an','-map_metadata','-1',out])
 listing=CACHE/'shots'/f"{s['id']}.txt";listing.write_text('\n'.join("file '"+p.as_posix()+"'" for p in parts),encoding='utf8');run(['-f','concat','-safe','0','-i',listing,'-c','copy',dest]);print('SCENE',s['id'],round(s['duration'],1),flush=True);return dest
def timestamp(t):
 v=round(t*100);h,v=divmod(v,360000);m,v=divmod(v,6000);sec,v=divmod(v,100);return f'{h}:{m:02}:{sec:02}.{v:02}'
def sound():
 n=round(TOTAL*SR);mix=np.zeros(n,np.float32);activity=np.zeros(n,np.float32);cues=[]
 for s in S:
  with wave.open(str(OUT/'audio'/f"{s['id']}.wav")) as f:rate=f.getframerate();a=np.frombuffer(f.readframes(f.getnframes()),'<i2').astype(np.float32).reshape(-1,f.getnchannels()).mean(1)/32768
  a=np.interp(np.arange(round(len(a)*SR/rate))*rate/SR,np.arange(len(a)),a).astype(np.float32);a*=min(2,.13/max(np.sqrt(np.mean(a*a)),1e-7));k=round(s['voiceStart']*SR);mix[k:k+len(a)]+=a;activity[k:k+len(a)]=1
  parts=[]
  for m in re.finditer(r'[^，。；！？]+[，。；！？]?',s['text']):
   x=m.group()
   while x:parts.append(x[:26]);x=x[26:]
  dur=len(a)/SR;weights=[len(x) for x in parts];cursor=s['voiceStart']
  for part,w in zip(parts,weights):end=cursor+dur*w/sum(weights);cues.append((cursor,end,part));cursor=end
 for j in range(math.ceil(TOTAL/5)):
  k=j*5*SR;nn=min(8*SR,n-k);t=np.arange(nn,dtype=np.float32)/SR;env=np.minimum(t/.5,1)*np.exp(-t/3.6)
  for midi in ([48,55,60,64] if j%2==0 else [45,52,57,60]):mix[k:k+nn]+=.005*env*np.sin(2*np.pi*440*2**((midi-69)/12)*t)*(1-.6*activity[k:k+nn])
 mix*=np.clip(np.minimum(np.arange(n)/SR,(n-np.arange(n))/SR),0,1)
 with wave.open(str(OUT/'audio/mix.wav'),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(SR);f.writeframes((np.clip(mix,-.98,.98)*32767).astype('<i2').tobytes())
 header='[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft JhengHei,36,&H00FFFFFF,&H00FFFFFF,&H00202020,&H90000000,0,0,0,0,100,100,0,0,3,1,0,2,70,70,25,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
 (OUT/'subtitles/普通話.ass').write_text(header+''.join(f'Dialogue: 0,{timestamp(a)},{timestamp(b)},Default,,0,0,0,,{t}\n' for a,b,t in cues),encoding='utf-8-sig')
 def st(t):return timestamp(t).replace('.',',').rjust(11,'0')+'0'
 (OUT/'subtitles/普通話.srt').write_text('\n'.join(f'{i+1}\n{st(a)} --> {st(b)}\n{x}\n' for i,(a,b,x) in enumerate(cues)),encoding='utf-8-sig')
 (OUT/'講稿.md').write_text('# 途見作品講解\n\n依使用者指定 PDF 編寫；不含比賽名稱。\n'+''.join(f"\n## {s['id']} {s['title']}\n\n{s['text']}\n" for s in S),encoding='utf8')
def joins(files):
 allparts=[]
 for i,(s,p) in enumerate(zip(S,files)):
  body=CACHE/'joins'/f'body-{i}.mp4';seek=.6 if i else 0;length=s['duration']-seek-(.6 if i<len(S)-1 else 0)
  if not body.exists():run(['-ss',seek,'-i',p,'-t',length,*enc(),'-an',body])
  allparts.append(body)
  if i<len(S)-1:
   cross=CACHE/'joins'/f'fade-{i}.mp4'
   if not cross.exists():run(['-ss',s['duration']-.6,'-i',p,'-i',files[i+1],'-filter_complex_threads','2','-filter_complex','[0:v]setpts=PTS-STARTPTS,settb=AVTB[a];[1:v]trim=duration=0.6,setpts=PTS-STARTPTS,settb=AVTB[b];[a][b]xfade=transition=fade:duration=0.6:offset=0[v]','-map','[v]','-t','0.6',*enc(),'-an',cross])
   allparts.append(cross)
 listing=CACHE/'joins/concat.txt';listing.write_text('\n'.join("file '"+p.as_posix()+"'" for p in allparts),encoding='utf8');run(['-f','concat','-safe','0','-i',listing,'-c','copy',CACHE/'master.mp4'])
def deliver():
 # Two-pass H.264 allocates detail to the busy footage while enforcing total size.
 kbps=int((28_000_000*8/TOTAL-80_000-10_000)/1000);dest=OUT/('途見_作品講解_比例修正版_30MB內.mp4' if FRAMED else '途見_作品講解_普通話_30MB內.mp4')
 common=['-i',CACHE/'master.mp4','-filter_threads','4','-vf','ass=subtitles/普通話.ass','-t',TOTAL,'-c:v','libx264','-preset','fast','-b:v',f'{kbps}k','-pix_fmt','yuv420p','-threads','6','-passlogfile',CACHE/'qa/twopass']
 print('ENCODE',TOTAL,'s',kbps,'kbps',flush=True)
 run([*common,'-pass','1','-an','-f','null','NUL'])
 run(['-i',CACHE/'master.mp4','-i',OUT/'audio/mix.wav','-filter_threads','4','-vf','ass=subtitles/普通話.ass','-af','loudnorm=I=-16:TP=-1.5:LRA=9','-t',TOTAL,'-c:v','libx264','-preset','fast','-b:v',f'{kbps}k','-threads','6','-pass','2','-passlogfile',CACHE/'qa/twopass','-pix_fmt','yuv420p','-c:a','aac','-b:a','80k','-ar','32000','-map_metadata','-1','-movflags','+faststart',dest])
 assert dest.stat().st_size<30_000_000,dest.stat().st_size;print('FINAL',dest.stat().st_size,flush=True)
if __name__=='__main__':
 os.chdir(OUT);assets()
 if FRAMED:focus_assets()
 sound();files=[encode_scene(s) for s in S];joins(files);deliver()
