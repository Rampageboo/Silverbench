#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Desktop shell: starts the Python backend and shows the web UI.
//!
//! Two layouts:
//! - **Installed** (resources/app/backend_api exists): the bundled Python first runs
//!   `packaging/bootstrap.py` (syncs the motion-capture engine, creates or updates the
//!   per-user runtime venv), then the backend runs from that venv. Per-user state lives
//!   in `%LOCALAPPDATA%\RampageWorkbench`, so updates can replace the install folder.
//! - **Source checkout** (development, update.bat): the repository's `.venv`, as before.

use std::{
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct BackendProcess(Mutex<Option<Child>>);

/// What the window shows while the backend is not up yet.
#[derive(Clone)]
struct RuntimeInfo {
    packaged: bool,
    /// starting | preparing | starting-backend | running | failed | stopped-for-update
    phase: String,
    error: Option<String>,
    status_file: Option<PathBuf>,
}

struct Runtime(Mutex<RuntimeInfo>);

#[derive(Clone)]
enum Layout {
    Installed { app: PathBuf, python: PathBuf, data: PathBuf },
    Checkout { root: PathBuf },
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(BackendProcess(Mutex::new(None)))
        .manage(Runtime(Mutex::new(RuntimeInfo {
            packaged: false,
            phase: "starting".into(),
            error: None,
            status_file: None,
        })))
        .invoke_handler(tauri::generate_handler![
            dismiss_launch_splash,
            runtime_status,
            retry_runtime,
            prepare_for_update,
            app_info
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.restore_state(StateFlags::all());
            }
            start_runtime(app.handle().clone());

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
                stop_backend(app_handle);
            }
        });
}

fn layout(app: &AppHandle) -> Result<Layout, String> {
    // An exe built inside a checkout also gets the bundle resources copied next to
    // it; it must keep using the checkout, so the exe's location decides first.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe
            .ancestors()
            .skip(1)
            .find(|dir| dir.join("backend_api").join("main.py").is_file())
        {
            return Ok(Layout::Checkout { root: root.to_path_buf() });
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("app");
        if bundled.join("backend_api").join("main.py").is_file() {
            let local = std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .ok_or("LOCALAPPDATA is not set")?;
            return Ok(Layout::Installed {
                app: bundled,
                python: resources.join("python").join("python.exe"),
                data: local.join("RampageWorkbench"),
            });
        }
    }
    find_project_root()
        .map(|root| Layout::Checkout { root })
        .map_err(|err| err.to_string())
}

fn set_phase(app: &AppHandle, phase: &str, error: Option<String>) {
    let runtime = app.state::<Runtime>();
    let mut info = runtime.0.lock().expect("runtime lock poisoned");
    info.phase = phase.into();
    info.error = error;
}

/// Prepare the runtime (installed layout) and start the backend, off the UI thread.
fn start_runtime(app: AppHandle) {
    std::thread::spawn(move || {
        let result = (|| -> Result<Option<Child>, String> {
            let layout = layout(&app)?;
            if let Layout::Installed { app: bundled, python, data } = &layout {
                {
                    let runtime = app.state::<Runtime>();
                    let mut info = runtime.0.lock().expect("runtime lock poisoned");
                    info.packaged = true;
                    info.status_file = Some(data.join("runtime").join("status.json"));
                }
                if backend_port_open(&layout) {
                    return Ok(None); // another instance already serves the UI
                }
                set_phase(&app, "preparing", None);
                run_bootstrap(&app, bundled, python, data)?;
            } else if backend_port_open(&layout) {
                return Ok(None);
            }
            set_phase(&app, "starting-backend", None);
            spawn_backend(&layout).map(Some)
        })();
        match result {
            Ok(child) => {
                *app.state::<BackendProcess>().0.lock().expect("backend lock poisoned") = child;
                set_phase(&app, "running", None);
            }
            Err(error) => set_phase(&app, "failed", Some(error)),
        }
    });
}

