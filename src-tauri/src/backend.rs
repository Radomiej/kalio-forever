use std::error::Error;
use std::fs::{create_dir_all, remove_file, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::sleep;
use std::time::{Duration, Instant};

use tauri::{App, AppHandle, Manager};

const BACKEND_PORT: u16 = 4516;
const TAURI_ORIGIN: &str = "http://tauri.localhost,tauri://localhost";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Clone, Default)]
pub struct BackendState {
    child: Arc<Mutex<Option<Child>>>,
    lock: Arc<Mutex<Option<(File, PathBuf)>>>,
}

pub fn start(app: &mut App) -> Result<(), Box<dyn Error>> {
    let kalio_home = resolve_kalio_home(app)?;
    let data_root = kalio_home.join("data");
    let resource_root = normalize_windows_path(app.path().resource_dir()?);
    let server_root = resource_root.join("kalio-server");
    let node_name = if cfg!(windows) {
        "kalio-node.exe"
    } else {
        "kalio-node"
    };
    let node_path = resource_root.join(node_name);
    let bootstrap_path = server_root.join("runtime-server-bootstrap.mjs");

    let logs_root = data_root.join("logs");
    create_dir_all(&logs_root)?;
    let log_path = logs_root.join("backend.log");
    let mut startup_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    writeln!(
        startup_log,
        "[kalio] startup resource_root={} server_root={} node={} bootstrap={}",
        resource_root.display(),
        server_root.display(),
        node_path.display(),
        bootstrap_path.display()
    )?;

    if let Err(error) = require_path(&node_path, "bundled Node.js runtime")
        .and_then(|_| require_path(&bootstrap_path, "desktop backend bootstrap"))
        .and_then(|_| {
            require_path(
                &server_root.join("dist").join("main.js"),
                "desktop backend build",
            )
        })
    {
        writeln!(startup_log, "[kalio] startup validation failed: {error}")?;
        return Err(error);
    }

    writeln!(startup_log, "[kalio] startup resources validated")?;
    drop(startup_log);
    let mut startup_log = OpenOptions::new().append(true).open(&log_path)?;
    let lock_path = kalio_home.join(".runtime.lock");
    let mut lock_file = match OpenOptions::new().write(true).create_new(true).open(&lock_path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(std::io::Error::other(format!(
                "another Kalio runtime appears to be using {}",
                lock_path.display()
            )).into());
        }
        Err(error) => return Err(error.into()),
    };
    writeln!(lock_file, "{{\"pid\":{},\"profile\":\"desktop\"}}", std::process::id())?;
    writeln!(
        startup_log,
        "[kalio] spawning backend on port {BACKEND_PORT}"
    )?;
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    let stderr = stdout.try_clone()?;

    let database_path = data_root.join("kalio.db");
    let workspace_root = data_root.join("workspaces");
    let memory_db_path = data_root.join("memory");
    let embedding_cache_dir = data_root.join("embeddings-cache");
    let mut child = match Command::new(node_path)
        .current_dir(&server_root)
        .arg(bootstrap_path)
        .env("NODE_ENV", "production")
        .env("PORT", BACKEND_PORT.to_string())
        .env("CORS_ORIGIN", TAURI_ORIGIN)
        .env("KALIO_INSTALL_PROFILE", "desktop")
        .env("KALIO_ENABLE_TEST_SUPPORT", "false")
        .env("KALIO_HOME", &kalio_home)
        .env("KALIO_DATA_ROOT", &data_root)
        .env("KALIO_HOST", "127.0.0.1")
        .env("KALIO_SERVE_UI", "false")
        .env("KALIO_RUNTIME_VERSION", env!("CARGO_PKG_VERSION"))
        .env("DATABASE_PATH", &database_path)
        .env("WORKSPACE_ROOT", &workspace_root)
        .env("MEMORY_DB_PATH", &memory_db_path)
        .env("EMBEDDING_CACHE_DIR", &embedding_cache_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
    {
        Ok(child) => {
            writeln!(
                startup_log,
                "[kalio] backend spawned with pid {}",
                child.id()
            )?;
            child
        }
        Err(error) => {
            let _ = remove_file(&lock_path);
            writeln!(startup_log, "[kalio] backend spawn failed: {error}")?;
            return Err(error.into());
        }
    };

    if let Err(error) = wait_for_backend(&mut child) {
        let _ = remove_file(&lock_path);
        writeln!(startup_log, "[kalio] backend health wait failed: {error}")?;
        if let Err(stop_error) = child.kill() {
            eprintln!("[kalio] backend cleanup failed: {stop_error}");
        }
        if let Err(wait_error) = child.wait() {
            eprintln!("[kalio] backend wait failed: {wait_error}");
        }
        return Err(error);
    }
    writeln!(startup_log, "[kalio] backend health check passed")?;
    drop(startup_log);

    let state = app.state::<BackendState>();
    let mut state_child = state
        .child
        .lock()
        .map_err(|_| "backend state lock is poisoned")?;
    *state_child = Some(child);
    let mut state_lock = state
        .lock
        .lock()
        .map_err(|_| "backend runtime lock is poisoned")?;
    *state_lock = Some((lock_file, lock_path));
    Ok(())
}

