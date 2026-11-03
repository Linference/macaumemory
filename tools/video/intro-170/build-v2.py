"""Render the revised Tujian film with a labeled Rokid concept clip."""
from __future__ import annotations

import json
import math
import subprocess
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageEnhance

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'output/video/tujian-intro-v2'
OUT.mkdir(parents=True, exist_ok=True)
VOICE_DIR = ROOT / 'output/video/tujian-intro-170s/audio'
FF = Path(r'D:\MacauSplat\engines\ffmpeg-full\ffmpeg-9.0.2-essentials_build\bin\ffmpeg.exe')
FP = FF.with_name('ffprobe.exe')
FONT = r'C:\Windows\Fonts\msjh.ttc'
BOLD = r'C:\Windows\Fonts\msjhbd.ttc'
S = json.loads((ROOT / 'tools/video/intro-170/script.json').read_text(encoding='utf-8'))['scenes']
W, H, FPS, CROSS = 2560, 1440, 30, .7


def run(args):
    print('RUN', Path(str(args[0])).name, ' '.join(map(str,args[1:7])), flush=True)
    subprocess.run(list(map(str,args)), check=True, cwd=ROOT, stdout=subprocess.DEVNULL)


def duration(p):
    z = subprocess.check_output([str(FP), '-v','error','-show_entries','format=duration',
                                 '-of','default=noprint_wrappers=1:nokey=1',str(p)])
    return float(z)


def cover(path, size):
    im = Image.open(path).convert('RGB')
    k = max(size[0]/im.width, size[1]/im.height)
    im = im.resize((round(im.width*k),round(im.height*k)),Image.Resampling.LANCZOS)
    x = (im.width-size[0])//2
    y = (im.height-size[1])//2
    return im.crop((x,y,x+size[0],y+size[1]))


