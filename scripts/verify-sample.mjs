import fs from "node:fs";
import * as XLSX from "xlsx";
import { analyzeRows } from "../src/report.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function order(merchant, inboundAt, extra = {}) {
  return {
    商家名称: merchant,
    入库时间: inboundAt,
    实际发货快递: extra.carrier || "顺丰",
    订单履约状态: extra.status || "",
    质检完成时间: extra.qcDoneAt || "",
    出库时间: extra.outboundAt || "",
    揽收时间: extra.pickupAt || "",
    是否取消: extra.isCanceled ? "是" : "",
  };
}

function tailRow(report, merchant) {
  return report.tail_table.find((row) => row.merchant === merchant);
}

function hourRow(report, label) {
  return report.hour_table.find((row) => row.label === label);
}

function assertTailSummary(report) {
  const expected = report.tail_table.reduce(
    (summary, row) => {
      summary.picked_overdue += row.picked_overdue;
      summary.unpicked_overdue += row.unpicked_overdue;
      summary.unpicked_soon += row.unpicked_soon;
      summary.qc_soon += row.qc_soon;
      return summary;
    },
    { picked_overdue: 0, unpicked_overdue: 0, unpicked_soon: 0, qc_soon: 0 }
  );

  assert(
    JSON.stringify(report.tail_summary) === JSON.stringify(expected),
    `Tail summary mismatch: ${JSON.stringify({ expected, actual: report.tail_summary })}`
  );
}

function runInlineVerification() {
  const rows = [
    order("昨天夜间", "2026-05-19 20:30", { carrier: "顺丰" }),
    order("前天夜间", "2026-05-18 20:30", { carrier: "京东" }),
    order("前天夜间已揽收", "2026-05-18 21:00", { carrier: "圆通", pickupAt: "2026-05-19 18:30" }),
    order("普通订单", "2026-05-19 15:00", { carrier: "顺丰", outboundAt: "2026-05-19 16:00" }),
  ];

  const beforeSix = analyzeRows(rows, "2026-05-20T05:59");
  assert(beforeSix.valid_count === 4, `Expected 4 valid orders before 06:00, got ${beforeSix.valid_count}`);
  assert(!tailRow(beforeSix, "昨天夜间"), "Yesterday 20:00-23:59 order should be excluded before 06:00");
  assert(tailRow(beforeSix, "前天夜间")?.unpicked_overdue === 1, "Two-days-ago night order should be overdue from yesterday 09:00");
  assert(tailRow(beforeSix, "前天夜间")?.qc_soon === 1, "Two-days-ago night QC order should count as QC soon/overdue risk");
  assert(tailRow(beforeSix, "前天夜间已揽收")?.picked_overdue === 1, "Picked two-days-ago night order should use yesterday 09:00");
  assert(beforeSix.merchant_total === 3, `Expected 3 tail orders before 06:00, got ${beforeSix.merchant_total}`);

  const beforeSixCarrierTotal = beforeSix.carrier_table.find((row) => row.label === "应出库总数");
  const beforeSixHourTotal = beforeSix.hour_table.find((row) => row.summary);
  assert(beforeSixCarrierTotal?.["合计"] === 4, "Carrier table should keep all valid orders before 06:00");
  assert(beforeSixHourTotal?.total === 4, "Hour table should keep all valid orders before 06:00");
  assert(hourRow(beforeSix, "10点前的")?.total === 2, "Two-days-ago night orders should be bucketed before 10 before 06:00");
  assert(!hourRow(beforeSix, "20-21点") || hourRow(beforeSix, "20-21点").total === 1, "Yesterday night order should remain in 20-21 before 06:00");
  assertTailSummary(beforeSix);

  const atSix = analyzeRows(rows, "2026-05-20T06:00");
  const yesterdayNight = tailRow(atSix, "昨天夜间");
  assert(yesterdayNight?.total === 1, "Yesterday 20:00-23:59 order should be included at 06:00");
  assert(
    yesterdayNight.picked_overdue === 0 &&
      yesterdayNight.unpicked_overdue === 0 &&
      yesterdayNight.unpicked_soon === 0 &&
      yesterdayNight.qc_soon === 0,
    `Yesterday night order should count from today 09:00 at 06:00: ${JSON.stringify(yesterdayNight)}`
  );
  assert(atSix.merchant_total === 4, `Expected 4 tail orders at 06:00, got ${atSix.merchant_total}`);
  assert(hourRow(atSix, "10点前的")?.total === 1, "Yesterday night orders should be bucketed before 10 at 06:00");
  assert(hourRow(atSix, "20-21点")?.total === 1, "Two-days-ago night orders should use original hour buckets at 06:00");
  assertTailSummary(atSix);

  const headerVariantRows = rows.map((row) => {
    const next = {};
    Object.entries(row).forEach(([key, value]) => {
      next[` ${key} `] = value;
    });
    return next;
  });
  const variantReport = analyzeRows(headerVariantRows, "2026-05-20T06:00");
  assert(variantReport.merchant_total === 4, "Header variant parsing failed");

  console.log("Inline verification passed:", {
    before_six_tail_total: beforeSix.merchant_total,
    at_six_tail_total: atSix.merchant_total,
    at_six_yesterday_night: yesterdayNight,
  });
}

function runOptionalSampleVerification() {
  if (!process.env.SAMPLE_XLSX) return;

  const workbook = XLSX.read(fs.readFileSync(process.env.SAMPLE_XLSX), { type: "buffer", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const report = analyzeRows(rows, "2026-05-18T11:40");

  assert(report.valid_count > 0, `Expected sample to contain valid orders, got ${report.valid_count}`);
  assert(report.merchant_total <= report.valid_count, "Tail merchant total cannot exceed valid order count");
  assertTailSummary(report);

  console.log("Optional sample verification passed:", {
    valid_count: report.valid_count,
    skipped_count: report.skipped_count,
    merchants: report.tail_table.length,
    merchant_total: report.merchant_total,
    top_merchant: report.tail_table[0],
  });
}

runInlineVerification();
runOptionalSampleVerification();