pub fn stop(app: &AppHandle) {
    let state = app.state::<BackendState>();
    let Ok(mut state_child) = state.child.lock() else {
        eprintln!("[kalio] backend state lock is poisoned during shutdown");
        return;
    };

    let Some(mut child) = state_child.take() else {
        return;
    };
    if let Err(error) = child.kill() {
        eprintln!("[kalio] backend shutdown failed: {error}");
    }
    if let Err(error) = child.wait() {
        eprintln!("[kalio] backend wait failed: {error}");
    }
    if let Ok(mut runtime_lock) = state.lock.lock() {
        if let Some((lock_file, lock_path)) = runtime_lock.take() {
            drop(lock_file);
            let _ = remove_file(lock_path);
        }
    }
}

fn resolve_kalio_home(app: &App) -> Result<PathBuf, Box<dyn Error>> {
    let base = if cfg!(windows) {
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or(app.path().app_local_data_dir()?)
    } else if let Some(path) = std::env::var_os("XDG_DATA_HOME") {
        PathBuf::from(path)
    } else if let Some(home) = std::env::var_os("HOME") {
        PathBuf::from(home).join(".local").join("share")
    } else {
        app.path().app_local_data_dir()?
    };
    let name = if cfg!(windows) { "Kalio" } else { "kalio" };
    let root = normalize_windows_path(base.join(name));
    create_dir_all(&root)?;
    Ok(root)
}

fn require_path(path: &Path, label: &str) -> Result<(), Box<dyn Error>> {
    if path.is_file() || path.is_dir() {
        return Ok(());
    }
    Err(std::io::Error::other(format!("{label} is missing at {}", path.display())).into())
}

fn normalize_windows_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(stripped) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }
    path
}

fn wait_for_backend(child: &mut Child) -> Result<(), Box<dyn Error>> {
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    let address = SocketAddr::from(([127, 0, 0, 1], BACKEND_PORT));

    loop {
        if let Some(status) = child.try_wait()? {
            return Err(std::io::Error::other(format!(
                "desktop backend exited before health check with {status}"
            ))
            .into());
        }
        if health_check(address) {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(std::io::Error::other(format!(
                "desktop backend did not become healthy on http://127.0.0.1:{BACKEND_PORT}"
            ))
            .into());
        }
        sleep(Duration::from_millis(250));
    }
}

fn health_check(address: SocketAddr) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return false;
    };
    if stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .is_err()
    {
        return false;
    }
    if stream
        .write_all(b"GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }

    let mut response = [0_u8; 1024];
    let Ok(read) = stream.read(&mut response) else {
        return false;
    };
    String::from_utf8_lossy(&response[..read]).contains(" 200 ")
}

