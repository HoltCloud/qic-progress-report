import { useRef, useState } from "react";
import html2canvas from "html2canvas";
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

const initialTailSummary = {
  picked_overdue: 0,
  unpicked_overdue: 0,
  unpicked_soon: 0,
  qc_soon: 0,
};

const tailSummaryRows = [
  ["picked_overdue", "已揽收超时单量"],
  ["unpicked_overdue", "未揽收超时单量"],
  ["unpicked_soon", "未揽收即将超时 >6.5h 单量"],
  ["qc_soon", "质检中即将超时 >4.5h 单量"],
];

const progressRows = [
  ["qc", "质检中"],
  ["wait_outbound", "待出库"],
  ["out_wait_pickup", "已出库待揽收"],
  ["picked", "已出库已揽收"],
];

const progressColors = {
  qc: "#d92d20",
  wait_outbound: "#f79009",
  out_wait_pickup: "#1570ef",
  picked: "#039855",
};

function nowMeta() {
  const now = new Date();
  return {
    date: `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`,
    clock: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value)}%`;
}

function safePercent(value, total) {
  if (!total) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

function Dashboard({ report }) {
  const summary = report.tail_summary || initialTailSummary;
  const carrierTotal = report.carrier_table?.find((row) => row.label === "应出库总数") || {};
  const totalOrders = report.valid_count || carrierTotal["合计"] || 0;
  const picked = report.carrier_table?.find((row) => row.label === "已出库已揽收")?.["合计"] || 0;
  const unfinished = Math.max(totalOrders - picked, 0);
  const riskTotal = tailSummaryRows.reduce((total, [key]) => total + (summary[key] || 0), 0);
  const progressData = progressRows.map(([key, label]) => {
    const source = report.carrier_table?.find((row) => row.label === label) || {};
    const count = source["合计"] || 0;
    return { key, label, count, percent: safePercent(count, totalOrders) };
  });
  const hourRows = (report.hour_table || [])
    .filter((row) => !row.summary)
    .map((row) => ({
      ...row,
      unfinished: (row.qc || 0) + (row.wait_outbound || 0) + (row.out_wait_pickup || 0),
    }));
  const maxHourTotal = Math.max(1, ...hourRows.map((row) => row.total || 0));
  const merchantRows = (report.tail_table || [])
    .map((row) => ({
      ...row,
      risk: (row.picked_overdue || 0) + (row.unpicked_overdue || 0) + (row.unpicked_soon || 0) + (row.qc_soon || 0),
    }))
    .filter((row) => row.risk > 0 || row.total > 0)
    .slice(0, 8);
  const maxMerchantRisk = Math.max(1, ...merchantRows.map((row) => row.risk || 0));
  const hasData = totalOrders > 0;

  return (
    <section className="dashboard" aria-label="作业风险仪表盘">
      <div className="dashboard-head">
        <div>
          <h1>作业风险仪表盘</h1>
          <p>{report.report_date} {report.report_clock} 更新</p>
        </div>
        <div className={`risk-badge ${riskTotal > 0 ? "is-alert" : ""}`}>
          {riskTotal > 0 ? "需要跟进" : "暂无风险"}
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <span>有效单量</span>
          <strong>{totalOrders}</strong>
          <small>剔除 {report.skipped_count || 0} 单</small>
        </div>
        <div className="kpi-card">
          <span>已揽收率</span>
          <strong>{formatPercent(safePercent(picked, totalOrders))}</strong>
          <small>{picked} / {totalOrders} 单</small>
        </div>
        <div className="kpi-card">
          <span>未完成单量</span>
          <strong>{unfinished}</strong>
          <small>质检、待出库、待揽收</small>
        </div>
        <div className="kpi-card is-danger">
          <span>风险尾单总量</span>
          <strong>{riskTotal}</strong>
          <small>{report.merchant_count || 0} 个商家</small>
        </div>
      </div>

      <div className="risk-grid">
        {tailSummaryRows.map(([key, label]) => (
          <div className="risk-card" key={key}>
            <span>{label}</span>
            <strong>{summary[key] || 0}</strong>
          </div>
        ))}
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-panel">
          <div className="panel-title">
            <h2>状态分布</h2>
            <span>{totalOrders} 单</span>
          </div>
          <div className="bar-list">
            {progressData.map((item) => (
              <div className="bar-row" key={item.key}>
                <div className="bar-meta">
                  <span>{item.label}</span>
                  <strong>{item.count} 单</strong>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${item.percent}%`, backgroundColor: progressColors[item.key] }}
                  />
                </div>
                <small>{formatPercent(item.percent)}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="panel-title">
            <h2>高风险商家</h2>
            <span>前 8 名</span>
          </div>
          <div className="merchant-list">
            {merchantRows.length ? merchantRows.map((row) => (
              <div className="merchant-row" key={row.merchant}>
                <div className="merchant-meta">
                  <strong>{row.merchant}</strong>
                  <span>{row.risk} 风险 / {row.total} 总单</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill merchant-fill" style={{ width: `${safePercent(row.risk, maxMerchantRisk)}%` }} />
                </div>
              </div>
            )) : (
              <div className="empty-dashboard">{hasData ? "暂无风险商家" : "上传 Excel 后显示商家风险排行"}</div>
            )}
          </div>
        </section>
      </div>

      <section className="dashboard-panel hour-panel">
        <div className="panel-title">
          <h2>入仓小时进度</h2>
          <span>红色为未完成</span>
        </div>
        <div className="hour-chart">
          {hourRows.length ? hourRows.map((row) => (
            <div className="hour-item" key={row.label}>
              <div className="hour-label">{row.label}</div>
              <div className="hour-bars">
                <div className="hour-total" style={{ width: `${safePercent(row.total, maxHourTotal)}%` }} />
                <div className="hour-unfinished" style={{ width: `${safePercent(row.unfinished, maxHourTotal)}%` }} />
              </div>
              <div className="hour-count">{row.unfinished}/{row.total}</div>
            </div>
          )) : (
            <div className="empty-dashboard">上传 Excel 后显示按小时进度</div>
          )}
        </div>
      </section>
    </section>
  );
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
           <th>质检中即将超时大于4.5小时</th>
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

