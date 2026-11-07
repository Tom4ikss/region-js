#!/usr/bin/env python3
# run.py [variant...]: the real-world benchmark. Starts each server variant,
# runs wrk on every route one after another, and prints requests per second,
# latency, the CPU the server used and its memory (PSS summed over its
# processes). Linux only: it reads /proc. See README.md for the setup.
#
#   python3 run.py                         # every variant, every route
#   ROUTES=json,db python3 run.py bun go
#   MIX=search=20000,report=600 python3 run.py   # fixed-rate mixed load
#
# With MIX the routes are not run one by one. Instead every route in MIX gets
# its own wrk2 at the given rate at the same time, and each one reports its
# own latency: the latency of light requests while heavy ones run next to
# them. Needs WRK2 (github.com/giltene/wrk2).
#
# The server runs on SERVER_CPUS, wrk on LOAD_CPUS; pin Postgres to other
# cores beforehand (README.md). A variant with the suffix @rjs runs a Node
# variant on the Node built from this fork (FORK_NODE) instead of NODE.
import json
import os
import re
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
NODE = os.environ.get('NODE', 'node')
FORK_NODE = os.environ.get('FORK_NODE', 'node')
BUN = os.environ.get('BUN', 'bun')
UWS = os.environ.get('UWS', '')
SERVER_CPUS = os.environ.get('SERVER_CPUS', '0-7')
LOAD_CPUS = os.environ.get('LOAD_CPUS', '16-31')
THREADS = os.environ.get('THREADS', '8')
DURATION = os.environ.get('DURATION', '15s')
WARMUP = os.environ.get('WARMUP', '5s')
CONNECTIONS = os.environ.get('CONNECTIONS', '256')
WRK_THREADS = os.environ.get('WRK_THREADS', '8')
PORT = os.environ.get('PORT', '3000')
ROUTES = os.environ.get(
    'ROUTES', 'plaintext,json,db,queries,fortunes,updates,search,report').split(',')
WRK2 = os.environ.get('WRK2', 'wrk2')
MIX = dict(item.split('=') for item in os.environ['MIX'].split(',')) if os.environ.get('MIX') else None
MIX_DURATION = os.environ.get('MIX_DURATION', '30s')
TICKS = os.sysconf('SC_CLK_TCK')

VARIANTS = ['express', 'fastify', 'http', 'uws', 'bun', 'go', 'rust', 'regions-http', 'regions-uws']


def command(variant):
    name, _, on = variant.partition('@')
    node = FORK_NODE if on == 'rjs' else NODE
    if name in ('express', 'fastify', 'http'):
        return [node, os.path.join(HERE, 'node.js'), name, THREADS, PORT]
    if name == 'uws':
        # The uWebSockets.js addon here is built for the Node of the fork.
        return [FORK_NODE, os.path.join(HERE, 'node.js'), 'uws', THREADS, PORT]
    if name == 'bun':
        return [BUN, os.path.join(HERE, 'bun.js'), THREADS, PORT]
    if name == 'go':
        return [os.path.join(HERE, 'go', 'go-server'), PORT]
    if name == 'rust':
        return [os.path.join(HERE, 'rust', 'target', 'release', 'rust-server'), THREADS, PORT]
    if name in ('regions-http', 'regions-uws'):
        return [FORK_NODE, '--harmony-regions', os.path.join(HERE, 'regions.js'),
                name.split('-')[1], THREADS, PORT]
    raise SystemExit(f'unknown variant {variant}')


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
    value, unit = re.fullmatch(r'([\d.]+)(us|ms|s|m)', text).groups()
    return float(value) * {'us': 0.001, 'ms': 1, 's': 1000, 'm': 60000}[unit]


def errors(out):
    bad = re.search(r'Non-2xx or 3xx responses:\s+(\d+)', out)
    sock = re.search(r'Socket errors: (.*)', out)
    return (bad.group(0) if bad else '') + (sock.group(1) if sock else '')


def wrk(route, duration):
    out = subprocess.run(
        ['taskset', '-c', LOAD_CPUS, 'wrk', '-t', WRK_THREADS, '-c', CONNECTIONS,
         '-d', duration, '--latency', '-s', os.path.join(HERE, 'wrk.lua'),
         f'http://127.0.0.1:{PORT}'],
        env=dict(os.environ, ROUTE=route), capture_output=True, text=True, check=True).stdout
    return {
        'rps': float(re.search(r'Requests/sec:\s+([\d.]+)', out).group(1)),
        'p50': ms(re.search(r'^\s+50%\s+(\S+)', out, re.M).group(1)),
        'p99': ms(re.search(r'^\s+99%\s+(\S+)', out, re.M).group(1)),
        'errors': errors(out),
    }


