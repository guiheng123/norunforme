#!/system/bin/sh
# 按 track 文件逐点喂给 gps + network 测试 provider（用于让 App 持续收到 Location 回调）
# 用法: sh /data/local/tmp/feed.sh /data/local/tmp/track.txt [interval_sec]
FILE=${1:-/data/local/tmp/track.txt}
IV=${2:-1}
while true; do
  while IFS=, read -r LA LO; do
    [ -z "$LA" ] && continue
    cmd location providers set-test-provider-location gps --location "$LA,$LO" --accuracy 5 >/dev/null 2>&1
    cmd location providers set-test-provider-location network --location "$LA,$LO" --accuracy 8 >/dev/null 2>&1
    sleep $IV
  done < "$FILE"
done
