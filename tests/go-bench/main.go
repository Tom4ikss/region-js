// go run . [workers]: the scenarios of tests/bench-tasks.js with goroutines.
// go run . real [workers]: the workloads of tests/bench-real.js.
// GOMAXPROCS is the number of workers; the driving code is a goroutine too,
// unlike the main thread of d8 or block_on in tests/tokio-bench.
package main

import (
	"fmt"
	"os"
	"runtime"
	"slices"
	"strconv"
	"sync"
	"time"
)

const n = 1000

func busy(us int) int {
	end := time.Now().Add(time.Duration(us) * time.Microsecond)
	x := 0
	for time.Now().Before(end) {
		x++
	}
	return x
}

func timeIt(name string, f func()) {
	runs := make([]float64, 0, 5)
	for range 5 {
		start := time.Now()
		f()
		runs = append(runs, float64(time.Since(start).Nanoseconds())/1e6)
	}
	slices.Sort(runs)
	fmt.Printf("%s: %.2f ms best, %.2f ms median\n", name, runs[0], runs[2])
}

func pingPong() {
	ping := make(chan int, 1)
	pong := make(chan int, 1)
	done := make(chan struct{})
	go func() {
		for v := range ping {
			pong <- v
		}
		close(done)
	}()
	for i := range n {
		ping <- i
		<-pong
	}
	close(ping)
	<-done
}

func tasks() {
	timeIt("spawn+await 1000 trivial", func() {
		results := make([]chan int, n)
		for i := range n {
			results[i] = make(chan int, 1)
			go func() { results[i] <- i + 1 }()
		}
		for _, r := range results {
			<-r
		}
	})
	timeIt("1000 x 50us cpu", func() {
		results := make([]chan int, n)
		for i := range n {
			results[i] = make(chan int, 1)
			go func() { results[i] <- busy(50) }()
		}
		for _, r := range results {
			<-r
		}
	})
	timeIt("fan-in: 1000 tasks send, main recv", func() {
		ch := make(chan int, n)
		var wg sync.WaitGroup
		for i := range n {
			wg.Add(1)
			go func() { defer wg.Done(); ch <- i }()
		}
		for range n {
			<-ch
		}
		wg.Wait()
	})
	timeIt("1000 parked on recv, then woken", func() {
		in := make(chan int, n)
		out := make(chan int, n)
		var wg sync.WaitGroup
		for range n {
			wg.Add(1)
			go func() { defer wg.Done(); out <- 2 * <-in }()
		}
		for i := range n {
			in <- i
		}
		for range n {
			<-out
		}
		wg.Wait()
	})
	timeIt("ping-pong 1000 round trips", pingPong)
	timeIt("rwlock: 1000 uncontended write+release", func() {
		var lock sync.RWMutex
		v := 0
		for range n {
			lock.Lock()
			v++
			lock.Unlock()
		}
	})
	timeIt("rwlock: 4 tasks x 250 write increments", func() {
		var lock sync.RWMutex
		var wg sync.WaitGroup
		v := 0
		for range 4 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for range 250 {
					lock.Lock()
					v++
					lock.Unlock()
				}
			}()
		}
		wg.Wait()
	})
}

func main() {
	args := os.Args[1:]
	isReal := len(args) > 0 && args[0] == "real"
	if isReal {
		args = args[1:]
	}
	workers := 4
	if len(args) > 0 {
		workers, _ = strconv.Atoi(args[0])
	}
	runtime.GOMAXPROCS(workers)
	if isReal {
		runReal(workers)
	} else {
		tasks()
	}
}
