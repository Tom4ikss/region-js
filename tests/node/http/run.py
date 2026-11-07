#!/usr/bin/env python3
# run.py [variant...]: runs server.js variants under wrk, one route after
# another, and prints requests per second, latency, the CPU the server used,
# and its memory. Linux only: it reads /proc. Needs wrk, and Fastify and
# piscina from `npm install` in this directory.
#
#   NODE=.../out/Release/node python3 run.py
#   THREADS=16 DURATION=30s python3 run.py rhttp fastify-cluster
#   WRK2=.../wrk2/wrk python3 run.py
#
# wrk keeps every connection busy, so it measures the most a server can do;
# its latency under such load is mostly the queue in front of the server.
# With WRK2 (github.com/giltene/wrk2) each route is then run again at a fixed
# rate (RATES, the same for every variant), and the latency is measured from
# when each request should have been sent, which is what a user would see.
#
# The server runs on SERVER_CPUS and wrk on LOAD_CPUS, so they do not compete
# for cores. Memory is PSS (proportional set size) summed over the server's
# processes: the pages that the processes of fastify-cluster share, such as
# the node binary, are counted once, not in every process. A variant name with
# a +regions suffix (fastify+regions) runs with --harmony-regions, which the
# spawn() variants always need.
#
# The variants `go` and `rust` run the same routes in go-server (net/http) and
# rust-server (axum on tokio), built beforehand with `go build` and `cargo
# build --release` in their directories.
import json
import os
import re
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
NODE = os.environ.get('NODE', 'node')
SERVER_CPUS = os.environ.get('SERVER_CPUS', '0-15')
LOAD_CPUS = os.environ.get('LOAD_CPUS', '16-31')
THREADS = os.environ.get('THREADS', '8')
DURATION = os.environ.get('DURATION', '15s')
WARMUP = os.environ.get('WARMUP', '5s')
CONNECTIONS = os.environ.get('CONNECTIONS', '256')
WRK_THREADS = os.environ.get('WRK_THREADS', '8')
PORT = os.environ.get('PORT', '3000')
ROUTES = os.environ.get('ROUTES', 'hello,compute,catalog').split(',')
WRK2 = os.environ.get('WRK2')
RATES = dict(item.split('=') for item in os.environ.get(
    'RATES', 'hello=40000,compute=4000,catalog=12000').split(','))
RATE_DURATION = os.environ.get('RATE_DURATION', '30s')
VARIANTS = ['fastify', 'fastify-cluster', 'fastify-piscina', 'fastify-spawn', 'rhttp']
NEED_REGIONS = {'fastify-spawn', 'rhttp'}
NATIVE = {
    'go': os.path.join(HERE, 'go-server', 'go-server'),
    'rust': os.path.join(HERE, 'rust-server', 'target', 'release', 'rust-server'),
}
TICKS = os.sysconf('SC_CLK_TCK')


def tree(pid):
    """The pid and all its descendants."""
    children = {}
    for entry in os.listdir('/proc'):
        if not entry.isdigit():
            continue
        try:
            with open(f'/proc/{entry}/stat') as f:
                ppid = int(f.read().rsplit(')', 1)[1].split()[1])
        except OSError:
            continue
        children.setdefault(ppid, []).append(int(entry))
    out, todo = [], [pid]
    while todo:
        p = todo.pop()
        out.append(p)
        todo.extend(children.get(p, []))
    return out


def cpu_seconds(pid):
    total = 0
    for p in tree(pid):
        try:
            with open(f'/proc/{p}/stat') as f:
                fields = f.read().rsplit(')', 1)[1].split()
            total += int(fields[11]) + int(fields[12])
        except OSError:
            pass
    return total / TICKS


def pss_mb(pid):
    total = 0
    for p in tree(pid):
        try:
            with open(f'/proc/{p}/smaps_rollup') as f:
                total += int(re.search(r'^Pss:\s+(\d+)', f.read(), re.M).group(1))
        except (OSError, AttributeError):
            pass
    return total / 1024


def ms(text):
    value, unit = re.fullmatch(r'([\d.]+)(us|ms|s)', text).groups()
    return float(value) * {'us': 0.001, 'ms': 1, 's': 1000}[unit]


