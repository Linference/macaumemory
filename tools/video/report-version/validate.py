from pathlib import Path
import subprocess,json,sys
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[3]/'output/video/tujian-report-version';ff=Path('D:/MacauSplat/engines/ffmpeg-full/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe');probe=ff.with_name('ffprobe.exe');framed='--framed' in sys.argv;dest=root/('途見_作品講解_比例修正版_30MB內.mp4' if framed else '途見_作品講解_普通話_30MB內.mp4');qa=root/'layout-fix/qa' if framed else root/'qa'
timeline=json.loads((root/'timeline.json').read_text(encoding='utf8'));info=json.loads(subprocess.check_output([str(probe),'-v','error','-show_streams','-show_format','-of','json',str(dest)]));v=next(x for x in info['streams'] if x['codec_type']=='video');a=next(x for x in info['streams'] if x['codec_type']=='audio')
assert dest.stat().st_size<30_000_000
assert (v['width'],v['height'],v['r_frame_rate'])==(1920,1080,'30/1')
assert abs(float(info['format']['duration'])-timeline['duration'])<.2
assert not any(x in ''.join(s['text']+s['title']+s['section'] for s in timeline['scenes']) for x in ['潛能','菁英','比賽'])
grid=Image.new('RGB',(1920,870),'#eeeae0');d=ImageDraw.Draw(grid);font=ImageFont.truetype('C:/Windows/Fonts/msjh.ttc',18)
for i,s in enumerate(timeline['scenes']):
 t=s['start']+min(12,s['duration']/2);p=qa/f"frame-{s['id']}.png"
 subprocess.run([str(ff),'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',str(dest),'-frames:v','1',str(p)],check=True)
 grid.paste(Image.open(p).resize((480,270)),(i%4*480,i//4*290));d.text((i%4*480+8,i//4*290+272),s['id']+' '+s['section'],font=font,fill='#174548')
grid.save(qa/'contact-sheet.jpg')
if framed:
 checks=Image.new('RGB',(1440,len(timeline['scenes'])*290),'#eeeae0');checkdraw=ImageDraw.Draw(checks)
 for i,s in enumerate(timeline['scenes']):
  for j,(label,dt) in enumerate([('開頭',2),('中段',s['duration']/2),('結尾',s['duration']-2)]):
   p=qa/f"check-{s['id']}-{j}.png";subprocess.run([str(ff),'-hide_banner','-loglevel','error','-y','-ss',str(s['start']+dt),'-i',str(dest),'-frames:v','1',str(p)],check=True);pic=Image.open(p);checks.paste(pic.resize((480,270)),(j*480,i*290));checkdraw.text((j*480+8,i*290+272),s['id']+' '+label,font=font,fill='#174548')
 checks.save(qa/'begin-middle-end.jpg')
subprocess.run([str(ff),'-hide_banner','-loglevel','error','-i',str(dest),'-f','null','NUL'],check=True)
(qa/'validation.json').write_text(json.dumps({'bytes':dest.stat().st_size,'decimalMB':round(dest.stat().st_size/1e6,2),'duration':info['format']['duration'],'width':1920,'height':1080,'fps':30,'audio':a['codec_name'],'decode':'passed','competitionName':'absent','frameSamples':33 if framed else 11},indent=2),encoding='utf8')
print('PASS',dest.stat().st_size,'bytes',info['format']['duration'],'seconds / 1080p / 30fps / full decode')