fn run_bootstrap(app: &AppHandle, bundled: &Path, python: &Path, data: &Path) -> Result<(), String> {
    let version = app.package_info().version.to_string();
    let mut command = Command::new(python);
    command
        .arg(bundled.join("packaging").join("bootstrap.py"))
        .arg("--app")
        .arg(bundled)
        .arg("--data")
        .arg(data)
        .arg("--version")
        .arg(&version)
        .arg("--status")
        .arg(data.join("runtime").join("status.json"))
        .current_dir(bundled)
        .stdin(Stdio::null())
        .stdout(log_sink(&data.join("logs"), "bootstrap.log"))
        .stderr(log_sink(&data.join("logs"), "bootstrap.log"));
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let status = command
        .status()
        .map_err(|err| format!("无法启动内置 Python（{}）：{err}", python.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err("运行环境准备失败，详见状态与日志。".into())
    }
}

#[tauri::command]
fn runtime_status(app: AppHandle) -> serde_json::Value {
    let info = app.state::<Runtime>().0.lock().expect("runtime lock poisoned").clone();
    let detail = info
        .status_file
        .as_ref()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
    serde_json::json!({
        "packaged": info.packaged,
        "phase": info.phase,
        "error": info.error,
        "detail": detail,
    })
}

#[tauri::command]
fn retry_runtime(app: AppHandle) {
    let phase = app.state::<Runtime>().0.lock().expect("runtime lock poisoned").phase.clone();
    // Also after an update that stopped the backend and then failed to install.
    if phase == "failed" || phase == "stopped-for-update" {
        set_phase(&app, "starting", None);
        start_runtime(app);
    }
}

/// Stop the backend (and its engines and capture adapters) so an update can replace files.
#[tauri::command]
fn prepare_for_update(app: AppHandle) {
    stop_backend(&app);
    set_phase(&app, "stopped-for-update", None);
}

#[tauri::command]
fn app_info(app: AppHandle) -> serde_json::Value {
    let packaged = app.state::<Runtime>().0.lock().expect("runtime lock poisoned").packaged;
    serde_json::json!({ "version": app.package_info().version.to_string(), "packaged": packaged })
}

fn stop_backend(app: &AppHandle) {
    let child = app.state::<BackendProcess>().0.lock().expect("backend lock poisoned").take();
    if let Some(mut child) = child {
        // The backend starts resident engines and capture adapters; end the whole tree.
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/T", "/F", "/PID", &child.id().to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }
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
                // Filter on the image name too: the splash usually self-closes
                // from the ready-file marker, so this PID may already be reused
                // by an unrelated process by the time we get here.
                let _ = std::process::Command::new("taskkill")
                    .args([
                        "/F",
                        "/FI",
                        &format!("PID eq {pid}"),
                        "/FI",
                        "IMAGENAME eq powershell.exe",
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status();
            }
        }
        let _ = std::fs::remove_file(pid_path);
    }
}

fn code_root(layout: &Layout) -> &Path {
    match layout {
        Layout::Installed { app, .. } => app,
        Layout::Checkout { root } => root,
    }
}

fn backend_settings(layout: &Layout) -> (String, u16) {
    if let Ok(raw) = std::env::var("YWB_BACKEND_PORT") {
        if let Ok(port) = raw.parse::<u16>() {
            if port > 0 {
                return (default_backend_host(), port);
            }
        }
    }
    let config_path = code_root(layout).join("apps").join("desktop").join("backend.config.json");
    if let Ok(text) = std::fs::read_to_string(config_path) {
        let host = json_string_field(&text, "host").unwrap_or_else(default_backend_host);
        if let Some(port) = json_number_field(&text, "port") {
            if port > 0 {
                return (host, port);
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

fn backend_port_open(layout: &Layout) -> bool {
    let (host, port) = backend_settings(layout);
    let address: SocketAddr = format!("{host}:{port}")
        .parse()
        .expect("valid backend address");
    TcpStream::connect_timeout(&address, Duration::from_millis(300)).is_ok()
}

fn spawn_backend(layout: &Layout) -> Result<Child, String> {
    let (host, port) = backend_settings(layout);
    let (python, logs) = match layout {
        Layout::Installed { data, .. } => (
            PythonCommand {
                program: data.join("runtime").join("venv").join("Scripts").join("python.exe"),
                prefix_args: Vec::new(),
            },
            data.join("logs"),
        ),
        Layout::Checkout { root } => (resolve_python_command(root)?, root.join("logs")),
    };
    let root = code_root(layout);

    let mut command = Command::new(&python.program);
    command
        .args(&python.prefix_args)
        .current_dir(root)
        .env("PYTHONPATH", root)
        .env("YWB_DESKTOP", "1")
        .arg("-m")
        .arg("uvicorn")
        // Same app as development (run.bat / start-backend-and-wait.mjs): it adds the training
        // and multimodal routes on top of backend_api.main.
        .arg("backend_api.multimodal_main:app")
        .arg("--host")
        .arg(host)
        .arg("--port")
        .arg(port.to_string())
        .stdin(Stdio::null())
        .stdout(log_sink(&logs, "backend.log"))
        .stderr(log_sink(&logs, "backend.log"));
    if let Layout::Installed { data, .. } = layout {
        command
            .env("RWB_PACKAGED", "1")
            .env("RWB_ANIMOCAP_ROOT", data.join("animocap"))
            .env("RWB_UI_MAPS_DIR", data.join("ui_maps"));
    }
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .spawn()
        .map_err(|err| format!("Failed to start Python backend with {}: {err}", python.display()))
}

/// Process output goes to `<logs>/<name>` (append), so a failed start leaves a trace.
fn log_sink(dir: &Path, name: &str) -> Stdio {
    let _ = std::fs::create_dir_all(dir);
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(name))
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null())
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
            format!("{} {}", self.program.display(), self.prefix_args.join(" "))
        }
    }
}

/// Source checkout: the project's .venv, else a Python on PATH.
fn resolve_python_command(project_root: &Path) -> Result<PythonCommand, String> {
    let venv = if cfg!(windows) {
        project_root.join(".venv").join("Scripts").join("python.exe")
    } else {
        project_root.join(".venv").join("bin").join("python")
    };
    if venv.is_file() {
        return Ok(PythonCommand { program: venv, prefix_args: Vec::new() });
    }
    let path_candidates: &[(&str, &[&str])] = if cfg!(windows) {
        &[("py", &["-3"]), ("python", &[])]
    } else {
        &[("python3", &[]), ("python", &[])]
    };
    for (program, prefix) in path_candidates {
        if python_command_available(Path::new(program), prefix) {
            return Ok(PythonCommand {
                program: PathBuf::from(program),
                prefix_args: prefix.iter().map(|s| (*s).to_string()).collect(),
            });
        }
    }
    Err("No working Python interpreter found (project .venv or PATH). Run run.bat first.".into())
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

    Err("could not locate project root containing backend_api/main.py".into())
}
