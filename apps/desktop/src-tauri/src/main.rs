#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::Manager;

struct BackendProcess(Mutex<Option<Child>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            let child = start_backend_if_needed().map_err(|err| err.to_string())?;
            let state = app.state::<BackendProcess>();
            *state.0.lock().expect("backend process lock poisoned") = child;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<BackendProcess>();
                let child = {
                    let mut guard = state.0.lock().expect("backend process lock poisoned");
                    guard.take()
                };
                if let Some(mut child) = child {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}

fn start_backend_if_needed() -> Result<Option<Child>, Box<dyn std::error::Error>> {
    if backend_port_open() {
        return Ok(None);
    }
    Ok(Some(spawn_backend()?))
}

fn backend_port_open() -> bool {
    let address: SocketAddr = "127.0.0.1:8765".parse().expect("valid backend address");
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

fn spawn_backend() -> Result<Child, Box<dyn std::error::Error>> {
    let root = find_project_root()?;
    let python = python_executable(&root);

    let mut command = Command::new(python);
    command
        .current_dir(&root)
        .env("PYTHONPATH", &root)
        .env("YWB_DESKTOP", "1")
        .arg("-m")
        .arg("uvicorn")
        .arg("backend_api.main:app")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("8765")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    Ok(command.spawn()?)
}

fn python_executable(root: &Path) -> PathBuf {
    let venv_python = if cfg!(windows) {
        root.join(".venv").join("Scripts").join("python.exe")
    } else {
        root.join(".venv").join("bin").join("python")
    };
    if venv_python.is_file() {
        return venv_python;
    }
    PathBuf::from(if cfg!(windows) { "python" } else { "python3" })
}

fn find_project_root() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let mut candidates = Vec::new();
    candidates.push(std::env::current_dir()?);
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for candidate in candidates {
        for dir in candidate.ancestors() {
            if dir.join("backend_api").join("main.py").is_file() {
                return Ok(dir.to_path_buf());
            }
        }
    }

    Err("could not locate project root containing backend_api/main.py".into())
}
