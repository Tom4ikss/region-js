// The workloads of tests/bench-real.js: orders built, processed and read on
// four tokio worker threads, driven from block_on like the main thread of d8.
use std::future::Future;
use std::sync::Arc;
use std::time::Instant;

const ORDERS: u32 = 200_000;
const BATCHES: u32 = 200;
const PRODUCTS: u32 = 100_000;
const LOOKUPS: u64 = 1_000_000;

struct Customer {
    #[allow(dead_code)]
    name: String,
    // Constant strings in JS are shared too.
    #[allow(dead_code)]
    city: &'static str,
}

struct Item {
    #[allow(dead_code)]
    sku: String,
    qty: u32,
    price: f64,
}

struct Order {
    #[allow(dead_code)]
    id: u32,
    #[allow(dead_code)]
    customer: Customer,
    items: Vec<Item>,
    total: f64,
}

#[derive(Clone)]
struct Product {
    #[allow(dead_code)]
    sku: String,
    price: f64,
    #[allow(dead_code)]
    stock: u32,
}

fn make_order(i: u32) -> Order {
    Order {
        id: i,
        customer: Customer {
            name: format!("customer {}", i % 1000),
            city: if i % 2 == 1 { "Moscow" } else { "Kazan" },
        },
        items: vec![
            Item { sku: format!("sku {}", i % 500), qty: 1 + i % 3, price: (10 + i % 7) as f64 },
            Item { sku: format!("sku {}", (i + 1) % 500), qty: 2, price: 20.5 },
            Item { sku: format!("sku {}", (i + 2) % 500), qty: 1, price: (5 + i % 11) as f64 },
        ],
        total: 0.0,
    }
}

fn build(from: u32, to: u32) -> Vec<Order> {
    (from..to).map(make_order).collect()
}

fn sum_qty(orders: &[Order]) -> u64 {
    orders.iter().flat_map(|o| o.items.iter()).map(|i| i.qty as u64).sum()
}

async fn time<F, Fut>(name: &str, mut f: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = String>,
{
    let mut runs = vec![];
    let mut check = String::new();
    for _ in 0..5 {
        let start = Instant::now();
        check = f().await;
        runs.push(start.elapsed().as_secs_f64() * 1e3);
    }
    runs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("{name}: {:.1} ms best, {:.1} ms median ({check})", runs[0], runs[2]);
}

pub fn run(threads: usize) {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(threads)
        .build()
        .unwrap();
    runtime.block_on(async {
        let t = threads as u32;
        time("build: tokio", || async {
            let parts: Vec<_> = (0..t)
                .map(|k| tokio::spawn(async move { build(k * ORDERS / t, (k + 1) * ORDERS / t) }))
                .collect();
            let mut qty = 0;
            for part in parts {
                qty += sum_qty(&part.await.unwrap());
            }
            qty.to_string()
        })
        .await;

        // The batches come back after every run, as the regions do in d8.
        let batches: Arc<std::sync::Mutex<Vec<Vec<Order>>>> = Arc::new(std::sync::Mutex::new(
            (0..BATCHES).map(|b| build(b * 1000, (b + 1) * 1000)).collect(),
        ));
        time("batches: tokio", || {
            let batches = batches.clone();
            async move {
                let taken = std::mem::take(&mut *batches.lock().unwrap());
                let tasks: Vec<_> = taken
                    .into_iter()
                    .map(|mut batch| {
                        tokio::spawn(async move {
                            for order in batch.iter_mut() {
                                let total: f64 =
                                    order.items.iter().map(|i| i.qty as f64 * i.price).sum();
                                order.total = total * 0.9;
                            }
                            batch
                        })
                    })
                    .collect();
                let mut sum = 0.0;
                let mut back = Vec::with_capacity(tasks.len());
                for task in tasks {
                    let batch = task.await.unwrap();
                    sum += batch.iter().map(|o| o.total).sum::<f64>();
                    back.push(batch);
                }
                *batches.lock().unwrap() = back;
                format!("{}", sum.round())
            }
        })
        .await;

        let catalog: Vec<Product> = (0..PRODUCTS)
            .map(|i| Product { sku: format!("sku {i}"), price: (1 + i % 100) as f64, stock: i % 50 })
            .collect();
        // Sharing copies nothing in Rust: the copies for the five runs are
        // made before timing.
        let mut copies: Vec<Vec<Product>> = (0..5).map(|_| catalog.clone()).collect();
        time("catalog: tokio + Arc", || {
            let copy = copies.pop().unwrap();
            async move {
                let shared = Arc::new(copy);
                let tasks: Vec<_> = (0..threads as u64)
                    .map(|seed| {
                        let catalog = shared.clone();
                        tokio::spawn(async move {
                            let mut sum = 0.0;
                            for i in 0..LOOKUPS {
                                sum += catalog[((i * 7919 + seed) % catalog.len() as u64) as usize].price;
                            }
                            sum
                        })
                    })
                    .collect();
                let mut sum = 0.0;
                for task in tasks {
                    sum += task.await.unwrap();
                }
                format!("{sum}")
            }
        })
        .await;
    });
}