def wrk2_start(route, rate, connections, threads):
    return subprocess.Popen(
        ['taskset', '-c', LOAD_CPUS, WRK2, '-t', str(threads), '-c', str(connections),
         '-d', MIX_DURATION, '-R', rate, '--latency', '-s', os.path.join(HERE, 'wrk.lua'),
         f'http://127.0.0.1:{PORT}'],
        env=dict(os.environ, ROUTE=route), stdout=subprocess.PIPE, text=True)


def wrk2_result(out):
    result = {'rps': float(re.search(r'Requests/sec:\s+([\d.]+)', out).group(1)),
              'errors': errors(out)}
    for name, pct in (('p50', '50.000'), ('p99', '99.000'), ('p999', '99.900')):
        result[name] = ms(re.search(r'^\s+' + re.escape(pct) + r'%\s+(\S+)', out, re.M).group(1))
    return result


def start(variant):
    env = dict(os.environ, UWS=UWS, GOMAXPROCS=THREADS)
    server = subprocess.Popen(
        ['taskset', '-c', SERVER_CPUS, *command(variant)],
        stdout=subprocess.PIPE, env=env, text=True, start_new_session=True)
    began = time.monotonic()
    line = server.stdout.readline()
    if not line.startswith('ready'):
        stop(server)
        raise RuntimeError(f'{variant} did not start: {line!r}')
    return server, time.monotonic() - began


def stop(server):
    try:
        os.killpg(server.pid, signal.SIGTERM)
        server.wait(10)
    except subprocess.TimeoutExpired:
        os.killpg(server.pid, signal.SIGKILL)
        server.wait()
    except ProcessLookupError:
        pass


def run(variant):
    server, startup = start(variant)
    rows = []
    try:
        time.sleep(1)
        idle = pss_mb(server.pid)
        if MIX:
            # A short warm-up of every route, then all of them at once.
            for route in MIX:
                wrk(route, WARMUP)
            before, began = cpu_seconds(server.pid), time.monotonic()
            share = int(CONNECTIONS) // len(MIX)
            runs = {route: wrk2_start(route, rate, share, max(1, int(WRK_THREADS) // len(MIX)))
                    for route, rate in MIX.items()}
            outs = {route: p.communicate()[0] for route, p in runs.items()}
            cores = (cpu_seconds(server.pid) - before) / (time.monotonic() - began)
            pss = pss_mb(server.pid)
            for route, out in outs.items():
                result = wrk2_result(out)
                result.update(variant=variant, route=route, rate=int(MIX[route]), cores=cores,
                              pss=pss, idle=idle, startup=startup)
                rows.append(result)
                print('%-16s %-9s at %6s rps: got %8.0f  p50 %7.2f ms  p99 %8.2f ms'
                      '  p99.9 %8.2f ms  %4.1f cores  %5.0f MB %s' % (
                          variant, route, MIX[route], result['rps'], result['p50'],
                          result['p99'], result['p999'], cores, pss, result['errors']),
                      flush=True)
            return rows
        for route in ROUTES:
            wrk(route, WARMUP)
            before, began = cpu_seconds(server.pid), time.monotonic()
            result = wrk(route, DURATION)
            cores = (cpu_seconds(server.pid) - before) / (time.monotonic() - began)
            result.update(variant=variant, route=route, cores=cores,
                          pss=pss_mb(server.pid), idle=idle, startup=startup)
            rows.append(result)
            print('%-16s %-9s %9.0f rps  p50 %7.2f ms  p99 %7.2f ms  %4.1f cores'
                  '  %6.0f MB (idle %5.0f, start %4.1f s) %s' % (
                      variant, route, result['rps'], result['p50'], result['p99'], cores,
                      result['pss'], idle, startup, result['errors']), flush=True)
    finally:
        stop(server)
    return rows


def main():
    print('threads %s, server cpus %s, wrk cpus %s, %s connections, %s per route' % (
        THREADS, SERVER_CPUS, LOAD_CPUS, CONNECTIONS, MIX_DURATION if MIX else DURATION),
        flush=True)
    rows = []
    for variant in sys.argv[1:] or VARIANTS:
        try:
            rows += run(variant)
        except Exception as e:  # keep going with the other variants
            print(f'{variant}: {e}', flush=True)
        time.sleep(2)
    with open(os.environ.get('OUT', 'results.json'), 'w') as f:
        json.dump(rows, f, indent=1)


main()
