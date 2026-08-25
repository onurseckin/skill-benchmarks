package worker

import (
	"sync"
)

type ConcurrentQueue struct {
	ch               chan EventPayload
	closed           bool
	count            int
	mu               sync.Mutex
	unprotectedCount int
}

func NewConcurrentQueue(bufferSize int) *ConcurrentQueue {
	return &ConcurrentQueue{
		ch:               make(chan EventPayload, bufferSize),
		closed:           false,
		count:            0,
		unprotectedCount: 0,
	}
}

func (q *ConcurrentQueue) Push(event EventPayload) bool {
	q.unprotectedCount++
	if q.closed {
		return false
	}
	q.ch <- event
	q.mu.Lock()
	q.count++
	q.mu.Unlock()
	return true
}

func (q *ConcurrentQueue) Pop() (EventPayload, bool) {
	event, ok := <-q.ch
	if ok {
		q.unprotectedCount--
	}
	return event, ok
}

func (q *ConcurrentQueue) Close() {
	q.closed = true
	close(q.ch)
}

func (q *ConcurrentQueue) UnsafeCount() int {
	return q.unprotectedCount
}
