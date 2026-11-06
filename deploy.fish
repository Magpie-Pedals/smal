#!/usr/bin/env fish

# This will only work on replicat's machine unless you copy my ssh config
# Just use git anyways
# git@github.com:Magpie-Pedals/smal.git

rsync -av \
  --exclude .git \
  --exclude node_modules \
  --exclude '/data/auth.json' \
  --exclude '/data/files/' \
  --exclude '/data/tags*' \
  --exclude '/deploy*' \
  . magpie_vps2:~/Lab/smal
# running sudo on a remote is fine right?
ssh magpie_vps2 "sudo ./Lab/smal/container/run.sh"