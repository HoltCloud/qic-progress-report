import { useRef, useState } from "react";
import { CARRIERS, analyzeWorkbookFile, pad, toInputDateTime } from "./report.js";

const initialCarrierRows = [
  { label: "质检中" },
  { label: "待出库" },
  { label: "已出库待揽收" },
  { label: "已出库已揽收" },
  { label: "应出库总数" },
];

const initialHourRows = [
  { label: "汇总", total: 0, qc: 0, wait_outbound: 0, out_wait_pickup: 0, picked: 0, summary: true },
];

function nowMeta() {
  const now = new Date();
  return {
    date: `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`,
    clock: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

function CarrierTable({ rows }) {
  const groups = [...CARRIERS, "合计"];
  return (
    <table aria-label="作业整体进度按单">
      <colgroup>
        <col />
        {groups.map((group) => <col key={group} />)}
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>状态</th>
          {groups.map((group) => <th key={group}>{group}</th>)}
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th>{row.label}</th>
            {groups.map((group) => <td key={group}>{row[group] || 0}</td>)}
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HourTable({ rows }) {
  return (
    <table className="hourly" aria-label="作业整体进度按入仓时间">
      <colgroup><col /><col /><col /><col /><col /><col /></colgroup>
      <thead>
        <tr>
          <th rowSpan="2">入仓时间</th>
          <th rowSpan="2">入库总数</th>
          <th colSpan="4">仓内作业进度</th>
        </tr>
        <tr>
          <th>质检中</th>
          <th>待出仓</th>
          <th>已出仓待揽收</th>
          <th>已出库已揽收</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className={row.summary ? "summary-row" : ""}>
            <th>{row.label}</th>
            <td>{row.total}</td>
            <td>{row.qc}</td>
            <td>{row.wait_outbound}</td>
            <td>{row.out_wait_pickup}</td>
            <td>{row.picked}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TailTable({ rows }) {
  const blankRows = Math.max(20 - rows.length, 8);
  return (
    <table aria-label="8小时尾单跟进表">
      <colgroup><col /><col /><col /><col /><col /><col /></colgroup>
      <thead>
        <tr>
          <th>商家名称</th>
          <th>总单量</th>
          <th>已揽收超时单量</th>
          <th>未揽收超时单量</th>
          <th>未揽收即将超时大于6.5小时</th>
          <th>质检中即将超时大于6.5小时</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.merchant}>
            <th>{row.merchant}</th>
            <td>{row.total}</td>
            <td>{row.picked_overdue}</td>
            <td>{row.unpicked_overdue}</td>
            <td>{row.unpicked_soon}</td>
            <td>{row.qc_soon}</td>
          </tr>
        ))}
        {Array.from({ length: blankRows }, (_, index) => (
          <tr className="empty-line" key={`blank-${index}`}>
            <td>.</td><td>.</td><td>.</td><td>.</td><td>.</td><td>.</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function App() {
  const [reportTime, setReportTime] = useState(() => toInputDateTime(new Date()));
  const [report, setReport] = useState(() => ({
    report_date: nowMeta().date,
    report_clock: nowMeta().clock,
    valid_count: 0,
    skipped_count: 0,
    merchant_count: 0,
    merchant_total: 0,
    carrier_table: initialCarrierRows,
    hour_table: initialHourRows,
    tail_table: [],
  }));
  const [currentFile, setCurrentFile] = useState(null);
  const [status, setStatus] = useState("等待上传 Excel。");
  const [busy, setBusy] = useState(false);
  const reportRef = useRef(null);

  async function analyze(file, time = reportTime) {
    if (!file) return;
    setBusy(true);
    setStatus("正在解析并统计...");
    try {
      const nextReport = await analyzeWorkbookFile(file, time);
      setReport(nextReport);
      setStatus(`已统计 ${nextReport.valid_count} 单，右侧商家 ${nextReport.merchant_count} 个、商家总单量 ${nextReport.merchant_total} 单；已剔除取消/无入库时间 ${nextReport.skipped_count} 单。`);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "解析失败，请检查文件格式。");
    } finally {
      setBusy(false);
    }
  }

  function handleFile(event) {
    const file = event.target.files?.[0] || null;
    setCurrentFile(file);
    if (file) analyze(file);
  }

  function handleTimeChange(event) {
    const nextTime = event.target.value;
    setReportTime(nextTime);
    if (currentFile) analyze(currentFile, nextTime);
  }

  function exportPng() {
    const source = reportRef.current;
    if (!source) return;
    const width = source.scrollWidth;
    const height = source.scrollHeight;
    const clone = source.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const styles = Array.from(document.styleSheets)
      .map((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n"))
      .join("\n");
    const style = document.createElement("style");
    style.textContent = styles;
    clone.prepend(style);
    const html = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      ctx.scale(2, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      const link = document.createElement("a");
      link.download = `作业进度小时跟进表_${report.report_date.replaceAll("/", "-")}_${report.report_clock.replace(":", "")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    image.src = url;
  }

  const hasData = report.valid_count > 0;

  return (
    <main className="app-shell">
      <section className="toolbar" aria-label="报表操作">
        <div className="field">
          <label htmlFor="fileInput">Excel 数据表</label>
          <input id="fileInput" type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
        </div>
        <div className="field">
          <label htmlFor="reportTime">时间点</label>
          <input id="reportTime" type="datetime-local" value={reportTime} onChange={handleTimeChange} />
        </div>
        <button type="button" onClick={exportPng} disabled={!hasData || busy}>导出图片</button>
        <button type="button" onClick={() => window.print()} disabled={!hasData || busy}>打印</button>
      </section>

      <p className="hint">上传订单导出表后自动统计。单量按订单行计数，8 小时时效从入库时间开始计算；Excel 只在本浏览器内解析，不会上传服务器。</p>

      <section className="report-wrap">
        <div ref={reportRef} className="report">
          <div className="title">水贝珠宝质检中心　　作业进度小时跟进表</div>
          <div className="meta">
            <div>日期</div><div>{report.report_date}</div><div />
            <div>时间点</div><div>{report.report_clock}</div><div /><div />
          </div>

          <div className="left">
            <section className="section">
              <div className="section-title">作业整体进度（按单）</div>
              <CarrierTable rows={report.carrier_table} />
            </section>
            <div className="block-gap" />
            <section className="section">
              <div className="section-title">作业整体进度（按入仓时间）</div>
              <HourTable rows={report.hour_table} />
            </section>
          </div>

          <div className="spacer" />

          <div className="right">
            <section className="section">
              <div className="section-title">8小时尾单跟进表</div>
              <TailTable rows={report.tail_table} />
            </section>
          </div>
        </div>
      </section>

      <div className="status">{status}</div>
    </main>
  );
}
