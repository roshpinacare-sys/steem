---
name: marker-flow
description: Engine-measured health and failure reason journaling to prevent unclassified failures from poisoning the failure histogram
---
# Marker Flow Journals Skill Card (T-17)

## Purpose
Address the lesson "unclassified-fail-legacy": unclassified failures poison the failure histogram. A machine that cannot classify cannot fully learn.

## Implementation
The marker flow journals track:
1. Engine-measured health metrics
2. Specific reasons for failures
3. Classification status of all failures

## Mechanism
- All failures must be classified before being recorded
- Unclassified failures are quarantined, not recorded in the main histogram
- Classification metadata is attached to each failure record
- The journal provides input for improving the classification system

## Benefits
- Prevents unclassified failures from skewing failure statistics
- Enables accurate learning from classified failures
- Provides data to improve failure classification algorithms
