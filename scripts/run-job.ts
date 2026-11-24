// npm run job -- <job-name>      e.g. npm run job -- playoff-odds
import { db } from "@/lib/db";
import { JOBS, runJob } from "@/lib/jobs/registry";

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.log("Jobs:\n" + JOBS.map((j) => `  ${j.name.padEnd(24)} ${j.schedule.padEnd(16)} ${j.description}`).join("\n"));
    return;
  }
  console.log(await runJob(name));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
