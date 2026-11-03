from pathlib import Path
import subprocess,json
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[3]/'output/video/tujian-promo-60s'
ff=Path('D:/MacauSplat/engines/ffmpeg-full/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe');probe=ff.with_name('ffprobe.exe')
video=root/'途見_60秒宣傳片_普通話_2K.mp4';qa=root/'qa'
info=json.loads(subprocess.check_output([str(probe),'-v','error','-show_streams','-show_format','-of','json',str(video)]))
v=next(s for s in info['streams'] if s['codec_type']=='video');a=next(s for s in info['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'],v['r_frame_rate'])==(2560,1440,'30/1')
assert abs(float(info['format']['duration'])-60)<.1
grid=Image.new('RGB',(1536,930),'#132327');draw=ImageDraw.Draw(grid);font=ImageFont.truetype('C:/Windows/Fonts/msjh.ttc',20)
for i,t in enumerate([.8,9,14,23,34,44.5,50,57.5]):
 file=qa/f'frame-{t}.jpg';subprocess.run([str(ff),'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1','-vf','scale=512:288',str(file)],check=True)
 grid.paste(Image.open(file),(i%3*512,i//3*310));draw.text((i%3*512+10,i//3*310+289),f'{t} 秒',font=font,fill='white')
grid.save(qa/'contact-sheet.jpg')
subprocess.run([str(ff),'-hide_banner','-loglevel','error','-i',str(video),'-f','null','NUL'],check=True)
(qa/'validation.json').write_text(json.dumps({'width':v['width'],'height':v['height'],'fps':v['r_frame_rate'],'duration':info['format']['duration'],'audio':a['codec_name'],'fullDecode':'passed'},indent=2),encoding='utf8')
print('PASS 2560x1440 / 30 fps / 60 s / AAC / full decode')
