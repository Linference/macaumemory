//! Explainable review triage. Thresholds are uncalibrated heuristics, never probabilities.
use std::{collections::{HashMap, HashSet}, path::Path};
use serde::Serialize;
use super::{autolabel::{Box3D, FrameAnnotation}, colmap::{camera_to_pixel, SparseReconstruction}};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all="camelCase")]
pub enum ReviewGrade { Candidate, Review, Reject }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct FrameQuality {
    pub frame: String,
    pub grade: ReviewGrade,
    pub reasons: Vec<String>,
    pub supported_cells: usize,
    /// Axis-aligned span of observed points / proposed box area; not visible-surface coverage.
    pub point_span_ratio: f64,
    pub projected_support: usize,
    pub view_bin: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct QualityReport {
    pub schema_version: u32,
    pub source_fingerprint: String,
    pub scope: String,
    pub candidate_frames: usize,
    pub review_frames: usize,
    pub rejected_frames: usize,
    pub frames: Vec<FrameQuality>,
}

pub fn assess(reconstruction:&SparseReconstruction, box3d:&Box3D, annotations:&[FrameAnnotation]) -> QualityReport {
    let mut observed:HashMap<u32,Vec<[f64;3]>>=HashMap::new();
    for p in &reconstruction.points {
        if !p.xyz.iter().all(|v|v.is_finite()) || !box3d.contains(p.xyz) { continue; }
        let mut ids=HashSet::new();
        for (id,_) in &p.track { if ids.insert(*id) { observed.entry(*id).or_default().push(p.xyz); } }
    }
    let images:HashMap<_,_>=reconstruction.images.iter().map(|i|(i.name.as_str(),i)).collect();
    let mut frames=Vec::new();
    for a in annotations {
        let mut reasons=Vec::new(); let mut cells=HashSet::new(); let mut support=0;
        let(mut min_x,mut min_y,mut max_x,mut max_y)=(1_f64,1_f64,0_f64,0_f64);
        let mut view_bin=0;
        if let Some(image)=images.get(a.frame.as_str()) {
            let center=image.camera_center();
            let delta=std::array::from_fn::<_,3,_>(|k|center[k]-box3d.center[k]);
            // Use box-relative axes, so the view grouping does not assume COLMAP world Y is up.
            let along=|axis:usize|delta.iter().zip(box3d.axes[axis]).map(|(x,y)|x*y).sum::<f64>();
            let(x,y,z)=(along(0),along(1),along(2));
            let azimuth=((y.atan2(x)+std::f64::consts::PI)/std::f64::consts::TAU*8.).floor() as usize;
            let elevation=z.atan2((x*x+y*y).sqrt());
            view_bin=azimuth.min(7)+8*if elevation < -0.35 {0} else if elevation > 0.35 {2} else {1};
            if let (Some(camera),Some([cx,cy,w,h]))=(reconstruction.cameras.get(&image.camera_id),a.yolo) {
                if w>0. && h>0. && camera.width>0 && camera.height>0 {
                    for point in observed.get(&image.id).into_iter().flatten() {
                        let Some((u,v,_))=camera_to_pixel(image.to_camera(*point),camera) else {continue};
                        let x=(u/camera.width as f64-(cx-w/2.))/w;
                        let y=(v/camera.height as f64-(cy-h/2.))/h;
                        if !(0.0..=1.0).contains(&x) || !(0.0..=1.0).contains(&y) {continue;}
                        support+=1; min_x=min_x.min(x);min_y=min_y.min(y);max_x=max_x.max(x);max_y=max_y.max(y);
                        cells.insert(((x*3.).floor() as usize).min(2)+3*((y*3.).floor() as usize).min(2));
                    }
                }
            }
        } else { reasons.push("影格姿态缺失".into()); }
        let span=if support>1 {(max_x-min_x)*(max_y-min_y)}else{0.};
        if a.visible_corners<8 {reasons.push("目标框有角点越出画面或相机前方，轮廓可能被截断".into());}
        if let Some(w)=&a.warning {reasons.push(w.clone());}
        if box3d.up_source.is_estimated(){reasons.push("上轴推断失败，当前为世界 Y 轴后备值".into());}
        if support<12 {reasons.push(format!("有效投影支持仅 {support} 点"));}
        if cells.len()<4 {reasons.push(format!("支持点集中在 {}/9 个网格",cells.len()));}
        if span<0.25 {reasons.push("支持点的二维跨度偏小，不能证明整个框都属于目标".into());}
        let grade=if !a.accepted {if let Some(r)=&a.reason{reasons.insert(0,r.clone());} ReviewGrade::Reject}
            else if reasons.is_empty(){ReviewGrade::Candidate}else{ReviewGrade::Review};
        frames.push(FrameQuality{frame:a.frame.clone(),grade,reasons,supported_cells:cells.len(),point_span_ratio:span,projected_support:support,view_bin});
    }
    QualityReport{schema_version:1,source_fingerprint:super::target_selection::scene_fingerprint(reconstruction),scope:"复核优先级的启发式分级；不是准确率或遮挡率，所有训练标注仍需抽查".into(),
        candidate_frames:frames.iter().filter(|f|f.grade==ReviewGrade::Candidate).count(),
        review_frames:frames.iter().filter(|f|f.grade==ReviewGrade::Review).count(),
        rejected_frames:frames.iter().filter(|f|f.grade==ReviewGrade::Reject).count(),frames}
}

/// Round-robin view bins, with review/rejected examples before candidates.
pub fn review_queue(report:&QualityReport,limit:usize)->Vec<&FrameQuality> {
    if limit == 0 { return Vec::new(); }
    let grades = [ReviewGrade::Review,ReviewGrade::Reject,ReviewGrade::Candidate];
    let mut ordered = Vec::new();
    for grade in grades {
        let mut bins:Vec<Vec<_>>=(0..24).map(|bin|report.frames.iter().filter(|f|f.grade==grade&&f.view_bin==bin).collect()).collect();
        for bin in &mut bins {bin.sort_by(|a,b|a.point_span_ratio.total_cmp(&b.point_span_ratio).then_with(||a.frame.cmp(&b.frame)));}
        let mut list=Vec::new();let mut round=0;
        loop {let mut any=false;for bin in &bins {if let Some(f)=bin.get(round){list.push(*f);any=true;}}if !any{break;}round+=1;}
        ordered.push(list);
    }
    let mut result=Vec::new();
    let mut positions=[0_usize;3];
    // Keep rejected examples even when the review group alone exceeds the limit.
    while result.len()<limit {
        let mut any=false;
        for group in [0,0,1,2] {
            if result.len()==limit {break;}
            if let Some(f)=ordered[group].get(positions[group]) {result.push(*f);positions[group]+=1;any=true;}
        }
        if !any {break;}
    }
    result.truncate(limit);result
}

fn escape(text:&str)->String {text.replace('&',"&amp;").replace('<',"&lt;").replace('>',"&gt;").replace('"',"&quot;").replace('\'',"&#39;")}
pub fn write_report(out:&Path,frames_href:&str,report:&QualityReport,limit:usize)->std::io::Result<()> {
    std::fs::write(out.join("review-quality.json"),serde_json::to_vec_pretty(report)?)?;
    let mut cards=String::new();
    for f in review_queue(report,limit) {
        let name=f.frame.bytes().map(|b|if b.is_ascii_alphanumeric()||b"-_.".contains(&b){(b as char).to_string()}else{format!("%{b:02X}")}).collect::<String>();
        let (label,state)=match f.grade{ReviewGrade::Candidate=>("候选","candidate"),ReviewGrade::Review=>("建议复核","review"),ReviewGrade::Reject=>("暂不使用","reject")};
        cards.push_str(&format!("<article data-grade='{state}'><img loading='lazy' src='{}/{}' alt='{}'><div><b>{label} · {}</b><p>{}</p><small>支持 {} 点 · {}/9 网格 · 点分布跨度 {:.1}% · 视角组 {}</small></div></article>",escape(frames_href),name,escape(&f.frame),escape(&f.frame),f.reasons.iter().map(|s|escape(s)).collect::<Vec<_>>().join("；"),f.projected_support,f.supported_cells,f.point_span_ratio*100.,f.view_bin));
    }
    let html=format!("<!doctype html><html lang='zh-CN'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>MacauSplat · 标注复核队列</title><style>body{{margin:0;background:#f4f2ec;color:#244d46;font:16px system-ui}}main{{max-width:1160px;margin:auto;padding:28px}}p{{line-height:1.7}}section{{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}}article{{background:white;border-radius:14px;overflow:hidden}}article img{{width:100%;aspect-ratio:4/3;object-fit:contain;background:#ddd}}article div{{padding:16px}}small{{color:#657971}}button{{padding:12px;margin:5px;background:#244d46;color:white;border:0;border-radius:8px;cursor:pointer}}</style><main><h1>优先检查值得修正的影格</h1><p>候选 {} 张 · 建议复核 {} 张 · 暂不使用 {} 张。按视角分组展示最多 {limit} 张；这不是随机质量评估样本。</p><p>{}</p><p>未经尺度校准的模型尺寸使用重建单位。完整框请查看 <a href='qa.html'>原始框位复核表</a>。</p><nav><button data-filter='all'>全部</button><button data-filter='review'>建议复核</button><button data-filter='reject'>暂不使用</button><button data-filter='candidate'>候选</button></nav><section>{cards}</section></main><script>document.querySelectorAll('button').forEach(b=>b.onclick=()=>document.querySelectorAll('article').forEach(a=>a.hidden=b.dataset.filter!=='all'&&a.dataset.grade!==b.dataset.filter));</script></html>",report.candidate_frames,report.review_frames,report.rejected_frames,escape(&report.scope));
    std::fs::write(out.join("review-queue.html"),html)?;
    let seeds:Vec<_>=review_queue(report,limit).iter().map(|f| {
        let name=f.frame.bytes().map(|b|if b.is_ascii_alphanumeric()||b"-_.".contains(&b){(b as char).to_string()}else{format!("%{b:02X}")}).collect::<String>();
        serde_json::json!({"frame":f.frame,"src":format!("{frames_href}/{name}")})
    }).collect();
    let payload=serde_json::to_string(&serde_json::json!({"sourceFingerprint":report.source_fingerprint,"frames":seeds}))?.replace('<',"\\u003c");
    let editor=include_str!("seed-editor.html").replace("__SEED_FRAMES__",&payload);
    std::fs::write(out.join("seed-editor.html"),editor)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{autolabel::UpAxisSource,colmap::{Camera,CameraModel,Image,Point3D}};
    fn setup(clustered:bool)->(SparseReconstruction,Box3D,FrameAnnotation){
        let camera=Camera{id:1,model:CameraModel::Pinhole,width:1000,height:1000,params:vec![500.,500.,500.,500.]};
        let image=Image{id:1,qvec:[1.,0.,0.,0.],tvec:[0.;3],camera_id:1,name:"a.jpg".into()};
        let points=(0..16).map(|id|{let x=if clustered{0.01*id as f64}else{(id%4)as f64*1.2-1.8};let y=if clustered{0.0}else{(id/4)as f64*1.2-1.8};Point3D{id,xyz:[x,y,10.],rgb:[0;3],track:vec![(1,0),(1,0)]}}).collect();
        let r=SparseReconstruction{cameras:[(1,camera)].into_iter().collect(),images:vec![image.clone()],points};
        let mut b=Box3D::axis_aligned([0.,0.,10.],[4.,4.,2.]);b.up_source=UpAxisSource::Manual;
        let a=super::super::autolabel::annotate_frame(&image,&r.cameras[&1],&b,&Default::default(),16);
        (r,b,a)
    }
    #[test]fn spread_support_is_candidate_but_clustered_support_needs_review(){
        let(r,b,a)=setup(false);let q=assess(&r,&b,&[a]);assert_eq!(q.candidate_frames,1);assert_eq!(q.frames[0].projected_support,16);
        let(r,b,a)=setup(true);assert_eq!(assess(&r,&b,&[a]).review_frames,1);
    }
    #[test]fn rejection_and_axis_fallback_are_not_candidates(){let(r,mut b,mut a)=setup(false);b.up_source=UpAxisSource::WorldY;assert_eq!(assess(&r,&b,&[a.clone()]).review_frames,1);a.accepted=false;assert_eq!(assess(&r,&b,&[a]).rejected_frames,1);}
    #[test]fn queue_spreads_views_and_prioritizes_review(){
        let frames=(0..5).map(|i|FrameQuality{frame:format!("{i}.jpg"),grade:if i==4{ReviewGrade::Candidate}else{ReviewGrade::Review},reasons:vec![],supported_cells:1,point_span_ratio:0.,projected_support:3,view_bin:if i==3{1}else{0}}).collect();
        let q=QualityReport{schema_version:1,source_fingerprint:String::new(),scope:String::new(),candidate_frames:1,review_frames:4,rejected_frames:0,frames};let selected=review_queue(&q,2);assert_eq!(selected[1].view_bin,1);assert!(review_queue(&q,0).is_empty());
    }
}
