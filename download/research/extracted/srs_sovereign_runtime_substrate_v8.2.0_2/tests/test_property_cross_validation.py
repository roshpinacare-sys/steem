"""Property-based Python ↔ C cross-validation using Hypothesis."""
import subprocess, sys
from pathlib import Path
import pytest
from hypothesis import given, strategies as st, settings

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
from kernel.omnivisor import Omnivisor, Domain, Page, PageAttribute

C_DIR = REPO_ROOT / "kernel" / "c"
DOMAIN_MAP = {"APU": 0, "RPU": 1, "RISCV": 2, "FPGA": 2}
DOMAIN_ENUM = {"APU": Domain.APU, "RPU": Domain.RPU, "RISCV": Domain.FPGA, "FPGA": Domain.FPGA}

def _setup_py():
    ov = Omnivisor(seg_certify_fn=lambda esr_id: True)
    ov.install_page(Page(pa=0x80000000, size=0x10000000, owner=Domain.APU, attrs=frozenset({PageAttribute.TI})))
    ov.install_page(Page(pa=0x90000000, size=0x00100000, owner=Domain.RPU, attrs=frozenset({PageAttribute.TI})))
    ov.install_page(Page(pa=0x91000000, size=0x00080000, owner=Domain.FPGA, attrs=frozenset({PageAttribute.TI})))
    return ov

def _c_check(domain_id, addr, write):
    harness = '#include <stdio.h>\n#include "smpu.h"\nint main(){smpu_table_t t;smpu_init(&t);smpu_add_region(&t,0,0x80000000ULL,0x10000000ULL,ACCESS_READ|ACCESS_WRITE|ACCESS_EXEC);smpu_add_region(&t,1,0x90000000ULL,0x00100000ULL,ACCESS_READ|ACCESS_WRITE);smpu_add_region(&t,2,0x91000000ULL,0x00080000ULL,ACCESS_READ|ACCESS_WRITE|ACCESS_EXEC);int d,a;unsigned long addr;scanf("%d %lu %d",&d,&addr,&a);printf("%d\\n",smpu_check_access(&t,d,addr,8,a));return 0;}'
    hp = C_DIR / "pb_harness.c"
    hp.write_text(harness)
    try:
        subprocess.run(["gcc","-Wall","-Wextra","-std=c11","-o",str(C_DIR/"pb_harness"),str(hp),str(C_DIR/"smpu.c"),"-lm"],capture_output=True,timeout=15,check=True)
        access = 2 if write else 1
        r = subprocess.run([str(C_DIR/"pb_harness")],input=f"{domain_id} {addr} {access}\n",capture_output=True,text=True,timeout=10)
        return r.stdout.strip().split("\n")[-1] == "1"
    except: pytest.skip("C harness unavailable")
    finally:
        for f in ["pb_harness","pb_harness.c"]:
            p = C_DIR / f
            if p.exists():
                try: p.unlink()
                except: pass

@given(domain_name=st.sampled_from(["APU", "RPU", "RISCV"]),
       addr=st.integers(min_value=0x70000000, max_value=0xA0000000),
       write=st.booleans())
@settings(max_examples=100, deadline=None)
def test_property_cross_validation(domain_name, addr, write):
    ov = _setup_py()
    py = ov.admissible_write(DOMAIN_ENUM[domain_name], addr)
    c = _c_check(DOMAIN_MAP[domain_name], addr, write)
    assert py == c, f"Disagreement: domain={domain_name}, addr=0x{addr:X}, write={write}: Python={py}, C={c}"