def wrk(route, duration):
    env = dict(os.environ, ROUTE=route)
    out = subprocess.run(
        ['taskset', '-c', LOAD_CPUS, 'wrk', '-t', WRK_THREADS, '-c', CONNECTIONS,
         '-d', duration, '--latency', '-s', os.path.join(HERE, 'wrk.lua'),
         f'http://127.0.0.1:{PORT}'],
        env=env, capture_output=True, text=True, check=True).stdout
    result = {
        'rps': float(re.search(r'Requests/sec:\s+([\d.]+)', out).group(1)),
        'p50': ms(re.search(r'^\s+50%\s+(\S+)', out, re.M).group(1)),
        'p99': ms(re.search(r'^\s+99%\s+(\S+)', out, re.M).group(1)),
    }
    bad = re.search(r'Non-2xx or 3xx responses:\s+(\d+)', out)
    errors = re.search(r'Socket errors: (.*)', out)
    result['errors'] = (bad.group(0) if bad else '') + (errors.group(1) if errors else '')
    return result


def wrk2(route):
    env = dict(os.environ, ROUTE=route)
    out = subprocess.run(
        ['taskset', '-c', LOAD_CPUS, WRK2, '-t', WRK_THREADS, '-c', CONNECTIONS,
         '-d', RATE_DURATION, '-R', RATES[route], '--latency',
         '-s', os.path.join(HERE, 'wrk.lua'), f'http://127.0.0.1:{PORT}'],
        env=env, capture_output=True, text=True, check=True).stdout
    result = {'rate': int(RATES[route]),
              'rate_rps': float(re.search(r'Requests/sec:\s+([\d.]+)', out).group(1))}
    for name, pct in (('rate_p50', '50.000'), ('rate_p99', '99.000'), ('rate_p999', '99.900')):
        result[name] = ms(re.search(r'^\s+' + re.escape(pct) + r'%\s+(\S+)', out, re.M).group(1))
    return result


def run(variant):
    name, _, suffix = variant.partition('+')
    flags = ['--harmony-regions'] if name in NEED_REGIONS or suffix == 'regions' else []
    if name in NATIVE:
        command = [NATIVE[name], THREADS, PORT]
    else:
        command = [NODE, *flags, os.path.join(HERE, 'server.js'), name, THREADS, PORT]
    server = subprocess.Popen(
        ['taskset', '-c', SERVER_CPUS, *command],
        stdout=subprocess.PIPE, text=True, start_new_session=True)
    rows = []
    try:
        line = server.stdout.readline()
        if not line.startswith('ready'):
            raise RuntimeError(f'{variant} did not start: {line!r}')
        startup = int(line.split()[1])
        time.sleep(1)
        idle = pss_mb(server.pid)
        for route in ROUTES:
            wrk(route, WARMUP)
            before, start = cpu_seconds(server.pid), time.monotonic()
            result = wrk(route, DURATION)
            cores = (cpu_seconds(server.pid) - before) / (time.monotonic() - start)
            result.update(variant=variant, route=route, cores=cores,
                          pss=pss_mb(server.pid), idle=idle, startup=startup)
            rows.append(result)
            print('%-18s %-8s %9.0f rps  p50 %7.2f ms  p99 %7.2f ms  %5.1f cores'
                  '  %7.0f rps/core  %6.0f MB (idle %4.0f, start %5d ms) %s' % (
                      variant, route, result['rps'], result['p50'], result['p99'],
                      cores, result['rps'] / cores, result['pss'], idle, startup,
                      result['errors']), flush=True)
        for route in ROUTES if WRK2 else []:
            result = wrk2(route)
            next(r for r in rows if r['route'] == route).update(result)
            print('%-18s %-8s at %6d rps: got %9.0f  p50 %7.2f ms  p99 %8.2f ms'
                  '  p99.9 %8.2f ms' % (variant, route, result['rate'], result['rate_rps'],
                                        result['rate_p50'], result['rate_p99'],
                                        result['rate_p999']), flush=True)
    finally:
        os.killpg(server.pid, signal.SIGTERM)
        try:
            server.wait(10)
        except subprocess.TimeoutExpired:
            os.killpg(server.pid, signal.SIGKILL)
            server.wait()
    return rows


def main():
    print('node %s, threads %s, server cpus %s, wrk cpus %s, %s connections, %s per route' % (
        NODE, THREADS, SERVER_CPUS, LOAD_CPUS, CONNECTIONS, DURATION), flush=True)
    rows = []
    for variant in sys.argv[1:] or VARIANTS:
        rows += run(variant)
    with open(os.environ.get('OUT', 'results.json'), 'w') as f:
        json.dump(rows, f, indent=1)


main()
