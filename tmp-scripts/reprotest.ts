const cmd = "bun sovereign/tmp/r208r/matrix-runner.mts | tail -20";
const proc = Bun.spawn(["bash", "-c", cmd], { cwd: "/home/z/my-project", stdout: "pipe", stderr: "pipe" });
const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
const exit = await proc.exited;
console.log("exit:", exit, "· stdout len:", stdout.length, "· includes expect:", stdout.includes('"failed": 0'));
console.log("stdout head:", JSON.stringify(stdout.slice(0, 120)));
