"""Decode the delivered films; check timing, captions, loudness and blank frames."""
import concurrent.futures,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/video/macau-memory-film-v2-20261004'
FF='D:/MacauSplat/engines/ffmpeg-full/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe'

def inspect(lang,label):
    path=OUT/f'澳門記憶-電影版-{label}-1080p.mp4'
    timeline=json.loads((OUT/'data'/f'{lang}-timeline.json').read_text(encoding='utf8'))
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))
    v=next(s for s in probe['streams'] if s['codec_type']=='video')
    a=next(s for s in probe['streams'] if s['codec_type']=='audio')
    assert (v['width'],v['height'],v['r_frame_rate'],v['pix_fmt'])==(1920,1080,'30/1','yuv420p')
    assert v['codec_name']=='h264' and int(v['nb_frames'])==6136
    assert a['codec_name']=='aac' and a['sample_rate']=='48000' and a['channels']==2
    assert abs(float(v['duration'])-timeline['duration'])<.034
    prev=0
    for start,end,text in timeline['captions']:
        assert prev<=start<end<timeline['duration'] and text.strip(),(prev,start,end,text)
        prev=end
    r=subprocess.run([FF,'-hide_banner','-threads','2','-filter_threads','2','-i',str(path),'-vf','scale=320:180,fps=3,blackdetect=d=0.7:pix_th=0.06:pic_th=0.99','-af','loudnorm=I=-14:TP=-1.5:LRA=9:print_format=json','-f','null','-'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    log=r.stdout.decode('utf8',errors='replace')
    (OUT/'qa'/f'{lang}-encoded-validation.log').write_text(log,encoding='utf8')
    assert r.returncode==0
    levels=json.loads(log[log.rfind('{'):log.rfind('}')+1])
    blacks=re.findall(r'black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)',log)
    assert not blacks,blacks
    assert abs(float(levels['input_i'])+14)<1.0
    assert float(levels['input_tp'])<=-1.0
    result={'file':path.name,'resolution':[1920,1080],'fps':30,'frames':int(v['nb_frames']),'duration':float(v['duration']),'captionSegments':len(timeline['captions']),'voiceType':timeline['voice'],'loudnessLUFS':float(levels['input_i']),'truePeakDBTP':float(levels['input_tp']),'prolongedBlackFrames':blacks,'bytes':path.stat().st_size,'status':'PASS'}
    print(json.dumps(result,ensure_ascii=False),flush=True)
    return result

if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        reports=list(pool.map(lambda p:inspect(*p),[('mandarin','普通話'),('cantonese','粵語預覽')]))
    (OUT/'qa/validation.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf8')
