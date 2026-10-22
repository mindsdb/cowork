#!/bin/sh
# Nginx access fields are configured natively. Its error text has no safe field
# allowlist, so emit classifications, never request lines or upstream URLs.
set -eu
configuration_error() {
    printf '{"logged_at":"%s","logger":"nginx.error","log_level":"ERROR","message":"Invalid logging configuration","event":"server_diagnostic","reason":"configuration_failed"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
}
case "${ACCESS_LOG_MODE:-errors}" in errors|all) ;; *) configuration_error; exit 2;; esac
export ACCESS_LOG_MODE="${ACCESS_LOG_MODE:-errors}"
case "${LOG_LEVEL:-WARNING}" in
    DEBUG|debug) NGINX_LOG_LEVEL=debug; threshold=10;;
    INFO|info) NGINX_LOG_LEVEL=info; threshold=20;;
    WARNING|warning) NGINX_LOG_LEVEL=warn; threshold=30;;
    ERROR|error) NGINX_LOG_LEVEL=error; threshold=40;;
    *) configuration_error; exit 2;;
esac
export NGINX_LOG_LEVEL
envsubst '${ACCESS_LOG_MODE} ${NGINX_LOG_LEVEL}' < /etc/nginx/diagnostic-logging.conf.template > /etc/nginx/conf.d/00-logging.conf
log_pipe_dir=$(mktemp -d)
mkfifo "$log_pipe_dir/error"
cleanup() { rm -f "$log_pipe_dir/error"; rmdir "$log_pipe_dir"; }
trap cleanup EXIT
stop_status=0
stop() {
    kill -QUIT "$nginx_pid" 2>/dev/null || true
    wait "$nginx_pid" 2>/dev/null || true
    wait "$reader_pid" 2>/dev/null || true
    exit "$1"
}
# Defer a signal until both child PIDs are assigned.
trap 'stop_status=130' INT
trap 'stop_status=143' TERM
awk -v threshold="$threshold" '
{
    text=$0
    sub(/, client:.*/, "", text)
    severity="ERROR"; level=40
    if (text ~ /\[debug\]/) {severity="DEBUG"; level=10}
    else if (text ~ /\[(info|notice)\]/) {severity="INFO"; level=20}
    else if (text ~ /\[warn\]/) {severity="WARNING"; level=30}
    if (level < threshold) next
    reason="server_diagnostic"
    if (text ~ /connect\(\) failed/) reason="upstream_connect_failed"
    else if (text ~ /upstream timed out/) reason="upstream_timeout"
    else if (text ~ /prematurely closed/) reason="upstream_closed"
    else if (text ~ /No such file/) reason="file_not_found"
    else if (text ~ /Permission denied/) reason="permission_denied"
    else if (text ~ /exited on signal/) reason="worker_crashed"
    else if (text ~ /\[emerg\]|configuration.*failed/) reason="configuration_failed"
    else if (text ~ /bind\(\) failed/) reason="listener_failed"
    command="date -u +%Y-%m-%dT%H:%M:%SZ"
    command | getline timestamp
    close(command)
    printf "{\"logged_at\":\"%s\",\"logger\":\"nginx.error\",\"log_level\":\"%s\",\"message\":\"Nginx diagnostic\",\"event\":\"server_diagnostic\",\"reason\":\"%s\"}\n", timestamp,severity,reason
    fflush()
}' < "$log_pipe_dir/error" >&2 &
reader_pid=$!
nginx -g 'daemon off;' 2> "$log_pipe_dir/error" &
nginx_pid=$!
trap 'stop 130' INT
trap 'stop 143' TERM
[ "$stop_status" -eq 0 ] || stop "$stop_status"
status=0
wait "$nginx_pid" || status=$?
wait "$reader_pid" || status=$?
exit "$status"
