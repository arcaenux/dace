use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use portable_pty::{ChildKiller, CommandBuilder, ExitStatus, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const MAX_WRITE_BYTES: usize = 1_000_000;
const OUTPUT_CHUNK_BYTES: usize = 8 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalShell {
    pub id: String,
    pub label: String,
    pub path: String,
    pub args: Vec<String>,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEnvironment {
    pub shells: Vec<TerminalShell>,
    pub default_shell_id: String,
    pub working_directory: String,
    pub platform: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    pub session_id: String,
    pub shell_id: String,
    pub shell_label: String,
    pub working_directory: String,
    pub cols: u16,
    pub rows: u16,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputPayload {
    session_id: String,
    chunk: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    session_id: String,
    code: Option<u32>,
    signal: Option<String>,
    message: String,
}

#[derive(Debug, Clone)]
struct ShellDefinition {
    id: String,
    label: String,
    path: PathBuf,
    args: Vec<String>,
}

struct TerminalSession {
    owner: String,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    info: Mutex<TerminalSessionInfo>,
    closed: AtomicBool,
}

pub struct TerminalState {
    shells: Vec<ShellDefinition>,
    default_shell_id: String,
    sessions: Mutex<HashMap<String, Arc<TerminalSession>>>,
}

impl TerminalState {
    pub fn new() -> Self {
        let shells = discover_shells();
        let default_shell_id = shells
            .first()
            .map(|shell| shell.id.clone())
            .unwrap_or_else(|| "system".to_string());
        Self {
            shells,
            default_shell_id,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn shell(&self, id: &str) -> Result<&ShellDefinition, String> {
        self.shells
            .iter()
            .find(|shell| shell.id == id)
            .ok_or_else(|| format!("Unknown shell '{}'.", id))
    }

    fn public_environment(&self, working_directory: &Path) -> TerminalEnvironment {
        TerminalEnvironment {
            shells: self
                .shells
                .iter()
                .map(|shell| TerminalShell {
                    id: shell.id.clone(),
                    label: shell.label.clone(),
                    path: path_string(&shell.path),
                    args: shell.args.clone(),
                    is_default: shell.id == self.default_shell_id,
                })
                .collect(),
            default_shell_id: self.default_shell_id.clone(),
            working_directory: display_path_string(working_directory),
            platform: std::env::consts::OS.to_string(),
        }
    }
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Canonical Windows paths carry a `\\?\` prefix that is valid for the OS but
/// noisy in the terminal chrome. Keep the canonical value for validation and
/// show the conventional drive path to the user.
fn display_path_string(path: &Path) -> String {
    let value = path_string(path);
    #[cfg(windows)]
    {
        value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
    }
    #[cfg(not(windows))]
    {
        value
    }
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(PathBuf::from))
    }
    #[cfg(not(windows))]
    {
        env::var_os("HOME").map(PathBuf::from)
    }
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for directory in env::split_paths(&path_var) {
        let candidate = directory.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }

        #[cfg(windows)]
        {
            for extension in ["EXE", "CMD", "BAT"] {
                let mut with_extension = candidate.clone();
                with_extension.set_extension(extension);
                if with_extension.is_file() {
                    return Some(with_extension);
                }
            }
        }
    }
    None
}

fn first_existing(paths: Vec<PathBuf>) -> Option<PathBuf> {
    paths.into_iter().find(|path| path.is_file())
}

fn push_unique(definitions: &mut Vec<ShellDefinition>, definition: ShellDefinition) {
    if !definitions
        .iter()
        .any(|existing| existing.id == definition.id || existing.path == definition.path)
    {
        definitions.push(definition);
    }
}

#[cfg_attr(windows, allow(dead_code))]
fn id_from_path(path: &Path) -> String {
    let name = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| "system".to_string());
    let sanitized: String = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.is_empty() {
        "system".to_string()
    } else {
        sanitized
    }
}

#[cfg(windows)]
fn discover_shells() -> Vec<ShellDefinition> {
    let mut definitions = Vec::new();

    let mut pwsh_paths = Vec::new();
    if let Some(program_files) = env::var_os("ProgramFiles") {
        pwsh_paths.push(PathBuf::from(program_files).join("PowerShell/7/pwsh.exe"));
    }
    if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
        pwsh_paths.push(PathBuf::from(program_files_x86).join("PowerShell/7/pwsh.exe"));
    }
    pwsh_paths.push(PathBuf::from(r"C:\Program Files\PowerShell\7\pwsh.exe"));
    if let Some(found) = first_existing(pwsh_paths).or_else(|| find_in_path("pwsh.exe")) {
        push_unique(
            &mut definitions,
            ShellDefinition {
                id: "pwsh".to_string(),
                label: "PowerShell 7".to_string(),
                path: found,
                args: vec!["-NoLogo".to_string()],
            },
        );
    }

    let mut powershell_paths = vec![PathBuf::from(
        r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
    )];
    if let Some(windir) = env::var_os("WINDIR") {
        powershell_paths.push(
            PathBuf::from(windir).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
        );
    }
    if let Some(found) = first_existing(powershell_paths).or_else(|| find_in_path("powershell.exe")) {
        push_unique(
            &mut definitions,
            ShellDefinition {
                id: "powershell".to_string(),
                label: "Windows PowerShell".to_string(),
                path: found,
                args: vec!["-NoLogo".to_string()],
            },
        );
    }

    let mut cmd_paths = vec![PathBuf::from(r"C:\Windows\System32\cmd.exe")];
    if let Some(windir) = env::var_os("WINDIR") {
        cmd_paths.push(PathBuf::from(windir).join("System32/cmd.exe"));
    }
    if let Some(found) = first_existing(cmd_paths).or_else(|| find_in_path("cmd.exe")) {
        push_unique(
            &mut definitions,
            ShellDefinition {
                id: "cmd".to_string(),
                label: "Command Prompt".to_string(),
                path: found,
                args: vec!["/Q".to_string()],
            },
        );
    }

    definitions
}

#[cfg(not(windows))]
fn discover_shells() -> Vec<ShellDefinition> {
    let mut definitions = Vec::new();

    if let Some(shell) = env::var_os("SHELL").map(PathBuf::from) {
        if shell.is_file() {
            let id = id_from_path(&shell);
            let label = shell
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "System shell".to_string());
            push_unique(
                &mut definitions,
                ShellDefinition {
                    id,
                    label: format!("{} (configured shell)", label),
                    path: shell,
                    args: Vec::new(),
                },
            );
        }
    }

    let candidates = [
        ("bash", "Bash", vec![PathBuf::from("/bin/bash"), PathBuf::from("/usr/bin/bash")]),
        ("zsh", "Zsh", vec![PathBuf::from("/bin/zsh"), PathBuf::from("/usr/bin/zsh")]),
        ("fish", "Fish", vec![PathBuf::from("/usr/bin/fish"), PathBuf::from("/bin/fish")]),
        ("sh", "POSIX shell", vec![PathBuf::from("/bin/sh"), PathBuf::from("/usr/bin/sh")]),
    ];

    for (id, label, paths) in candidates {
        if let Some(found) = first_existing(paths) {
            push_unique(
                &mut definitions,
                ShellDefinition {
                    id: id.to_string(),
                    label: label.to_string(),
                    path: found,
                    args: Vec::new(),
                },
            );
        }
    }

    definitions
}

fn validate_cwd(
    requested: Option<&str>,
    roots: &[PathBuf],
    fallback: &Path,
) -> Result<PathBuf, String> {
    let candidate = match requested {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value.trim()),
        _ => fallback.to_path_buf(),
    };

    if !candidate.is_absolute() {
        return Err("Terminal working directory must be an absolute path.".to_string());
    }

    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("Invalid terminal working directory: {}", e))?;
    let allowed = roots.iter().any(|root| {
        root.canonicalize()
            .map(|canonical_root| canonical.starts_with(canonical_root))
            .unwrap_or(false)
    });
    if !allowed {
        return Err("Terminal working directory must be inside your user or Dace data folder.".to_string());
    }
    Ok(canonical)
}

fn working_roots(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    if let Some(home) = home_dir() {
        roots.push(home);
    }
    roots.push(
        app.path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app data dir: {}", e))?,
    );
    Ok(roots)
}

fn emit_output(app: &AppHandle, session: &Arc<TerminalSession>, bytes: &[u8]) {
    if bytes.is_empty() || session.closed.load(Ordering::SeqCst) {
        return;
    }
    let payload = TerminalOutputPayload {
        session_id: session.info.lock().map(|info| info.session_id.clone()).unwrap_or_default(),
        chunk: STANDARD.encode(bytes),
    };
    let _ = app.emit_to(session.owner.as_str(), "dace://terminal-output", payload);
}

fn finalize_session(
    app: &AppHandle,
    state: &Arc<TerminalState>,
    session: Arc<TerminalSession>,
    status: io::Result<ExitStatus>,
) {
    let should_emit = !session.closed.swap(true, Ordering::SeqCst);
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.remove(&session.info.lock().map(|info| info.session_id.clone()).unwrap_or_default());
    }

    if !should_emit {
        return;
    }

    let (code, signal, message) = match status {
        Ok(status) => {
            let code = status.exit_code();
            (
                Some(code),
                status.signal().map(str::to_string),
                format!("Process exited with code {}", code),
            )
        }
        Err(error) => (None, None, format!("Terminal process error: {}", error)),
    };

    let payload = TerminalExitPayload {
        session_id: session.info.lock().map(|info| info.session_id.clone()).unwrap_or_default(),
        code,
        signal,
        message,
    };
    let _ = app.emit_to(session.owner.as_str(), "dace://terminal-exit", payload);
}

fn owned_session(
    state: &TerminalState,
    session_id: &str,
    owner: &str,
) -> Result<Arc<TerminalSession>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Terminal session store unavailable: {}", e))?;
    let session = sessions
        .get(session_id)
        .ok_or_else(|| "Terminal session is no longer running.".to_string())?;
    if session.owner != owner {
        return Err("Terminal session belongs to another window.".to_string());
    }
    Ok(session.clone())
}

#[tauri::command]
pub fn get_terminal_environment(
    app: AppHandle,
    state: tauri::State<'_, Arc<TerminalState>>,
) -> Result<TerminalEnvironment, String> {
    let roots = working_roots(&app)?;
    let fallback = roots
        .first()
        .cloned()
        .ok_or_else(|| "No home or application data directory could be resolved.".to_string())?;
    Ok(state.public_environment(&fallback))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn spawn_terminal_session(
    app: AppHandle,
    window: tauri::Window,
    state: tauri::State<'_, Arc<TerminalState>>,
    shell_id: Option<String>,
    working_directory: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<TerminalSessionInfo, String> {
    let shell_id = shell_id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| state.default_shell_id.clone());
    let shell = state.shell(&shell_id)?.clone();

    let roots = working_roots(&app)?;
    let fallback = roots
        .first()
        .cloned()
        .ok_or_else(|| "No home or application data directory could be resolved.".to_string())?;
    let cwd = validate_cwd(working_directory.as_deref(), &roots, &fallback)?;
    // Validate with the canonical path, but launch the shell from its readable
    // form so PowerShell does not print a `\\?\` prefix in every prompt.
    let launch_cwd = PathBuf::from(display_path_string(&cwd));

    let cols = cols.unwrap_or(80).clamp(20, 400);
    let rows = rows.unwrap_or(24).clamp(5, 200);
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Could not create pseudo-terminal: {}", e))?;

    let mut command = CommandBuilder::new(&shell.path);
    for argument in &shell.args {
        command.arg(argument);
    }
    command.cwd(&launch_cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("DACE_TERMINAL", "1");

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| format!("Could not start {}: {}", shell.label, e))?;
    let killer = child.clone_killer();
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Could not open terminal input: {}", e))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Could not open terminal output: {}", e))?;
    drop(pair.slave);

    let session_id = Uuid::new_v4().to_string();
    let info = TerminalSessionInfo {
        session_id: session_id.clone(),
        shell_id: shell.id.clone(),
        shell_label: shell.label.clone(),
        working_directory: display_path_string(&cwd),
        cols,
        rows,
        started_at: chrono::Utc::now().to_rfc3339(),
    };
    let session = Arc::new(TerminalSession {
        owner: window.label().to_string(),
        killer: Mutex::new(killer),
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        info: Mutex::new(info.clone()),
        closed: AtomicBool::new(false),
    });

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|e| format!("Terminal session store unavailable: {}", e))?;
        sessions.insert(session_id.clone(), session.clone());
    }

    let output_app = app.clone();
    let output_session = session.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; OUTPUT_CHUNK_BYTES];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => emit_output(&output_app, &output_session, &buffer[..count]),
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    });

    let wait_app = app.clone();
    let wait_state = TerminalStateHandle(state.inner().clone());
    let wait_session = session.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        finalize_session(&wait_app, &wait_state.0, wait_session, status);
    });

    Ok(info)
}

/// Wrapper that lets spawned threads hold a cloned terminal state handle while
/// keeping Tauri's `State` wrapper at the command boundary.
struct TerminalStateHandle(Arc<TerminalState>);

#[tauri::command]
pub fn write_terminal_session(
    state: tauri::State<'_, Arc<TerminalState>>,
    window: tauri::Window,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = STANDARD
        .decode(data.as_bytes())
        .map_err(|_| "Terminal input must be base64 encoded.".to_string())?;
    if bytes.len() > MAX_WRITE_BYTES {
        return Err("Terminal input chunk is too large.".to_string());
    }
    let session = owned_session(&state, &session_id, window.label())?;
    if session.closed.load(Ordering::SeqCst) {
        return Err("Terminal session is no longer running.".to_string());
    }
    let mut writer = session
        .writer
        .lock()
        .map_err(|e| format!("Terminal input unavailable: {}", e))?;
    writer
        .write_all(&bytes)
        .map_err(|e| format!("Could not write terminal input: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Could not flush terminal input: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn resize_terminal_session(
    state: tauri::State<'_, Arc<TerminalState>>,
    window: tauri::Window,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = owned_session(&state, &session_id, window.label())?;
    let cols = cols.clamp(20, 400);
    let rows = rows.clamp(5, 200);
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    session
        .master
        .lock()
        .map_err(|e| format!("Terminal display unavailable: {}", e))?
        .resize(size)
        .map_err(|e| format!("Could not resize terminal: {}", e))?;
    if let Ok(mut info) = session.info.lock() {
        info.cols = cols;
        info.rows = rows;
    }
    Ok(())
}

#[tauri::command]
pub fn interrupt_terminal_session(
    state: tauri::State<'_, Arc<TerminalState>>,
    window: tauri::Window,
    session_id: String,
) -> Result<(), String> {
    let session = owned_session(&state, &session_id, window.label())?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|e| format!("Terminal input unavailable: {}", e))?;
    writer
        .write_all(&[3])
        .map_err(|e| format!("Could not interrupt terminal process: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Could not flush terminal interrupt: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn close_terminal_session(
    state: tauri::State<'_, Arc<TerminalState>>,
    window: tauri::Window,
    session_id: String,
) -> Result<(), String> {
    let session = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|e| format!("Terminal session store unavailable: {}", e))?;
        sessions
            .remove(&session_id)
            .ok_or_else(|| "Terminal session is no longer running.".to_string())?
    };
    if session.owner != window.label() {
        return Err("Terminal session belongs to another window.".to_string());
    }
    if session.closed.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    if let Ok(mut killer) = session.killer.lock() {
        let _ = killer.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn list_terminal_sessions(
    state: tauri::State<'_, Arc<TerminalState>>,
    window: tauri::Window,
) -> Result<Vec<TerminalSessionInfo>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("Terminal session store unavailable: {}", e))?;
    Ok(sessions
        .values()
        .filter(|session| session.owner == window.label())
        .filter_map(|session| session.info.lock().ok().map(|info| info.clone()))
        .collect())
}

pub fn cleanup_all_sessions(state: &Arc<TerminalState>) {
    let sessions: Vec<Arc<TerminalSession>> = state
        .sessions
        .lock()
        .map(|mut sessions| sessions.drain().map(|(_, session)| session).collect())
        .unwrap_or_default();

    for session in sessions {
        session.closed.store(true, Ordering::SeqCst);
        if let Ok(mut killer) = session.killer.lock() {
            let _ = killer.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_at_least_one_shell() {
        let shells = discover_shells();
        assert!(!shells.is_empty(), "a local shell must be discoverable");
        assert!(
            shells.iter().all(|shell| shell.path.is_file()),
            "discovered shell paths must exist"
        );
        assert!(
            shells.iter().all(|shell| !shell.id.is_empty()),
            "shell IDs must be stable backend identifiers"
        );
    }

    #[test]
    fn display_paths_hide_windows_extended_prefix() {
        let path = PathBuf::from(r"C:\Users\Astrolab\Project");
        #[cfg(windows)]
        assert_eq!(display_path_string(&path), r"C:\Users\Astrolab\Project");
        #[cfg(not(windows))]
        assert_eq!(display_path_string(&path), path.to_string_lossy());
    }

    #[test]
    fn accepts_only_canonical_paths_inside_allowed_roots() {
        let root = env::temp_dir().join(format!("dace-terminal-test-{}", Uuid::new_v4()));
        let inside = root.join("work");
        std::fs::create_dir_all(&inside).expect("test directory");
        let outside = env::temp_dir();

        let accepted = validate_cwd(Some(inside.to_string_lossy().as_ref()), &[root.clone()], &root)
            .expect("inside path should be accepted");
        assert_eq!(accepted, inside.canonicalize().expect("canonical inside path"));

        let relative = validate_cwd(Some("relative/path"), &[root.clone()], &root);
        assert!(relative.is_err(), "relative paths must be rejected");

        let escaped = validate_cwd(
            Some(outside.to_string_lossy().as_ref()),
            &[root.clone()],
            &root,
        );
        assert!(escaped.is_err(), "paths outside allowed roots must be rejected");

        std::fs::remove_dir_all(inside).expect("cleanup inside");
        std::fs::remove_dir_all(root).expect("cleanup root");
    }
}
