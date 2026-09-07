"""R17.4 Advice fingerprint collision (R3.3 was never fixed).

The advice key is sha256(b"|".join(hypotheses))[:16].
If hypotheses contain the b'|' byte, the join is reversible:
    [b'a|b', b'c']  ->  b'a|b|c'
    [b'a', b'b|c']  ->  b'a|b|c'
Both produce the same fingerprint → advice built for one will be served for the other.
"""
import sys, hashlib
sys.path.insert(0, '/home/z/my-project/download')
from srs.primitives.advice import AdviceTable

# Two different hypothesis sets that collide
set_a = [b'a|b', b'c']
set_b = [b'a', b'b|c']

# Compute the actual key used
h_a = hashlib.sha256(b"|".join(set_a)).hexdigest()[:16]
h_b = hashlib.sha256(b"|".join(set_b)).hexdigest()[:16]
print(f"set_a fingerprint: {h_a}")
print(f"set_b fingerprint: {h_b}")
print(f"Collision? {h_a == h_b}")

# Now demonstrate the attack
advice = AdviceTable()
# Build advice for set_a with target=0
advice.build_for_identify(set_a, 0)
print(f"\nBuilt advice for set_a (target=0)")
print(f"  advice._table = {advice._table}")

# Query for set_b — gets set_a's advice!
result = advice.lookup(set_b, 0)
print(f"\nlookup(set_b, 0) = {result}")
print(f"  This is set_a's advice applied to set_b!")
print(f"  Verdict: {'COLLISION' if result is not None else 'safe'}")

# More dramatic: build for one target, query for a DIFFERENT hypothesis set
# that should NOT have any advice
set_c = [b'x', b'y', b'z']
advice2 = AdviceTable()
advice2.build_for_identify(set_a, 5)
# Craft set_d that collides with set_a
# We need join(set_d) == join(set_a) = b'a|b|c'
# set_d = [b'a|b|c'] — one element instead of two!
set_d = [b'a|b|c']
h_d = hashlib.sha256(b"|".join(set_d)).hexdigest()[:16]
print(f"\nset_d fingerprint: {h_d}")
print(f"set_a fingerprint: {h_a}")
print(f"Length-changing collision? {h_d == h_a}")
result2 = advice2.lookup(set_d, 5)
print(f"lookup(set_d, 5) = {result2}")
print(f"  set_d was NEVER built — got set_a's advice!")

# Same with attacker-chosen target value
advice3 = AdviceTable()
# Attacker controls advice value (e.g., via legitimate run)
# Then victim runs a task with hypothesis set that collides
target_in_advice = 42
advice3.build_for_identify([b'victim||hyp', b'2'], target_in_advice)
# Attacker constructs a hypothesis list that joins to the same bytes
# But with completely different elements
colliding_set = [b'victim', b'|', b'hyp', b'2']
result3 = advice3.lookup(colliding_set, target_in_advice)
print(f"\nVictim runs lookup(colliding_set, 42) = {result3}")
print(f"  Got back attacker-controlled answer: {result3}")
