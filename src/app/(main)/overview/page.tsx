"use client";

import mqtt, { type IClientOptions, type MqttClient } from "mqtt";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// ========= 설정 =========
const DEFAULT_BROKER_URL = "wss://g11c1e1e.ala.eu-central-1.emqxsl.com:8084/mqtt";
const DEFAULT_USERNAME = "okj1812";
const DEFAULT_PASSWORD = "okj1812";

// ========= 토픽 =========
const TOPIC_STT = "stt/voice_command";
const TOPIC_ACTION = "llm/action";
const TOPIC_ENTERED = "/object_entered";
const TOPIC_QC = "/qc_result";
const TOPIC_VERDICT = "qc/verdict";

// ========= 타입 =========
type ActionName = "start" | "stop" | "inspect_circuit" | "cancel";
type QCResult = "OK" | "NG";
type Verdict = "PASS" | "FAIL" | "OK" | "NG";
type EventMsg =
  | { kind: "STT"; ts: number; text: string }
  | { kind: "ACTION"; ts: number; action: ActionName }
  | { kind: "ENTERED"; ts: number }
  | { kind: "QC"; ts: number; result: QCResult }
  | { kind: "VERDICT"; ts: number; verdict: Verdict }
  | { kind: "INFO"; ts: number; text: string };
type ConnState = "connecting" | "connected" | "reconnecting" | "error";

