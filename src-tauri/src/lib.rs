pub mod db;
pub mod knowledge;

use db::Database;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) -> Result<bool, String> {
    let is_fs = window.is_fullscreen().map_err(|e| e.to_string())?;
    let next_state = !is_fs;
    window.set_fullscreen(next_state).map_err(|e| e.to_string())?;
    Ok(next_state)
}

#[tauri::command]
fn set_fullscreen(window: tauri::Window, fullscreen: bool) -> Result<bool, String> {
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())?;
    Ok(fullscreen)
}

#[tauri::command]
fn is_fullscreen(window: tauri::Window) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn destroy_window(window: tauri::Window) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Resolve OS-standard application data directory
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

            std::fs::create_dir_all(&app_data_dir)
                .map_err(|e| format!("Failed to create app data dir {:?}: {}", app_data_dir, e))?;

            let db_path = app_data_dir.join("novadome.db");
            let database = Database::init(db_path)
                .map_err(|e| format!("Failed to initialize database: {}", e))?;

            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            toggle_fullscreen,
            set_fullscreen,
            is_fullscreen,
            close_window,
            destroy_window,
            knowledge::commands::create_record,
            knowledge::commands::get_record,
            knowledge::commands::list_records,
            knowledge::commands::update_record,
            knowledge::commands::delete_record,
            knowledge::commands::search_records,
            knowledge::commands::list_tags,
            knowledge::commands::create_relationship,
            knowledge::commands::delete_relationship,
            knowledge::commands::get_record_relationships
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
