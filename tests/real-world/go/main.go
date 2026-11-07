// go-server [port]: the routes of the real-world benchmark (see ../common.js)
// on net/http with pgx. One process; GOMAXPROCS sets the threads, DB_POOL the
// size of the database pool (64 by default, as 8 processes of 8 elsewhere).
package main

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"log"
	"math"
	"math/rand/v2"
	"net"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	categories       = 1000
	page             = 20
	reportCategories = 5
)

type World struct {
	ID           int32 `json:"id"`
	RandomNumber int32 `json:"randomNumber"`
}

type Fortune struct {
	ID      int32
	Message string
}

type Product struct {
	ID       int
	Name     string
	Category int
	Price    float64
	Stock    int
	Rating   float64
	Brand    string
}

var (
	db        *pgxpool.Pool
	catalog   [][]*Product
	fortunesT = template.Must(template.New("f").Parse(`<!DOCTYPE html><html><head><title>Fortunes</title></head><body><table><tr><th>id</th><th>message</th></tr>{{range .}}<tr><td>{{.ID}}</td><td>{{.Message}}</td></tr>{{end}}</table></body></html>`))
)

func randomID() int32 { return 1 + rand.Int32N(10000) }

func count(r *http.Request) int {
	n, err := strconv.Atoi(r.URL.Query().Get("n"))
	if err != nil || n < 1 {
		return 1
	}
	return min(n, 500)
}

func writeJSON(w http.ResponseWriter, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

func one(ctx context.Context) (World, error) {
	var row World
	err := db.QueryRow(ctx, "SELECT id, randomnumber FROM world WHERE id = $1", randomID()).Scan(&row.ID, &row.RandomNumber)
	return row, err
}

// many runs n single-row queries at once, as the JavaScript servers do with
// Promise.all.
func many(ctx context.Context, n int) ([]World, error) {
	rows := make([]World, n)
	errs := make(chan error, n)
	for i := range rows {
		go func(i int) {
			var err error
			rows[i], err = one(ctx)
			errs <- err
		}(i)
	}
	var first error
	for range rows {
		if err := <-errs; err != nil && first == nil {
			first = err
		}
	}
	return rows, first
}

func handleDB(w http.ResponseWriter, r *http.Request) {
	row, err := one(r.Context())
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, row)
}

func handleQueries(w http.ResponseWriter, r *http.Request) {
	rows, err := many(r.Context(), count(r))
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, rows)
}

func handleFortunes(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(r.Context(), "SELECT id, message FROM fortune")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Fortune, error) {
		var f Fortune
		err := row.Scan(&f.ID, &f.Message)
		return f, err
	})
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	list = append(list, Fortune{0, "Additional fortune added at request time."})
	slices.SortFunc(list, func(a, b Fortune) int { return strings.Compare(a.Message, b.Message) })
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fortunesT.Execute(w, list)
}

func handleUpdates(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	rows, err := many(ctx, count(r))
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	byID := map[int32]int32{}
	for i := range rows {
		rows[i].RandomNumber = randomID()
		byID[rows[i].ID] = rows[i].RandomNumber
	}
	ids := make([]int32, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	values := make([]string, len(ids))
	params := make([]any, 0, 2*len(ids))
	for i, id := range ids {
		values[i] = fmt.Sprintf("($%d::int, $%d::int)", 2*i+1, 2*i+2)
		params = append(params, id, byID[id])
	}
	_, err = db.Exec(ctx, "UPDATE world SET randomnumber = v.r FROM (VALUES "+strings.Join(values, ", ")+") AS v(id, r) WHERE world.id = v.id", params...)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, rows)
}

func intParam(r *http.Request, name string) int {
	n, _ := strconv.Atoi(r.URL.Query().Get(name))
	return n
}

type SearchItem struct {
	ID     int     `json:"id"`
	Name   string  `json:"name"`
	Price  float64 `json:"price"`
	Stock  int     `json:"stock"`
	Rating float64 `json:"rating"`
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	c := intParam(r, "c") % categories
	lo, _ := strconv.ParseFloat(q.Get("min"), 64)
	hi := math.Inf(1)
	if s := q.Get("max"); s != "" {
		hi, _ = strconv.ParseFloat(s, 64)
	}
	p := max(0, intParam(r, "page"))
	var found []*Product
	for _, x := range catalog[c] {
		if x.Stock > 0 && x.Price >= lo && x.Price <= hi {
			found = append(found, x)
		}
	}
	slices.SortFunc(found, func(a, b *Product) int {
		return cmp.Or(cmp.Compare(a.Price, b.Price), cmp.Compare(a.ID, b.ID))
	})
	items := []SearchItem{}
	for i := p * page; i < len(found) && i < (p+1)*page; i++ {
		x := found[i]
		items = append(items, SearchItem{x.ID, x.Name, x.Price, x.Stock, x.Rating})
	}
	writeJSON(w, map[string]any{"category": c, "total": len(found), "page": p, "items": items})
}

