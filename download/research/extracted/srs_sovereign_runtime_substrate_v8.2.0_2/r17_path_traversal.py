"""R17.2 Path traversal bypass attempts."""
import sys
sys.path.insert(0, '/home/z/my-project/download')
from srs.persistence import _sanitize_id

attacks = [
    "../../etc/passwd",
    "..\\..\\windows\\system32",
    "....//....//etc/passwd",
    "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "..%2f..%2fetc%2fpasswd",
    "/etc/passwd",
    "test\x00../../etc/passwd",
    "test\n../../etc/passwd",
    "a" * 100,  # long
    "",  # empty
    None,
    "test/../../etc/passwd",
    ".",  # dot only
    "..",  # double dot
    "test..test",  # dots in middle
    "a" * 65,  # exactly over the limit
    "a" * 64,  # exactly at limit
    "valid_id-1",
    "valid_id_2",
    "test\x00",  # null at end
    "café",  # unicode
    "test; rm -rf /",  # shell injection
    "test && cat /etc/shadow",
    "test `whoami`",
    "test$(id)",
    "test|cat /etc/passwd",
    "../../../root/.ssh/id_rsa",
    "test\x0a../../etc/passwd",  # \n
    "test\x0d../../etc/passwd",  # \r
    "test\x0d\x0a../../etc/passwd",
]

print(f"{'Attack':60s} | {'Result'}")
print("-" * 100)
for attack in attacks:
    try:
        result = _sanitize_id(attack)
        print(f"  {repr(attack)[:55]:60s} | ACCEPTED: {result!r}")
    except (ValueError, TypeError) as e:
        print(f"  {repr(attack)[:55]:60s} | REJECTED: {type(e).__name__}")