function TailSummaryTable({ summary }) {
  return (
    <table className="tail-summary" aria-label="8小时尾单汇总表">
      <colgroup><col /><col /></colgroup>
      <thead>
        <tr>
          <th>汇总项目</th>
          <th>总数</th>
        </tr>
      </thead>
      <tbody>
        {tailSummaryRows.map(([key, label]) => (
          <tr key={key}>
            <th>{label}</th>
            <td>{summary[key] || 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState("report");
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
    tail_summary: initialTailSummary,
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
    if (file) {
      const now = toInputDateTime(new Date());
      setReportTime(now);
      analyze(file, now);
    }
  }

  function handleTimeChange(event) {
    const nextTime = event.target.value;
    setReportTime(nextTime);
    if (currentFile) analyze(currentFile, nextTime);
  }

  async function exportPng() {
    const source = reportRef.current;
    if (!source) return;
    try {
      const canvas = await html2canvas(source, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      const link = document.createElement("a");
      link.download = `作业进度小时跟进表_${report.report_date.replaceAll("/", "-")}_${report.report_clock.replace(":", "")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (error) {
      console.error("导出图片失败:", error);
      setStatus("导出图片失败，请重试。");
    }
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

      <div className="view-tabs" role="tablist" aria-label="页面切换">
        <button
          type="button"
          className={activeView === "dashboard" ? "is-active" : ""}
          onClick={() => setActiveView("dashboard")}
          aria-selected={activeView === "dashboard"}
          role="tab"
        >
          仪表盘
        </button>
        <button
          type="button"
          className={activeView === "report" ? "is-active" : ""}
          onClick={() => setActiveView("report")}
          aria-selected={activeView === "report"}
          role="tab"
        >
          明细报表
        </button>
      </div>

      {activeView === "dashboard" && <Dashboard report={report} />}

      <section className={`report-wrap ${activeView === "report" ? "" : "is-hidden-screen"}`}>
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
            <section className="section tail-summary-section">
              <div className="section-title">8小时尾单汇总</div>
              <TailSummaryTable summary={report.tail_summary || initialTailSummary} />
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
