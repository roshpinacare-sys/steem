#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
websocket.py — WebSocket events for real-time audit streaming.

Provides:
  - EventBroadcaster: manages WebSocket connections + broadcasts events
  - WebSocket endpoint handler for FastAPI

Agents and operators can subscribe to real-time audit events via WebSocket
instead of polling the REST API. This is critical for real-time monitoring
dashboards and alerting systems.
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import asdict
from typing import Any, Dict, List, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect


class EventBroadcaster:
    """Manages WebSocket connections and broadcasts events to subscribers."""

    def __init__(self) -> None:
        self.connections: Set[WebSocket] = set()
        self.event_buffer: List[Dict[str, Any]] = []
        self._max_buffer = 1000

    async def connect(self, websocket: WebSocket) -> None:
        """Accept a new WebSocket connection."""
        await websocket.accept()
        self.connections.add(websocket)
        # Send buffered events
        for event in self.event_buffer[-50:]:  # last 50 events
            await websocket.send_json(event)

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket connection."""
        self.connections.discard(websocket)

    async def broadcast(self, event: Dict[str, Any]) -> None:
        """Broadcast an event to all connected clients."""
        event["timestamp"] = event.get("timestamp", time.time())
        self.event_buffer.append(event)
        if len(self.event_buffer) > self._max_buffer:
            self.event_buffer = self.event_buffer[-self._max_buffer:]

        dead = set()
        for ws in self.connections:
            try:
                await ws.send_json(event)
            except Exception:
                dead.add(ws)
        self.connections -= dead

    def stats(self) -> Dict[str, Any]:
        return {
            "connected_clients": len(self.connections),
            "buffered_events": len(self.event_buffer),
        }


# Singleton broadcaster
broadcaster = EventBroadcaster()

# WebSocket router
router = APIRouter()


@router.websocket("/v1/events")
async def websocket_events(websocket: WebSocket):
    """WebSocket endpoint for real-time audit event streaming.

    Clients receive JSON events like:
      {"type": "audit", "action": "mutation:submit", "resource": "mut-001", ...}
    """
    await broadcaster.connect(websocket)
    try:
        while True:
            # Keep connection alive; clients can send ping messages
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"type": "pong", "timestamp": time.time()})
    except WebSocketDisconnect:
        broadcaster.disconnect(websocket)


def broadcast_audit_event(tenant_id: str, identity_id: str,
                          action: str, resource: str,
                          outcome: str = "success") -> None:
    """Helper to broadcast an audit event via WebSocket.

    This is called from the audit chain's append method (or as a hook).
    Buffers the event and schedules async broadcast if an event loop is running.
    """
    event = {
        "type": "audit",
        "tenant_id": tenant_id,
        "identity_id": identity_id,
        "action": action,
        "resource": resource,
        "outcome": outcome,
        "timestamp": time.time(),
    }
    # Always buffer the event (for late-connecting clients)
    broadcaster.event_buffer.append(event)
    if len(broadcaster.event_buffer) > broadcaster._max_buffer:
        broadcaster.event_buffer = broadcaster.event_buffer[-broadcaster._max_buffer:]

    # Schedule async broadcast if an event loop is running
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(broadcaster.broadcast(event))
    except RuntimeError:
        pass  # No event loop running (e.g., in sync tests) — event is buffered


def self_test() -> None:
    print("=" * 78)
    print("WebSocket Events — Real-time audit streaming self-test")
    print("=" * 78)

    # Clear buffer for clean test
    broadcaster.event_buffer.clear()

    # Test event buffering
    broadcast_audit_event("acme", "agent-001", "mutation:submit", "mut-001")
    broadcast_audit_event("acme", "seg", "seg:admit", "mut-001")
    assert len(broadcaster.event_buffer) == 2
    print(f"  Events buffered: {len(broadcaster.event_buffer)} ✓")

    stats = broadcaster.stats()
    print(f"  Stats: {stats['connected_clients']} clients, {stats['buffered_events']} events")
    assert stats["buffered_events"] == 2

    print("=" * 78)
    print("WebSocket Events self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
