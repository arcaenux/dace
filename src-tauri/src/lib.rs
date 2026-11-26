pub mod attachments;
pub mod backup;
pub mod db;
pub mod fonts;
pub mod knowledge;
pub mod migration;
pub mod reader;
pub mod settings;
pub mod terminal;

use tauri::Manager;

#[cfg(not(test))]
use attachments::storage::AttachmentStorage;
#[cfg(not(test))]
use db::Database;

#[allow(dead_code)]
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[allow(dead_code)]
#[tauri::command]
fn toggle_fullscreen(window: tauri::Window) -> Result<bool, String> {
    let is_fs = window.is_fullscreen().map_err(|e| e.to_string())?;
    let next_state = !is_fs;
    window.set_fullscreen(next_state).map_err(|e| e.to_string())?;
    Ok(next_state)
}

#[allow(dead_code)]
#[tauri::command]
fn set_fullscreen(window: tauri::Window, fullscreen: bool) -> Result<bool, String> {
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())?;
    Ok(fullscreen)
}

#[allow(dead_code)]
#[tauri::command]
fn is_fullscreen(window: tauri::Window) -> Result<bool, String> {
    window.is_fullscreen().map_err(|e| e.to_string())
}

#[allow(dead_code)]
#[tauri::command]
fn get_migration_status(app: tauri::AppHandle) -> Result<migration::MigrationReport, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(migration::DataMigrator::migrate_if_needed(&app_data_dir))
}

#[allow(dead_code)]
#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[allow(dead_code)]
#[tauri::command]
fn destroy_window(window: tauri::Window) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}

#[cfg(not(test))]
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

            // Apply a staged restore before any SQLite or attachment handles are
            // opened. This also finalizes or rolls back an interrupted attempt.
            let mut restore_applied = false;
            match backup::restore::apply_pending_restore(&app_data_dir) {
                Ok(Some(outcome)) => {
                    restore_applied = true;
                    if outcome.success {
                        eprintln!("[Dace] Restore completed: {}", outcome.message);
                    } else {
                        eprintln!("[Dace] Restore failed: {}", outcome.message);
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    eprintln!("[Dace] Could not apply pending restore: {}", e);
                    restore_applied = true;
                    if let Err(record_err) =
                        backup::restore::record_startup_restore_error(&app_data_dir, &e)
                    {
                        eprintln!("[Dace] Could not record restore startup error: {}", record_err);
                    }
                }
            }

            // Safe legacy data migration: detect and migrate com.novadome.app data if present.
            // Skip it after a restore so a partial prior migration cannot replace the
            // just-restored (or rolled-back) database with legacy data.
            let report = if restore_applied {
                migration::MigrationReport {
                    legacy_dir_found: None,
                    db_migrated: false,
                    attachments_migrated: 0,
                    already_migrated: true,
                    details: "Legacy migration skipped because a restore was applied at startup"
                        .to_string(),
                    error: None,
                }
            } else {
                migration::DataMigrator::migrate_if_needed(&app_data_dir)
            };
            if let Some(ref err) = report.error {
                eprintln!("[Dace] Legacy data migration notice: {}", err);
            }

            // Target SQLite database: dace.db (with fallback to novadome.db if needed)
            let db_path = if app_data_dir.join("dace.db").exists() {
                app_data_dir.join("dace.db")
            } else if app_data_dir.join("novadome.db").exists() {
                app_data_dir.join("novadome.db")
            } else {
                app_data_dir.join("dace.db")
            };

            let database = Database::init(db_path)
                .map_err(|e| format!("Failed to initialize database: {}", e))?;

            // Initialize Content-Addressed Attachment Storage & run startup reconciliation
            let attachments_dir = app_data_dir.join("attachments");
            let storage = AttachmentStorage::new(&attachments_dir)
                .map_err(|e| format!("Failed to initialize attachment storage {:?}: {}", attachments_dir, e))?;
            storage.run_reconciliation();

            // Confirm the restored environment with the live handles before the
            // frontend is allowed to consume (and report) the restore result.
            if let Err(e) =
                backup::restore::confirm_startup_restore(&app_data_dir, &database, &storage)
            {
                eprintln!("[Dace] Could not confirm restored environment: {}", e);
            }

            app.manage(database);
            app.manage(storage);
            app.manage(std::sync::Arc::new(terminal::TerminalState::new()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_migration_status,
            toggle_fullscreen,
            set_fullscreen,
            is_fullscreen,
            close_window,
            destroy_window,
            settings::get_app_settings,
            settings::update_app_settings,
            settings::reset_app_settings,
            settings::get_storage_info,
            settings::get_app_info,
            settings::pick_backup_directory,
            fonts::list_system_fonts,
            terminal::get_terminal_environment,
            terminal::spawn_terminal_session,
            terminal::write_terminal_session,
            terminal::resize_terminal_session,
            terminal::interrupt_terminal_session,
            terminal::close_terminal_session,
            terminal::list_terminal_sessions,
            backup::export_backup,
            backup::inspect_backup_archive,
            backup::restore_backup_archive,
            backup::get_restore_result,
            knowledge::commands::create_record,
            knowledge::commands::get_record,
            knowledge::commands::list_records,
            knowledge::commands::update_record,
            knowledge::commands::delete_record,
            knowledge::commands::search_records,
            knowledge::commands::list_tags,
            knowledge::commands::create_relationship,
            knowledge::commands::delete_relationship,
            knowledge::commands::get_record_relationships,
            knowledge::commands::get_knowledge_graph,
            attachments::commands::pick_and_import_attachment,
            attachments::commands::import_attachment_from_path,
            attachments::commands::import_attachment_from_bytes,
            attachments::commands::get_record_attachments,
            attachments::commands::list_all_attachments,
            attachments::commands::get_attachment_details,
            attachments::commands::associate_attachment_with_record,
            attachments::commands::disassociate_attachment_from_record,
            attachments::commands::delete_attachment,
            attachments::commands::read_attachment_text,
            attachments::commands::read_attachment_data_url,
            attachments::commands::open_attachment_in_system,
            reader::commands::create_highlight,
            reader::commands::get_attachment_highlights,
            reader::commands::update_highlight_type,
            reader::commands::delete_highlight,
            reader::commands::save_annotation,
            reader::commands::delete_annotation,
            reader::commands::link_highlight_to_record,
            reader::commands::unlink_highlight_from_record,
            reader::commands::get_record_excerpts,
            reader::commands::get_highlight_records,
            reader::commands::create_record_from_excerpt
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle: &tauri::AppHandle, event: tauri::RunEvent| {
            if matches!(event, tauri::RunEvent::Exit) {
                let state = app_handle.state::<std::sync::Arc<terminal::TerminalState>>();
                terminal::cleanup_all_sessions(&state);
            }
        });
}
