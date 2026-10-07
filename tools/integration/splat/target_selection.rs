//! Human seed rectangles constrain the target before fitting a scene box.
//! This is geometric consensus, not semantic segmentation or an accuracy estimate.
use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use super::colmap::{camera_to_pixel, SparseReconstruction};

#[derive(Debug, Deserialize)]
pub struct SeedFrame {
    pub frame: String,
    /// Normalized visible-target rectangle: cx, cy, width, height.
    pub bbox: [f64; 4],
}

#[derive(Debug, Deserialize)]
pub struct SeedDocument {
    #[serde(rename="sourceFingerprint")]
    pub source_fingerprint: String,
    pub labels: Vec<SeedFrame>,
}

/// Stable, non-cryptographic guard against reusing seeds on another reconstruction.
pub fn scene_fingerprint(r: &SparseReconstruction) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    let mut add = |bytes: &[u8]| { for byte in bytes { hash ^= *byte as u64; hash = hash.wrapping_mul(0x100000001b3); } };
    let mut cameras: Vec<_> = r.cameras.values().collect(); cameras.sort_by_key(|c| c.id);
    for camera in cameras { add(&camera.id.to_le_bytes()); add(&[camera.model as u8]); add(&camera.width.to_le_bytes()); add(&camera.height.to_le_bytes()); for v in &camera.params {add(&v.to_bits().to_le_bytes());} }
    let mut images: Vec<_> = r.images.iter().collect(); images.sort_by_key(|i| i.id);
    for image in images {add(&image.id.to_le_bytes());add(&image.camera_id.to_le_bytes());add(image.name.as_bytes());add(&[0]);for v in image.qvec.iter().chain(&image.tvec) {add(&v.to_bits().to_le_bytes());}}
    let mut points: Vec<_> = r.points.iter().collect(); points.sort_by_key(|p| p.id);
    for point in points {add(&point.id.to_le_bytes());for v in point.xyz {add(&v.to_bits().to_le_bytes());}let mut track=point.track.clone();track.sort_unstable();for (id,index) in track {add(&id.to_le_bytes());add(&index.to_le_bytes());}add(&[255]);}
    format!("scene-v1-{hash:016x}")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetSelection {
    pub total_points: usize,
    pub selected_points: usize,
    pub seed_frames: Vec<String>,
    pub minimum_support: usize,
    pub points: Vec<[f64; 3]>,
}

