"""Competition report: verified prototype, proposed co-creation and study design."""
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,PageBreak,Table,TableStyle,Image,KeepTogether
from PIL import Image as PILImage,ImageOps
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'output/pdf';TMP=ROOT/'tmp/pdfs/tujian';OUT.mkdir(exist_ok=True);TMP.mkdir(parents=True,exist_ok=True)
DEST=OUT/'途见--基于3DGS与GMVR的澳门文旅记忆系统.pdf'
pdfmetrics.registerFont(TTFont('CN','C:/Windows/Fonts/simsun.ttc',subfontIndex=0))
pdfmetrics.registerFont(TTFont('CNB','C:/Windows/Fonts/msyhbd.ttc',subfontIndex=0))
pdfmetrics.registerFontFamily('CN',normal='CN',bold='CNB')
INK=colors.HexColor('#20343C');GOLD=colors.HexColor('#B28C3E');TEAL=colors.HexColor('#276E71');LIGHT=colors.HexColor('#F2F5F4')
styles={
 'body':ParagraphStyle('body',fontName='CN',fontSize=10.3,leading=17.2,textColor=INK,spaceAfter=8,wordWrap='CJK'),
 'small':ParagraphStyle('small',fontName='CN',fontSize=8.7,leading=13.2,textColor=colors.HexColor('#586B72'),spaceAfter=6,wordWrap='CJK'),
 'h1':ParagraphStyle('h1',fontName='CNB',fontSize=19,leading=28,textColor=INK,spaceAfter=15,wordWrap='CJK'),
 'h2':ParagraphStyle('h2',fontName='CNB',fontSize=12.2,leading=20,textColor=TEAL,spaceBefore=9,spaceAfter=7,wordWrap='CJK'),
 'cell':ParagraphStyle('cell',fontName='CN',fontSize=9.3,leading=14.7,textColor=INK,wordWrap='CJK'),
 'cover':ParagraphStyle('cover',fontName='CNB',fontSize=34,leading=45,textColor=INK,spaceAfter=13),
 'subtitle':ParagraphStyle('subtitle',fontName='CNB',fontSize=17,leading=28,textColor=INK,spaceAfter=16,wordWrap='CJK')}
story=[]
def p(s,style='body'):return Paragraph(s,styles[style])
def add(s,style='body'):story.append(p(s,style))
def section(n,title):story.extend([PageBreak(),p(f'{n:02d}  {title}','h1')])
def sub(title,text):story.extend([p(title,'h2'),p(text)])
def table(headers,rows,widths):
 data=[[p(escape(str(x)),'cell') for x in headers]]+[[p(escape(str(x)),'cell') for x in row] for row in rows]
 t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E6EDEB')),('BACKGROUND',(0,1),(-1,-1),LIGHT),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('LINEBELOW',(0,0),(-1,0),.7,TEAL),('LINEBELOW',(0,1),(-1,-1),.3,colors.HexColor('#D5DFDC'))]));story.extend([t,Spacer(1,10)])
def photo(path,height,caption):
 dest=TMP/(Path(path).stem+'.jpg');im=PILImage.open(path).convert('RGB');im=ImageOps.fit(im,(1440,round(height/511*1440)),method=PILImage.Resampling.LANCZOS);im.save(dest,quality=89)
 story.extend([Image(str(dest),width=511,height=height),Spacer(1,6),p(caption,'small'),Spacer(1,7)])
def frame(c,d):
 c.setStrokeColor(GOLD);c.setLineWidth(.7);c.line(42,802,553,802)
 if d.page>1:
  c.setFont('CN',8);c.setFillColor(INK);c.drawString(42,812,'途见 · 澳门文旅记忆系统');c.drawRightString(553,812,'创新比赛作品说明')
 c.setFont('CN',8);c.setFillColor(colors.HexColor('#65767D'));c.drawString(42,27,'2026年10月7日');c.drawRightString(553,27,str(d.page))
add('途见','cover');add('基于3DGS与GMVR的<br/>澳门文旅记忆系统','subtitle');add('创新比赛作品说明 · 价值、创新与软件设计','h2');story.append(Spacer(1,18))
photo(ROOT/'public/photos/real/red-market-f1bf06a963c7.webp',264,'红街市实拍。照片：Doraemon.tvb，CC BY-SA 3.0；素材来源记录保留于项目照片档案。')
add('每一处平凡，都值得被记住。','h2');add('以建筑和街巷为入口，将多视角照片、地点信息、三维实景与个人故事组织成可持续积累的城市记忆。')
add('作品全称：途见--基于3DGS与GMVR的澳门文旅记忆系统','small');add('本说明以现有原型为技术基础，明确提出记忆拼图、居民故事与探究式研学的新增功能设计。','small')

