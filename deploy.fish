#!/usr/bin/env fish

# This will only work on replicat's machine unless you copy my ssh config
# Just use git anyways
# git@github.com:Magpie-Pedals/smal.git

rsync -av --exclude node_modules . magpie_vps2:~/Lab/smal
# running sudo on a remote is fine right?
ssh magpie_vps2 "sudo ./Lab/smal/container/run.sh"

# and this should work from anyone's machine:

# rsync -av --exclude node_modules . ecuser@213.171.182.171:~/Lab/smal
# ssh ecuser@213.171.182.171 "sudo ./Lab/smal/container/run.sh"