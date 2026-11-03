"""A result-led film edited from genuine local UI operations and labeled demos."""
from pathlib import Path
import json, math, subprocess, wave, re
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'output/video/tujian-story'
CAP=OUT/'captures'
FF=Path(r'D:\MacauSplat\engines\ffmpeg-full\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe')
FP=FF.with_name('ffprobe.exe')
FONT=r'C:\Windows\Fonts\msjh.ttc';BOLD=r'C:\Windows\Fonts\msjhbd.ttc'
W,H,FPS=2560,1440,30
SCRIPT=json.loads((ROOT/'tools/video/story/script.json').read_text(encoding='utf-8'))['scenes']
EVENT={e['name']:e['time'] for e in json.loads((CAP/'events.json').read_text())}
J=CAP/'journey.webm'
PHOTO=ROOT/'output/pdf/assets/tonglau-real.jpg'
STPAUL=ROOT/'output/pdf/assets/stpaul-2010.jpg'
for d in ['shots','graphics','qa']: (OUT/d).mkdir(parents=True,exist_ok=True)

def run(args):
    subprocess.run(list(map(str,args)),cwd=ROOT,check=True,stdout=subprocess.DEVNULL)

def dur(p):
    return float(subprocess.check_output([str(FP),'-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',str(p)]))

def cover(p,crop=None):
    im=Image.open(p).convert('RGB')
    if crop:
        x,y,w,h=crop;im=im.crop((x,y,x+w,y+h))
    k=max(W/im.width,H/im.height)
    im=im.resize((round(im.width*k),round(im.height*k)),Image.Resampling.LANCZOS)
    x=(im.width-W)//2;y=(im.height-H)//2
    return im.crop((x,y,x+W,y+H))

def graphic(name,title,detail='',badge='',final=False,right=False):
    im=Image.new('RGBA',(W,H),(0,0,0,0));d=ImageDraw.Draw(im)
    if final:
        d.rounded_rectangle((100,595,2030,1155),radius=36,fill=(8,23,34,210))
        d.text((160,645),'途見',font=ImageFont.truetype(BOLD,142),fill='white')
        d.text((165,845),title,font=ImageFont.truetype(BOLD,70),fill='#e3c17b')
        d.text((165,970),detail,font=ImageFont.truetype(FONT,43),fill='white')
        d.text((165,1058),'基於 3DGS 與 GMVR 的澳門文旅記憶系統',font=ImageFont.truetype(FONT,42),fill='#d4dce0')
    else:
        box=d.textbbox((0,0),title,font=ImageFont.truetype(BOLD,47))
        width=min(1650,max(700,box[2]+145))
        left=W-width-58 if right else 58
        d.rounded_rectangle((left,55,left+width-58,225 if detail else 155),radius=18,fill=(8,23,34,228))
        d.rectangle((left+27,83,left+32,130),fill='#e3c17b')
        d.text((left+54,78),title,font=ImageFont.truetype(BOLD,47),fill='white')
        if detail:d.text((left+52,155),detail,font=ImageFont.truetype(FONT,31),fill='#e3c17b')
    if badge:
        font=ImageFont.truetype(FONT,29);b=d.textbbox((0,0),badge,font=font);ww=b[2]+48
        by=260 if right else 58
        d.rounded_rectangle((W-ww-55,by,W-55,by+59),radius=12,fill=(8,23,34,215))
        d.text((W-ww-31,by+10),badge,font=font,fill='#eef2f2')
    if name=='04-04':
        d.rounded_rectangle((177,57,650,133),radius=12,outline='#d6a950',width=4)
    p=OUT/'graphics'/f'{name}.png';im.save(p);return p

def vid(start,end,title,detail='',badge='',crop=None):
    return dict(src=J,start=max(0,start),end=end,title=title,detail=detail,badge=badge,crop=crop)

def pic(src,title,detail='',badge='',final=False):
    return dict(src=src,title=title,detail=detail,badge=badge,final=final)

