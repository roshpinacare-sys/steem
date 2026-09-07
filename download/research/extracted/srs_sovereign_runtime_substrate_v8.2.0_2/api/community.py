#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
community.py — Open-source community program + bounty system.

Provides:
  - Bounty: a task with a reward for community contributors
  - Contributor: a community member with reputation + earned bounties
  - CommunityProgram: manages bounties, contributors, and payouts

Encourages open-source contributions by rewarding:
  - Bug reports ($50-$500)
  - Feature implementations ($200-$2000)
  - Documentation improvements ($50-$200)
  - Security vulnerability reports ($500-$5000)
"""
from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class BountyStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class BountyCategory(str, Enum):
    BUG = "bug"
    FEATURE = "feature"
    DOCS = "docs"
    SECURITY = "security"
    PERFORMANCE = "performance"
    TESTING = "testing"


@dataclass
class Bounty:
    """A community bounty task."""
    bounty_id: str
    title: str
    description: str
    category: BountyCategory
    reward_usd: float
    status: BountyStatus = BountyStatus.OPEN
    assignee: str = ""
    created_at: float = field(default_factory=time.time)
    completed_at: float = 0.0
    difficulty: str = "medium"  # easy, medium, hard, expert


@dataclass
class Contributor:
    """A community contributor."""
    contributor_id: str
    username: str
    email: str = ""
    reputation: int = 0
    bounties_completed: int = 0
    total_earned_usd: float = 0.0
    joined_at: float = field(default_factory=time.time)
    badges: List[str] = field(default_factory=list)

    def add_badge(self, badge: str) -> None:
        if badge not in self.badges:
            self.badges.append(badge)


class CommunityProgram:
    """Manages community bounties + contributors."""

    def __init__(self) -> None:
        self.bounties: Dict[str, Bounty] = {}
        self.contributors: Dict[str, Contributor] = {}

    def register_contributor(self, contributor_id: str, username: str,
                             email: str = "") -> Contributor:
        c = Contributor(contributor_id=contributor_id, username=username, email=email)
        self.contributors[contributor_id] = c
        return c

    def post_bounty(self, bounty_id: str, title: str, description: str,
                    category: BountyCategory, reward_usd: float,
                    difficulty: str = "medium") -> Bounty:
        b = Bounty(bounty_id=bounty_id, title=title, description=description,
                   category=category, reward_usd=reward_usd, difficulty=difficulty)
        self.bounties[bounty_id] = b
        return b

    def claim_bounty(self, bounty_id: str, contributor_id: str) -> bool:
        b = self.bounties.get(bounty_id)
        if b is None or b.status != BountyStatus.OPEN:
            return False
        b.assignee = contributor_id
        b.status = BountyStatus.IN_PROGRESS
        return True

    def complete_bounty(self, bounty_id: str) -> bool:
        b = self.bounties.get(bounty_id)
        if b is None or b.status != BountyStatus.IN_PROGRESS:
            return False
        b.status = BountyStatus.COMPLETED
        b.completed_at = time.time()
        # Reward contributor
        c = self.contributors.get(b.assignee)
        if c is None:
            return True
        if c:
            c.bounties_completed += 1
            c.total_earned_usd += b.reward_usd
            c.reputation += self._reputation_for(b)
            self._award_badges(c)
        return True

    def _reputation_for(self, bounty: Bounty) -> int:
        base = {"easy": 10, "medium": 25, "hard": 50, "expert": 100}
        return base.get(bounty.difficulty, 25)

    def _award_badges(self, c: Contributor) -> None:
        if c.bounties_completed >= 1:
            c.add_badge("first-bounty")
        if c.bounties_completed >= 5:
            c.add_badge("prolific")
        if c.bounties_completed >= 10:
            c.add_badge("veteran")
        if c.total_earned_usd >= 1000:
            c.add_badge("thousand-club")

    def list_bounties(self, status: Optional[BountyStatus] = None,
                      category: Optional[BountyCategory] = None) -> List[Dict]:
        return [
            {"bounty_id": b.bounty_id, "title": b.title, "category": b.category.value,
             "reward_usd": b.reward_usd, "status": b.status.value,
             "difficulty": b.difficulty, "assignee": b.assignee}
            for b in self.bounties.values()
            if (status is None or b.status == status)
            and (category is None or b.category == category)
        ]

    def get_contributor(self, contributor_id: str) -> Optional[Contributor]:
        return self.contributors.get(contributor_id)

    def leaderboard(self, limit: int = 10) -> List[Dict]:
        sorted_c = sorted(self.contributors.values(),
                          key=lambda c: c.reputation, reverse=True)
        return [
            {"username": c.username, "reputation": c.reputation,
             "bounties": c.bounties_completed, "earned_usd": c.total_earned_usd,
             "badges": c.badges}
            for c in sorted_c[:limit]
        ]

    def stats(self) -> Dict[str, Any]:
        return {
            "total_bounties": len(self.bounties),
            "open_bounties": sum(1 for b in self.bounties.values()
                                if b.status == BountyStatus.OPEN),
            "completed_bounties": sum(1 for b in self.bounties.values()
                                     if b.status == BountyStatus.COMPLETED),
            "total_contributors": len(self.contributors),
            "total_paid_usd": sum(c.total_earned_usd for c in self.contributors.values()),
        }


def self_test() -> None:
    print("=" * 78)
    print("Community Program — Bounty system self-test")
    print("=" * 78)
    prog = CommunityProgram()
    prog.register_contributor("c-001", "alice")
    prog.register_contributor("c-002", "bob")
    prog.post_bounty("b-001", "Fix SEG race condition", "...", BountyCategory.BUG, 500, "hard")
    prog.post_bounty("b-002", "Add Rust SDK", "...", BountyCategory.FEATURE, 2000, "expert")
    assert prog.claim_bounty("b-001", "c-001")
    assert prog.complete_bounty("b-001")
    alice = prog.get_contributor("c-001")
    assert alice is not None
    assert alice.total_earned_usd == 500
    assert alice.reputation == 50
    assert "first-bounty" in alice.badges
    print(f"  Alice: ${alice.total_earned_usd} earned, {alice.reputation} rep, badges={alice.badges}")
    lb = prog.leaderboard()
    assert lb[0]["username"] == "alice"
    print(f"  Leaderboard: {lb[0]['username']} #1")
    print("=" * 78)
    print("Community Program self-test PASSED.")
    print("=" * 78)


if __name__ == "__main__":
    self_test()