type Bucket struct {
	Bucket int     `json:"bucket"`
	Count  int     `json:"count"`
	Mean   float64 `json:"mean"`
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
	sum    float64
}

type BrandValue struct {
	Brand string  `json:"brand"`
	Value float64 `json:"value"`
}

type Rated struct {
	ID     int     `json:"id"`
	Name   string  `json:"name"`
	Price  float64 `json:"price"`
	Rating float64 `json:"rating"`
}

func round2(x float64) float64 { return math.Round(x*100) / 100 }

func handleReport(w http.ResponseWriter, r *http.Request) {
	first := intParam(r, "c") % categories
	buckets := make([]Bucket, 100)
	for i := range buckets {
		buckets[i] = Bucket{Bucket: i, Min: math.Inf(1), Max: math.Inf(-1)}
	}
	brands := map[string]float64{}
	var all []*Product
	for k := 0; k < reportCategories; k++ {
		for _, x := range catalog[(first+k)%categories] {
			b := &buckets[min(99, int(math.Floor(x.Price/10)))]
			b.Count++
			b.sum += x.Price
			b.Min = min(b.Min, x.Price)
			b.Max = max(b.Max, x.Price)
			brands[x.Brand] += x.Price * float64(x.Stock)
			all = append(all, x)
		}
	}
	slices.SortFunc(all, func(a, b *Product) int {
		return cmp.Or(cmp.Compare(b.Rating, a.Rating), cmp.Compare(a.Price, b.Price), cmp.Compare(a.ID, b.ID))
	})
	best := []Rated{}
	for i := 0; i < 100 && i < len(all); i++ {
		x := all[i]
		best = append(best, Rated{x.ID, x.Name, x.Price, x.Rating})
	}
	top := make([]BrandValue, 0, len(brands))
	for brand, value := range brands {
		top = append(top, BrandValue{brand, value})
	}
	slices.SortFunc(top, func(a, b BrandValue) int { return cmp.Compare(b.Value, a.Value) })
	top = top[:min(10, len(top))]
	for i := range top {
		top[i].Value = round2(top[i].Value)
	}
	used := []Bucket{}
	for _, b := range buckets {
		if b.Count > 0 {
			b.Mean = round2(b.sum / float64(b.Count))
			used = append(used, b)
		}
	}
	writeJSON(w, map[string]any{"first": first, "products": len(all), "buckets": used, "topBrands": top, "best": best})
}

func loadCatalog(ctx context.Context) {
	catalog = make([][]*Product, categories)
	rows, err := db.Query(ctx, "SELECT id, name, category, price::float8, stock, rating, brand FROM product ORDER BY id")
	if err != nil {
		log.Fatal(err)
	}
	for rows.Next() {
		x := &Product{}
		if err := rows.Scan(&x.ID, &x.Name, &x.Category, &x.Price, &x.Stock, &x.Rating, &x.Brand); err != nil {
			log.Fatal(err)
		}
		catalog[x.Category] = append(catalog[x.Category], x)
	}
	if rows.Err() != nil {
		log.Fatal(rows.Err())
	}
}

func main() {
	port := "3000"
	if len(os.Args) > 1 {
		port = os.Args[1]
	}
	pool := os.Getenv("DB_POOL")
	if pool == "" {
		pool = "64"
	}
	var err error
	db, err = pgxpool.New(context.Background(), "postgres://bench:bench@127.0.0.1:5432/bench?pool_max_conns="+pool)
	if err != nil {
		log.Fatal(err)
	}
	loadCatalog(context.Background())

	mux := http.NewServeMux()
	mux.HandleFunc("GET /plaintext", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("Hello, World!"))
	})
	mux.HandleFunc("GET /json", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"message": "Hello, World!"})
	})
	mux.HandleFunc("GET /db", handleDB)
	mux.HandleFunc("GET /queries", handleQueries)
	mux.HandleFunc("GET /fortunes", handleFortunes)
	mux.HandleFunc("GET /updates", handleUpdates)
	mux.HandleFunc("GET /search", handleSearch)
	mux.HandleFunc("GET /report", handleReport)
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("ready")
	log.Fatal(http.Serve(ln, mux))
}
