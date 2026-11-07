// rust-server [threads] [port]: the routes of the real-world benchmark (see
// ../common.js) with axum on tokio and tokio-postgres. `threads` tokio
// workers; DB_POOL sets the size of the database pool (64 by default, as 8
// processes of 8 elsewhere). The catalog is one Arc shared by every task.
use axum::extract::{Query, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::fmt::Write;
use std::sync::Arc;

const CATEGORIES: usize = 1000;
const PAGE: usize = 20;
const REPORT_CATEGORIES: usize = 5;

struct Product {
    id: i32,
    name: String,
    price: f64,
    stock: i32,
    rating: f64,
    brand: String,
}

struct App {
    pool: Pool,
    catalog: Vec<Vec<Product>>,
}

type Shared = State<Arc<App>>;
type Params = Query<HashMap<String, String>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct World {
    id: i32,
    random_number: i32,
}

fn random_id() -> i32 {
    fastrand::i32(1..=10000)
}

fn count(q: &HashMap<String, String>) -> usize {
    match q.get("n").and_then(|s| s.parse::<i64>().ok()) {
        Some(n) if n >= 1 => n.min(500) as usize,
        _ => 1,
    }
}

fn int(q: &HashMap<String, String>, name: &str) -> usize {
    q.get(name).and_then(|s| s.parse::<i64>().ok()).unwrap_or(0).max(0) as usize
}

fn fail(e: impl std::fmt::Display) -> Response {
    (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
}

async fn one(app: &App) -> Result<World, Response> {
    let client = app.pool.get().await.map_err(fail)?;
    let stmt = client
        .prepare_cached("SELECT id, randomnumber FROM world WHERE id = $1")
        .await
        .map_err(fail)?;
    let row = client.query_one(&stmt, &[&random_id()]).await.map_err(fail)?;
    Ok(World { id: row.get(0), random_number: row.get(1) })
}

// n single-row queries at once, as the JavaScript servers do with Promise.all.
async fn many(app: &App, n: usize) -> Result<Vec<World>, Response> {
    futures::future::try_join_all((0..n).map(|_| one(app))).await
}

async fn db(State(app): Shared) -> Response {
    match one(&app).await {
        Ok(row) => Json(row).into_response(),
        Err(e) => e,
    }
}

async fn queries(State(app): Shared, Query(q): Params) -> Response {
    match many(&app, count(&q)).await {
        Ok(rows) => Json(rows).into_response(),
        Err(e) => e,
    }
}

fn escape(out: &mut String, text: &str) {
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
}

async fn fortunes(State(app): Shared) -> Response {
    let client = match app.pool.get().await {
        Ok(c) => c,
        Err(e) => return fail(e),
    };
    let stmt = match client.prepare_cached("SELECT id, message FROM fortune").await {
        Ok(s) => s,
        Err(e) => return fail(e),
    };
    let rows = match client.query(&stmt, &[]).await {
        Ok(r) => r,
        Err(e) => return fail(e),
    };
    let mut list: Vec<(i32, String)> = rows.iter().map(|r| (r.get(0), r.get(1))).collect();
    list.push((0, "Additional fortune added at request time.".to_string()));
    list.sort_by(|a, b| a.1.cmp(&b.1));
    let mut html = String::from("<!DOCTYPE html><html><head><title>Fortunes</title></head><body><table><tr><th>id</th><th>message</th></tr>");
    for (id, message) in &list {
        write!(html, "<tr><td>{}</td><td>", id).unwrap();
        escape(&mut html, message);
        html.push_str("</td></tr>");
    }
    html.push_str("</table></body></html>");
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
}

async fn updates(State(app): Shared, Query(q): Params) -> Response {
    let mut rows = match many(&app, count(&q)).await {
        Ok(r) => r,
        Err(e) => return e,
    };
    let mut by_id: HashMap<i32, i32> = HashMap::new();
    for row in rows.iter_mut() {
        row.random_number = random_id();
        by_id.insert(row.id, row.random_number);
    }
    let mut ids: Vec<i32> = by_id.keys().copied().collect();
    ids.sort();
    let mut sql = String::from("UPDATE world SET randomnumber = v.r FROM (VALUES ");
    let mut params: Vec<i32> = Vec::with_capacity(2 * ids.len());
    for (i, id) in ids.iter().enumerate() {
        if i > 0 {
            sql.push_str(", ");
        }
        write!(sql, "(${}::int, ${}::int)", 2 * i + 1, 2 * i + 2).unwrap();
        params.push(*id);
        params.push(by_id[id]);
    }
    sql.push_str(") AS v(id, r) WHERE world.id = v.id");
    let client = match app.pool.get().await {
        Ok(c) => c,
        Err(e) => return fail(e),
    };
    let refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
        params.iter().map(|p| p as &(dyn tokio_postgres::types::ToSql + Sync)).collect();
    if let Err(e) = client.execute(sql.as_str(), &refs).await {
        return fail(e);
    }
    Json(rows).into_response()
}

async fn search(State(app): Shared, Query(q): Params) -> Response {
    let c = int(&q, "c") % CATEGORIES;
    let lo = q.get("min").and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
    let hi = q.get("max").and_then(|s| s.parse::<f64>().ok()).unwrap_or(f64::INFINITY);
    let page = int(&q, "page");
    let mut found: Vec<&Product> = app.catalog[c]
        .iter()
        .filter(|p| p.stock > 0 && p.price >= lo && p.price <= hi)
        .collect();
    found.sort_by(|a, b| a.price.total_cmp(&b.price).then(a.id.cmp(&b.id)));
    let items: Vec<_> = found
        .iter()
        .skip(page * PAGE)
        .take(PAGE)
        .map(|p| json!({"id": p.id, "name": p.name, "price": p.price, "stock": p.stock, "rating": p.rating}))
        .collect();
    Json(json!({"category": c, "total": found.len(), "page": page, "items": items})).into_response()
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

async fn report(State(app): Shared, Query(q): Params) -> Response {
    let first = int(&q, "c") % CATEGORIES;
    let mut buckets = vec![(0usize, 0.0f64, f64::INFINITY, f64::NEG_INFINITY); 100];
    let mut brands: HashMap<&str, f64> = HashMap::new();
    let mut all: Vec<&Product> = Vec::new();
    for k in 0..REPORT_CATEGORIES {
        for p in &app.catalog[(first + k) % CATEGORIES] {
            let b = &mut buckets[((p.price / 10.0).floor() as usize).min(99)];
            b.0 += 1;
            b.1 += p.price;
            b.2 = b.2.min(p.price);
            b.3 = b.3.max(p.price);
            *brands.entry(&p.brand).or_insert(0.0) += p.price * p.stock as f64;
            all.push(p);
        }
    }
    all.sort_by(|a, b| {
        b.rating.total_cmp(&a.rating).then(a.price.total_cmp(&b.price)).then(a.id.cmp(&b.id))
    });
    let best: Vec<_> = all
        .iter()
        .take(100)
        .map(|p| json!({"id": p.id, "name": p.name, "price": p.price, "rating": p.rating}))
        .collect();
    let mut top: Vec<(&str, f64)> = brands.into_iter().collect();
    top.sort_by(|a, b| b.1.total_cmp(&a.1));
    let top: Vec<_> = top
        .iter()
        .take(10)
        .map(|(brand, value)| json!({"brand": brand, "value": round2(*value)}))
        .collect();
    let used: Vec<_> = buckets
        .iter()
        .enumerate()
        .filter(|(_, b)| b.0 > 0)
        .map(|(i, b)| json!({"bucket": i, "count": b.0, "mean": round2(b.1 / b.0 as f64), "min": b.2, "max": b.3}))
        .collect();
    Json(json!({"first": first, "products": all.len(), "buckets": used, "topBrands": top, "best": best}))
        .into_response()
}

async fn load_catalog(pool: &Pool) -> Vec<Vec<Product>> {
    let client = pool.get().await.unwrap();
    let rows = client
        .query("SELECT id, name, category, price::float8, stock, rating, brand FROM product ORDER BY id", &[])
        .await
        .unwrap();
    let mut catalog: Vec<Vec<Product>> = (0..CATEGORIES).map(|_| Vec::new()).collect();
    for r in rows {
        let category: i32 = r.get(2);
        catalog[category as usize].push(Product {
            id: r.get(0),
            name: r.get(1),
            price: r.get(3),
            stock: r.get(4),
            rating: r.get(5),
            brand: r.get(6),
        });
    }
    catalog
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let threads: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(8);
    let port: u16 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(3000);
    let pool_size: usize = std::env::var("DB_POOL").ok().and_then(|s| s.parse().ok()).unwrap_or(64);
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(threads)
        .enable_all()
        .build()
        .unwrap()
        .block_on(async move {
            let mut cfg = tokio_postgres::Config::new();
            cfg.host("127.0.0.1").port(5432).user("bench").password("bench").dbname("bench");
            let manager = Manager::from_config(
                cfg,
                tokio_postgres::NoTls,
                ManagerConfig { recycling_method: RecyclingMethod::Fast },
            );
            let pool = Pool::builder(manager).max_size(pool_size).build().unwrap();
            let catalog = load_catalog(&pool).await;
            let app = Arc::new(App { pool, catalog });
            let router = Router::new()
                .route(
                    "/plaintext",
                    get(|| async { ([(header::CONTENT_TYPE, "text/plain")], "Hello, World!") }),
                )
                .route("/json", get(|| async { Json(json!({"message": "Hello, World!"})) }))
                .route("/db", get(db))
                .route("/queries", get(queries))
                .route("/fortunes", get(fortunes))
                .route("/updates", get(updates))
                .route("/search", get(search))
                .route("/report", get(report))
                .with_state(app);
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.unwrap();
            println!("ready");
            axum::serve(listener, router).await.unwrap();
        });
}
