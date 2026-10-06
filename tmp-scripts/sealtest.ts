import { sealOpen } from "../scripts/weave-seal";
try {
  const s = sealOpen();
  console.log("SEAL-OK", s.cloudAddress.slice(0, 10), s.networkAddress.slice(0, 10), "cloudKey:", s.cloudKeyHex ? "present" : "missing");
} catch (e) {
  console.log("SEAL-FAIL:", String(e).slice(0, 300));
}
