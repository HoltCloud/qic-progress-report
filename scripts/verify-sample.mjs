import fs from "node:fs";
import * as XLSX from "xlsx";
import { analyzeRows } from "../src/report.js";

const samplePath = process.env.SAMPLE_XLSX || "/Users/holtcloud/Downloads/QIC订单导出_1.xlsx";
const workbook = XLSX.read(fs.readFileSync(samplePath), { type: "buffer", cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
const report = analyzeRows(rows, "2026-05-18T11:40");

if (report.valid_count !== 365) {
  throw new Error(`Expected 365 valid orders, got ${report.valid_count}`);
}

if (report.skipped_count !== 1) {
  throw new Error(`Expected 1 skipped order, got ${report.skipped_count}`);
}

if (report.tail_table.length !== 18) {
  throw new Error(`Expected 18 merchants, got ${report.tail_table.length}`);
}

const total = report.carrier_table.find((row) => row.label === "应出库总数");
if (!total || total["合计"] !== 365 || total["京东"] !== 283 || total["顺丰"] !== 65 || total["圆通"] !== 17) {
  throw new Error(`Carrier total mismatch: ${JSON.stringify(total)}`);
}

console.log("Sample verification passed:", {
  valid_count: report.valid_count,
  skipped_count: report.skipped_count,
  merchants: report.tail_table.length,
  top_merchant: report.tail_table[0],
});
