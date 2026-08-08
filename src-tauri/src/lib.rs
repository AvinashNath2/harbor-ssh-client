mod commands;
mod config;
mod db;
mod models;
mod ssh;

use commands::{
    agent_docker_inspect, agent_docker_list_containers, agent_docker_logs, agent_docker_networks,
    agent_docker_stats, agent_docker_volumes, agent_exec_read, agent_exec_write,
    agent_list_directory, agent_read_file, append_command, cancel_folder_list, cancel_transfer,
    chmod_file, clear_download_history, close_session, close_terminal, compute_folder_size,
    connect, connection_status, create_folder, create_session, delete_download, delete_local_path,
    delete_path, delete_profile, delete_session, delete_sessions_before, disconnect,
    docker_all_container_stats, docker_all_mounts, docker_available, docker_container_events,
    docker_container_inspect, docker_container_logs, docker_container_stats, download_file,
    download_file_queued, export_profiles_json, get_file_info, get_local_home,
    import_profiles_json, list_compose_projects, list_docker_containers, list_docker_images,
    list_docker_networks, list_docker_volumes, list_downloads, list_folder, list_folder_stream,
    list_local_folder, list_port_forwards, list_profiles, list_sessions, load_session,
    open_terminal, parse_ssh_config, ping, ping_connection, process_detail, process_kill,
    process_list_java, process_vm_memory, read_file_preview, read_file_preview_tail, reconnect,
    rename_local_path, rename_path, resize_terminal, reveal_in_finder, save_download, save_profile,
    start_port_forward, stat_local_path, stat_path, stop_all_port_forwards, stop_port_forward,
    storage_age_histogram, storage_category_sizes, storage_check_sudo, storage_cleanup_estimate,
    storage_cleanup_execute, storage_cleanup_preview, storage_find_duplicates,
    storage_largest_items, storage_overview, storage_scan_path, storage_scan_root,
    storage_system_info, storage_system_load, test_connection, upload_file, upload_file_queued,
    write_file_text, write_terminal,
};
use ssh::SshState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;
            let dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            // One-time migration: copy data from the old bundle identifier directory
            // (com.remotevmexplorer.app) used before the app was renamed to HarborSCP.
            if let Some(parent) = dir.parent() {
                let old_dir = parent.join("com.remotevmexplorer.app");
                if old_dir.exists() {
                    for file in ["connections.json", "sessions.db"] {
                        let src = old_dir.join(file);
                        let dst = dir.join(file);
                        if src.exists() && !dst.exists() {
                            let _ = std::fs::copy(&src, &dst);
                        }
                    }
                }
            }

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
            list_folder_stream,
            cancel_folder_list,
            stat_path,
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
            stat_local_path,
            rename_local_path,
            delete_local_path,
            reveal_in_finder,
            export_profiles_json,
            import_profiles_json,
            open_terminal,
            write_terminal,
            resize_terminal,
            close_terminal,
            get_file_info,
            chmod_file,
            read_file_preview,
            read_file_preview_tail,
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
            save_download,
            list_downloads,
            delete_download,
            clear_download_history,
            docker_available,
            list_docker_containers,
            list_docker_images,
            list_docker_networks,
            list_docker_volumes,
            list_compose_projects,
            docker_container_inspect,
            docker_container_logs,
            docker_container_stats,
            docker_container_events,
            docker_all_container_stats,
            docker_all_mounts,
            // Agent tools
            agent_docker_list_containers,
            agent_docker_logs,
            agent_docker_inspect,
            agent_docker_stats,
            agent_docker_networks,
            agent_docker_volumes,
            agent_read_file,
            agent_list_directory,
            agent_exec_read,
            agent_exec_write,
            // Java Process Monitor
            process_list_java,
            process_detail,
            process_vm_memory,
            process_kill,
            // Storage Analyzer
            storage_overview,
            storage_system_info,
            storage_system_load,
            storage_scan_root,
            storage_age_histogram,
            storage_scan_path,
            storage_largest_items,
            storage_category_sizes,
            storage_check_sudo,
            storage_cleanup_estimate,
            storage_cleanup_execute,
            storage_cleanup_preview,
            storage_find_duplicates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