section(0,'作品摘要与目录')
add('途见面向澳门文旅探索与城市记忆保存。现有原型通过建筑目标检测、图像特征检索、位置辅助排序和多视角一致性核验，将照片关联到具体建筑及其记忆档案；采用三维高斯泼溅展示采集场景，并提供实时旋转、缩放及本地模型查看。')
add('作品的价值主张是让普通街巷、民居、店铺与居民经历共同进入澳门记忆。新增设计围绕三个转变展开：由单向导览走向共创叙事，由知识推送深化为情感连接，由单点体验连接成“探究、采集、核验、创作、分享、反馈”的研学闭环。')
table(['内容','页码'],[['项目定位与现有基础','3'],['3DGS与GMVR技术方案','4'],['核心价值与创新主张','5'],['可编辑的记忆拼图','6'],['居民故事与情感连接','7'],['历史城区探究式研学','8'],['软件优化与验证方案','9'],['资料来源与实施范围','10']],[430,81])
add('阅读说明：已实现内容依据当前代码与运行结果整理；共创、关联推荐、人物事件和研学模块按系统设计描述。','small')

section(1,'项目定位与现有基础')
sub('真实问题','澳门记忆不应只围绕知名景点展开。普通建筑背后的职业、家庭与街坊故事往往分散在照片、个人叙述和地方资料中，缺少统一的地点关联与记录入口。游客容易获得建筑简介，却难以理解这里与居民生活的关系。')
table(['使用者','主要需求','系统回应'],[['游客','认出建筑，理解地方故事','照片检索、候选确认、地图与实景探索'],['澳门居民','保存老照片和个人经历','地点关联与记忆档案；新增故事共创设计'],['学生与教师','围绕真实问题开展研学','观察与采集基础；新增任务与作品评价设计']],[82,179,250])
sub('当前原型基础','网站已具备三维地图、真实照片记忆档案、建筑识别工作台、多视角核验、位置辅助、新建筑建档及采集选图工具。本次新增实时高斯实景查看器，并接入实际大三巴重建模型。')
sub('聚焦研学应用','澳门“三五”规划已正式公布；政府相关交流材料提出研学、婚庆等新兴文旅业态及人工智能服务方向。[2][3] 途见选择探究式研学作为优先应用场景，以学习任务、资料来源和学生创作形成可验证的完整流程。')
add('婚庆与康养可作为后续应用研究对象，当前设计集中于文化探索、社区记忆与研学，避免同时铺开多条缺少验证的服务线。','small')

section(2,'3DGS与GMVR技术方案')
table(['技术','职责','当前实现'],[['3DGS','三维高斯泼溅：多视角实景重建与浏览','MacauSplat / COLMAP / Brush 重建；PlayCanvas 网页实时预览'],['GMVR','地理感知多视角视觉识别：关联具体建筑','YOLO检测、DINOv2检索、位置辅助排序与多照片一致性核验']],[58,189,264])
add('GMVR（Geo-aware Multi-view Visual Recognition）是本项目对识别流程的自定义描述性名称。YOLO处理建筑区域和类别，DINOv2提取特征用于建筑身份检索；位置辅助以定位质量为条件，多视角模块检查不同照片的候选是否一致。相似度分数不等于识别正确率。')
photo(ROOT/'output/gaussian-preview/website-preview.png',241,'图1 途见实时高斯实景网页的实际运行画面，支持旋转与缩放。')
add('大三巴预览直接加载155.2 MB原始PLY，保留657,492个高斯点及完整三阶球谐系数，不进行模型降采样或展示文件有损转换。大文件采用流式读取。本地打开功能在浏览器内读取文件。','small')
add('三维重建使用局部坐标。网页通过建筑编号关联地图与独立实景视图；精确叠加到地理地图还需要尺度、朝向与坐标配准。','small')

