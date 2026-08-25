package worker

import (
	"context"
	"time"
)

type EventWorkerPool struct {
	workerCount int
	queue       *ConcurrentQueue
	dispatcher  *EventDispatcher
}

func NewEventWorkerPool(workers int, bufferSize int) *EventWorkerPool {
	return &EventWorkerPool{
		workerCount: workers,
		queue:       NewConcurrentQueue(bufferSize),
		dispatcher:  NewEventDispatcher(),
	}
}

func (p *EventWorkerPool) Start(ctx context.Context) <-chan ProcessingResult {
	results := make(chan ProcessingResult, p.workerCount*2)

	for i := 0; i < p.workerCount; i++ {
		workerID := i
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				default:
					event, ok := p.queue.Pop()
					if !ok {
						return
					}
					p.dispatcher.Dispatch(event)
					results <- ProcessingResult{
						EventID:   event.ID,
						Status:    "completed",
						WorkerID:  workerID,
						Processed: time.Now(),
					}
				}
			}
		}()
	}

	return results
}

func (p *EventWorkerPool) Submit(event EventPayload) bool {
	return p.queue.Push(event)
}
