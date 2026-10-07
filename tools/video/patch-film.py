"""Replace reviewed scenes without re-rendering the entire picture master."""
import importlib.util,subprocess
from pathlib import Path
s=importlib.util.spec_from_file_location('film',Path(__file__).with_name('build-film.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
master=m.OUT/'renders/picture-master.mp4';original=m.OUT/'renders/picture-before-review.mp4'
if not original.exists():master.rename(original)
pieces=[];cursor=0
def keep(begin,end):
 if end<=begin:return
 dest=m.OUT/'renders'/f'keep-{begin}-{end}.mp4'
 with (m.OUT/'qa/patch-encode.log').open('a') as log:subprocess.run([m.FF,'-y','-loglevel','warning','-ss',str(begin/m.FPS),'-i',str(original),'-frames:v',str(end-begin),'-an','-c:v','h264_nvenc','-preset','p5','-cq','18','-b:v','0','-bf','0',str(dest)],stderr=log,check=True)
 pieces.append(dest)
def still(at):
 raw=subprocess.check_output([m.FF,'-loglevel','error','-ss',str(at/m.FPS),'-i',str(original),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);return m.Image.frombytes('RGB',(m.W,m.H),raw)
patch_indices=[1,5,10,11]
for idx in patch_indices:
 start=round(m.TIMES[idx]['start']*m.FPS);n=m.TIMES[idx]['frames'];keep(cursor,start);prev=still(max(0,start-1));following=still(min(m.offset-1,start+n)) if idx<len(m.SCENES)-1 else None
 dest=m.OUT/'renders'/f'corrected-{m.SCENES[idx]["id"]}.mp4';log=(m.OUT/'qa/patch-encode.log').open('a');p=subprocess.Popen([m.FF,'-y','-loglevel','warning','-f','rawvideo','-pix_fmt','rgb24','-s',f'{m.W}x{m.H}','-r',str(m.FPS),'-i','pipe:0','-an','-c:v','h264_nvenc','-preset','p5','-cq','18','-b:v','0','-bf','0',str(dest)],stdin=subprocess.PIPE,stderr=log)
 print('PATCH',m.SCENES[idx]['id'],flush=True)
 for f,im in enumerate(m.scene_frames(idx)):
  # Adjacent replacement scenes share the transition frames only once.
  if idx+1 in patch_indices and f>=n-m.TRANS:break
  if f<m.TRANS and idx:im=m.transition(prev,im,f/(m.TRANS-1))
  if following is not None and f>=n-m.TRANS:im=m.transition(im,following,(f-(n-m.TRANS))/(m.TRANS-1))
  p.stdin.write(im.tobytes())
 p.stdin.close();p.wait();log.close()
 if p.returncode:raise RuntimeError('Patch render failed')
 pieces.append(dest);cursor=start+n-(m.TRANS if idx+1 in patch_indices else 0)
keep(cursor,m.offset)
listing=m.OUT/'renders/picture-concat.txt';listing.write_text(''.join("file '"+p.as_posix()+"'\n" for p in pieces),encoding='utf8')
subprocess.run([m.FF,'-y','-loglevel','warning','-f','concat','-safe','0','-i',str(listing),'-c','copy','-movflags','+faststart',str(master)],check=True);print('PATCHES_DONE',flush=True)
