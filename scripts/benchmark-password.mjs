import { hashPassword } from '../worker/password.mjs';
import { cpus } from 'node:os';
const secret = crypto.randomUUID();
console.log(`Node ${process.version}; ${cpus()[0].model}. Five warmups, 40 samples per candidate; process CPU (user + system), not wall time.`);
for (const iterations of [10000, 20000, 30000, 40000, 50000, 55000, 60000, 65000, 70000, 80000, 100000]) {
  const samples = [];
  for (let i = 0; i < 45; i++) {
    const start = process.cpuUsage();
    await hashPassword(secret, undefined, iterations);
    const cpu = process.cpuUsage(start);
    if (i >= 5) samples.push((cpu.user + cpu.system) / 1000);
  }
  samples.sort((a,b) => a-b);
  console.log(JSON.stringify({ iterations, medianCPUms: samples[20], p95CPUms: samples[37], maxCPUms: samples[39] }));
}
