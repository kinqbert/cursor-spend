import { fetchPersonalSpend, formatUsd, SpendError } from "./spend.js";

import { fetchPersonalSpend, formatUsd, toMs, SpendError } from "./spend.js";

function fmtDate(value) {
  const ms = toMs(value);
  if (ms == null) return "unknown";
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

try {
  const report = await fetchPersonalSpend();
  console.log(`${report.you.email ?? "you"} · ${report.membershipType ?? "plan"}`);
  console.log(`Billing cycle ${fmtDate(report.cycleStart)} → ${fmtDate(report.cycleEnd)}`);
  console.log("");
  console.log(`On-demand (extra billed): ${formatUsd(report.onDemand.usedDollars)}`);
  console.log(`Included usage:           ${formatUsd(report.plan.includedDollars)}`);
  if (report.plan.bonusDollars) {
    console.log(`Bonus usage:              ${formatUsd(report.plan.bonusDollars)}`);
  }
  console.log(`Plan consumed:            ${formatUsd(report.plan.totalDollars)}`);
  if (report.plan.limitDollars) {
    console.log(`Plan limit:               ${formatUsd(report.plan.limitDollars)}`);
  }
  if (report.messages.auto) console.log(`\n${report.messages.auto}`);
  if (report.messages.api) console.log(report.messages.api);

  if (report.models.length) {
    console.log("\nBy model");
    const width = Math.max(...report.models.map((row) => row.model.length), 5);
    for (const row of report.models) {
      console.log(
        `  ${row.model.padEnd(width)}  ${formatUsd(row.totalDollars).padStart(10)}`,
      );
    }
  }
} catch (error) {
  if (error instanceof SpendError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
