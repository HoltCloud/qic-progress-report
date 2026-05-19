import * as XLSX from "xlsx";

export const CARRIERS = ["顺丰", "圆通", "京东"];

export const STATUS_ROWS = [
  ["qc", "质检中"],
  ["wait_outbound", "待出库"],
  ["out_wait_pickup", "已出库待揽收"],
  ["picked", "已出库已揽收"],
  ["total", "应出库总数"],
];

export function pad(value) {
  return String(value).padStart(2, "0");
}

export function toInputDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function cleanText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeHeader(value) {
  return cleanText(value).replace(/^\uFEFF/, "").replace(/[\s　:：()（）_-]/g, "");
}

function valueByHeader(row, candidates) {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) return row[candidate];
  }

  const wanted = candidates.map(normalizeHeader);
  const matchedKey = Object.keys(row).find((key) => wanted.includes(normalizeHeader(key)));
  return matchedKey ? row[matchedKey] : "";
}

function parseExcelDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0));
  }
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text.replace(/\./g, "-").replace(/\//g, "-");
  const date = new Date(normalized.includes("T") ? normalized : normalized.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeOrder(row) {
  const merchant = cleanText(valueByHeader(row, ["商家名称", "商家", "店铺名称", "店铺"]));
  return {
    merchant: merchant || "未填写商家",
    carrierRaw: cleanText(valueByHeader(row, ["实际发货快递", "快递公司", "快递", "承运商"])),
    statusRaw: cleanText(valueByHeader(row, ["订单履约状态", "履约状态", "状态"])),
    isCanceled: cleanText(valueByHeader(row, ["是否取消", "取消状态"])) === "是",
    inboundAt: parseExcelDate(valueByHeader(row, ["入库时间", "入仓时间"])),
    qcDoneAt: parseExcelDate(valueByHeader(row, ["质检完成时间", "质检时间"])),
    outboundAt: parseExcelDate(valueByHeader(row, ["出库时间", "出仓时间"])),
    pickupAt: parseExcelDate(valueByHeader(row, ["揽收时间", "揽件时间"])),
  };
}

function carrierGroup(order) {
  if (order.carrierRaw.includes("圆通")) return "圆通";
  if (order.carrierRaw.includes("京东")) return "京东";
  if (order.carrierRaw.includes("顺丰") || order.carrierRaw.includes("丰")) return "顺丰";
  return "其他";
}

function progress(order) {
  if (order.pickupAt) return "picked";
  if (order.outboundAt) return "out_wait_pickup";
  if (order.qcDoneAt || order.statusRaw.includes("待出库")) return "wait_outbound";
  return "qc";
}

function emptyCarrierCounts() {
  return Object.fromEntries([...CARRIERS, "合计"].map((name) => [name, 0]));
}

function buildCarrierTable(orders) {
  const counts = Object.fromEntries(STATUS_ROWS.map(([key]) => [key, emptyCarrierCounts()]));

  orders.forEach((order) => {
    const group = CARRIERS.includes(carrierGroup(order)) ? carrierGroup(order) : "合计";
    const state = progress(order);
    counts[state][group] += 1;
    counts[state]["合计"] += 1;
    counts.total[group] += 1;
    counts.total["合计"] += 1;
  });

  return STATUS_ROWS.map(([key, label]) => ({ label, ...counts[key] }));
}

function buildHourTable(orders, reportAt) {
  const inboundHours = orders.map((order) => order.inboundAt?.getHours()).filter((hour) => hour != null);
  const endHour = Math.max(reportAt.getHours(), 10, ...inboundHours);
  const buckets = [{ label: "10点前的", start: -Infinity, end: 10 }];

  for (let hour = 10; hour <= endHour; hour += 1) {
    buckets.push({ label: `${hour}-${hour + 1}点`, start: hour, end: hour + 1 });
  }

  const rows = buckets.map((bucket) => {
    const row = { label: bucket.label, total: 0, qc: 0, wait_outbound: 0, out_wait_pickup: 0, picked: 0 };
    orders.forEach((order) => {
      const hour = order.inboundAt.getHours() + order.inboundAt.getMinutes() / 60 + order.inboundAt.getSeconds() / 3600;
      if (hour >= bucket.start && hour < bucket.end) {
        row.total += 1;
        row[progress(order)] += 1;
      }
    });
    return row;
  });

  const summary = rows.reduce(
    (acc, row) => {
      ["total", "qc", "wait_outbound", "out_wait_pickup", "picked"].forEach((key) => {
        acc[key] += row[key];
      });
      return acc;
    },
    { label: "汇总", total: 0, qc: 0, wait_outbound: 0, out_wait_pickup: 0, picked: 0, summary: true }
  );

  return [...rows, summary];
}

function buildTailTable(orders, reportAt) {
  const merchants = new Map();

  orders.forEach((order) => {
    if (!merchants.has(order.merchant)) {
      merchants.set(order.merchant, {
        merchant: order.merchant,
        total: 0,
        picked_overdue: 0,
        unpicked_overdue: 0,
        unpicked_soon: 0,
        qc_soon: 0,
      });
    }

    const row = merchants.get(order.merchant);
    const currentHours = (reportAt - order.inboundAt) / 36e5;
    const isPicked = Boolean(order.pickupAt);
    row.total += 1;

    if (isPicked) {
      const pickupHours = (order.pickupAt - order.inboundAt) / 36e5;
      if (pickupHours > 8) row.picked_overdue += 1;
    } else if (currentHours > 8) {
      row.unpicked_overdue += 1;
    } else if (currentHours > 6.5) {
      row.unpicked_soon += 1;
    }

    if (!isPicked && currentHours > 4.5 && progress(order) === "qc") {
      row.qc_soon += 1;
    }
  });

  const rows = [...merchants.values()].sort((a, b) => {
    const riskA = a.picked_overdue + a.unpicked_overdue + a.unpicked_soon + a.qc_soon;
    const riskB = b.picked_overdue + b.unpicked_overdue + b.unpicked_soon + b.qc_soon;
    return riskB - riskA || b.total - a.total || a.merchant.localeCompare(b.merchant, "zh-Hans-CN");
  });

  if (!rows.length && orders.length) {
    rows.push({
      merchant: "未识别商家",
      total: orders.length,
      picked_overdue: 0,
      unpicked_overdue: 0,
      unpicked_soon: 0,
      qc_soon: 0,
    });
  }

  return rows;
}

function buildTailSummary(tailTable) {
  return tailTable.reduce(
    (summary, row) => {
      summary.picked_overdue += row.picked_overdue;
      summary.unpicked_overdue += row.unpicked_overdue;
      summary.unpicked_soon += row.unpicked_soon;
      summary.qc_soon += row.qc_soon;
      return summary;
    },
    {
      picked_overdue: 0,
      unpicked_overdue: 0,
      unpicked_soon: 0,
      qc_soon: 0,
    }
  );
}

function dayAt(date, offsetDays, hour = 0, minute = 0, second = 0, millisecond = 0) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays, hour, minute, second, millisecond);
}

