mod commands;
mod db;
mod models;
mod ssh;

use commands::{
    append_command, cancel_transfer, chmod_file, close_session, close_terminal,
    compute_folder_size, connect, connection_status, create_folder, create_session, delete_local_path,
    delete_path, delete_profile, delete_session, delete_sessions_before, disconnect, download_file,
    download_file_queued, get_file_info, get_local_home, list_folder, list_local_folder,
    list_port_forwards, list_profiles, list_sessions, load_session, open_terminal, parse_ssh_config,
    ping, ping_connection, read_file_preview, reconnect, rename_local_path, rename_path,
    resize_terminal, reveal_in_finder, save_profile, start_port_forward, stop_all_port_forwards,
    stop_port_forward, test_connection, upload_file, upload_file_queued, write_file_text,
    write_terminal,
};
use ssh::SshState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            let dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let database = db::Db::open(dir).expect("failed to open session database");
            app.manage(database);
            Ok(())
        })
        .manage(SshState::new())
        .invoke_handler(tauri::generate_handler![
            ping,
            connect,
            disconnect,
            connection_status,
            list_folder,
            create_folder,
            rename_path,
            delete_path,
            download_file,
            upload_file,
            download_file_queued,
            upload_file_queued,
            cancel_transfer,
            list_profiles,
            save_profile,
            delete_profile,
            get_local_home,
            list_local_folder,
            rename_local_path,
            delete_local_path,
            reveal_in_finder,
            open_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            get_file_info,
            chmod_file,
            read_file_preview,
            parse_ssh_config,
            test_connection,
            reconnect,
            ping_connection,
            write_file_text,
            compute_folder_size,
            create_session,
            close_session,
            append_command,
            list_sessions,
            load_session,
            delete_session,
            delete_sessions_before,
            start_port_forward,
            stop_port_forward,
            list_port_forwards,
            stop_all_port_forwards,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