section(3,'核心价值与创新主张')
sub('共创叙事：让使用者参与记忆的组织','CROSSCULT通过文化资源、地点、人物与公民观点之间的关联，鼓励反思和历史再解读。[1] 途见借鉴这一思路，设计可编辑的记忆拼图：系统提供候选线索，使用者补充背景、选择关联、修正信息，并形成自己的叙事作品。')
sub('情感连接：让建筑与生活经历相遇','居民的口述与家庭照片可以补充建筑介绍。一个地点既有可核对的公共历史，也有具体讲述者的个人记忆。软件为两种内容保留各自来源与表达空间，让游客理解地方生活，让居民参与城市记忆的保存。')
sub('系统闭环：让探索产出可积累的成果','系统设计把拍摄、建筑核验、空间展示、故事采集、线索关联和研学创作连接起来。每次活动留下可编辑的地点记录或记忆作品，使文化探索产生可复用的数据与内容。')
table(['创新层次','可体现的贡献'],[['工程与应用整合','将建筑检索、定位核验、三维实景和记忆档案连接成可操作的软件流程'],['内容组织与交互','以地点为锚点组织照片、人物、事件和口述，提供可修改的关联与叙事'],['学习与社会价值','鼓励普通建筑和居民经历进入记录，支持基于资料的研学创作与跨代交流']],[120,391])
add('比赛创新应由原型、对照实验和真实使用结果支撑。3DGS、YOLO、DINOv2及上游重建工具作为技术基础注明来源；项目贡献落在场景适配、系统整合和可验证的参与机制。','small')

section(4,'可编辑的记忆拼图')
add('功能设计目标：让一张照片或一段叙述成为探索关联的起点。自动推荐以已收录且来源清晰的资料为依据，使用者决定是否采用、补充或删除关联。')
table(['信息对象','建议字段'],[['地点 / 建筑','稳定编号、名称、坐标、地点确认状态、建筑类型'],['记忆记录','照片或录音、讲述者署名、发生时间与不确定性、记录时间、授权范围'],['人物 / 事件','名称或称谓、时间范围、相关地点、资料来源与审核状态'],['关联线索','起点与终点、关联类型、推荐理由、引用资料、用户确认与修改记录']],[112,399])
sub('推荐与编辑流程','上传照片或故事，先确认地点与背景；提取人名、地点、年代和主题；从审核后的资料库检索相关记录；展示“你可能还想知道”的线索及关联理由；使用者确认、修改或拒绝；将选中的线索组织成一张可编辑的记忆拼图。')
sub('示意案例：爷爷在码头工作的照片','使用者补充“家人曾在码头工作”，但尚不清楚拍摄年份。系统可推荐与已确认码头地点、职业生活或渔业主题有关的资料。推荐卡说明关联依据与资料出处，不自行认定照片年代、人物身份或具体事件。使用者可询问家人并更新记录。')
sub('优化建议','每条关系保留来源和修改历史；日期允许填写“约某年代”或“未知”；个人记忆与公共史料分层呈现；自动推测先进入待确认区。先用少量人工整理的主题资料完成案例，再评估关联推荐。')

section(5,'居民故事与情感连接')
add('新增设计：在地点档案中加入“这里的故事”。居民可以选择地点、录制口述或输入文字，决定如何署名与公开；游客在识别建筑或打开地图地点后，可以阅读或听取关联故事，也能贡献自己的经历。')
table(['环节','交互与数据要求'],[['选择地点','可使用设备定位，也可手动点选；拍摄者所在位置与故事发生地分别记录'],['记录故事','录音与文字并行；建议短篇叙述；转写文本可由讲述者修改'],['补充背景','填写时间范围、与地点的关系、是否为亲历，允许注明不确定之处'],['授权与发布','分别选择公开文字、公开录音、匿名或署名；提供撤回与编辑入口'],['审核与反馈','公开前检查隐私、内容与关联地点；允许补充资料，不以点赞决定史实']],[98,413])
sub('保留声音的温度','数字人可介绍建筑并引导使用者探索，居民原声承担个人叙事。合成讲解与居民录音在界面中分别标识，保留讲述者的表达，不自动改写成统一的标准历史。')
sub('普通建筑同样可参与','居民故事可以关联民居、店铺、街角或已经改变用途的空间。没有进入参考库的建筑，经手动确认后建立稳定地点记录；系统不以是否属于知名景点决定其记录价值。')
add('当前网站已有定位、照片和地点档案基础。统一的居民录音上传、公开内容审核及撤回流程属于新增设计，需要云端存储与内容管理支持。','small')

section(6,'历史城区探究式研学')
add('建议研学主题：“一条街如何连接建筑、职业与家庭记忆？”学生在教师指导下提出问题，通过实地观察、照片、居民自愿讲述和来源资料形成自己的解读。')
table(['学习环节','软件提供的支持','学生产出'],[['提出问题','主题任务与背景资料入口','明确研究问题与观察计划'],['实地采集','多视角照片、位置确认与记录','带地点的观察笔记'],['核验与关联','建筑候选、资料来源及记忆拼图','经过说明的关联线索'],['三维探索','实时高斯实景与不同角度观察','空间观察与细节描述'],['创作叙事','组合照片、口述和事件资料','可编辑的主题记忆作品'],['分享与反馈','教师点评、同伴讨论、居民补充','修改记录与学习反思']],[81,235,195])
sub('评价关注什么','评价研究问题是否清晰、来源是否可靠、地点是否确认、个人记忆与公共史料是否区分、观点是否有依据，以及是否回应反馈进行修改。图片数量或游戏积分不能替代学习质量。')
sub('闭环如何形成','一次研学活动结束后，经过授权和审核的资料可以进入地点档案；学生收到教师或居民的反馈后修改作品；下一组使用者能够继续探索已公开的线索。记录、创作与反馈共同构成可积累的城市记忆。')

