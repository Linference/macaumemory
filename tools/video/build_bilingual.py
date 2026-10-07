"""Rebuild the two 1440p videos from local project assets and Tencent WAVs.
No credentials, remote downloads, or third-party renderer are needed here.
Run with the bundled Python that supplies Pillow and NumPy.
"""
import argparse, concurrent.futures, json, math, re, shutil, subprocess, wave
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/video/macau-memory-2k-20261004'
IMAGES = OUT / 'assets/images'
ART = OUT / 'assets/compositions'
RENDERS = OUT / 'renders'
W, H, FPS, SR = 2560, 1440, 30, 48000
GOLD, WHITE, MUTED, BLUE = '#d7b563', '#f1f0e9', '#a4b5be', '#76bacb'
FONT = 'C:/Windows/Fonts/msjh.ttc'
BOLD = 'C:/Windows/Fonts/msjhbd.ttc'
SCRIPT = json.loads((OUT/'data/script.json').read_text(encoding='utf-8-sig'))
for p in [ART, RENDERS, OUT/'subtitles', OUT/'qa']: p.mkdir(parents=True, exist_ok=True)

def font(size, bold=False): return ImageFont.truetype(BOLD if bold else FONT, size)
def text(im, xy, value, size=42, color=WHITE, bold=False):
    ImageDraw.Draw(im).text(xy, value, font=font(size,bold), fill=color)

def wrap(value, width, size):
    out, line = [], ''
    f = font(size)
    for ch in value:
        if f.getlength(line+ch)>width and line: out.append(line); line=''
        line += ch
    if line: out.append(line)
    return out

def paragraph(im, xy, value, width, size=40, color=MUTED, spacing=18):
    x,y=xy
    for part in value.split('\n'):
        for line in wrap(part,width,size): text(im,(x,y),line,size,color);y+=size+spacing
    return y

