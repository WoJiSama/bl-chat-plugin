#!/usr/bin/env bash
set -euo pipefail

service_name="${1:-trss-yunzai.service}"
wait_seconds="${IMAGE_TASK_DRAIN_SECONDS:-300}"
deadline=$((SECONDS + wait_seconds))

count_image_jobs() {
  redis-cli --raw --scan --pattern 'ytbot:image_*_job:*' 2>/dev/null | awk 'NF{count++} END{print count+0}'
}

while true; do
  active_jobs=$(count_image_jobs)
  if [[ "$active_jobs" -eq 0 ]]; then
    break
  fi
  if (( SECONDS >= deadline )); then
    echo "等待图片任务完成超时，保留 Redis 任务记录并重启，启动后将自动恢复。"
    break
  fi
  echo "仍有 ${active_jobs} 个图片任务，等待完成后再重启..."
  sleep 5
done

systemctl restart "$service_name"
sleep 5
systemctl is-active "$service_name"
