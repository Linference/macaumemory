//! TUJIAN memory-sidecar and byte-preserving publication. Reconstruction is unchanged.
use std::{path::PathBuf, process::Command};
use serde_json::Value;

fn run_memory(project_path: String, settings: Option<Value>, destination: Option<String>) -> Result<Value,String> {
    let project = std::fs::canonicalize(&project_path).map_err(|e| e.to_string())?;
    if !project.is_dir() { return Err("工程目录不存在".into()); }
    let temp = std::env::temp_dir().join(format!("macausplat-memory-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&temp).map_err(|e| e.to_string())?;
    let result = (|| {
        let script = temp.join("memory-project.py");
        std::fs::write(&script, include_str!("../../scripts/memory-project.py")).map_err(|e| e.to_string())?;
        let mut command = Command::new(std::env::var("MACAUSPLAT_PYTHON").unwrap_or_else(|_| "python".into()));
        command.env("PYTHONIOENCODING", "utf-8").env("PYTHONUTF8", "1");
        command.arg(&script).arg(if settings.is_some(){"export"}else{"inspect"}).arg("--project").arg(&project);
        if let Some(body) = settings {
            let file = temp.join("settings.json"); std::fs::write(&file, serde_json::to_vec(&body).map_err(|e| e.to_string())?).map_err(|e|e.to_string())?;
            let base = PathBuf::from(destination.ok_or("请选择发布目录")?);
            if !base.is_dir() { return Err("发布父目录不存在".into()); }
            let out = base.join(format!("tujian-memory-{}", uuid::Uuid::new_v4()));
            command.arg("--settings").arg(file).arg("--out").arg(out);
        }
        #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let output = command.output().map_err(|e|format!("记忆工具需要 Python 3.10+；请安装或设置 MACAUSPLAT_PYTHON。{e}"))?;
        if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());}
        serde_json::from_slice(&output.stdout).map_err(|e|e.to_string())
    })();
    // Remove only this invocation's known files, then its empty temporary directory.
    for name in ["memory-project.py","settings.json"] { let _ = std::fs::remove_file(temp.join(name)); }
    let _ = std::fs::remove_dir(&temp);
    result
}

#[tauri::command]
pub async fn inspect_memory_project(project_path:String)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||run_memory(project_path,None,None)).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub async fn export_memory_project(project_path:String,settings:Value,destination:String)->Result<Value,String>{
    tauri::async_runtime::spawn_blocking(move||run_memory(project_path,Some(settings),Some(destination))).await.map_err(|e|e.to_string())?
}
