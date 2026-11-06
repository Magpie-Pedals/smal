#!/usr/bin/bash
rsync -av \
  --exclude .git \
  --exclude node_modules \
  --exclude '/data/auth.json' \
  --exclude '/data/files/' \
  --exclude '/data/tags*' \
  --exclude '/deploy*' \
  . ecuser@213.171.182.171:~/Lab/smal
ssh ecuser@213.171.182.171 "sudo ./Lab/smal/container/run.sh"