section(7,'软件优化与验证方案')
table(['优先事项','具体优化','验证方式'],[['识别与位置','保留候选与分差；定位质量不足时回到影像排序；多图冲突提示补拍','用独立新照片比较单图、位置辅助和多视角核验'],['记忆拼图','先整理少量人物、事件与地点资料；逐条提供关联理由和出处','人工审核推荐相关性、引用正确性及错误关联'],['居民共创','云端录音与文字记录、授权、审核、编辑及撤回','检查任务完成率、授权理解和内容处理流程'],['研学闭环','围绕一个主题形成任务、采集、创作和反馈完整案例','比较介绍阅读与探究任务的学习成果'],['实景性能','按需加载、轻量展示资源、画质档位与暂停环绕','记录下载量、首帧时间及不同设备帧率']],[85,252,174])
sub('识别对照与消融','把同一建筑的一次拍摄放在同一数据分组，避免近重复照片泄漏。比较影像检索、加入位置辅助、加入多视角核验的结果。分别记录Top-1、Top-3、待确认比例与未知建筑误接受率；如与通用AI比较，使用相同照片与独立人工标签。')
sub('共创与学习验证','先开展小规模可行性试用，再根据问题调整。记录关联推荐的人工认可率、无依据关联率、完成一份记忆作品的比例和修改次数。研学评价使用统一量表；参与人数、样本选择和实施时间需在实际试用后据实报告。')
add('这些是验证设计，不作为已经取得的实验结果。避免仅凭相似度分数或演示成功宣称准确率提高、情感连接增强或学习效果提升。','small')

section(8,'资料来源与实施范围')
table(['类别','本说明对应范围'],[['已实现的基础','三维地图、真实照片档案、建筑检索、位置辅助、多视角核验、建档与采集选图；新增网页实时高斯预览'],['新增功能设计','记忆拼图关联推荐、人物事件资料组织、居民录音共创、云端审核与研学任务闭环'],['研究验证','独立识别测试、融合消融、关联质量及学习效果评价；实际结果需另行开展并记录']],[110,401])
add('参考资料','h2')
refs=[
 ('[1] European Commission / CORDIS. CROSSCULT 项目成果：文化资源关联、公民观点与历史再解读。','https://cordis.europa.eu/article/id/413506-digital-resources-encourage-citizens-to-reinterpret-european-hi-stories'),
 ('[2] 澳门政策研究和区域发展局。《澳门特别行政区经济和社会发展第三个五年规划（2026-2030年）》专题。','https://www.dsepdr.gov.mo/zh-hans/event/plan3/plan3'),
 ('[3] 澳门特区政府。“三五”规划经济财政范畴交流会：研学、婚庆及人工智能服务方向。','https://www.gov.mo/zh-hans/news/934184/'),
 ('[4] Oquab et al. DINOv2: Learning Robust Visual Features without Supervision.','https://arxiv.org/abs/2304.07193'),
 ('[5] Kerbl et al. 3D Gaussian Splatting for Real-Time Radiance Field Rendering. SIGGRAPH 2023.','https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/'),
 ('[6] OOOSplat 0.6.0 发布说明：离线HTML、流式PLY与导出功能等。','https://github.com/ooolabdev/ooosplat/releases/tag/0.6.0'),
 ('[7] PlayCanvas Engine：浏览器高斯渲染。','https://github.com/playcanvas/engine')]
for title,url in refs:add(escape(title)+f' <link href="{escape(url)}" color="#276E71">查看原文</link>','small')
add('项目与素材说明','h2');add('模型重建基础来源为OOOSplat、COLMAP与Brush；网站使用DINOv2等已有模型，并通过场景适配和流程整合形成项目功能。红街市照片署名及授权保留；网页截图为本项目实际运行画面。CROSSCULT作为设计参考引用。','small')
doc=SimpleDocTemplate(str(DEST),pagesize=(595.28,841.89),leftMargin=42,rightMargin=42,topMargin=51,bottomMargin=44,title='途见--基于3DGS与GMVR的澳门文旅记忆系统',author='',pageCompression=1)
doc.build(story,onFirstPage=frame,onLaterPages=frame)
print(DEST)
