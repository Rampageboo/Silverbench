#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

struct BackendProcess(Mutex<Option<Child>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(BackendProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![dismiss_launch_splash])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.restore_state(StateFlags::all());
            }

            let child = start_backend_if_needed().map_err(|err| err.to_string())?;
            let state = app.state::<BackendProcess>();
            *state.0.lock().expect("backend process lock poisoned") = child;

            // Safety net: if the webview fails to load, force-show main after 30s.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(30));
                if let Some(main) = handle.get_webview_window("main") {
                    if !main.is_visible().unwrap_or(true) {
                        let _ = main.show();
                        let _ = main.set_focus();
                        dismiss_launch_splash_impl();
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let _ = app_handle.save_window_state(StateFlags::all());
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

#[tauri::command]
fn dismiss_launch_splash() {
    dismiss_launch_splash_impl();
}

fn dismiss_launch_splash_impl() {
    let temp = std::env::temp_dir();
    let _ = std::fs::write(temp.join("ywb-launch-ready"), b"1");
    let pid_path = temp.join("ywb-launch-splash.pid");
    if let Ok(text) = std::fs::read_to_string(&pid_path) {
        if let Ok(pid) = text.trim().parse::<u32>() {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/F"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status();
            }
        }
        let _ = std::fs::remove_file(pid_path);
    }
}

fn start_backend_if_needed() -> Result<Option<Child>, Box<dyn std::error::Error>> {
    if backend_port_open() {
        return Ok(None);
    }
    Ok(Some(spawn_backend()?))
}

fn backend_settings() -> (String, u16) {
    if let Ok(raw) = std::env::var("YWB_BACKEND_PORT") {
        if let Ok(port) = raw.parse::<u16>() {
            if port > 0 {
                return (default_backend_host(), port);
            }
        }
    }

    if let Ok(root) = find_project_root() {
        let config_path = root
            .join("apps")
            .join("desktop")
            .join("backend.config.json");
        if let Ok(text) = std::fs::read_to_string(config_path) {
            let host = json_string_field(&text, "host").unwrap_or_else(default_backend_host);
            if let Some(port) = json_number_field(&text, "port") {
                if port > 0 {
                    return (host, port);
                }
            }
        }
    }

    (default_backend_host(), default_backend_port())
}

fn default_backend_host() -> String {
    "127.0.0.1".to_string()
}

fn default_backend_port() -> u16 {
    8765
}

fn json_string_field(text: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\"");
    let start = text.find(&marker)?;
    let after = text[start + marker.len()..].trim_start();
    if !after.starts_with(':') {
        return None;
    }
    let value = after[1..].trim_start();
    if let Some(rest) = value.strip_prefix('"') {
        let end = rest.find('"')?;
        return Some(rest[..end].to_string());
    }
    None
}

fn json_number_field(text: &str, key: &str) -> Option<u16> {
    let marker = format!("\"{key}\"");
    let start = text.find(&marker)?;
    let after = text[start + marker.len()..].trim_start();
    if !after.starts_with(':') {
        return None;
    }
    let digits: String = after[1..]
        .trim_start()
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

fn backend_port_open() -> bool {
    let (host, port) = backend_settings();
    let address: SocketAddr = format!("{host}:{port}")
        .parse()
        .expect("valid backend address");
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

fn spawn_backend() -> Result<Child, Box<dyn std::error::Error>> {
    let root = find_project_root()?;
    let python = resolve_python_command(&root)?;
    let (host, port) = backend_settings();

    let mut command = Command::new(&python.program);
    command
        .args(&python.prefix_args)
        .current_dir(&root)
        .env("PYTHONPATH", &root)
        .env("YWB_DESKTOP", "1")
        .arg("-m")
        .arg("uvicorn")
        .arg("backend_api.main:app")
        .arg("--host")
        .arg(host)
        .arg("--port")
        .arg(port.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    command.spawn().map_err(|err| {
        format!(
            "Failed to start Python backend with {}: {err}. See apps/desktop/PACKAGING.md",
            python.display()
        )
        .into()
    })
}

struct PythonCommand {
    program: PathBuf,
    prefix_args: Vec<String>,
}

impl PythonCommand {
    fn display(&self) -> String {
        if self.prefix_args.is_empty() {
            self.program.display().to_string()
        } else {
            format!(
                "{} {}",
                self.program.display(),
                self.prefix_args.join(" ")
            )
        }
    }
}

fn resolve_python_command(project_root: &Path) -> Result<PythonCommand, Box<dyn std::error::Error>> {
    for candidate in python_candidates(project_root) {
        if candidate.path.is_file() {
            return Ok(PythonCommand {
                program: candidate.path,
                prefix_args: candidate.prefix_args.iter().map(|s| (*s).to_string()).collect(),
            });
        }
        if candidate.use_path_lookup && python_command_available(&candidate.path, candidate.prefix_args) {
            return Ok(PythonCommand {
                program: candidate.path,
                prefix_args: candidate.prefix_args.iter().map(|s| (*s).to_string()).collect(),
            });
        }
    }

    Err(format!(
        "No working Python interpreter found. Checked bundled resources/, project .venv, and system python. \
Install dependencies with run.bat or see apps/desktop/PACKAGING.md."
    )
    .into())
}

struct PythonCandidate {
    path: PathBuf,
    prefix_args: &'static [&'static str],
    use_path_lookup: bool,
}

fn python_candidates(project_root: &Path) -> Vec<PythonCandidate> {
    let mut candidates = Vec::new();

    for resource_root in bundled_resource_roots() {
        let bundled_venv = if cfg!(windows) {
            resource_root.join(".venv").join("Scripts").join("python.exe")
        } else {
            resource_root.join(".venv").join("bin").join("python")
        };
        candidates.push(PythonCandidate {
            path: bundled_venv,
            prefix_args: &[],
            use_path_lookup: false,
        });

        let bundled_python = if cfg!(windows) {
            resource_root.join("python").join("python.exe")
        } else {
            resource_root.join("python").join("bin").join("python3")
        };
        candidates.push(PythonCandidate {
            path: bundled_python,
            prefix_args: &[],
            use_path_lookup: false,
        });
    }

    let project_venv = if cfg!(windows) {
        project_root.join(".venv").join("Scripts").join("python.exe")
    } else {
        project_root.join(".venv").join("bin").join("python")
    };
    candidates.push(PythonCandidate {
        path: project_venv,
        prefix_args: &[],
        use_path_lookup: false,
    });

    if cfg!(windows) {
        candidates.push(PythonCandidate {
            path: PathBuf::from("py"),
            prefix_args: &["-3"],
            use_path_lookup: true,
        });
        candidates.push(PythonCandidate {
            path: PathBuf::from("python"),
            prefix_args: &[],
            use_path_lookup: true,
        });
    } else {
        candidates.push(PythonCandidate {
            path: PathBuf::from("python3"),
            prefix_args: &[],
            use_path_lookup: true,
        });
        candidates.push(PythonCandidate {
            path: PathBuf::from("python"),
            prefix_args: &[],
            use_path_lookup: true,
        });
    }

    candidates
}

fn bundled_resource_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("resources"));
            roots.push(dir.to_path_buf());
        }
    }
    roots
}

fn python_command_available(command: &Path, prefix_args: &[&str]) -> bool {
    Command::new(command)
        .args(prefix_args)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
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

    Err("could not locate project root containing backend_api/main.py. See apps/desktop/PACKAGING.md".into())
}