def shot_specs():
    e=EVENT
    # Each shot has an action or its visible outcome, rather than an unrelated feature card.
    return [
        [pic(ROOT/'public/photos/real/ruins-st-paul-dc080a179a57.webp','途見：找到建築，也留下你的記憶','拍照找建築 · 看實景與故事 · 保存自己的記錄'),
         pic(CAP/'photo-selected.png','從一張建築照片開始'),
         pic(CAP/'story-attachments-visible.png','最後，照片與聲音回到同一份檔案','接下來完整操作一次','操作示範')],
        [vid(e['photo-selected']-2,e['recognition-ready']+.2,'① 選照片，按「開始辨識」'),
         vid(e['recognition-ready']-.2,e['recognition-result']-2.8,'比對照片，找出建築候選'),
         vid(e['recognition-result']-2.5,e['recognition-result']+.3,'核對候選：大三巴牌坊','位置與多角度照片可補充線索'),
         vid(e['recognition-result']+.2,e['archive-open'],'結果：大三巴記憶檔案已打開')],
        [vid(e['album-open']+.2,e['versions-open']-.5,'② 在檔案裡選「實景版本」'),
         vid(e['gaussian-ready']-1.2,e['gaussian-ready']+2.2,'打開大三巴的真實 3DGS 模型'),
         vid(e['gaussian-ready']+2.2,e['gaussian-orbit'],'旋轉：從不同方向重新觀看'),
         vid(e['gaussian-orbit']+.2,e['gaussian-closeup'],'拉近：查看建築與周邊空間')],
        [pic(PHOTO,'普通街巷，也值得被記住'),
         vid(e['new-place-open']-.8,e['new-place-filled'],'③ 記錄一棟普通建築','填寫名稱；確認過的位置可以一併保存','建檔示範 · 位置待實地確認'),
         vid(e['new-place-filled']-.5,e['new-place-saved']-2,'按「建立永久編號」','本次示範先建檔，保留待確認的位置','操作示範'),
         vid(e['new-place-saved']-1.7,e['new-place-saved']+.2,'結果：普通建築已有獨立檔案','新的 TJ 編號，讓後續記錄回到同一地點','操作示範')],
        [vid(e['story-open']-.8,e['story-written'],'④ 點「留下我的記憶」，寫下觀察','由使用者留下照片、文字與聲音','示範投稿'),
         vid(e['story-written']-.4,e['story-media-added'],'加入照片與示範音訊','附件與文字一起保存','示範投稿 · 合成音訊'),
         vid(e['story-media-added']-.3,e['story-saved'],'按「保存記憶」'),
         vid(e['story-saved']+.1,e['story-attachments-visible']+.2,'結果：照片與音訊已出現在檔案裡','這次的故事先私人保存','示範投稿'),
         vid(e['story-reopened']-2.5,e['story-reopened']+.1,'重新打開，記錄仍然保留','公開投稿需同意及審核','示範投稿'),
         vid(e['story-attachments-visible']+.15,e['story-audio-playing'],'播放已保存的音訊','接下來聽一小段功能示範','合成示範音訊')],
        [vid(e['story-reopened']+.1,e['story-in-puzzle'],'⑤ 把這段記憶加入拼圖'),
         vid(e['story-in-puzzle']+.1,e['clues-found'],'搜尋有來源的城市歷史線索'),
         vid(e['clues-found']+.1,e['clue-added'],'選擇線索，加入自己的故事順序'),
         vid(e['clue-added']+.1,e['puzzle-saved'],'寫下關係與解讀，再保存拼圖'),
         vid(e['puzzle-saved']+.1,e['puzzle-reopened'],'結果：保存的拼圖可以再次打開')],
        [dict(src=ROOT/'output/video/tujian-promo-60s/ai/rokid-experience.mp4',start=0,end=6.5,title='現場導覽：把文化內容帶到街道',detail='網站講解 · 小程序查詢與行程 · 眼鏡觀看與聆聽',badge='Rokid 情境示意'),
         dict(src=ROOT/'output/video/tujian-promo-60s/ai/rokid-hero.mp4',start=0,end=3.7,title='Rokid：導覽內容的觀看與聆聽載體',badge='情境示意'),
         pic(OUT/'graphics/guide-composite.jpg','網站中的小澳，提供建築講解','這裡展示實際網站介面')],
        [pic(CAP/'story-attachments-visible.png','一張照片 → 一份地點檔案','照片、文字與聲音，在同一個地方累積','操作示範'),
         pic(CAP/'puzzle-reopened.png','一份檔案 → 可以持續補充的城市記憶','透過記憶拼圖，整理觀察與有來源的線索','操作示範'),
         pic(PHOTO,'看見澳門，續寫記憶。','旅客 · 居民 · 學生，一起記錄每一處值得記住的地方',final=True)]
    ]

def guide_composite():
    im=cover(STPAUL).convert('RGBA');shade=Image.new('RGBA',(W,H),(5,15,23,85));im=Image.alpha_composite(im,shade)
    src=Image.open(ROOT/'output/video/tujian-detailed/captures/guide-arrival.png')
    panel=src.crop((1810,748,2145,1425)).convert('RGBA');panel.thumbnail((670,1120),Image.Resampling.LANCZOS)
    im.alpha_composite(panel,(W-panel.width-110,230))
    d=ImageDraw.Draw(im);d.text((140,520),'小澳 · 建築講解',font=ImageFont.truetype(BOLD,86),fill='white')
    d.text((140,670),'查看地點介紹，也能聆聽語音。',font=ImageFont.truetype(FONT,48),fill='#eed8a4')
    im.convert('RGB').save(OUT/'graphics/guide-composite.jpg')

