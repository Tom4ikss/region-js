// The workloads of tests/bench-real.js: orders built, processed and read by
// goroutines.
package main

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"time"
)

const (
	orders   = 200_000
	batches  = 200
	products = 100_000
	lookups  = 1_000_000
)

type customer struct {
	name string
	city string
}

type item struct {
	sku   string
	qty   int
	price float64
}

type order struct {
	id       int
	customer *customer
	items    []*item
	total    float64
}

type product struct {
	sku   string
	price float64
	stock int
}

func makeOrder(i int) *order {
	city := "Kazan"
	if i%2 == 1 {
		city = "Moscow"
	}
	return &order{
		id:       i,
		customer: &customer{name: "customer " + strconv.Itoa(i%1000), city: city},
		items: []*item{
			{sku: "sku " + strconv.Itoa(i%500), qty: 1 + i%3, price: float64(10 + i%7)},
			{sku: "sku " + strconv.Itoa((i+1)%500), qty: 2, price: 20.5},
			{sku: "sku " + strconv.Itoa((i+2)%500), qty: 1, price: float64(5 + i%11)},
		},
	}
}

func build(from, to int) []*order {
	out := make([]*order, 0, to-from)
	for i := from; i < to; i++ {
		out = append(out, makeOrder(i))
	}
	return out
}

func sumQty(list []*order) int {
	qty := 0
	for _, o := range list {
		for _, it := range o.items {
			qty += it.qty
		}
	}
	return qty
}

func timeReal(name string, f func() string) {
	runs := make([]float64, 0, 5)
	check := ""
	for range 5 {
		start := time.Now()
		check = f()
		runs = append(runs, float64(time.Since(start).Nanoseconds())/1e6)
	}
	slices.Sort(runs)
	fmt.Printf("%s: %.1f ms best, %.1f ms median (%s)\n", name, runs[0], runs[2], check)
}

func runReal(threads int) {
	timeReal("build: goroutines", func() string {
		parts := make([]chan []*order, threads)
		for k := range threads {
			parts[k] = make(chan []*order, 1)
			go func() { parts[k] <- build(k*orders/threads, (k+1)*orders/threads) }()
		}
		qty := 0
		for _, p := range parts {
			qty += sumQty(<-p)
		}
		return strconv.Itoa(qty)
	})

	all := make([][]*order, batches)
	for b := range batches {
		all[b] = build(b*1000, (b+1)*1000)
	}
	timeReal("batches: goroutines", func() string {
		done := make([]chan []*order, batches)
		for b, batch := range all {
			done[b] = make(chan []*order, 1)
			go func() {
				for _, o := range batch {
					total := 0.0
					for _, it := range o.items {
						total += float64(it.qty) * it.price
					}
					o.total = total * 0.9
				}
				done[b] <- batch
			}()
		}
		sum := 0.0
		for b := range batches {
			all[b] = <-done[b]
			for _, o := range all[b] {
				sum += o.total
			}
		}
		return fmt.Sprint(math.Round(sum))
	})

	catalog := make([]*product, products)
	for i := range products {
		catalog[i] = &product{sku: "sku " + strconv.Itoa(i), price: float64(1 + i%100), stock: i % 50}
	}
	// Goroutines share the heap: nothing is handed over.
	timeReal("catalog: goroutines, shared", func() string {
		sums := make([]chan float64, threads)
		for t := range threads {
			sums[t] = make(chan float64, 1)
			go func() {
				sum := 0.0
				for i := range lookups {
					sum += catalog[(i*7919+t)%len(catalog)].price
				}
				sums[t] <- sum
			}()
		}
		sum := 0.0
		for _, s := range sums {
			sum += <-s
		}
		return fmt.Sprint(sum)
	})
}
