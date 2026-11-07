// go-server [threads] [port]: the routes of server.js with net/http, for
// run.py (variant `go`). GOMAXPROCS is `threads`; the catalog is one slice,
// shared by every goroutine. Prints `ready <ms>` once it listens.
package main

import (
	"cmp"
	"encoding/json"
	"fmt"
	"math"
	"net"
	"net/http"
	"os"
	"runtime"
	"slices"
	"strconv"
	"time"
)

var start = time.Now()

type row struct {
	ID    int      `json:"id"`
	Name  string   `json:"name"`
	Price float64  `json:"price"`
	Stock int      `json:"stock"`
	Tags  []string `json:"tags"`
}

type cheap struct {
	ID    int     `json:"id"`
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

// number is written as JSON.stringify writes a number: null if it is not
// finite.
type number float64

func (n number) MarshalJSON() ([]byte, error) {
	f := float64(n)
	if math.IsInf(f, 0) || math.IsNaN(f) {
		return []byte("null"), nil
	}
	return json.Marshal(f)
}

type answer struct {
	Category int     `json:"category"`
	InStock  int     `json:"inStock"`
	Min      number  `json:"min"`
	Max      number  `json:"max"`
	Mean     number  `json:"mean"`
	Cheapest []cheap `json:"cheapest"`
}

type scored struct {
	ID    int `json:"id"`
	Score int `json:"score"`
}

type computed struct {
	Top  []scored `json:"top"`
	Mean float64  `json:"mean"`
}

// buildCatalog, query and compute are those of work.js.
func buildCatalog(count int) [][]*row {
	byCategory := make([][]*row, 1000)
	for i := range count {
		byCategory[i%1000] = append(byCategory[i%1000], &row{
			ID:    i,
			Name:  "item " + strconv.Itoa(i),
			Price: float64((i*7919)%100000) / 100,
			Stock: (i * 31) % 50,
			Tags:  []string{"a", "b"},
		})
	}
	return byCategory
}

func query(catalog [][]*row, category int) answer {
	rows := catalog[((category%1000)+1000)%1000]
	inStock := make([]*row, 0, len(rows))
	lo, hi, sum := math.Inf(1), math.Inf(-1), 0.0
	for _, r := range rows {
		if r.Stock == 0 {
			continue
		}
		inStock = append(inStock, r)
		lo = math.Min(lo, r.Price)
		hi = math.Max(hi, r.Price)
		sum += r.Price
	}
	slices.SortStableFunc(inStock, func(a, b *row) int { return cmp.Compare(a.Price, b.Price) })
	cheapest := make([]cheap, 0, 5)
	for i := 0; i < 5 && i < len(inStock); i++ {
		cheapest = append(cheapest, cheap{inStock[i].ID, inStock[i].Name, inStock[i].Price})
	}
	return answer{category, len(inStock), number(lo), number(hi), number(sum / float64(len(inStock))), cheapest}
}

func compute(seed int) computed {
	x := int32(seed)
	if x == 0 {
		x = 1
	}
	items := make([]*scored, 0, 4000)
	for i := range 4000 {
		x = (x*1103515245 + 12345) & 0x7fffffff
		items = append(items, &scored{i, int(x % 100000)})
	}
	slices.SortStableFunc(items, func(a, b *scored) int { return cmp.Compare(b.Score, a.Score) })
	sum := 0
	for _, it := range items {
		sum += it.Score
	}
	top := make([]scored, 10)
	for i := range top {
		top[i] = *items[i]
	}
	return computed{top, float64(sum) / float64(len(items))}
}

func reply(w http.ResponseWriter, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("content-length", strconv.Itoa(len(body)))
	w.Write(body)
}

func main() {
	threads, port := 8, "3000"
	if len(os.Args) > 1 {
		threads, _ = strconv.Atoi(os.Args[1])
	}
	if len(os.Args) > 2 {
		port = os.Args[2]
	}
	runtime.GOMAXPROCS(threads)
	rows := 1_000_000
	if s := os.Getenv("CATALOG_ROWS"); s != "" {
		rows, _ = strconv.Atoi(s)
	}
	catalog := buildCatalog(rows)

	mux := http.NewServeMux()
	mux.HandleFunc("/hello", func(w http.ResponseWriter, r *http.Request) {
		reply(w, map[string]string{"hello": "world"})
	})
	mux.HandleFunc("/compute", func(w http.ResponseWriter, r *http.Request) {
		seed, _ := strconv.Atoi(r.URL.Query().Get("seed"))
		reply(w, compute(seed))
	})
	mux.HandleFunc("/catalog", func(w http.ResponseWriter, r *http.Request) {
		c, _ := strconv.Atoi(r.URL.Query().Get("c"))
		reply(w, query(catalog, c))
	})
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		panic(err)
	}
	fmt.Printf("ready %d\n", time.Since(start).Milliseconds())
	http.Serve(listener, mux)
}
