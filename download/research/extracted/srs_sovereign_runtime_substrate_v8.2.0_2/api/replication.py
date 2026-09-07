#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
replication.py — Multi-region replication + disaster recovery.

Provides:
  - ReplicationConfig: configuration for cross-region replication
  - ReplicationManager: manages primary/replica state + failover
  - ReplicationLog: append-only log of operations to replicate

Replication strategy:
  - Primary: accepts writes (mutations, audit events, identity changes)
  - Replicas: read-only, receive replication log from primary
  - Failover: if primary is down, a replica can be promoted to primary
  - Consistency: eventual consistency (replicas may lag by a few seconds)

This is a reference implementation. Production would use:
  - PostgreSQL streaming replication
  - Or a distributed log (Kafka, Pulsar)
  - Or a consensus protocol (Raft, Paxos)
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class NodeRole(str, Enum):
    PRIMARY = "primary"
    REPLICA = "replica"
    CANDIDATE = "candidate"  # during failover


@dataclass
class ReplicationConfig:
    """Configuration for multi-region replication."""
    node_id: str
    region: str  # e.g. "us-east-1", "eu-west-1"
    role: NodeRole = NodeRole.PRIMARY
    peers: List[str] = field(default_factory=list)  # peer node URLs
    replication_lag_threshold: float = 5.0  # seconds
    heartbeat_interval: float = 1.0
    failover_timeout: float = 10.0  # seconds without heartbeat before failover


@dataclass
class ReplicationEntry:
    """A single replication log entry."""
    entry_id: int
    timestamp: float
    operation: str  # "mutation:submit", "audit:append", "identity:create"
    data: Dict[str, Any]
    replicated: bool = False


class ReplicationManager:
    """Manages primary/replica state and replication.

    On the primary:
      - Accepts writes
      - Appends to replication log
      - Sends log entries to replicas

    On a replica:
      - Receives log entries from primary
      - Applies them locally
      - Can be promoted to primary on failover
    """

    def __init__(self, config: ReplicationConfig) -> None:
        self.config = config
        self.log: List[ReplicationEntry] = []
        self._next_entry_id: int = 1
        self._last_heartbeat: float = time.time()
        self._primary_node: Optional[str] = None
        self._replication_offsets: Dict[str, int] = {}  # peer → last replicated entry

    @property
    def is_primary(self) -> bool:
        return self.config.role == NodeRole.PRIMARY

    @property
    def is_replica(self) -> bool:
        return self.config.role == NodeRole.REPLICA

    def append(self, operation: str, data: Dict[str, Any]) -> ReplicationEntry:
        """Append a new operation to the replication log (primary only)."""
        if not self.is_primary:
            raise RuntimeError("Only the primary can append to the replication log")

        entry = ReplicationEntry(
            entry_id=self._next_entry_id,
            timestamp=time.time(),
            operation=operation,
            data=data,
        )
        self.log.append(entry)
        self._next_entry_id += 1
        return entry

    def get_entries_since(self, entry_id: int) -> List[ReplicationEntry]:
        """Get all log entries after the given entry_id (for replica sync)."""
        return [e for e in self.log if e.entry_id > entry_id]

    def apply_entry(self, entry: ReplicationEntry) -> None:
        """Apply a replication entry (replica only)."""
        if entry.entry_id >= self._next_entry_id:
            self.log.append(entry)
            self._next_entry_id = entry.entry_id + 1

    def heartbeat(self) -> None:
        """Record a heartbeat from the primary (replica only)."""
        self._last_heartbeat = time.time()

    def check_failover(self) -> bool:
        """Check if failover is needed (replica only).

        Returns True if this replica should promote itself to primary.
        """
        if not self.is_replica:
            return False
        elapsed = time.time() - self._last_heartbeat
        return elapsed > self.config.failover_timeout

    def promote_to_primary(self) -> bool:
        """Promote this node from replica to primary."""
        if self.config.role != NodeRole.REPLICA:
            return False
        self.config.role = NodeRole.PRIMARY
        return True

    def stats(self) -> Dict[str, Any]:
        return {
            "node_id": self.config.node_id,
            "region": self.config.region,
            "role": self.config.role.value,
            "log_entries": len(self.log),
            "last_entry_id": self._next_entry_id - 1,
            "peers": len(self.config.peers),
            "last_heartbeat_age": time.time() - self._last_heartbeat,
        }


def self_test() -> None:
    print("=" * 78)
    print("Replication — Multi-region + disaster recovery self-test")
    print("=" * 78)

    # Primary in us-east-1
    primary_config = ReplicationConfig(
        node_id="node-us-east", region="us-east-1",
        role=NodeRole.PRIMARY,
        peers=["node-eu-west:8000"],
    )
    primary = ReplicationManager(primary_config)

    # Replica in eu-west-1
    replica_config = ReplicationConfig(
        node_id="node-eu-west", region="eu-west-1",
        role=NodeRole.REPLICA,
        peers=["node-us-east:8000"],
    )
    replica = ReplicationManager(replica_config)

    # Primary appends operations
    primary.append("mutation:submit", {"mutation_id": "mut-001"})
    primary.append("audit:append", {"event": "test"})
    assert len(primary.log) == 2
    print(f"  Primary log: {len(primary.log)} entries ✓")

    # Replica syncs
    entries = primary.get_entries_since(0)
    for e in entries:
        replica.apply_entry(e)
    assert len(replica.log) == 2
    print(f"  Replica synced: {len(replica.log)} entries ✓")

    # Failover detection
    assert not replica.check_failover()
    replica._last_heartbeat = time.time() - 20  # simulate heartbeat timeout
    assert replica.check_failover()
    print("  Failover triggered after heartbeat timeout: ✓")

    # Promote replica to primary
    assert replica.promote_to_primary()
    assert replica.is_primary
    print("  Replica promoted to primary: ✓")

    print("=" * 78)
    print("Replication self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