def paste_picture(im, name, box, cover=True, crop=None, radius=22):
    src=Image.open(IMAGES/name).convert('RGB')
    if crop: src=src.crop(crop)
    x,y,w,h=box
    if cover: src=ImageOps.fit(src,(w,h),method=Image.Resampling.LANCZOS)
    else:
        src=ImageOps.contain(src,(w,h),method=Image.Resampling.LANCZOS)
        canvas=Image.new('RGB',(w,h),'#101d26');canvas.paste(src,((w-src.width)//2,(h-src.height)//2));src=canvas
    mask=Image.new('L',(w,h));ImageDraw.Draw(mask).rounded_rectangle((0,0,w-1,h-1),radius,fill=255)
    im.paste(src,(x,y),mask)

def panel(im,box,color='#142732',outline='#2c424b',radius=24):
    x,y,w,h=box;ImageDraw.Draw(im).rounded_rectangle((x,y,x+w,y+h),radius,fill=color,outline=outline,width=2)

def arrow(im, x, y, length=70):
    d=ImageDraw.Draw(im);d.line((x,y,x+length,y),fill=GOLD,width=5)
    d.polygon([(x+length,y),(x+length-17,y-12),(x+length-17,y+12)],fill=GOLD)

def background():
    y,x=np.mgrid[0:H,0:W]
    glow=np.exp(-((x-2150)**2+(y-180)**2)/950000)
    a=np.empty((H,W,3),dtype=np.uint8)
    for k,(b,c) in enumerate([(8,18),(19,22),(27,19)]): a[:,:,k]=b+c*glow
    im=Image.fromarray(a)
    d=ImageDraw.Draw(im)
    for x in range(128,W,128): d.line((x,350,x,1180),fill='#132731')
    for y in range(390,1180,128): d.line((128,y,2432,y),fill='#132731')
    return im

def note_cards(im, cards, x=1870,y=410,w=560):
    for i,(title,body) in enumerate(cards):
        panel(im,(x,y+i*245,w,217))
        text(im,(x+30,y+26+i*245),f'{i+1:02}',29,GOLD)
        text(im,(x+95,y+22+i*245),title,40,WHITE,True)
        paragraph(im,(x+30,y+90+i*245),body,w-60,32)

NOTES={
 's03':[('空間入口','地形、街道與建築輪廓'),('24,904 棟','已載入的建築輪廓'),('記憶點','實拍相冊的地圖入口')],
 's04':[('尋找建築','搜尋地點與景點分類'),('打開介紹','從地點進入文化內容'),('連接出行','步行與駕車路網估算')],
 's07':[('選擇照片','上傳、貼上或使用實拍示範'),('找出區域','建築偵測與類型判斷'),('比對記憶','參考照片的特徵檢索')],
 's09':[('首位候選','大三巴牌坊'),('原始相似度','本次實拍示範：0.741'),('保留核對','分數需要結合候選判斷')],
 's11':[('裝置位置','記錄拍攝者所在位置'),('建築位置','手動確認照片中的建築'),('定位範圍','顯示裝置估計，不作精度保證')],
 's12':[('點選輪廓','照片中的建築高亮確認'),('主動啟用','位置與照片對應後才輔助'),('並排對照','圖像結果與位置輔助結果')],
 's13':[('普通建築','名稱、類型、位置與備註'),('穩定編號','每份記錄具有記憶編號'),('本機保存','附近查詢與備份導出')],
 's14':[('讀取照片','批次收集建築實拍素材'),('減少重複','比較影像差異與視角資料'),('人工確認','保留來源，導出參考庫草稿')],
 's17':[('獨立查看','建築與文物三維模型'),('旋轉觀察','從不同方向查看外觀'),('縮放細節','連接文字介紹與模型')]
}

def prepare_assets():
    names=['taipa-2011.jpg','taipa-side-2011.jpg','taipa-2023.jpg','lawrence-2014.jpg','dominic-2009.jpg','dominic-2016.jpg','stpaul-2010.jpg','artifact.jpg']
    for n in names: shutil.copy2(ROOT/'output/pdf/assets'/n,IMAGES/n)
    shutil.copy2(ROOT/'public/photos/real/red-market-2ee7e53617f8.webp',IMAGES/'market-interior.webp')
    shutil.copy2(ROOT/'docs/figs/live-cloud-render.png',IMAGES/'live-cloud-render.png')
    # Crop only captured screen content. These are real UI results, not recreated UI.
    crops={
      'recognize-current.jpg':('recognize-full.jpg',(35,320,1228,1510)),
      'comparison-current.jpg':('survey-full.jpg',(600,335,1230,1460)),
      'survey-current.jpg':('survey-full.jpg',(600,1990,1230,3375)),
      'footprint-current.jpg':('footprint-full.jpg',(600,2520,1230,3375)),
      'capture-current.jpg':('capture-full.jpg',(35,900,1230,2300)),
      'guide-detail.jpg':('guide-panel.jpg',(1805,770,2160,1425)),
      'album-detail.jpg':('album-current.jpg',(775,455,1782,985))
    }
    for n,(src,box) in crops.items(): Image.open(IMAGES/src).crop(box).save(IMAGES/n,quality=96)
    # Attribution accompanies the video and is also printed in the relevant frames.
    credits=json.loads((ROOT/'output/pdf/photo-attribution.json').read_text(encoding='utf-8'))
    archive=json.loads((ROOT/'public/data/photo-archive.json').read_text(encoding='utf-8'))
    market=next(p for p in archive['places'] if p['nearId']=='red-market')
    credit=next(p for p in market['photos'] if p['file'].endswith('red-market-2ee7e53617f8.webp'))
    credits.append({**credit,'report_asset':'market-interior.webp'})
    (OUT/'photo-attribution.json').write_text(json.dumps(credits,ensure_ascii=False,indent=2),encoding='utf-8')

def compose(scene):
    sid=scene['id'];im=background()
    if sid in ['s01','s20']:
        paste_picture(im,'taipa-2023.jpg',(0,0,W,H),radius=0)
        shade=Image.new('RGBA',(W,H))
        a=np.zeros((H,W,4),dtype=np.uint8);a[:,:,:3]=[5,15,23]
        a[:,:,3]=np.clip(230-150*np.arange(W)/W,70,230).astype(np.uint8)[None,:]
        im=Image.alpha_composite(im.convert('RGBA'),Image.fromarray(a)).convert('RGB')
        text(im,(145,490),'澳門記憶',158,WHITE,True)
        text(im,(154,695),'MACAU MEMORY',49,GOLD)
        paragraph(im,(154,825),scene['tagline'],1550,57,WHITE,22)
        text(im,(154,1090),'看見  ·  理解  ·  留下記錄',42,GOLD)
        text(im,(154,1185),'龍環葡韻實拍 / LN9267 / CC BY-SA 4.0 · 裁切與調色',26,MUTED)
    elif sid=='s02':
        paste_picture(im,'market-interior.webp',(950,375,1475,820))
        text(im,(140,435),'城市記憶',60,GOLD,True)
        paragraph(im,(140,545),'街角的建築\n舊市場的日常\n值得留下的發現',670,64,WHITE,24)
        paragraph(im,(140,1010),'照片  ×  位置  ×  文化介紹',700,36,GOLD)
        text(im,(985,1140),'紅街市日常 / Mx. Granger / CC0 · 裁切',26,'#ffffff')
    elif sid=='s05':
        for i,n in enumerate(['taipa-2011.jpg','dominic-2016.jpg','lawrence-2014.jpg']):
            paste_picture(im,n,(128+i*779,400,746,690))
        panel(im,(128,1110,2304,88));text(im,(160,1127),'32 個建築記憶點',40,GOLD,True);text(im,(1040,1127),'305 張實拍照片',40,WHITE,True)
        text(im,(2000,1140),'來源見隨附清單',26,MUTED)
    elif sid=='s06':
        paste_picture(im,'album-detail.jpg',(128,400,1570,790),cover=False)
        note_cards(im,[('同一建築','多張照片連接同一編號'),('保留日期','2011、2023 等已記錄日期'),('可追溯來源','照片作者、來源與使用權')])
    elif sid in ['s08','s10']:
        vals=[('照片輸入','看見一棟建築'),('類型偵測','YOLO · 11 類'),('身份檢索','DINOv2 · 38 棟'),('人工核對','保留不確定性')] if sid=='s08' else [('第一個角度','正面'),('第二個角度','側面'),('第三個角度','另一視角'),('核對結果','一致 / 衝突 / 重複')]
        for i,(heading,body) in enumerate(vals):
            x=128+i*592;panel(im,(x,450,525,635));text(im,(x+35,485),f'{i+1:02}',38,GOLD)
            if sid=='s10' and i<3: paste_picture(im,['taipa-2011.jpg','taipa-side-2011.jpg','taipa-2023.jpg'][i],(x+25,560,475,330))
            elif sid=='s08' and i==0: paste_picture(im,'stpaul-2010.jpg',(x+25,560,475,330))
            else:
                d=ImageDraw.Draw(im)
                for j in range(4):d.rounded_rectangle((x+70+j*88,615+(j%2)*25,x+130+j*88,790-(j%2)*20),12,outline=GOLD,width=3)
            text(im,(x+30,925),heading,43,WHITE,True);paragraph(im,(x+30,997),body,465,32)
            if i<3:arrow(im,x+535,780,46)
        text(im,(148,1140),'流程示意 · 多照片核對的實際效果以獨立測試評估',30,MUTED)
    elif sid=='s15':
        paste_picture(im,'live-cloud-render.png',(128,400,1520,785),cover=False)
        text(im,(155,1135),'MacauSplat · 幾何投影流程示例',29,GOLD)
        note_cards(im,[('相機與點雲','沿用開源三維重建流程'),('包圍盒投影','由三維位置產生二維標註'),('人工複核','檢查品質並保留輸出')],x=1750,w=680)
    elif sid=='s16':
        paste_picture(im,'taipa-2023.jpg',(128,400,1100,790))
        paste_picture(im,'guide-detail.jpg',(1300,400,555,790),cover=False)
        paragraph(im,(1930,445),'小澳',450,72,GOLD)
        paragraph(im,(1930,560),'從當前建築出發\n了解歷史與特色',460,43,WHITE)
        paragraph(im,(1930,845),'建築介紹\n文字提問\n語音接口',450,38,MUTED,28)
        text(im,(155,1138),'龍環葡韻 / LN9267 / CC BY-SA 4.0',26,WHITE)
    elif sid=='s18':
        vals=[('MacauSplat','資料製作','幾何輔助標註\n品質檢查與複核'),('澳門記憶網站','記錄與探索','圖像辨識、位置確認\n實拍相冊與建築檔案'),('旅遊助手小程序','隨身查看','共用名錄與記憶編號\n文化探索清單')]
        for i,(name,label,body) in enumerate(vals):
            x=128+i*780;panel(im,(x,455,724,620));text(im,(x+40,495),f'{i+1:02}  {label}',35,GOLD)
            text(im,(x+40,615),name,49,WHITE,True)
            paragraph(im,(x+40,750),body,635,39,MUTED,22)
            if i<2:arrow(im,x+734,745,36)
        text(im,(145,1120),'共用地點編號 + 匯出名錄 · 現階段為本地資料交換',38,GOLD)
    elif sid=='s19':
        vals=[('A','圖像檢索','同一組有標準答案的照片'),('B','位置輔助','比較候選與位置條件'),('C','多照片核對','比較一致、衝突與拒識')]
        for i,(label,title,body) in enumerate(vals):
            x=128+i*780;panel(im,(x,450,724,570));text(im,(x+42,485),label,105,GOLD,True)
            text(im,(x+42,665),title,55,WHITE,True);paragraph(im,(x+42,785),body,630,39)
        panel(im,(128,1060,2304,138));text(im,(165,1100),'獨立照片 · 固定資料分組 · 可核對結果',46,GOLD)
    else:
        asset=scene['asset'];box=(128,400,1660,790)
        if sid=='s07':
            paste_picture(im,asset,box,cover=False)
        elif sid=='s09':
            paste_picture(im,'comparison-current.jpg',(960,400,780,790),crop=(0,0,630,645),cover=False)
            paste_picture(im,'stpaul-2010.jpg',(128,400,795,790))
        elif sid in ['s11','s12','s13']:
            src='footprint-full.jpg' if sid=='s12' else 'survey-full.jpg'
            paste_picture(im,src,(128,400,810,790),crop=(600,1990,1230,2670),cover=False)
            paste_picture(im,src,(965,400,810,790),crop=(600,2680,1230,3340),cover=False)
        elif sid=='s14':
            paste_picture(im,'capture-full.jpg',(128,400,1660,790),crop=(35,1120,1230,1860),cover=False)
        else:paste_picture(im,asset,box,cover=False)
        note_cards(im,NOTES[sid])
    im.save(ART/f'{sid}-bg.png')
    overlay=Image.new('RGBA',(W,H));d=ImageDraw.Draw(overlay)
    # Stable labels are separate from the gently moving photograph/UI composition.
    text(overlay,(128,68),'澳門記憶',37,GOLD,True)
    text(overlay,(375,77),'MACAU MEMORY',26,MUTED)
    text(overlay,(1910,77),f'{int(sid[1:]):02} / 20    {scene["chapter"]}',30,MUTED)
    d.line((128,132,2432,132),fill='#3d5057',width=2)
    if sid not in ['s01','s20']:
        text(overlay,(128,180),scene['title'],79,WHITE,True)
        text(overlay,(132,293),scene['tagline'],37,GOLD)
    # Caption-safe scrim is part of the composition, not a screenshot alteration.
    d.rectangle((0,1240,W,H),fill=(5,15,23,242))
    overlay.save(ART/f'{sid}-fg.png')
    preview=Image.alpha_composite(im.convert('RGBA'),overlay).convert('RGB')
    preview.save(OUT/'qa'/f'{sid}.jpg',quality=92)
    return preview

def read_wave(path):
    with wave.open(str(path)) as w:
        rate=w.getframerate();channels=w.getnchannels();data=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(np.float32)/32768
    data=data.reshape(-1,channels)
    if rate!=SR:
        xx=np.arange(round(len(data)*SR/rate))*rate/SR
        data=np.stack([np.interp(xx,np.arange(len(data)),data[:,k]) for k in range(channels)],axis=1).astype(np.float32)
    if channels==1:data=np.repeat(data,2,axis=1)
    return data

def save_wave(path,a):
    with wave.open(str(path),'wb') as w:
        w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes((np.clip(a,-1,1)*32767).astype('<i2').tobytes())

def ass_time(t):
    cent=round(t*100);return f'{cent//360000}:{cent//6000%60:02}:{cent//100%60:02}.{cent%100:02}'
def srt_time(t):
    ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

def caption_chunks(value, sub, offset):
    # Use original script glyphs; Tencent times/indexes are Unicode character indexes.
    groups=[];start=0
    for i,ch in enumerate(value):
        if ch in '，。；！？、' or i-start>=23 or i==len(value)-1:
            end=i+1;chunk=value[start:end].strip()
            entries=[s for s in sub if s['BeginIndex']<end and s['EndIndex']>start]
            if entries and chunk:groups.append((offset+entries[0]['BeginTime']/1000,offset+entries[-1]['EndTime']/1000,chunk))
            start=end
    return groups

def timeline(lang):
    scenes=[];chunks=[];wav_parts=[];offset=0
    for scene in SCRIPT['scenes']:
        local=.75;lines=[]
        for i,value in enumerate(scene[lang]):
            p=OUT/'assets/audio'/lang/f'{scene["id"]}-{i+1}'
            a=read_wave(p.with_suffix('.wav'))
            meta=json.loads(p.with_suffix('.json').read_text(encoding='utf-8'))
            chunks+=caption_chunks(value,meta['subtitles'],offset+local)
            wav_parts.append((offset+local,a));lines.append((local,len(a)/SR));local+=len(a)/SR+.30
        duration=math.ceil((local+.40)/.6)*.6
        scenes.append({'id':scene['id'],'start':round(offset,4),'duration':round(duration,4),'lines':lines})
        offset+=duration
    voice=np.zeros((round(offset*SR),2),dtype=np.float32)
    for start,a in wav_parts:
        k=round(start*SR);voice[k:k+len(a)] += a
    peak=float(np.max(np.abs(voice)))
    if peak>0:voice*=.76/peak
    save_wave(OUT/'assets/audio'/f'{lang}-voice.wav',voice)
    music=read_wave(ROOT/'docs/video/_work/web3min/assets/audio/music/bgm-raw.wav')
    # Loop the locally generated score using a short equal-power overlap.
    if len(music)<len(voice):
        overlap=SR*2
        tail=music[-overlap:].copy();head=music[:overlap].copy();r=np.linspace(0,1,overlap)[:,None]
        joined=tail*np.cos(r*np.pi/2)+head*np.sin(r*np.pi/2)
        music=np.concatenate([music[:-overlap],joined,music[overlap:]],axis=0)
    music=music[:len(voice)]
    rms_voice=np.sqrt(np.mean(voice[np.max(np.abs(voice),axis=1)>.025]**2))
    rms_music=np.sqrt(np.mean(music**2))
    music*=float(rms_voice*.25/max(rms_music,1e-6))
    fade=min(SR*3,len(music)//4);music[:fade]*=np.linspace(0,1,fade)[:,None];music[-fade:]*=np.linspace(1,0,fade)[:,None]
    mix=voice+music
    if np.max(np.abs(mix))>.95:mix*=.95/np.max(np.abs(mix))
    save_wave(OUT/'assets/audio'/f'{lang}-mix.wav',mix)
    header='''[Script Info]\nScriptType: v4.00+\nPlayResX: 2560\nPlayResY: 1440\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft JhengHei,54,&H00F3F1E9,&H00F3F1E9,&H00170F05,&H00170F05,0,0,0,0,100,100,1,0,1,2,0,2,140,140,92,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'''
    ass=header+''.join(f'Dialogue: 0,{ass_time(a)},{ass_time(b)},Default,,0,0,0,,{{\\fad(60,60)}}{v}\n' for a,b,v in chunks)
    (OUT/'subtitles'/f'{lang}.ass').write_text(ass,encoding='utf-8-sig')
    srt='\n'.join(f'{i+1}\n{srt_time(a)} --> {srt_time(b)}\n{v}\n' for i,(a,b,v) in enumerate(chunks))
    (OUT/'subtitles'/f'{lang}.srt').write_text(srt,encoding='utf-8-sig')
    (OUT/'data'/f'{lang}-timeline.json').write_text(json.dumps({'duration':offset,'scenes':scenes,'captions':chunks},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'{lang}: {offset:.1f}s, {len(chunks)} subtitle segments',flush=True)
    return scenes

def run(cmd,log):
    result=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    log.write_bytes(result.stdout)
    if result.returncode:raise RuntimeError(f'FFmpeg failed: see {log}')
    return result.stdout.decode('utf-8',errors='replace')

def valid_video(path, duration):
    if not path.exists():return False
    r=subprocess.run(['ffprobe','-v','error','-show_entries','stream=width,height,r_frame_rate,duration','-of','json',str(path)],capture_output=True)
    try:
        s=json.loads(r.stdout)['streams'][0]
        return r.returncode==0 and s['width']==W and s['height']==H and s['r_frame_rate']=='30/1' and abs(float(s['duration'])-duration)<.015
    except (KeyError,ValueError,IndexError):return False

def render_common(scene,maxduration):
    sid=scene['id'];path=RENDERS/f'{sid}.mp4'
    if valid_video(path,maxduration):return
    frames=round(maxduration*FPS)
    # Stable titles + gentle camera move + motion line + half-second reveals.
    filters=f"[0:v]zoompan=z='1+0.016*on/{frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={frames}:s={W}x{H}:fps={FPS},format=yuv420p[b];[b][1:v]overlay=0:0:format=auto,drawbox=x=128:y=1352:w=2304:h=3:color=0x34454c:t=fill[c];color=c=0xd7b563:s=74x4:r={FPS}[line];[c][line]overlay=x='128+mod(t*78,2230)':y=1352,fade=t=in:st=0:d=0.35,fade=t=out:st={maxduration-.25}:d=0.25,format=yuv420p[v]"
    run(['ffmpeg','-hide_banner','-y','-threads','2','-filter_complex_threads','2','-i',str(ART/f'{sid}-bg.png'),'-loop','1','-framerate',str(FPS),'-i',str(ART/f'{sid}-fg.png'),'-filter_complex',filters,'-map','[v]','-t',str(maxduration),'-an','-c:v','h264_nvenc','-preset','p4','-rc','vbr','-cq','18','-b:v','0','-pix_fmt','yuv420p',str(path)],OUT/'qa'/f'{sid}-render.log')
    print(f'rendered {sid} {maxduration:.1f}s',flush=True)

def final_render(lang, scenes):
    # Re-encode exact frame counts; stream-copy trimming retains B frames past a
    # cut and creates cumulative audio/subtitle drift. Captions are burned here.
    timeline_data=json.loads((OUT/'data'/f'{lang}-timeline.json').read_text(encoding='utf-8'))
    ass_source=(OUT/'subtitles'/f'{lang}.ass').read_text(encoding='utf-8-sig')
    ass_header=ass_source[:ass_source.index('Dialogue:')]
    label='普通話' if lang=='mandarin' else '粵語'
    def render_trim(scene):
        sid=scene['id'];path=RENDERS/f'{lang}-{sid}.mp4'
        start=scene['start'];end=start+scene['duration']
        local_ass=ass_header+''.join(f'Dialogue: 0,{ass_time(a-start)},{ass_time(min(b,end)-start)},Default,,0,0,0,,{{\\fad(60,60)}}{v}\n' for a,b,v in timeline_data['captions'] if start<=a<end)
        (OUT/'subtitles'/f'{lang}-{sid}.ass').write_text(local_ass,encoding='utf-8-sig')
        import hashlib
        key=hashlib.sha256((local_ass+str((RENDERS/f'{sid}.mp4').stat().st_mtime_ns)).encode()).hexdigest()
        marker=path.with_suffix('.ok')
        if marker.exists() and marker.read_text()==key and valid_video(path,scene['duration']):return
        vf=f"subtitles=subtitles/{lang}-{sid}.ass,drawtext=fontfile='C\\:/Windows/Fonts/msjh.ttc':text='{label}版':fontsize=28:fontcolor=0xd7b563:x=2200:y=1380,format=yuv420p"
        result=subprocess.run(['ffmpeg','-hide_banner','-y','-threads','2','-filter_threads','2','-i',str(RENDERS/f'{sid}.mp4'),'-vf',vf,'-frames:v',str(round(scene['duration']*FPS)),'-an','-c:v','h264_nvenc','-preset','p4','-bf','0','-rc','vbr','-cq','18','-b:v','0','-pix_fmt','yuv420p',str(path)],cwd=OUT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (OUT/'qa'/f'{lang}-{sid}-trim.log').write_bytes(result.stdout)
        if result.returncode:raise RuntimeError(f'Subtitle render failed: {lang} {sid}')
        if not valid_video(path,scene['duration']):raise RuntimeError(f'Frame count mismatch: {lang} {sid}')
        marker.write_text(key);print(f'captioned {lang} {sid}',flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for r in pool.map(render_trim,scenes):pass
    concat=RENDERS/f'{lang}-concat.txt'
    concat.write_text(''.join(f"file '{lang}-{s['id']}.mp4'\n" for s in scenes),encoding='utf-8')
    inp=OUT/'assets/audio'/f'{lang}-mix.wav'
    measured=run(['ffmpeg','-hide_banner','-i',str(inp),'-af','loudnorm=I=-14:TP=-2.5:LRA=9:print_format=json','-f','null','-'],OUT/'qa'/f'{lang}-loudness-input.log')
    norm=json.loads(measured[measured.rfind('{'):measured.rfind('}')+1])
    af=f"loudnorm=I=-14:TP=-2.5:LRA=9:measured_I={norm['input_i']}:measured_TP={norm['input_tp']}:measured_LRA={norm['input_lra']}:measured_thresh={norm['input_thresh']}:offset={norm['target_offset']}:linear=true"
    normpath=OUT/'assets/audio'/f'{lang}-final.wav'
    run(['ffmpeg','-hide_banner','-y','-i',str(inp),'-af',af,'-ar',str(SR),str(normpath)],OUT/'qa'/f'{lang}-normalize.log')
    dest=OUT/f'澳門記憶-{label}-2K.mp4'
    result=subprocess.run(['ffmpeg','-hide_banner','-y','-f','concat','-safe','0','-i',str(concat),'-i',str(normpath),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar',str(SR),'-movflags','+faststart','-shortest','-metadata',f'title=澳門記憶 · {label} · 2K',str(dest)],cwd=OUT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    (OUT/'qa'/f'{lang}-final-render.log').write_bytes(result.stdout)
    if result.returncode:raise RuntimeError(f'Final render failed: {lang}')
    print(f'FINISHED {dest.name}',flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--prepare-only',action='store_true');args=parser.parse_args()
    prepare_assets();previews=[compose(s) for s in SCRIPT['scenes']]
    sheet=Image.new('RGB',(1600,1100),'#08131b')
    for i,im in enumerate(previews):
        im=ImageOps.contain(im,(384,216));sheet.paste(im,(12+i%4*400,12+i//4*218))
    sheet.save(OUT/'qa/contact-sheet.jpg',quality=95)
    previews[0].save(OUT/'澳門記憶-影片封面.png')
    times={lang:timeline(lang) for lang in ['mandarin','cantonese']}
    if args.prepare_only:return
    jobs=[(s,max(times[l][i]['duration'] for l in times)) for i,s in enumerate(SCRIPT['scenes'])]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for result in pool.map(lambda p:render_common(*p),jobs):pass
    for lang in times:final_render(lang,times[lang])
    markdown='# 澳門記憶 · 雙語講解稿\n\n'
    for s in SCRIPT['scenes']:
        markdown+=f"## {s['id']} · {s['title']}\n\n普通話：{''.join(s['mandarin'])}\n\n粵語：{''.join(s['cantonese'])}\n\n"
    (OUT/'雙語講解稿.md').write_text(markdown,encoding='utf-8')

if __name__=='__main__':main()
