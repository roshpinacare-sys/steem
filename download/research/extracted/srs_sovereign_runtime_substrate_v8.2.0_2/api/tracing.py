#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tracing.py — OpenTelemetry-style distributed tracing for SRS.

Provides:
  - Span: a single trace span (operation with start/end + metadata)
  - Tracer: creates spans and manages trace context
  - trace_context: a context manager for creating spans

Distributed tracing allows operators to follow a single mutation through
the entire SRS pipeline (API → policy → SEG → SQA → BLS → audit) and
identify bottlenecks.

In production, this would export to Jaeger/Zipkin via OpenTelemetry SDK.
Here we provide a reference implementation with in-memory span storage.
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, ContextManager


@dataclass
class Span:
    """A single trace span."""
    span_id: str
    trace_id: str
    parent_span_id: Optional[str]
    operation: str
    start_time: float = field(default_factory=time.time)
    end_time: float = 0.0
    duration_s: float = 0.0
    status: str = "ok"  # "ok", "error"
    attributes: Dict[str, Any] = field(default_factory=dict)
    events: List[Dict[str, Any]] = field(default_factory=list)

    def set_attribute(self, key: str, value: Any) -> None:
        self.attributes[key] = value

    def add_event(self, name: str, **kwargs: Any) -> None:
        self.events.append({
            "name": name, "timestamp": time.time(), "attributes": kwargs,
        })

    def finish(self, status: str = "ok") -> None:
        self.end_time = time.time()
        self.duration_s = self.end_time - self.start_time
        self.status = status

    def to_dict(self) -> Dict[str, Any]:
        return {
            "span_id": self.span_id, "trace_id": self.trace_id,
            "parent_span_id": self.parent_span_id, "operation": self.operation,
            "start_time": self.start_time, "end_time": self.end_time,
            "duration_s": self.duration_s, "status": self.status,
            "attributes": self.attributes, "events": self.events,
        }


class Tracer:
    """Creates spans and manages trace context."""

    def __init__(self, service_name: str = "srs") -> None:
        self.service_name = service_name
        self.spans: List[Span] = []
        self._current_trace_id: Optional[str] = None
        self._current_span_id: Optional[str] = None

    def start_trace(self, operation: str) -> Span:
        """Start a new trace (root span)."""
        trace_id = uuid.uuid4().hex
        span_id = uuid.uuid4().hex[:16]
        span = Span(
            span_id=span_id, trace_id=trace_id,
            parent_span_id=None, operation=operation,
        )
        self._current_trace_id = trace_id
        self._current_span_id = span_id
        self.spans.append(span)
        return span

    def start_span(self, operation: str) -> Span:
        """Start a child span within the current trace."""
        if self._current_trace_id is None:
            return self.start_trace(operation)
        span_id = uuid.uuid4().hex[:16]
        span = Span(
            span_id=span_id, trace_id=self._current_trace_id,
            parent_span_id=self._current_span_id, operation=operation,
        )
        self._current_span_id = span_id
        self.spans.append(span)
        return span

    def finish_span(self, span: Span, status: str = "ok") -> None:
        """Finish a span and restore the parent as current."""
        span.finish(status)
        self._current_span_id = span.parent_span_id

    def get_trace(self, trace_id: str) -> List[Span]:
        """Get all spans for a trace."""
        return [s for s in self.spans if s.trace_id == trace_id]

    def stats(self) -> Dict[str, Any]:
        traces = set(s.trace_id for s in self.spans)
        durations = [s.duration_s for s in self.spans if s.duration_s > 0]
        return {
            "service": self.service_name,
            "total_spans": len(self.spans),
            "total_traces": len(traces),
            "avg_duration_s": sum(durations) / len(durations) if durations else 0,
            "error_count": sum(1 for s in self.spans if s.status == "error"),
        }


# Singleton tracer
tracer = Tracer("srs")


class SpanContext:
    """Context manager for creating + finishing spans."""

    def __init__(self, operation: str, **attributes: Any) -> None:
        self.operation = operation
        self.attributes = attributes
        self.span: Optional[Span] = None

    def __enter__(self) -> Span:
        self.span = tracer.start_span(self.operation)
        for k, v in self.attributes.items():
            self.span.set_attribute(k, v)
        return self.span

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self.span is not None:
            status = "error" if exc_type is not None else "ok"
            if exc_type is not None:
                self.span.add_event("exception", type=str(exc_type), message=str(exc_val))
            tracer.finish_span(self.span, status)
        # don't suppress exceptions


def self_test() -> None:
    print("=" * 78)
    print("Tracing — Distributed tracing self-test")
    print("=" * 78)

    # Clear any prior spans
    tracer.spans.clear()
    tracer._current_trace_id = None
    tracer._current_span_id = None

    # Start a trace
    root = tracer.start_trace("mutation:submit")
    root.set_attribute("mutation_id", "mut-001")
    root.set_attribute("tenant_id", "acme")

    # Child spans
    with SpanContext("policy:evaluate", mutation_id="mut-001") as span:
        span.add_event("policy_checked", effect="allow")

    with SpanContext("seg:evaluate", mutation_id="mut-001") as span:
        span.add_event("seg_checked", admissible=True)

    with SpanContext("audit:append", mutation_id="mut-001") as span:
        pass

    tracer.finish_span(root)

    # Verify trace
    trace = tracer.get_trace(root.trace_id)
    assert len(trace) == 4  # root + 3 children
    print(f"  Trace: {len(trace)} spans ✓")

    stats = tracer.stats()
    print(f"  Stats: {stats['total_spans']} spans, {stats['total_traces']} traces")
    assert stats["total_spans"] == 4
    assert stats["error_count"] == 0

    print("=" * 78)
    print("Tracing self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
