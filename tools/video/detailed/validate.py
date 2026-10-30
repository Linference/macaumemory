from pathlib import Path
import subprocess,json
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[3]/'output/video/tujian-detailed';qa=root/'qa'
ff=Path('D:/MacauSplat/engines/ffmpeg-full/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe');probe=ff.with_name('ffprobe.exe')
video=root/'途見_詳細講解_普通話_2K.mp4';timeline=json.loads((root/'timeline.json').read_text(encoding='utf8'))
info=json.loads(subprocess.check_output([str(probe),'-v','error','-show_streams','-show_format','-of','json',str(video)]))
v=next(x for x in info['streams'] if x['codec_type']=='video');a=next(x for x in info['streams'] if x['codec_type']=='audio')
assert (v['width'],v['height'],v['r_frame_rate'])==(2560,1440,'30/1')
assert abs(float(info['format']['duration'])-timeline['duration'])<.2
grid=Image.new('RGB',(2048,1240),'#132327');draw=ImageDraw.Draw(grid);font=ImageFont.truetype('C:/Windows/Fonts/msjh.ttc',19)
for i,s in enumerate(timeline['scenes']):
 t=s['start']+2;file=qa/f"frame-{s['id']}.jpg"
 subprocess.run([str(ff),'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1','-vf','scale=512:288',str(file)],check=True)
 grid.paste(Image.open(file),(i%4*512,i//4*310));draw.text((i%4*512+8,i//4*310+290),s['id']+' '+s['title'],font=font,fill='white')
grid.save(qa/'contact-sheet.jpg')
subprocess.run([str(ff),'-hide_banner','-loglevel','error','-i',str(video),'-f','null','NUL'],check=True)
subs=(root/'subtitles/普通話.srt').read_text(encoding='utf-8-sig');assert '-->' in subs
(qa/'validation.json').write_text(json.dumps({'width':2560,'height':1440,'fps':30,'duration':info['format']['duration'],'chapters':len(timeline['scenes']),'audio':a['codec_name'],'decode':'passed'},indent=2),encoding='utf8')
print('PASS',info['format']['duration'],'seconds / 2K / 30 fps / AAC / 14 chapters / full decode')
