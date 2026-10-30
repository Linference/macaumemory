"""Replace the opening photo while copying the remainder and audio unchanged."""
from pathlib import Path
import importlib.util, json, subprocess, hashlib

ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('story_builder',ROOT/'tools/video/story/build.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
out=b.OUT;work=out/'opening-revision';work.mkdir(exist_ok=True)
timeline=json.loads((out/'timeline.json').read_text(encoding='utf-8'))
first_length=b.dur(out/'shots/01-01.mp4')
replacement=b.render_shot('01-01-macau',b.shot_specs()[0][0],first_length)
clips=[replacement,out/'shots/01-02.mp4',out/'shots/01-03.mp4']
scene=work/'opening-scene.mp4';b.join(clips,[b.dur(p) for p in clips],.25,scene)
results=[]
for label,source,scale,codec in [
 ('2K',out/'途見_使用故事版_2K.mp4',None,['-cq','20','-b:v','0']),
 ('1080p_30MB內',out/'途見_使用故事版_1080p_30MB內.mp4','scale=1920:1080:flags=lanczos',['-rc','vbr','-b:v','1180k','-maxrate','1450k','-bufsize','2900k'])]:
    raw=subprocess.check_output([str(b.FP),'-v','error','-select_streams','v:0','-skip_frame','nokey','-read_intervals','0%+15','-show_entries','frame=best_effort_timestamp_time','-of','csv=p=0',str(source)],cwd=ROOT).decode()
    cut=next(float(line.strip().split(',')[0]) for line in raw.splitlines() if line.strip() and float(line.strip().split(',')[0])>first_length)
    frames=round(cut*30)
    first=work/f'first-{label}.mp4';tail=work/f'tail-{label}.mp4';joined=work/f'joined-{label}.mp4'
    vf='ass=output/video/tujian-story/subtitles.ass'+(','+scale if scale else '')
    b.run([b.FF,'-hide_banner','-loglevel','error','-y','-i',scene,'-vf',vf,'-frames:v',str(frames),'-an','-c:v','h264_nvenc','-preset','p4',*codec,'-pix_fmt','yuv420p','-r','30',first])
    b.run([b.FF,'-hide_banner','-loglevel','error','-y','-ss',f'{frames/30:.9f}','-i',source,'-map','0:v:0','-an','-c:v','copy',tail])
    listing=work/f'concat-{label}.txt';listing.write_text("file '"+first.as_posix()+f"'\nduration {frames/30:.9f}\nfile '"+tail.as_posix()+"'\n",encoding='utf-8')
    b.run([b.FF,'-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',listing,'-c:v','copy','-an',joined])
    target=out/f'途見_使用故事版_開頭修訂_{label}.mp4'
    b.run([b.FF,'-hide_banner','-loglevel','error','-y','-i',joined,'-i',source,'-map','0:v:0','-map','1:a:0','-c','copy','-movflags','+faststart',target])
    def audio_hash(p):
        data=subprocess.check_output([str(b.FF),'-hide_banner','-loglevel','error','-i',str(p),'-map','0:a:0','-c:a','copy','-f','data','-'],cwd=ROOT)
        return hashlib.sha256(data).hexdigest()
    def frame_hash(p):
        return subprocess.check_output([str(b.FF),'-hide_banner','-loglevel','error','-ss','10','-i',str(p),'-t','1','-an','-f','framemd5','-'],cwd=ROOT)
    assert audio_hash(target)==audio_hash(source),'Audio changed'
    assert frame_hash(target)==frame_hash(source),'Content after opening changed'
    assert abs(b.dur(target)-b.dur(source))<.04,'Duration changed'
    results.append({'file':str(target),'duration':b.dur(target),'bytes':target.stat().st_size,'copiedFromSeconds':frames/30,'audioUnchanged':True,'sampledFramesAfterOpeningUnchanged':True})
    print('VERIFIED',label,flush=True)
(work/'verification.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