// ========= 유틸 =========
function fmtTime(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function badge(txt: string, cls: string) {
  return <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${cls}`}>{txt}</span>;
}

// ========= 컴포넌트 =========
export default function OverviewPage() {
  // 설정 입력값
  const [brokerUrl, setBrokerUrl] = useState(DEFAULT_BROKER_URL);
  const [username, setUsername] = useState(DEFAULT_USERNAME);
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [camCircuitUrl, setCamCircuitUrl] = useState("");
  const [camBoardUrl, setCamBoardUrl] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  // 연결 상태/클라이언트
  const [conn, setConn] = useState<ConnState>("connecting");
  const clientRef = useRef<MqttClient | null>(null);

  // 이벤트
  const [events, setEvents] = useState<EventMsg[]>([]);
  const [, setAwaitingCircuit] = useState(false);

  // 헬퍼
  const toText = (p: any) => {
    if (typeof p === "string") return p;
    try {
      const hasDecoder = "TextDecoder" in globalThis;
      if (hasDecoder) {
        const dec = new (globalThis as any).TextDecoder();
        if (p instanceof Uint8Array) return dec.decode(p);
        if (Array.isArray(p)) return dec.decode(new Uint8Array(p as number[]));
      }
    } catch { }
    return String(p ?? "");
  };
  const push = (e: EventMsg) =>
    setEvents((prev) => {
      const next = [...prev, e];
      if (next.length > 1000) next.shift();
      return next;
    });
  const pushInfo = (text: string) => push({ kind: "INFO", ts: Date.now(), text });

  // ===== MQTT 연결: 브라우저에서만, 설정 변경 시 재연결 =====
  useEffect(() => {
    // 이전 연결 정리
    if (clientRef.current) {
      try { clientRef.current.end(true); } catch { }
      clientRef.current = null;
    }

    setConn("connecting");
    const opts: IClientOptions = {
      username,
      password,
      clean: true,
      reconnectPeriod: 1000,
    };
    const c = mqtt.connect(brokerUrl, opts);
    clientRef.current = c;

    c.on("connect", () => { setConn("connected"); pushInfo("MQTT connected"); });
    c.on("reconnect", () => { setConn("reconnecting"); pushInfo("MQTT reconnecting…"); });
    c.on("error", (err: any) => { setConn("error"); pushInfo(`MQTT error: ${String(err?.message ?? err)}`); });
    c.on("close", () => { setConn("error"); pushInfo("MQTT closed"); });

    const topics = [TOPIC_STT, TOPIC_ACTION, TOPIC_ENTERED, TOPIC_QC, TOPIC_VERDICT];
    c.subscribe(topics, { qos: 1 }, (err) => {
      if (err) pushInfo(`Subscribe failed: ${String(err)}`);
      else pushInfo(`Subscribed: ${topics.join(", ")}`);
    });

    c.on("message", (topic: string, payload: any) => {
      const ts = Date.now();
      const raw = toText(payload);

      if (topic === TOPIC_STT) {
        let text = raw;
        try { const o = JSON.parse(raw); if (typeof o === "object" && o) text = (o.text ?? raw)?.toString(); } catch { }
        push({ kind: "STT", ts, text: text ?? "" });
      } else if (topic === TOPIC_ACTION) {
        let action: ActionName | undefined;
        try { const o = JSON.parse(raw); action = String(o.action ?? "").toLowerCase() as ActionName; }
        catch { action = raw.toLowerCase() as ActionName; }
        if (action) {
          push({ kind: "ACTION", ts, action });
          if (action === "inspect_circuit") setAwaitingCircuit(true);
        }
      } else if (topic === TOPIC_ENTERED) {
        push({ kind: "ENTERED", ts });
      } else if (topic === TOPIC_QC) {
        try {
          const o = JSON.parse(raw);
          const r = String(o.result ?? "").toUpperCase() as QCResult;
          if (r === "OK" || r === "NG") push({ kind: "QC", ts, result: r });
        } catch { }
      } else if (topic === TOPIC_VERDICT) {
        try {
          const o = JSON.parse(raw);
          const v = String(o.verdict ?? "").toUpperCase() as Verdict;
          push({ kind: "VERDICT", ts, verdict: v });
          setAwaitingCircuit(false);
        } catch { }
      }
    });

    return () => {
      try { c.end(true); } catch { }
      clientRef.current = null;
    };
  }, [brokerUrl, username, password]); // 설정 바뀌면 재연결

  // 언마운트 시 안전 정리(이중 방어)
  useEffect(() => () => { try { clientRef.current?.end(true); } catch { } }, []);

  // ===== 퍼블리시 =====
  const publishAction = useCallback((action: ActionName) => {
    const c = clientRef.current;
    if (!c || conn !== "connected") { pushInfo("Not connected — action not sent"); return; }
    try {
      c.publish(TOPIC_ACTION, JSON.stringify({ action }), { qos: 1 }, (err) => {
        if (err) pushInfo(`Publish failed: ${String(err)}`);
        else push({ kind: "ACTION", ts: Date.now(), action });
      });
      if (action === "inspect_circuit") setAwaitingCircuit(true);
    } catch (e) { pushInfo(`Publish exception: ${String(e)}`); }
  }, [conn]);

  // ===== KPI =====
  const { circuit, board, cycleAvgMs } = useMemo(() => {
    const now = Date.now();
    const qc = events.filter((e) => e.kind === "QC") as Extract<EventMsg, { kind: "QC" }>[];
    const boardOk = qc.filter((e) => e.result === "OK").length;
    const boardNg = qc.filter((e) => e.result === "NG").length;
    const boardProcessed = boardOk + boardNg;
    const boardYield = boardProcessed ? (boardOk / boardProcessed) * 100 : 0;
    const boardLastHour = qc.filter((e) => e.ts >= now - 3600_000).length;

    const verdicts = events.filter((e) => e.kind === "VERDICT") as Extract<EventMsg, { kind: "VERDICT" }>[];
    const circuitOk = verdicts.filter((v) => v.verdict === "OK" || v.verdict === "PASS").length;
    const circuitNg = verdicts.filter((v) => v.verdict === "NG" || v.verdict === "FAIL").length;
    const circuitProcessed = circuitOk + circuitNg;
    const circuitYield = circuitProcessed ? (circuitOk / circuitProcessed) * 100 : 0;
    const circuitDefect = 100 - circuitYield;
    const circuitLastHour = verdicts.filter((e) => e.ts >= now - 3600_000).length;

    const enteredTs: number[] = events.filter((e) => e.kind === "ENTERED").map((e) => e.ts);
    const outTs: number[] = events.filter((e) => e.kind === "QC" || e.kind === "VERDICT").map((e) => e.ts);
    const diffs: number[] = [];
    for (const q of outTs) { const prevEntered = maxLE(enteredTs, q); if (prevEntered != null) diffs.push(q - prevEntered); }
    const cycleAvg = diffs.length ? Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length) : 0;

    return {
      board: { ok: boardOk, ng: boardNg, processed: boardProcessed, yieldRate: boardYield, defectRate: 100 - boardYield, lastHour: boardLastHour },
      circuit: { ok: circuitOk, ng: circuitNg, processed: circuitProcessed, yieldRate: circuitYield, defectRate: circuitDefect, lastHour: circuitLastHour },
      cycleAvgMs: cycleAvg,
    };
  }, [events]);
  function maxLE(arr: number[], x: number): number | null { let best: number | null = null; for (const v of arr) if (v <= x && (best == null || v > best)) best = v; return best; }

  // ===== 마운트 가드 =====
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const isConnected = conn === "connected";
  const disabledCls = !isConnected ? "opacity-50 cursor-not-allowed" : "";

  // ===== 렌더 =====
  if (!mounted) {
    return (
      <div className="mx-auto max-w-[1400px] p-4 md:p-6 lg:p-8">
        <div className="rounded-xl border p-6">
          <div className="h-6 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border bg-gray-50 dark:bg-gray-900/40" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6 lg:p-8">
      {/* 상단 바 */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Production Overview</h1>
          {conn === "connected" && badge("Connected", "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300")}
          {conn === "connecting" && badge("Connecting…", "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300")}
          {conn === "reconnecting" && badge("Reconnecting…", "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300")}
          {conn === "error" && badge("Error", "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300")}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => publishAction("start")} disabled={!isConnected} className={"rounded-lg bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700 " + disabledCls}>Start</button>
          <button onClick={() => publishAction("stop")} disabled={!isConnected} className={"rounded-lg bg-rose-600 px-3 py-2 text-white hover:bg-rose-700 " + disabledCls}>Stop</button>
          <button onClick={() => publishAction("inspect_circuit")} disabled={!isConnected} className={"rounded-lg bg-indigo-600 px-3 py-2 text-white hover:bg-indigo-700 " + disabledCls}>Inspect Circuit</button>
          <button onClick={() => setShowSettings((v) => !v)} className="rounded-lg border px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-900" title="MQTT/스트림 설정">Settings</button>
        </div>
      </div>

      {/* 설정 패널 */}
      {showSettings && (
        <div className="mt-4 grid gap-3 rounded-xl border p-4 md:grid-cols-2">
          <LabeledInput label="Broker URL (wss)" value={brokerUrl} onChange={setBrokerUrl} placeholder="wss://host:port/mqtt" />
          <LabeledInput label="Username" value={username} onChange={setUsername} />
          <LabeledInput label="Password" value={password} onChange={setPassword} type="password" />
          <LabeledInput label="Circuit (RealSense) Stream URL" value={camCircuitUrl} onChange={setCamCircuitUrl} placeholder="http(s)://..." />
          <LabeledInput label="Board (Webcam) Stream URL" value={camBoardUrl} onChange={setCamBoardUrl} placeholder="http(s)://..." />
        </div>
      )}

      {/* KPI */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="grid gap-2">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Circuit (RealSense)</div>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard title="Defect Rate" value={`${circuit.defectRate.toFixed(1)}%`} sub={`${circuit.ng}/${circuit.processed}`} variant="danger" />
            <KpiCard title="OK" value={String(circuit.ok)} />
            <KpiCard title="NG" value={String(circuit.ng)} variant="danger" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard title="Throughput (1h)" value={String(circuit.lastHour)} />
          </div>
        </div>

        <div className="grid gap-2">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Board (Webcam)</div>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard title="Yield" value={`${board.yieldRate.toFixed(1)}%`} sub={`${board.ok}/${board.processed}`} />
            <KpiCard title="OK" value={String(board.ok)} />
            <KpiCard title="NG" value={String(board.ng)} variant="danger" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard title="Throughput (1h)" value={String(board.lastHour)} />
          </div>
        </div>
      </div>

      {/* 본문 */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="grid gap-6 lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <VisionTile title="Circuit — RealSense" url={camCircuitUrl} />
            <VisionTile title="Board — Webcam" url={camBoardUrl} />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <QualityTrendChart events={events} minutes={20} source="circuit" invertRate />
            <QualityTrendChart events={events} minutes={20} source="board" />
          </div>

          <div className="hidden">
            <h2 className="mb-3 text-base font-semibold">Cycle Time (ENTERED → QC/VERDICT)</h2>
            <div className="text-3xl font-bold">{cycleAvgMs ? `${Math.round(cycleAvgMs)} ms` : "-"}</div>
            <p className="mt-1 text-sm text-gray-500">가장 가까운 이전 ENTERED와 QC/VERDICT 간 평균 지연입니다.</p>
          </div>
        </div>

        <div className="rounded-xl border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Live Events</h2>
            <span className="text-xs text-gray-500">최근 {Math.min(events.length, 100)}건 표시</span>
          </div>
          <div className="grid gap-2">
            {events.slice(-100).reverse().map((e, i) => <EventRow e={e} key={i} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ========= 부컴포넌트 =========
function LabeledInput({ label, value, onChange, placeholder, type }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div className="grid gap-2">
      <label className="text-sm text-gray-500">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type} className="w-full rounded-lg border bg-white px-3 py-2 dark:bg-gray-950" />
    </div>
  );
}

function KpiCard({ title, value, sub, variant }: { title: string; value: string; sub?: string; variant?: "danger" }) {
  const color = variant === "danger" ? "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300" : "bg-gray-50 text-gray-700 dark:bg-gray-900/40 dark:text-gray-200";
  return (
    <div className="rounded-xl border p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-1 text-3xl font-semibold">{value}</div>
      {sub && <div className={`mt-2 inline-block rounded-md px-2 py-1 text-xs ${color}`}>{sub}</div>}
    </div>
  );
}

function EventRow({ e }: { e: EventMsg }) {
  const t = <span className="font-mono text-[11px] text-gray-500">{fmtTime(e.ts)}</span>;
  if (e.kind === "STT") return row("STT", "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300", e.text, t);
  if (e.kind === "ACTION") return row("ACTION", "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300", e.action, t);
  if (e.kind === "ENTERED") return row("ENTERED", "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", "object detected", t);
  if (e.kind === "QC") return row("QC", e.result === "OK" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", e.result, t);
  if (e.kind === "VERDICT") {
    const good = e.verdict === "OK" || e.verdict === "PASS";
    return row("VERDICT", good ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300", e.verdict, t);
  }
  return row("INFO", "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300", e.text, t);
}
function row(tag: string, cls: string, text: React.ReactNode, t: React.ReactNode) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-lg border p-2">
      <div className="flex items-center gap-2">
        {badge(tag, cls)}
        <span className="text-sm">{text}</span>
      </div>
      {t}
    </div>
  );
}

function VisionTile({ title, url }: { title: string; url: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        {url ? badge("Live", "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300") : badge("No stream", "bg-gray-100 text-gray-700 dark:bg-gray-800/50 dark:text-gray-300")}
      </div>
      <div className="aspect-video w-full overflow-hidden rounded-lg border bg-black/60">
        {url ? <img src={url} alt={title} className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center text-sm text-gray-400">입력된 스트림 URL이 없습니다.</div>}
      </div>
    </div>
  );
}

function QualityTrendChart({ events, minutes = 20, source, invertRate = false }: { events: EventMsg[]; minutes?: number; source: "circuit" | "board"; invertRate?: boolean }) {
  const { data, maxTotal } = React.useMemo(() => {
    const now = Date.now();
    const startMin = Math.floor((now - minutes * 60_000) / 60_000);
    const endMin = Math.floor(now / 60_000);
    const buckets = new Map<number, { ok: number; ng: number }>();
    for (let k = startMin; k <= endMin; k++) buckets.set(k, { ok: 0, ng: 0 });

    for (const e of events) {
      const k = Math.floor(e.ts / 60_000);
      const b = buckets.get(k); if (!b) continue;
      if (source === "board" && e.kind === "QC") {
        if (e.result === "OK") b.ok++; else b.ng++;
      } else if (source === "circuit" && e.kind === "VERDICT") {
        const good = e.verdict === "OK" || e.verdict === "PASS";
        if (good) b.ok++; else b.ng++;
      }
    }

    const arr = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => {
        const total = v.ok + v.ng;
        const dt = new Date(k * 60_000);
        const hh = String(dt.getHours()).padStart(2, "0");
        const mm = String(dt.getMinutes()).padStart(2, "0");
        const yieldPct = total ? (v.ok / total) * 100 : 0;
        const rate = invertRate ? (total ? (v.ng / total) * 100 : 0) : yieldPct;
        return { t: `${hh}:${mm}`, ok: v.ok, ng: v.ng, total, rate };
      });
    const maxT = Math.max(1, ...arr.map(d => d.total));
    return { data: arr, maxTotal: maxT };
  }, [events, minutes, source, invertRate]);

  const title = source === "circuit" ? "Circuit (RealSense)" : "Board (Webcam)";
  const rateName = invertRate ? "Defect%" : "Yield%";

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">{title} — Trend (last {minutes}m)</h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded bg-emerald-500" />OK</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded bg-rose-500" />NG</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded bg-indigo-500" />{rateName}</span>
        </div>
      </div>
      <div className="h-[260px] w-full rounded-lg border bg-white dark:bg-gray-950">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="t" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="count" allowDecimals={false} tick={{ fontSize: 12 }} domain={[0, Math.max(5, maxTotal)]} />
            <YAxis yAxisId="rate" orientation="right" tickFormatter={(v) => `${Math.round(v)}%`} domain={[0, 100]} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(value: any, name: string) => name === 'rate' ? [`${(value as number).toFixed(1)}%`, rateName] : [value, name.toUpperCase()]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="count" dataKey="ok" stackId="a" name="OK" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar yAxisId="count" dataKey="ng" stackId="a" name="NG" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            <Line yAxisId="rate" type="monotone" dataKey="rate" name={rateName} stroke="#6366f1" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
