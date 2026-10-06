const proc = Bun.spawn(["bash", "-c", "bun sovereign/tmp/r208r/matrix-runner.mts"], { cwd: "/home/z/my-project", stdout: "pipe", stderr: "pipe" });
const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
const exit = await proc.exited;
console.log("exit:", exit, "· stdout len:", stdout.length, "· stderr len:", stderr.length);
console.log("includes expect:", stdout.includes('"failed": 0'), "· in stderr:", stderr.includes('"failed": 0'));
const lines = stdout.trim().split("\n");
console.log("total lines:", lines.length, "· line3:", JSON.stringify(lines[2]));
