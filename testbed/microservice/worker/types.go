package worker

import "time"

type EventPayload struct {
	ID        string                 `json:"id"`
	Type      string                 `json:"type"`
	Data      map[string]interface{} `json:"data"`
	Timestamp time.Time              `json:"timestamp"`
}

type ProcessingResult struct {
	EventID   string    `json:"event_id"`
	Status    string    `json:"status"`
	WorkerID  int       `json:"worker_id"`
	Processed time.Time `json:"processed"`
	Error     string    `json:"error,omitempty"`
}

type JobQueue interface {
	Push(event EventPayload) bool
	Pop() (EventPayload, bool)
	Close()
}
