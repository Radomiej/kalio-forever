mod backend;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(backend::BackendState::default())
        .setup(|app| backend::start(app))
        .build(tauri::generate_context!())
        .expect("error while running Kalio");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            backend::stop(app_handle);
        }
    });
}
