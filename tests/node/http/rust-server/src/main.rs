// rust-server [threads] [port]: the routes of server.js with axum on tokio,
// for run.py (variant `rust`). `threads` tokio workers; the catalog is one
// Arc, shared by every task. Handlers run on the workers, as the handlers of
// rhttp run on its threads. Prints `ready <ms>` once it listens.
use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;

struct Row {
    id: u32,
    name: String,
    price: f64,
    stock: u32,
    #[allow(dead_code)]
    tags: Vec<String>,
}

#[derive(Serialize)]
struct Cheap {
    id: u32,
    name: String,
    price: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Answer {
    category: i64,
    in_stock: usize,
    min: f64,
    max: f64,
    mean: f64,
    cheapest: Vec<Cheap>,
}

#[derive(Serialize, Clone)]
struct Scored {
    id: u32,
    score: i32,
}

#[derive(Serialize)]
struct Computed {
    top: Vec<Scored>,
    mean: f64,
}

// build_catalog, query and compute are those of work.js.
fn build_catalog(count: u32) -> Vec<Vec<Row>> {
    let mut by_category: Vec<Vec<Row>> = (0..1000).map(|_| Vec::new()).collect();
    for i in 0..count {
        by_category[(i % 1000) as usize].push(Row {
            id: i,
            name: format!("item {i}"),
            price: ((i as u64 * 7919) % 100000) as f64 / 100.0,
            stock: (i * 31) % 50,
            tags: vec!["a".to_string(), "b".to_string()],
        });
    }
    by_category
}

fn query(catalog: &[Vec<Row>], category: i64) -> Answer {
    let rows = &catalog[category.rem_euclid(1000) as usize];
    let mut in_stock: Vec<&Row> = Vec::with_capacity(rows.len());
    let (mut min, mut max, mut sum) = (f64::INFINITY, f64::NEG_INFINITY, 0.0);
    for row in rows {
        if row.stock == 0 {
            continue;
        }
        in_stock.push(row);
        min = min.min(row.price);
        max = max.max(row.price);
        sum += row.price;
    }
    in_stock.sort_by(|a, b| a.price.partial_cmp(&b.price).unwrap());
    let cheapest = in_stock
        .iter()
        .take(5)
        .map(|r| Cheap { id: r.id, name: r.name.clone(), price: r.price })
        .collect();
    Answer { category, in_stock: in_stock.len(), min, max, mean: sum / in_stock.len() as f64, cheapest }
}

fn compute(seed: i64) -> Computed {
    let mut x = seed as i32;
    if x == 0 {
        x = 1;
    }
    let mut items = Vec::with_capacity(4000);
    for i in 0..4000 {
        x = x.wrapping_mul(1103515245).wrapping_add(12345) & 0x7fffffff;
        items.push(Box::new(Scored { id: i, score: x % 100000 }));
    }
    items.sort_by(|a, b| b.score.cmp(&a.score));
    let sum: i64 = items.iter().map(|i| i.score as i64).sum();
    Computed { top: items[..10].iter().map(|i| (**i).clone()).collect(), mean: sum as f64 / items.len() as f64 }
}

#[derive(Deserialize)]
struct SeedQuery {
    seed: Option<i64>,
}

#[derive(Deserialize)]
struct CategoryQuery {
    c: Option<i64>,
}

fn main() {
    let start = Instant::now();
    let args: Vec<String> = std::env::args().collect();
    let threads: usize = args.get(1).map_or(8, |s| s.parse().unwrap());
    let port: u16 = args.get(2).map_or(3000, |s| s.parse().unwrap());
    let rows: u32 = std::env::var("CATALOG_ROWS").map_or(1_000_000, |s| s.parse().unwrap());
    let catalog = Arc::new(build_catalog(rows));
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(threads)
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async move {
        let app = Router::new()
            .route("/hello", get(|| async { Json(serde_json::json!({ "hello": "world" })) }))
            .route("/compute", get(|Query(q): Query<SeedQuery>| async move { Json(compute(q.seed.unwrap_or(0))) }))
            .route(
                "/catalog",
                get(|State(catalog): State<Arc<Vec<Vec<Row>>>>, Query(q): Query<CategoryQuery>| async move {
                    Json(query(&catalog, q.c.unwrap_or(0)))
                }),
            )
            .with_state(catalog);
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        println!("ready {}", start.elapsed().as_millis());
        axum::serve(listener, app).await.unwrap();
    });
}
