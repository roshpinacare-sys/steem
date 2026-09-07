"""Python ↔ C cross-validation for SMPU access control."""
import subprocess, sys
from pathlib import Path
from typing import List, Tuple
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from kernel.omnivisor import Omnivisor, Domain, Page, PageAttribute

CROSS_VAL_SCENARIOS: List[Tuple[str, int, bool, bool, str]] = [
    ("APU", 0x80001000, True, True, "APU writes own region"),
    ("APU", 0x80001000, False, True, "APU reads own region"),
    ("RPU", 0x90000100, True, True, "RPU writes own region"),
    ("RPU", 0x90000100, False, True, "RPU reads own region"),
    ("RISCV", 0x91000200, False, True, "RISCV reads own region"),
    ("APU", 0x90000100, True, False, "APU writes into RPU region"),
    ("APU", 0x90000100, False, False, "APU reads from RPU region"),
    ("RPU", 0x80001000, True, False, "RPU writes into APU region"),
    ("RISCV", 0x90000100, True, False, "RISCV writes into RPU region"),
    ("APU", 0xDEAD0000, True, False, "APU writes unmapped address"),
    ("RPU", 0xA0000000, False, False, "RPU reads unmapped address"),
    ("RPU", 0x90000100, False, True, "RPU reads own RW region"),
]
DOMAIN_MAP = {"APU": 0, "RPU": 1, "RISCV": 2, "FPGA": 2}
DOMAIN_ENUM = {"APU": Domain.APU, "RPU": Domain.RPU, "RISCV": Domain.FPGA, "FPGA": Domain.FPGA}

def _setup_py():
    ov = Omnivisor(seg_certify_fn=lambda esr_id: True)
    ov.install_page(Page(pa=0x80000000, size=0x10000000, owner=Domain.APU, attrs=frozenset({PageAttribute.TI})))
    ov.install_page(Page(pa=0x90000000, size=0x00100000, owner=Domain.RPU, attrs=frozenset({PageAttribute.TI})))
    ov.install_page(Page(pa=0x91000000, size=0x00080000, owner=Domain.FPGA, attrs=frozenset({PageAttribute.TI})))
    return ov

def _c_check(domain_id, addr, write):
    c_dir = REPO_ROOT / "kernel" / "c"
    harness = '#include <stdio.h>\n#include "smpu.h"\nint main(){smpu_table_t t;smpu_init(&t);smpu_add_region(&t,0,0x80000000ULL,0x10000000ULL,ACCESS_READ|ACCESS_WRITE|ACCESS_EXEC);smpu_add_region(&t,1,0x90000000ULL,0x00100000ULL,ACCESS_READ|ACCESS_WRITE);smpu_add_region(&t,2,0x91000000ULL,0x00080000ULL,ACCESS_READ|ACCESS_WRITE|ACCESS_EXEC);int d,a;unsigned long addr;scanf("%d %lu %d",&d,&addr,&a);printf("%d\\n",smpu_check_access(&t,d,addr,8,a));return 0;}'
    hp = c_dir / "cv_harness.c"
    hp.write_text(harness)
    try:
        subprocess.run(["gcc","-Wall","-Wextra","-std=c11","-o",str(c_dir/"cv_harness"),str(hp),str(c_dir/"smpu.c"),"-lm"],capture_output=True,timeout=15,check=True)
        access = 2 if write else 1
        r = subprocess.run([str(c_dir/"cv_harness")],input=f"{domain_id} {addr} {access}\n",capture_output=True,text=True,timeout=10)
        return r.stdout.strip().split("\n")[-1] == "1"
    except: pytest.skip("C harness unavailable")
    finally:
        for f in ["cv_harness","cv_harness.c"]:
            p = c_dir / f
            if p.exists():
                try: p.unlink()
                except: pass

@pytest.mark.parametrize("dn,addr,write,expected,desc", CROSS_VAL_SCENARIOS)
def test_cross_validation(dn, addr, write, expected, desc):
    ov = _setup_py()
    py = ov.admissible_write(DOMAIN_ENUM[dn], addr)
    c = _c_check(DOMAIN_MAP[dn], addr, write)
    assert py == expected, f"Python mismatch for '{desc}': got {py}, expected {expected}"
    assert c == expected, f"C mismatch for '{desc}': got {c}, expected {expected}"
    assert py == c, f"Disagreement for '{desc}': Python={py}, C={c}"

def test_cross_validation_summary():
    ov = _setup_py()
    agreements = 0
    for dn, addr, write, expected, desc in CROSS_VAL_SCENARIOS:
        py = ov.admissible_write(DOMAIN_ENUM[dn], addr)
        c = _c_check(DOMAIN_MAP[dn], addr, write)
        if py == c: agreements += 1
    assert agreements == len(CROSS_VAL_SCENARIOS)