def render_shot(code,s,seconds):
    target=OUT/'shots'/f'{code}.mp4'
    if target.exists() and target.stat().st_size>100000:return target
    print('SHOT',code,s['title'],flush=True)
    image=s['src'].suffix.lower() in ['.jpg','.png','.webp']
    overlay=graphic(code,s['title'],s.get('detail',''),s.get('badge',''),s.get('final',False),s.get('right',False))
    args=[FF,'-hide_banner','-loglevel','error','-y']
    if image:
        source=OUT/'graphics'/f'{code}-base.jpg';cover(s['src'],s.get('crop')).save(source,quality=97)
        args+=['-loop','1','-framerate','30','-i',source]
        base="[0:v]scale=2688:1512,crop=2560:1440:x='64+20*sin(n/70)':y=36,fps=30[base]"
    else:
        length=s['end']-s['start'];factor=min(1.3,max(.8,seconds/length))
        args+=['-ss',f"{s['start']:.4f}",'-t',f'{length:.4f}','-i',s['src']]
        crop=s.get('crop');cf=f"crop={crop[2]}:{crop[3]}:{crop[0]}:{crop[1]}," if crop else ''
        base=f'[0:v]setpts={factor:.6f}*(PTS-STARTPTS),{cf}scale=2560:1440:flags=lanczos,fps=30,tpad=stop_mode=clone:stop_duration={seconds:.4f},trim=duration={seconds:.4f}[base]'
    args+=['-loop','1','-framerate','30','-i',overlay]
    graph=base+';[1:v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1[text];[base][text]overlay=0:0,format=yuv420p[v]'
    run([*args,'-filter_complex',graph,'-map','[v]','-t',f'{seconds:.6f}','-an','-c:v','h264_nvenc','-preset','p4','-cq','21','-b:v','0','-pix_fmt','yuv420p','-r','30',target])
    return target

def join(clips,lengths,cross,target):
    args=[]
    for p in clips:args+=['-i',p]
    filters=[];label='0:v';offset=0
    for i in range(1,len(clips)):
        offset+=lengths[i-1]-cross;new=f'f{i}'
        filters.append(f'[{label}][{i}:v]xfade=transition=fade:duration={cross}:offset={offset:.6f}[{new}]');label=new
    run([FF,'-hide_banner','-loglevel','error','-y',*args,'-filter_complex',';'.join(filters),'-map',f'[{label}]','-an','-c:v','h264_nvenc','-preset','p4','-cq','21','-b:v','0','-pix_fmt','yuv420p',target])

def atime(t):
    cs=round(t*100);return f'{cs//360000}:{cs//6000%60:02d}:{cs//100%60:02d}.{cs%100:02d}'

