#!/bin/zsh
# Runs a trap program with a time limit: run.sh file.js [variant] [seconds]
D8=~/Prikoli/v8-src/v8/out/fast/d8
f=$1; v=${2:-first}; t=${3:-20}
perl -e 'alarm shift; exec @ARGV' $t $D8 --harmony-region-literals --module $f -- $v 2>&1 | grep -v 'experimental features'
code=${pipestatus[1]}
[ $code -eq 142 ] && echo "[HANG: killed after ${t}s]"
[ $code -ne 0 ] && [ $code -ne 142 ] && echo "[exit $code]"
true
