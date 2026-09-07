SELECT current_setting('server_version_num')::integer AS server_version_num,
       system_identifier,
       timeline_id,
       current_setting('ssl') AS ssl_enabled
FROM pg_control_system(), pg_control_checkpoint();