def captions(starts,audio):
    lines=['[Script Info]','ScriptType: v4.00+','PlayResX: 2560','PlayResY: 1440','',
           '[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
           'Style: Sub,Microsoft JhengHei,55,&H00FFFFFF,&H00FFFFFF,&H000B1822,&H880B1822,0,0,0,0,100,100,0,0,1,3,2,2,100,100,65,1','',
           '[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    for start,p,s in zip(starts,audio,SCRIPT):
        with wave.open(str(p)) as f:
            sr=f.getframerate();nchan=f.getnchannels();a=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(float).reshape(-1,nchan).mean(1)
        ad=len(a)/sr;step=sr//100;a=a[:len(a)//step*step].reshape(-1,step);rms=np.sqrt(np.mean(a*a,axis=1))
        silence=rms<max(120,np.percentile(rms,30)*.5)
        pauses=[];begin=None
        for i,v in enumerate(silence):
            if v and begin is None:begin=i
            if not v and begin is not None:
                if i-begin>=10:pauses.append((begin+i)/200)
                begin=None
        chunks=[c for c in re.split(r'(?<=[，。；])',s['text']) if c]
        counts=[len(c) for c in chunks];bounds=[0.0];total=sum(counts)
        for i in range(1,len(chunks)):
            predict=ad*sum(counts[:i])/total
            choices=[p for p in pauses if abs(p-predict)<.65 and p>bounds[-1]+.25 and p<ad-.15]
            bounds.append(min(choices,key=lambda p:abs(p-predict)) if choices else max(bounds[-1]+.3,predict))
        bounds.append(ad)
        for i,c in enumerate(chunks):
            if len(c)>29:c=c[:len(c)//2]+'\\N'+c[len(c)//2:]
            lines.append(f'Dialogue: 0,{atime(start+.55+bounds[i])},{atime(start+.55+bounds[i+1]-.06)},Sub,,0,0,0,,{c}')
    p=OUT/'subtitles.ass';p.write_text('\n'.join(lines),encoding='utf-8');return p

def main():
    guide_composite();audio=[OUT/'audio'/f'{i:02}.wav' for i in range(1,9)];ad=[dur(p) for p in audio]
    section=[math.ceil((a+1.7+(3.6 if i==4 else 0))*FPS)/FPS for i,a in enumerate(ad)]
    specs=shot_specs();scenes=[]
    memory_crop=(260,80,1260,708)
    for i,group in enumerate(specs,1):
        for j,s in enumerate(group):
            if (i==2 and j==3) or (i==3 and j==0) or (i==4 and j==3) or (i==5 and j>=3) or i==6 or (i==8 and j<2):
                s['crop']=memory_crop
                s['right']=True
    for i,(spec,length) in enumerate(zip(specs,section),1):
        cross=.25;budget=round((length+(len(spec)-1)*cross)*FPS)
        weights=[1]*len(spec)
        if i==5:weights=[1.15,1,1,1.1,1.05,.85]
        if i==7:weights=[1.3,.7,1]
        if i==8:weights=[1,1,1.7]
        frames=[round(budget*w/sum(weights)) for w in weights];frames[-1]+=budget-sum(frames)
        ds=[n/FPS for n in frames];clips=[render_shot(f'{i:02}-{j+1:02}',s,d) for j,(s,d) in enumerate(zip(spec,ds))]
        target=OUT/f'scene-{i:02}.mp4';join(clips,ds,cross,target);scenes.append(target)
    starts=[0.0]
    for d in section[:-1]:starts.append(starts[-1]+d-.7)
    total=starts[-1]+section[-1];silent=OUT/'visual-2k.mp4';join(scenes,section,.7,silent)
    captions(starts,audio)
    bed=ROOT/'output/video/tujian-intro-v2/audio/ambient-original.wav'
    inputs=[]
    for p in audio:inputs+=['-i',p]
    inputs+=['-stream_loop','-1','-i',bed,'-i',OUT/'audio/demo-memory.wav']
    af=[]
    for i,st in enumerate(starts):af.append(f'[{i}:a]adelay={round((st+.55)*1000)}:all=1[a{i}]')
    sample_start=starts[4]+.55+ad[4]+.35
    af.append(f'[8:a]atrim=duration={total},volume=.35[bed]')
    af.append(f'[9:a]atrim=start=5.65:duration=2.63,asetpts=PTS-STARTPTS,afade=t=in:d=0.04,afade=t=out:st=2.48:d=0.15,adelay={round(sample_start*1000)}:all=1[sample]')
    af.append(''.join(f'[a{i}]' for i in range(8))+'[bed][sample]amix=inputs=10:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=9[mix]')
    mixed=OUT/'audio/mix.wav';run([FF,'-hide_banner','-loglevel','error','-y',*inputs,'-filter_complex',';'.join(af),'-map','[mix]','-ar','48000','-ac','2','-t',f'{total:.6f}',mixed])
    master=OUT/'途見_使用故事版_2K.mp4'
    run([FF,'-hide_banner','-loglevel','error','-y','-i',silent,'-i',mixed,'-vf','ass=output/video/tujian-story/subtitles.ass','-map','0:v','-map','1:a','-c:v','h264_nvenc','-preset','p4','-cq','20','-b:v','0','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',master])
    small=OUT/'途見_使用故事版_1080p_30MB內.mp4'
    run([FF,'-hide_banner','-loglevel','error','-y','-i',master,'-vf','scale=1920:1080:flags=lanczos','-c:v','h264_nvenc','-preset','p5','-rc','vbr','-b:v','1180k','-maxrate','1450k','-bufsize','2900k','-c:a','aac','-b:a','96k','-movflags','+faststart',small])
    (OUT/'timeline.json').write_text(json.dumps({'duration':total,'starts':starts,'sections':section,'sampleStart':sample_start,'shots':[[{'title':s['title'],'source':str(s['src']),'sourceStart':s.get('start'),'sourceEnd':s.get('end')} for s in group] for group in specs]},ensure_ascii=False,indent=2),encoding='utf-8')
    print('DONE',total,master,small,flush=True)

if __name__=='__main__':main()