pub fn select_target_points(
    reconstruction: &SparseReconstruction,
    seeds: &SeedDocument,
    minimum_support: usize,
) -> Result<TargetSelection, String> {
    if seeds.source_fingerprint != scene_fingerprint(reconstruction) {
        return Err("目标框文件与当前重建工程不一致，请使用当前工程生成的 seed-editor.html 重新框选".into());
    }
    if minimum_support < 2 || seeds.labels.len() < minimum_support {
        return Err("至少需要两个不同影格的目标框，且支持数不能小于 2".into());
    }
    let mut names = HashSet::new();
    let mut prepared = Vec::new();
    for seed in &seeds.labels {
        if !names.insert(&seed.frame) { return Err(format!("重复种子影格：{}", seed.frame)); }
        let [x,y,w,h] = seed.bbox;
        if !seed.bbox.iter().all(|v| v.is_finite()) || w <= 0.0 || h <= 0.0
            || x-w/2.0 < -1e-6 || y-h/2.0 < -1e-6 || x+w/2.0 > 1.0+1e-6 || y+h/2.0 > 1.0+1e-6 {
            return Err(format!("目标框越界或无效：{}", seed.frame));
        }
        let image = reconstruction.images.iter().find(|i| i.name == seed.frame)
            .ok_or_else(|| format!("影格未注册：{}", seed.frame))?;
        let camera = reconstruction.cameras.get(&image.camera_id)
            .ok_or_else(|| format!("影格缺少相机：{}", seed.frame))?;
        if camera.width == 0 || camera.height == 0 || camera.model.projection_is_approximate() {
            return Err(format!("种子影格的尺寸无效或相机投影仅为近似：{}", seed.frame));
        }
        prepared.push((seed, image, camera));
    }
    let mut points = Vec::new();
    for point in &reconstruction.points {
        if !point.xyz.iter().all(|v| v.is_finite()) { continue; }
        let mut support = 0;
        let mut conflict = false;
        for (seed, image, camera) in &prepared {
            // A missing feature track is unknown, never evidence of absence.
            if !point.track.iter().any(|(id,_)| *id == image.id) { continue; }
            let Some((u,v,_)) = camera_to_pixel(image.to_camera(point.xyz), camera) else { conflict = true; break; };
            let u = u/camera.width as f64;
            let v = v/camera.height as f64;
            let [x,y,w,h] = seed.bbox;
            if u.is_finite() && v.is_finite() && (x-w/2.0..=x+w/2.0).contains(&u) && (y-h/2.0..=y+h/2.0).contains(&v) {
                support += 1;
            } else { conflict = true; break; }
        }
        if !conflict && support >= minimum_support { points.push(point.xyz); }
    }
    if points.len() < 10 { return Err(format!("只有 {} 个多视角一致的目标点；请增加视角或检查目标框，未退回整场景拟合", points.len())); }
    Ok(TargetSelection { total_points: reconstruction.points.len(), selected_points: points.len(),
        seed_frames: seeds.labels.iter().map(|s|s.frame.clone()).collect(), minimum_support, points })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::colmap::{Camera, CameraModel, Image, Point3D};
    fn scene() -> SparseReconstruction {
        let camera = Camera { id:1, model:CameraModel::Pinhole, width:1000,height:1000,params:vec![500.,500.,500.,500.] };
        let images = (1..=3).map(|id|Image{id,qvec:[1.,0.,0.,0.],tvec:[0.;3],camera_id:1,name:format!("{id}.jpg")}).collect();
        let points = (0..12).map(|id|Point3D{id,xyz:[id as f64/100.,0.,10.],rgb:[0;3],track:vec![(1,0),(2,0),(3,0)]}).collect();
        SparseReconstruction{cameras:[(1,camera)].into_iter().collect(),images,points}
    }
    fn seeds(r:&SparseReconstruction) -> SeedDocument { SeedDocument{source_fingerprint:scene_fingerprint(r),labels:vec![1,2].into_iter().map(|id|SeedFrame{frame:format!("{id}.jpg"),bbox:[0.5,0.5,0.2,0.2]}).collect()} }
    #[test] fn keeps_consensus_and_excludes_background() {
        let mut r=scene(); r.points.push(Point3D{id:99,xyz:[8.,0.,10.],rgb:[0;3],track:vec![(1,0),(2,0)]});
        let selected=select_target_points(&r,&seeds(&r),2).unwrap(); assert_eq!(selected.selected_points,12);
    }
    #[test] fn observed_conflict_and_single_view_support_do_not_pass() {
        let mut r=scene(); r.points[0].track=vec![(1,0)];
        let mut s=seeds(&r); s.labels.push(SeedFrame{frame:"3.jpg".into(),bbox:[0.8,0.5,0.1,0.1]});
        assert!(select_target_points(&r,&s,2).is_err());
        assert_eq!(select_target_points(&r,&seeds(&r),2).unwrap().selected_points,11);
    }
    #[test] fn invalid_duplicate_unknown_and_insufficient_seeds_fail() {
        let r=scene(); let mut s=seeds(&r);s.labels[1].frame="1.jpg".into();assert!(select_target_points(&r,&s,2).is_err());
        s=seeds(&r);s.labels[0].bbox[2]=2.;assert!(select_target_points(&r,&s,2).is_err());
        s=seeds(&r);s.labels[0].frame="missing".into();assert!(select_target_points(&r,&s,2).is_err());
        assert!(select_target_points(&r,&seeds(&r),1).is_err());
    }
    #[test] fn seeds_from_other_reconstruction_are_rejected() {let mut r=scene();let s=seeds(&r);r.images[0].tvec[0]=0.1;assert!(select_target_points(&r,&s,2).unwrap_err().contains("不一致"));}
}