def photo_card(idx):
    if idx == 1:
        a=cover(ROOT/'output/pdf/assets/tonglau-real.jpg',(W//2,H))
        b=cover(ROOT/'public/photos/real/ruins-st-paul-dc080a179a57.webp',(W//2,H))
        im=Image.new('RGB',(W,H)); im.paste(a,(0,0)); im.paste(b,(W//2,0))
        title='一座城，不止地標'; kicker='途見  /  TOUJIAN'; sub='讓澳門的每一處記憶，都有被看見的入口'
    elif idx == 8:
        a=cover(ROOT/'output/pdf/assets/stpaul-2010.jpg',(W//2,H))
        b=cover(ROOT/'output/pdf/assets/rokid-max2.png',(W//2,H))
        im=Image.new('RGB',(W,H)); im.paste(a,(0,0)); im.paste(b,(W//2,0))
        title='讓導覽回到真實街道'; kicker='網站 × 小程序 × Rokid'; sub='Rokid 眼鏡作為現場觀看與聆聽的導覽載體'
    else:
        im=cover(ROOT/'public/photos/real/ruins-st-paul-dc080a179a57.webp',(W,H))
        title='讓澳門的記憶，繼續被書寫'; kicker='途見  /  TOUJIAN'; sub='基於 3DGS 與 GMVR 的澳門文旅記憶系統'
    shade=Image.new('RGBA',(W,H),(4,12,19,0)); d=ImageDraw.Draw(shade)
    d.rectangle((0,0,W,H),fill=(3,11,19,70 if idx==8 else 88))
    d.rectangle((0,0,1490,H),fill=(3,12,20,125))
    im=Image.alpha_composite(im.convert('RGBA'),shade)
    d=ImageDraw.Draw(im)
    gold='#e6c581'
    d.rounded_rectangle((130,460,650,465),radius=2,fill=gold)
    d.text((130,510),kicker,font=ImageFont.truetype(BOLD,46),fill=gold)
    d.text((125,615),title,font=ImageFont.truetype(BOLD,98),fill='white')
    d.text((130,775),sub,font=ImageFont.truetype(FONT,43),fill='#f6f2e9')
    d.text((132,H-140),f'{idx:02d}  /  09',font=ImageFont.truetype(FONT,35),fill=gold)
    if idx==9:
        for x,big,small in [(130,'38','已收錄建築'),(570,'335','參考照片'),(1100,'88.96%','參考庫留一 Top-1')]:
            d.rounded_rectangle((x,955,x+390,1130),radius=18,fill=(6,20,30,205))
            d.text((x+28,975),big,font=ImageFont.truetype(BOLD,73),fill=gold)
            d.text((x+30,1070),small,font=ImageFont.truetype(FONT,31),fill='white')
    if idx==8:
        d.rounded_rectangle((1990,1110,2420,1180),radius=12,fill=(5,18,29,210))
        d.text((2020,1122),'導覽載體示意',font=ImageFont.truetype(FONT,35),fill='white')
    return im.convert('RGB')


def panel_background(idx,title,strap):
    im=Image.new('RGB',(W,H),'#0c1720')
    d=ImageDraw.Draw(im)
    d.rectangle((0,0,1028,H),fill='#11212b')
    d.rectangle((0,0,W,13),fill='#d9b76c')
    d.text((105,90),'途見  /  TOUJIAN',font=ImageFont.truetype(BOLD,37),fill='#e1bf76')
    d.text((105,290),f'{idx:02d}',font=ImageFont.truetype(BOLD,125),fill='#d8b46d')
    # Deliberate short line breaks keep the title legible on a phone.
    words={'02':['從地點開始','探索'],'03':['拍照確認','眼前建築'],
           '04':['普通建築','也能建檔'],'06':['照片與人的','記憶'],
           '07':['一起拼出','城市故事']}.get(f'{idx:02d}',[title])
    for j,line in enumerate(words):
        d.text((105,510+j*102),line,font=ImageFont.truetype(BOLD,80),fill='white')
    d.rounded_rectangle((105,780,730,785),radius=2,fill='#d8b46d')
    d.text((105,845),strap,font=ImageFont.truetype(FONT,43),fill='#d1dce0')
    d.text((105,1300),'真實網站操作畫面',font=ImageFont.truetype(FONT,30),fill='#8fa4aa')
    d.rectangle((1040,72,2500,1365),outline='#405661',width=3)
    return im


def video_title_overlay(idx,title,strap):
    im=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle((45,55,990,350),radius=30,fill=(5,17,27,205))
    d.rectangle((87,97,92,310),fill='#d9b76c')
    d.text((120,110),f'{idx:02d}  /  09',font=ImageFont.truetype(BOLD,34),fill='#d9b76c')
    d.text((120,175),title,font=ImageFont.truetype(BOLD,67),fill='white')
    d.text((120,270),strap,font=ImageFont.truetype(FONT,29),fill='#cbd9dc')
    return im


def film_graphic(kind):
    im=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(im)
    gold='#e6c581'; white='#ffffff'
    if kind=='intro':
        d.rounded_rectangle((86,770,1410,1130),radius=30,fill=(4,15,25,185))
        d.text((130,805),'途見  /  TOUJIAN',font=ImageFont.truetype(BOLD,96),fill=white)
        d.text((135,955),'基於 3DGS 與 GMVR 的澳門文旅記憶系統',
               font=ImageFont.truetype(FONT,48),fill=gold)
    elif kind=='rokid':
        d.rounded_rectangle((80,78,700,160),radius=18,fill=(4,15,25,190))
        d.text((105,94),'Rokid 導覽情境示意',font=ImageFont.truetype(BOLD,39),fill=white)
    elif kind=='stats':
        d.rounded_rectangle((90,800,1770,1210),radius=30,fill=(4,15,25,202))
        d.text((135,833),'目前的參考資料與測試',font=ImageFont.truetype(BOLD,51),fill=white)
        for x,big,small in [(135,'38','棟建築'),(610,'335','張參考照片'),(1090,'88.96%','庫內留一 Top-1')]:
            d.text((x,930),big,font=ImageFont.truetype(BOLD,95),fill=gold)
            d.text((x,1060),small,font=ImageFont.truetype(FONT,41),fill=white)
    elif kind=='end':
        d.rounded_rectangle((100,605,1660,1110),radius=38,fill=(4,15,25,190))
        d.text((150,650),'途見',font=ImageFont.truetype(BOLD,150),fill=white)
        d.text((155,850),'看見澳門，續寫記憶。',font=ImageFont.truetype(BOLD,72),fill=gold)
        d.text((155,984),'3DGS  ×  GMVR  ×  城市共創',font=ImageFont.truetype(FONT,41),fill=white)
    return im


def make_scene(idx, seconds):
    target=OUT/f'scene-{idx:02d}.mp4'
    if target.exists() and target.stat().st_size>100000:
        return target
    bg=OUT/f'graphic-{idx:02d}.png'
    title=S[idx-1]['title']
    args=[FF,'-hide_banner','-loglevel','error','-y']
    if idx == 1:
        film_graphic('intro').save(bg)
        args += ['-loop','1','-framerate','30','-i',ROOT/'output/pdf/assets/tonglau-real.jpg',
                 '-loop','1','-framerate','30','-i',ROOT/'public/photos/real/ruins-st-paul-dc080a179a57.webp',
                 '-stream_loop','-1','-i',ROOT/'output/video/tujian-promo-60s/captures/splat-2k.webm',
                 '-loop','1','-framerate','30','-i',bg]
        filt=("[0:v]scale=2700:1519,crop=2560:1440:x='70+25*sin(n/28)':y=39,trim=duration=5.35,setpts=PTS-STARTPTS,fps=30,format=yuv420p[a];"
              "[1:v]scale=2700:1519,crop=2560:1440:x='70-25*sin(n/28)':y=39,trim=duration=5.35,setpts=PTS-STARTPTS,fps=30,format=yuv420p[b];"
              '[2:v]trim=start=2:duration=5.35,setpts=PTS-STARTPTS,scale=2560:1440,fps=30,format=yuv420p[c];'
              '[a][b]xfade=transition=fade:duration=0.5:offset=4.85[ab];'
              '[ab][c]xfade=transition=fade:duration=0.5:offset=9.70[film];'
              "[3:v]format=rgba[title];[film][title]overlay=0:0:enable='gte(t,9.5)',format=yuv420p[v]")
    elif idx == 8:
        film_graphic('rokid').save(bg)
        args += ['-i',ROOT/'output/video/tujian-promo-60s/ai/rokid-experience.mp4',
                 '-i',ROOT/'output/video/tujian-promo-60s/ai/rokid-hero.mp4',
                 '-loop','1','-framerate','30','-i',ROOT/'output/pdf/assets/stpaul-2010.jpg',
                 '-loop','1','-framerate','30','-i',bg]
        filt=("[0:v]trim=duration=8.05,setpts=PTS-STARTPTS,fps=30,scale=2560:1440,format=yuv420p[a];"
              "[1:v]trim=duration=4.06,setpts=PTS-STARTPTS,fps=30,scale=2560:1440,format=yuv420p[b];"
              "[2:v]scale=2700:1519,crop=2560:1440:x='70+20*sin(n/40)':y=39,trim=duration=6.31,setpts=PTS-STARTPTS,fps=30,format=yuv420p[c];"
              '[a][b]xfade=transition=fade:duration=0.5:offset=7.55[ab];'
              '[ab][c]xfade=transition=fade:duration=0.5:offset=11.11[film];'
              '[3:v]format=rgba[label];[film][label]overlay=0:0,format=yuv420p[v]')
    elif idx == 9:
        stats=OUT/'graphic-09-stats.png'; ending=OUT/'graphic-09-end.png'
        film_graphic('stats').save(stats);film_graphic('end').save(ending)
        args += ['-stream_loop','-1','-i',ROOT/'output/video/tujian-promo-60s/captures/splat-2k.webm',
                 '-loop','1','-framerate','30','-i',ROOT/'public/photos/real/ruins-st-paul-dc080a179a57.webp',
                 '-loop','1','-framerate','30','-i',ROOT/'output/pdf/assets/stpaul-2010.jpg',
                 '-loop','1','-framerate','30','-i',stats,
                 '-loop','1','-framerate','30','-i',ending]
        filt=("[0:v]trim=start=5:duration=6.5,setpts=PTS-STARTPTS,fps=30,scale=2560:1440,format=yuv420p[a];"
              "[1:v]scale=2700:1519,crop=2560:1440:x='70+20*sin(n/38)':y=39,trim=duration=6.5,setpts=PTS-STARTPTS,fps=30,format=yuv420p[b];"
              "[2:v]scale=2900:1631,crop=2560:1440:x='170+30*sin(n/50)':y=95,trim=duration=7.0,setpts=PTS-STARTPTS,fps=30,format=yuv420p[c];"
              '[a][b]xfade=transition=fade:duration=0.5:offset=6.0[ab];'
              '[ab][c]xfade=transition=fade:duration=0.5:offset=12.0[film];'
              "[3:v]format=rgba[stats];[film][stats]overlay=0:0:enable='between(t,6,13.2)'[withstats];"
              "[4:v]format=rgba[end];[withstats][end]overlay=0:0:enable='gte(t,13.0)',format=yuv420p[v]")
    elif idx == 5:
        video=ROOT/'output/video/tujian-promo-60s/captures/splat-2k.webm'
        video_title_overlay(idx,title,'MacauSplat · 實際訓練模型畫面').save(bg)
        args += ['-stream_loop','-1','-i',video,'-loop','1','-framerate','30','-i',bg]
        filt='[0:v]scale=2560:1440,fps=30[raw];[1:v]format=rgba,fade=t=in:st=0:d=0.55:alpha=1[txt];[raw][txt]overlay=0:0,format=yuv420p[v]'
    else:
        spec={
            2:('output/video/tujian-detailed/captures/system.webm','地點編號 × 照片 × 故事',[(350,40,1600,900),(400,270,1600,900),(400,480,1600,900)]),
            3:('output/video/tujian-promo-60s/captures/recognition-2k.webm','影像 × 定位 × 多視角',[(440,25,1400,788),(500,300,1400,788),(500,615,1400,788)]),
            4:('output/video/tujian-detailed/captures/ordinary.webm','定位確認 · 重複檢查 · 永久編號',[(510,170,1500,844),(600,260,1300,731),(600,430,1300,731)]),
            6:('output/video/tujian-promo-60s/captures/memory-2k.webm','真實照片 · 拍攝時間 · 原聲故事',[(360,30,1700,956),(390,260,1700,956),(390,470,1700,956)]),
            7:('output/video/tujian-detailed/captures/puzzle.webm','人物 × 事件 × 地點線索',[(360,30,1700,956),(400,240,1700,956),(400,470,1700,956)]),
        }[idx]
        src,strap,crops=spec
        video_title_overlay(idx,title,strap).save(bg)
        args += ['-stream_loop','-1','-i',ROOT/src,'-loop','1','-framerate','30','-i',bg]
        shot=(seconds+.7)/3
        parts=['[0:v]split=3[raw0][raw1][raw2]']
        for j,(x,y,w,h) in enumerate(crops):
            parts.append(f'[raw{j}]trim=start={j*shot:.4f}:duration={shot:.4f},setpts=PTS-STARTPTS,'
                         f'crop={w}:{h}:{x}:{y},scale=2560:1440:flags=lanczos,fps=30,format=yuv420p[s{j}]')
        parts.append(f'[s0][s1]xfade=transition=fade:duration=0.35:offset={shot-.35:.4f}[ab]')
        parts.append(f'[ab][s2]xfade=transition=fade:duration=0.35:offset={2*shot-.7:.4f}[footage]')
        parts.append('[1:v]format=rgba,fade=t=in:st=0:d=0.5:alpha=1[title]')
        parts.append("[footage][title]overlay=0:0:enable='lt(t,4.2)',format=yuv420p[v]")
        filt=';'.join(parts)
    args += ['-filter_complex',filt,'-map','[v]','-t',f'{seconds:.6f}',
             '-an','-c:v','h264_nvenc','-preset','p4','-cq','22',
             '-b:v','0','-pix_fmt','yuv420p','-r','30','-movflags','+faststart',target]
    run(args)
    return target


def ass_time(t):
    cs=round(t*100)
    return f'{cs//360000}:{(cs//6000)%60:02d}:{(cs//100)%60:02d}.{cs%100:02d}'


def write_subtitles(starts,audio_durations):
    lines=['[Script Info]','ScriptType: v4.00+','PlayResX: 2560','PlayResY: 1440','',
           '[V4+ Styles]',
           'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
           'Style: Sub,Microsoft JhengHei,54,&H00FFFFFF,&H00FFFFFF,&H00101B25,&H8A081018,0,0,0,0,100,100,1,0,1,3,2,2,110,110,65,1',
           '', '[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    for i,(s,adur) in enumerate(zip(S,audio_durations)):
        chunks=[]
        for phrase in s['text'].replace('。','。|').replace('；','；|').replace('，','，|').split('|'):
            phrase=phrase.strip()
            if not phrase: continue
            if len(phrase)>23:
                cut=len(phrase)//2
                chunks.extend([phrase[:cut],phrase[cut:]])
            else: chunks.append(phrase)
        weights=[max(3,len(c)) for c in chunks]
        t=starts[i]+.55
        span=adur/sum(weights)
        for phrase,n in zip(chunks,weights):
            dt=n*span
            lines.append(f'Dialogue: 0,{ass_time(t)},{ass_time(t+dt-.06)},Sub,,0,0,0,,{phrase}')
            t+=dt
    p=OUT/'subtitles.ass';p.write_text('\n'.join(lines),encoding='utf-8')
    return p


def make_music(seconds, scene_starts):
    sr=24000
    n=math.ceil(seconds*sr)
    t=np.arange(n,dtype=np.float64)/sr
    m=np.zeros(n,dtype=np.float64)
    # Restrained original ambient bed: slow suspended chords and soft airy motion.
    chords=[(146.83,220.00,293.66),(130.81,196.00,261.63),(164.81,246.94,329.63),(146.83,220.00,293.66)]
    for k,notes in enumerate(chords):
        envelope=(.5-.5*np.cos(2*np.pi*np.clip((t-k*38)/38,0,1)))
        envelope*=((t>=k*38)&(t<(k+1)*38))
        for f in notes:
            m+=.018*envelope*(np.sin(2*np.pi*f*t)+.17*np.sin(2*np.pi*2*f*t))
    m+=.004*np.sin(2*np.pi*.13*t)*np.sin(2*np.pi*73.42*t)
    # Sparse, quiet mallet notes supply movement without competing with speech.
    notes=[293.66,349.23,440.00,523.25,440.00,349.23]
    for k in range(int(seconds/.8)):
        start=int((k*.8)*sr)
        end=min(n,start+int(.65*sr))
        local=np.arange(end-start)/sr
        f=notes[k%len(notes)]
        m[start:end]+=.0055*np.exp(-local*6.0)*(np.sin(2*np.pi*f*local)+.12*np.sin(2*np.pi*2*f*local))
    # Soft transition swells align with the picture cuts.
    rng=np.random.default_rng(20261012)
    for cut in scene_starts[1:]:
        start=max(0,int((cut-.35)*sr));end=min(n,start+int(.75*sr))
        local=np.linspace(0,1,end-start,endpoint=False)
        noise=rng.normal(0,1,end-start)
        smooth=np.convolve(noise,np.ones(96)/96,mode='same')
        m[start:end]+=.018*smooth*np.sin(np.pi*local)**2
    m*=np.minimum(1,np.minimum(t/2,(seconds-t)/3).clip(min=0))
    p=OUT/'audio/ambient-original.wav'
    p.parent.mkdir(parents=True,exist_ok=True)
    with wave.open(str(p),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(sr)
        f.writeframes((np.clip(m,-1,1)*32767).astype('<i2').tobytes())
    return p


def main():
    audio=[VOICE_DIR/f'{i:02d}.wav' for i in range(1,10)]
    ad=[duration(p) for p in audio]
    vd=[math.ceil((x+1.7)*FPS)/FPS for x in ad]
    print('NARRATION',sum(ad),'VISUAL',sum(vd)-8*CROSS,flush=True)
    scenes=[make_scene(i,d) for i,d in enumerate(vd,1)]
    starts=[0.0]
    for d in vd[:-1]: starts.append(starts[-1]+d-CROSS)
    total=starts[-1]+vd[-1]
    ins=[]
    for p in scenes: ins+=['-i',p]
    filters=[];last='0:v';running=0
    for i in range(1,9):
        running+=vd[i-1]-CROSS
        label=f'x{i}'
        filters.append(f'[{last}][{i}:v]xfade=transition=fade:duration={CROSS}:offset={running:.6f}[{label}]')
        last=label
    silent=OUT/'visual-2k.mp4'
    if not silent.exists() or silent.stat().st_size<100000:
        run([FF,'-hide_banner','-loglevel','error','-y',*ins,'-filter_complex',';'.join(filters),
             '-map',f'[{last}]','-an','-c:v','h264_nvenc','-preset','p4','-cq','22',
             '-b:v','0','-pix_fmt','yuv420p','-movflags','+faststart',silent])
    music=make_music(total,starts)
    audio_args=[]
    for p in audio: audio_args+=['-i',p]
    audio_args+=['-i',music]
    af=[]
    for i,s in enumerate(starts):
        delay=round((s+.55)*1000)
        af.append(f'[{i}:a]aformat=sample_rates=24000:channel_layouts=mono,adelay={delay}|{delay}[a{i}]')
    af.append(f'[9:a]volume=0.46[bed]')
    af.append(''.join(f'[a{i}]' for i in range(9))+'[bed]amix=inputs=10:duration=longest:normalize=0,alimiter=limit=0.95[rough]')
    af.append('[rough]loudnorm=I=-16:TP=-1.5:LRA=9[a]')
    mixed=OUT/'audio/mix.wav'
    if not mixed.exists() or mixed.stat().st_size<100000:
        run([FF,'-hide_banner','-loglevel','error','-y',*audio_args,
             '-filter_complex',';'.join(af),'-map','[a]','-ar','48000','-ac','2',mixed])
    subs=write_subtitles(starts,ad)
    # Render captions once at 2K, then derive the small submission copy from it.
    master=OUT/'途見_三分鐘介紹_優化版_2K.mp4'
    ass_path='output/video/tujian-intro-v2/subtitles.ass'
    run([FF,'-hide_banner','-loglevel','error','-y','-i',silent,'-i',mixed,
         '-vf',f'ass={ass_path}','-map','0:v','-map','1:a','-c:v','h264_nvenc',
         '-preset','p4','-cq','20','-b:v','0','-c:a','aac','-b:a','192k',
         '-shortest','-movflags','+faststart',master])
    small=OUT/'途見_三分鐘介紹_優化版_1080p_30MB內.mp4'
    run([FF,'-hide_banner','-loglevel','error','-y','-i',master,
         '-vf','scale=1920:1080:flags=lanczos','-c:v','h264_nvenc','-preset','p5',
         '-rc','vbr','-b:v','1150k','-maxrate','1300k','-bufsize','2600k',
         '-c:a','aac','-b:a','96k','-movflags','+faststart',small])
    print('DONE',master,small,flush=True)


if __name__=='__main__': main()
