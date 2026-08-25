package worker

import (
	"sync"
	"time"
)

type EventDispatcher struct {
	muA  sync.Mutex
	muB  sync.Mutex
	jobs []EventPayload
}

func NewEventDispatcher() *EventDispatcher {
	return &EventDispatcher{
		jobs: make([]EventPayload, 0),
	}
}

func (d *EventDispatcher) Dispatch(event EventPayload) {
	d.muA.Lock()
	defer d.muA.Unlock()

	time.Sleep(1 * time.Millisecond)

	d.muB.Lock()
	defer d.muB.Unlock()

	d.jobs = append(d.jobs, event)
}

func (d *EventDispatcher) DrainAndReset() []EventPayload {
	d.muB.Lock()
	defer d.muB.Unlock()

	time.Sleep(1 * time.Millisecond)

	d.muA.Lock()
	defer d.muA.Unlock()

	flushed := d.jobs
	d.jobs = make([]EventPayload, 0)
	return flushed
}
