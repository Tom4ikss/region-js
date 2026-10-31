// cargo run --release -- [workers]
// cargo run --release -- real [workers]: the workloads of tests/bench-real.js.
// The scenarios of tests/bench-tasks.js with tokio. The driving code runs in
// block_on, outside the worker threads, like the main thread of d8 outside
// the spawn() pool; the last line also measures ping-pong between two tasks.
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex, RwLock};

mod real;

const N: usize = 1000;

fn busy(us: u64) -> u64 {
    let end = Instant::now() + Duration::from_micros(us);
    let mut x = 0u64;
    while Instant::now() < end {
        x += 1;
    }
    x
}

async fn time<F, Fut>(name: &str, mut f: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = ()>,
{
    let mut runs = vec![];
    for _ in 0..5 {
        let start = Instant::now();
        f().await;
        runs.push(start.elapsed().as_secs_f64() * 1e3);
    }
    runs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("{name}: {:.2} ms best, {:.2} ms median", runs[0], runs[2]);
}

async fn ping_pong() {
    let (ping_tx, mut ping_rx) = mpsc::channel::<usize>(1);
    let (pong_tx, mut pong_rx) = mpsc::channel::<usize>(1);
    let echo = tokio::spawn(async move {
        while let Some(v) = ping_rx.recv().await {
            pong_tx.send(v).await.unwrap();
        }
    });
    for i in 0..N {
        ping_tx.send(i).await.unwrap();
        pong_rx.recv().await.unwrap();
    }
    drop(ping_tx);
    echo.await.unwrap();
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "real") {
        args.remove(0);
        real::run(args.first().map_or(4, |s| s.parse().unwrap()));
        return;
    }
    let workers: usize = args.first().map_or(4, |s| s.parse().unwrap());
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .build()
        .unwrap();
    runtime.block_on(async {
        time("spawn+await 1000 trivial", || async {
            let tasks: Vec<_> = (0..N).map(|i| tokio::spawn(async move { i + 1 })).collect();
            for task in tasks {
                task.await.unwrap();
            }
        })
        .await;
        time("1000 x 50us cpu", || async {
            let tasks: Vec<_> = (0..N).map(|_| tokio::spawn(async { busy(50) })).collect();
            for task in tasks {
                task.await.unwrap();
            }
        })
        .await;
        time("fan-in: 1000 tasks send, main recv", || async {
            let (tx, mut rx) = mpsc::channel::<usize>(N);
            let tasks: Vec<_> = (0..N)
                .map(|i| {
                    let tx = tx.clone();
                    tokio::spawn(async move { tx.send(i).await.unwrap() })
                })
                .collect();
            for _ in 0..N {
                rx.recv().await.unwrap();
            }
            for task in tasks {
                task.await.unwrap();
            }
        })
        .await;
        time("1000 parked on recv, then woken", || async {
            // tokio has no multi-consumer channel; a mutex around the
            // receiver is the usual stand-in.
            let (in_tx, in_rx) = mpsc::channel::<usize>(N);
            let in_rx = Arc::new(Mutex::new(in_rx));
            let (out_tx, mut out_rx) = mpsc::channel::<usize>(N);
            let tasks: Vec<_> = (0..N)
                .map(|_| {
                    let in_rx = in_rx.clone();
                    let out_tx = out_tx.clone();
                    tokio::spawn(async move {
                        let v = in_rx.lock().await.recv().await.unwrap();
                        out_tx.send(v * 2).await.unwrap();
                    })
                })
                .collect();
            for i in 0..N {
                in_tx.send(i).await.unwrap();
            }
            for _ in 0..N {
                out_rx.recv().await.unwrap();
            }
            for task in tasks {
                task.await.unwrap();
            }
        })
        .await;
        time("ping-pong 1000 round trips", ping_pong).await;
        time("rwlock: 1000 uncontended write+release", || async {
            let lock = RwLock::new(0u64);
            for _ in 0..N {
                *lock.write().await += 1;
            }
        })
        .await;
        time("rwlock: 4 tasks x 250 write increments", || async {
            let lock = Arc::new(RwLock::new(0u64));
            let tasks: Vec<_> = (0..4)
                .map(|_| {
                    let lock = lock.clone();
                    tokio::spawn(async move {
                        for _ in 0..250 {
                            *lock.write().await += 1;
                        }
                    })
                })
                .collect();
            for task in tasks {
                task.await.unwrap();
            }
        })
        .await;
        let inside = tokio::spawn(async {
            let start = Instant::now();
            ping_pong().await;
            start.elapsed().as_secs_f64() * 1e3
        })
        .await
        .unwrap();
        println!("ping-pong between two tasks: {inside:.2} ms");
    });
}
