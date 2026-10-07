"""Apply scoped MacauSplat changes to the explicitly user-named checkout, backing up files."""
from pathlib import Path
import shutil
import json

ROOT=Path(__file__).resolve().parents[2]
SPLAT=Path('D:/Users/LINKIT/Desktop/MacauSplat').resolve()
STAGE=ROOT/'output/integration/splat-edits'
BACKUP=ROOT/'output/integration/backups/splat-upgrade'

def edit(name, replacements):
    path=STAGE/name
    text=path.read_text(encoding='utf-8')
    for old,new in replacements:
        if old not in text: raise ValueError(f'Missing edit anchor in {name}: {old[:70]}')
        text=text.replace(old,new,1)
    path.write_text(text,encoding='utf-8')

def prepare():
    edit('src/lib/backend.ts',[
        ('if (!inTauri()) return null;\n  const locale = getCurrentLocale();','if (!inTauri()) throw new Error(translate(getCurrentLocale(), "input.desktopOnly"));\n  const locale = getCurrentLocale();'),
        ('extensions: ["mp4", "mov"]','extensions: ["mp4", "mov", "m4v", "avi", "mkv", "webm"]'),
        ('if (!inTauri()) return null;\n  const locale = getCurrentLocale();','if (!inTauri()) throw new Error(translate(getCurrentLocale(), "input.desktopOnly"));\n  const locale = getCurrentLocale();'),
        ('export async function selectImageSequence()', '''export async function selectAnnotationSeeds(): Promise<string | null> {
  if (!inTauri()) throw new Error(translate(getCurrentLocale(), "input.desktopOnly"));
  const selected = await open({ title: translate(getCurrentLocale(), "annotation.selectSeeds"), multiple: false, directory: false, filters: [{ name: "JSON", extensions: ["json"] }] });
  return typeof selected === "string" ? selected : null;
}

export async function selectImageSequence()'''),
    ])
    path=STAGE/'src/lib/backend.ts';text=path.read_text(encoding='utf-8')
    old='export async function annotateProject'; start=text.index(old);end=text.index('\n',start)
    line=text[start:end]
    if 'projectPath' not in line:raise ValueError('Unexpected annotation function')
    text=text[:start]+'''export async function annotateProject(projectPath: string, classId = 0, seedsPath: string | null = null): Promise<AnnotationOutcome> {'''+text[end:]
    text=text.replace('invoke<AnnotationOutcome>("annotate_project", { projectPath, classId })','invoke<AnnotationOutcome>("annotate_project", { projectPath, classId, seedsPath })')
    path.write_text(text,encoding='utf-8')
    edit('src/i18n/index.tsx',[
        ('"input.videoTypes": "MP4 或 MOV"','"input.videoTypes": "MP4 / MOV / M4V / AVI / MKV / WebM"'),
        ('"input.selectVideo": "选择 MP4 或 MOV 视频"','"input.selectVideo": "导入本机视频"'),
        ('"input.videoTypes": "MP4 or MOV"','"input.videoTypes": "MP4 / MOV / M4V / AVI / MKV / WebM"'),
        ('"input.selectVideo": "Choose an MP4 or MOV video"','"input.selectVideo": "Import a local video"'),
        ('"input.label": "输入素材",','"input.label": "输入素材",\n  "input.desktopOnly": "请在 MacauSplat 桌面应用中导入素材；浏览器页面仅用于界面预览。",'),
        ('"input.label": "Input media",','"input.label": "Input media", "input.desktopOnly": "Import media in the MacauSplat desktop app. This browser page is a UI preview.",'),
        ('"annotation.failed": "自动标注失败：{detail}",','''"annotation.failed": "自动标注失败：{detail}",
    "annotation.seedRun": "用目标框生成标注",
    "annotation.selectSeeds": "选择导出的目标框 JSON",
    "annotation.seedEditor": "查看目标框选文件",
    "annotation.reviewQueue": "查看优先复核文件",
    "annotation.quality": "候选 {candidate} 张 · 建议复核 {review} 张 · 暂不使用 {rejected} 张（启发式分级）",'''),
        ('"annotation.failed": "Auto-annotation failed: {detail}",','''"annotation.failed": "Auto-annotation failed: {detail}",
    "annotation.seedRun": "Annotate with target seeds",
    "annotation.selectSeeds": "Choose target seed JSON",
    "annotation.seedEditor": "Locate target seed editor",
    "annotation.reviewQueue": "Locate review queue",
    "annotation.quality": "Candidates {candidate} · Review {review} · Rejected {rejected} (heuristic triage)",'''),
        ('"annotation.qaHint": "双击文件夹内的 qa.html 可人工复核框是否正确"','"annotation.qaHint": "双击 seed-editor.html 框选至少两个视角，导出后用目标框生成标注；review-queue.html 显示复核原因。候选分级不代表准确率。尺寸为未校准的重建单位。"'),
    ])
    edit('src/types/pipeline.ts',[
        ('  upAxisEstimated: boolean;','  upSource: "cameraTrajectory" | "worldY" | "manual";\n  upAxisMayBeWrong: boolean;\n  labelsRemoved: number;\n  warnings: [string, number][];\n  reviewQueue: string;\n  seedEditor: string;\n  candidateFrames: number;\n  reviewFrames: number;\n  rejectedFrames: number;'),
    ])
    edit('src/app/App.tsx',[
        ('selectImageSequence, selectProjectsRoot, selectVideo,','selectImageSequence, selectProjectsRoot, selectVideo, selectAnnotationSeeds,'),
        ('const runAnnotation = useCallback(async () => {','const runAnnotation = useCallback(async (useSeeds = false) => {'),
        ('const outcome = await annotateProject(projectPath, 0);','const seedsPath = useSeeds ? await selectAnnotationSeeds() : null;\n      if (useSeeds && !seedsPath) return;\n      const outcome = await annotateProject(projectPath, 0, seedsPath);'),
        ('matchingAnnotation.outcome.upAxisEstimated','matchingAnnotation.outcome.upAxisMayBeWrong'),
        ('join(" × ") + " m"','join(" × ")'),
        ('<p>{t("annotation.labels", { count: formatNumber(matchingAnnotation.outcome.labelsWritten) })}</p>','''<p>{t("annotation.labels", { count: formatNumber(matchingAnnotation.outcome.labelsWritten) })}</p>
              <p>{t("annotation.quality", { candidate: matchingAnnotation.outcome.candidateFrames, review: matchingAnnotation.outcome.reviewFrames, rejected: matchingAnnotation.outcome.rejectedFrames })}</p>'''),
        ('<button type="button" onClick={() => void revealFile(matchingAnnotation.outcome.qaHtml)}>', '''<button type="button" disabled={annotating} onClick={() => void runAnnotation(true)}><Tags size={14} />{t("annotation.seedRun")}</button>
                <button type="button" onClick={() => void revealFile(matchingAnnotation.outcome.seedEditor)}><FolderOpen size={14} />{t("annotation.seedEditor")}</button>
                <button type="button" onClick={() => void revealFile(matchingAnnotation.outcome.reviewQueue)}><FolderOpen size={14} />{t("annotation.reviewQueue")}</button>
                <button type="button" onClick={() => void revealFile(matchingAnnotation.outcome.qaHtml)}>'''),
    ])
    edit('src-tauri/src/project/manager.rs',[
        ('Some("mp4" | "mov") => Ok(())','Some("mp4" | "mov" | "m4v" | "avi" | "mkv" | "webm") => Ok(())'),
        ('"仅支持 MP4 或 MOV 文件"','"支持 MP4、MOV、M4V、AVI、MKV 或 WebM 视频；实际编码需 FFprobe/FFmpeg 可读取"'),
    ])
    edit('src-tauri/src/reconstruction/mod.rs',[('pub mod autolabel;','pub mod autolabel;\npub mod annotation_quality;\npub mod target_selection;')])
    edit('src-tauri/src/reconstruction/autolabel.rs',[
        ('幾何一致、可稽核、零漏框','幾何一致、可稽核但仍需人工複核'),
        ('各軸最小尺寸（公尺）','各軸最小尺寸（重建單位，未校準時不是公尺）'),
    ])
    edit('src-tauri/src/commands/mod.rs',[
        ('该项目当前未在 OOOSplat 预览中打开','该项目当前未在 MacauSplat 预览中打开'),
        ('擬合出的包圍盒尺寸（公尺）','擬合出的包圍盒尺寸（未校準的重建單位）'),
        ('pub struct AnnotationOutcome {','''pub struct AnnotationOutcome {
    pub review_queue: String,
    pub seed_editor: String,
    pub candidate_frames: usize,
    pub review_frames: usize,
    pub rejected_frames: usize,'''),
        ('    class_id: Option<usize>,\n) -> std::result::Result<AnnotationOutcome, SplatError>', '    class_id: Option<usize>,\n    seeds_path: Option<String>,\n) -> std::result::Result<AnnotationOutcome, SplatError>'),
        ('let box3d = fit_box_from_points(&reconstruction, &FitOptions::default())', '''let selection = seeds_path.as_ref().map(|path| -> std::result::Result<_, SplatError> {
            let seeds = serde_json::from_slice::<crate::reconstruction::target_selection::SeedDocument>(&std::fs::read(path)?)?;
            crate::reconstruction::target_selection::select_target_points(&reconstruction, &seeds, 2).map_err(SplatError::Process)
        }).transpose()?;
        let box3d = if let Some(target) = &selection {
            crate::reconstruction::autolabel::fit_box_from_xyz(&target.points, &reconstruction.images, &FitOptions::default())
        } else { fit_box_from_points(&reconstruction, &FitOptions::default()) }'''),
        ('write_qa_html(&qa_html, &frames_href, &annotations, &summary, &box3d, 60)?;', '''write_qa_html(&qa_html, &frames_href, &annotations, &summary, &box3d, 60)?;
        let quality = crate::reconstruction::annotation_quality::assess(&reconstruction, &box3d, &annotations);
        crate::reconstruction::annotation_quality::write_report(&output_dir, &frames_href, &quality, 60)?;
        if let Some(target) = selection { std::fs::write(output_dir.join("target-selection.json"), serde_json::to_vec_pretty(&target)?)?; }'''),
        ('Ok(AnnotationOutcome {','''Ok(AnnotationOutcome {
            review_queue: output_dir.join("review-queue.html").display().to_string(),
            seed_editor: output_dir.join("seed-editor.html").display().to_string(),
            candidate_frames: quality.candidate_frames,
            review_frames: quality.review_frames,
            rejected_frames: quality.rejected_frames,'''),
        ('let outcome = AnnotationOutcome {','''let outcome = AnnotationOutcome {
            review_queue: "C:/p/annotation/review-queue.html".into(),
            seed_editor: "C:/p/annotation/seed-editor.html".into(),
            candidate_frames: 6, review_frames: 18, rejected_frames: 6,'''),
    ])
    edit('src-tauri/src/bin/splatstudio.rs',[
        ('        no_infer_up: bool,\n    },','''        no_infer_up: bool,
        /// Human seed rectangles from seed-editor.html; at least two registered views.
        #[arg(long)]
        seeds: Option<PathBuf>,
        #[arg(long, default_value_t = 2)]
        min_seed_support: usize,
    },'''),
        ('            no_infer_up,\n        } => {','            no_infer_up,\n            seeds,\n            min_seed_support,\n        } => {'),
        ('let box3d = fit_box_from_points(&reconstruction, &options)', '''let selection = seeds.as_ref().map(|path| -> Result<_> {
                let seeds = serde_json::from_slice::<ooo_splat::reconstruction::target_selection::SeedDocument>(&std::fs::read(path)?)?;
                ooo_splat::reconstruction::target_selection::select_target_points(&reconstruction, &seeds, min_seed_support).map_err(SplatError::Process)
            }).transpose()?;
            let box3d = if let Some(target) = &selection {
                ooo_splat::reconstruction::autolabel::fit_box_from_xyz(&target.points, &reconstruction.images, &options)
            } else { fit_box_from_points(&reconstruction, &options) }'''),
        ('std::fs::write(&path, serde_json::to_string_pretty(&box3d)?)?;', '''std::fs::write(&path, serde_json::to_string_pretty(&box3d)?)?;
            if let Some(target) = selection { std::fs::write(out.join("target-selection.json"), serde_json::to_vec_pretty(&target)?)?; }'''),
        ('× {:.2} m，中心','× {:.2} 重建單位（未校準），中心'),
        ('            println!(\n                "影格 {} 張 → 採用', '''            let quality = ooo_splat::reconstruction::annotation_quality::assess(&reconstruction, &box3d, &annotations);
            ooo_splat::reconstruction::annotation_quality::write_report(&out, &frames_href, &quality, qa_limit)?;
            println!("複核分級：候選 {} · 需複核 {} · 暫不使用 {}（啟發式，不是準確率）", quality.candidate_frames, quality.review_frames, quality.rejected_frames);
            println!(
                "影格 {} 張 → 採用'''),
    ])
    edit('src-tauri/src/telemetry/service.rs',[
        ('analytics_enabled: true,\n            consent_decided: true,','analytics_enabled: false,\n            consent_decided: false,'),
        ('assert_eq!(TELEMETRY_ENDPOINT, Some(configured));','assert_eq!(TELEMETRY_ENDPOINT, if configured.is_empty() { None } else { Some(configured) });'),
        ('assert!(second_config.analytics_enabled);\n        assert!(second_config.consent_decided);','assert!(!second_config.analytics_enabled);\n        assert!(!second_config.consent_decided);'),
    ])
    (STAGE/'config/telemetry-endpoint.txt').write_text('',encoding='utf-8')
    edit('src-tauri/Cargo.toml',[
        ('authors = ["ooolabdev"]','authors = ["Linference", "ooolabdev (upstream contributors)"]'),
        ('repository = "https://github.com/ooolabdev/ooosplat"','repository = "https://github.com/Linference/MacauSplat"'),
        ('homepage = "https://github.com/ooolabdev/ooosplat"','homepage = "https://github.com/Linference/MacauSplat"'),
    ])
    # Internal crate/protocol names remain compatible with existing projects.
    for name in ['target_selection.rs','annotation_quality.rs','seed-editor.html']:
        shutil.copyfile(ROOT/'tools/integration/splat'/name,STAGE/'src-tauri/src/reconstruction'/name)
    package=json.loads((SPLAT/'package.json').read_text(encoding='utf-8'))
    for platform in ('windows','linux','macos'):
        key='package:'+platform
        package['scripts'][key]=package['scripts'][key].replace('verify:telemetry:release','verify:telemetry')
    (STAGE/'package.json').write_text(json.dumps(package,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def install():
    for source in STAGE.rglob('*'):
        if not source.is_file():continue
        relative=source.relative_to(STAGE);target=(SPLAT/relative).resolve()
        if not target.is_relative_to(SPLAT):raise ValueError('Path leaves target project')
        backup=BACKUP/relative
        if target.exists() and not backup.exists():
            backup.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(target,backup)
        target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
    print('MacauSplat scoped upgrade installed with backups.')

if __name__=='__main__':
    import sys
    if '--prepare' in sys.argv:prepare()
    else:install()
