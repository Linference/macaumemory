#!/usr/bin/env bash
# 逐個運行即夢圖生視頻節點（Seedance 2.0 Fast VIP 帳號同時只受理一個任務）。
# 用法：bash capture/run-clips-serial.sh <node-id>...   每個節點在使用者已批准的總上限內按 30 積分確認
set -u
cd "$(dirname "$0")/.."
P=$(cat capture/canvas-project.txt)
status() { dreamina-canvas node show --project-id "$P" --node-id "$1" --format json --non-interactive 2>/dev/null | python -I -c "import sys,json;print(json.load(sys.stdin)['data']['nodes'][0]['node']['status'])"; }
busy() { for n in $(cut -d' ' -f1 capture/upload/submits.txt); do [ "$(status "$n")" = running ] && return 0; done; return 1; }
for NODE in "$@"; do
  while busy; do sleep 20; done
  SID=$(python -c 'import uuid;print(uuid.uuid4())')
  echo "$NODE $SID" >> capture/upload/submits-retry.txt
  TOKEN=$(dreamina-canvas node confirm --project-id "$P" --node-id "$NODE" --credit-ceiling 30 --format json --non-interactive 2>/dev/null \
    | python -I -c "import sys,json;print(json.load(sys.stdin).get('data',{}).get('creditConfirmationToken',''))")
  [ -n "$TOKEN" ] || { echo "$NODE confirm failed"; continue; }
  dreamina-canvas node run --project-id "$P" --node-id "$NODE" --submit-id "$SID" --credit-token "$TOKEN" --format json --non-interactive 2>&1 \
    | python -I -c "import sys,json;d=json.load(sys.stdin);print('$NODE', [i.get('state') for i in (d.get('data') or d.get('partialData') or {}).get('items',[])], d.get('error',{}).get('serviceCode',''))"
  sleep 15
done
while busy; do sleep 20; done
for n in $(cut -d' ' -f1 capture/upload/submits.txt); do echo "final $n $(status "$n")"; done
