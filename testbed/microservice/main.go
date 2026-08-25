package main

import (
	"context"
	"fmt"
	"time"

	"testbed/microservice/worker"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	pool := worker.NewEventWorkerPool(4, 100)
	results := pool.Start(ctx)

	go func() {
		for i := 0; i < 10; i++ {
			pool.Submit(worker.EventPayload{
				ID:        fmt.Sprintf("evt-%d", i),
				Type:      "benchmark.benchmark_event",
				Data:      map[string]interface{}{"index": i},
				Timestamp: time.Now(),
			})
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case res := <-results:
			if res.Status == "completed" {
				return
			}
		}
	}
}
