const cmd = `bun sovereign/tmp/r208r/matrix-runner.mts && bun sovereign/tmp/r208r/world-child.mts '{"id":"PC-B1","objectiveMode":"ok","prefMode":"absent","authMode":"valid","sbd":{"value":3.5},"idleSteem":210}'`;
const proc = Bun.spawn(["bash", "-c", cmd], { cwd: "/home/z/my-project", stdout: "pipe", stderr: "pipe" });
const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
const exit = await proc.exited;
console.log("exit:", exit, "· stdout len:", stdout.length, "· includes:", stdout.includes("independentVsBuiltin"), "· in stderr:", stderr.includes("independentVsBuiltin"));