function inRange(date, start, end) {
  return date >= start && date < end;
}

function buildTailOrders(orders, reportAt) {
  const todayStart = dayAt(reportAt, 0);
  const todaySix = dayAt(reportAt, 0, 6);
  const todayNine = dayAt(reportAt, 0, 9);
  const yesterdayStart = dayAt(reportAt, -1);
  const yesterdayEightPm = dayAt(reportAt, -1, 20);
  const yesterdayNine = dayAt(reportAt, -1, 9);
  const twoDaysAgoEightPm = dayAt(reportAt, -2, 20);
  const beforeTodaySix = reportAt < todaySix;

  return orders.flatMap((order) => {
    if (beforeTodaySix && inRange(order.inboundAt, yesterdayEightPm, todayStart)) {
      return [];
    }

    if (inRange(order.inboundAt, yesterdayEightPm, todayStart)) {
      return [{ ...order, inboundAt: new Date(todayNine) }];
    }

    if (inRange(order.inboundAt, twoDaysAgoEightPm, yesterdayStart)) {
      return [{ ...order, inboundAt: new Date(yesterdayNine) }];
    }

    return [order];
  });
}

function buildHourOrders(orders, reportAt) {
  const todayStart = dayAt(reportAt, 0);
  const todaySix = dayAt(reportAt, 0, 6);
  const todayNine = dayAt(reportAt, 0, 9);
  const yesterdayStart = dayAt(reportAt, -1);
  const yesterdayEightPm = dayAt(reportAt, -1, 20);
  const yesterdayNine = dayAt(reportAt, -1, 9);
  const twoDaysAgoEightPm = dayAt(reportAt, -2, 20);
  const beforeTodaySix = reportAt < todaySix;

  return orders.map((order) => {
    if (beforeTodaySix && inRange(order.inboundAt, twoDaysAgoEightPm, yesterdayStart)) {
      return { ...order, inboundAt: new Date(yesterdayNine) };
    }

    if (!beforeTodaySix && inRange(order.inboundAt, yesterdayEightPm, todayStart)) {
      return { ...order, inboundAt: new Date(todayNine) };
    }

    return order;
  });
}

export function analyzeRows(rows, reportTime) {
  const reportAt = reportTime ? new Date(reportTime) : new Date();
  if (Number.isNaN(reportAt.getTime())) {
    throw new Error("时间点格式不正确，请重新选择时间。");
  }

  const orders = rows.map(normalizeOrder);
  const valid = orders.filter((order) => !order.isCanceled && order.inboundAt && order.statusRaw !== "小邮局处理中");
  const hourOrders = buildHourOrders(valid, reportAt);
  const tailOrders = buildTailOrders(valid, reportAt);
  const tailTable = buildTailTable(tailOrders, reportAt);
  const tailSummary = buildTailSummary(tailTable);

  return {
    report_date: `${reportAt.getFullYear()}/${reportAt.getMonth() + 1}/${reportAt.getDate()}`,
    report_clock: `${pad(reportAt.getHours())}:${pad(reportAt.getMinutes())}`,
    valid_count: valid.length,
    skipped_count: orders.length - valid.length,
    merchant_count: tailTable.length,
    merchant_total: tailTable.reduce((sum, row) => sum + row.total, 0),
    carrier_table: buildCarrierTable(valid),
    hour_table: buildHourTable(hourOrders, reportAt),
    tail_table: tailTable,
    tail_summary: tailSummary,
  };
}

export async function analyzeWorkbookFile(file, reportTime) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  return analyzeRows(rows, reportTime);
}
