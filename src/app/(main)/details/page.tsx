"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import mqtt from "mqtt";

type PartType = "resistor" | "capacitor" | "switch" | "led" | "transistor";
type Port = { key: string; dx: number; dy: number };

type Part = {
  id: string;
  refName: string;
  type: PartType;
  x: number; y: number;
  ports: Port[];
  w: number; h: number;
  rot?: number; // 회전 각도(deg)
};

type Conn = {
  id: string;
  a: { partId: string; portKey: string };
  b: { partId: string; portKey: string };
};

type BoardListItem = { id: string; name: string; savedAt: number; size: number };

const GRID = 20;
const SNAP = 20;
const CANVAS_W = 1800;
const CANVAS_H = 1100;

// 오른쪽 아래 삭제 영역
const TRASH = { w: 260, h: 180 };
const TRASH_POS = { x: CANVAS_W - TRASH.w, y: CANVAS_H - TRASH.h };

const PALETTE: { type: PartType; w: number; h: number; ports: Port[]; refPrefix: string }[] = [
  { type: "capacitor",  w: 200, h: 100, ports: [{ key:"A", dx:-45, dy:0 }, { key:"B", dx:45, dy:0 }], refPrefix: "C"   },
  { type: "resistor",   w: 200, h: 100, ports: [{ key:"A", dx:-50, dy:0 }, { key:"B", dx:50, dy:0 }], refPrefix: "R"   },
  { type: "switch",     w: 300, h: 300, ports: [{ key:"A", dx:-45, dy:0 }, { key:"B", dx:45, dy:0 }], refPrefix: "S"   },
  { type: "led",        w: 200, h: 200, ports: [{ key:"A", dx:-40, dy:0 }, { key:"B", dx:40, dy:0 }], refPrefix: "LED" },
  { type: "transistor", w: 300, h: 300, ports: [{ key:"B", dx:0, dy:-35 }, { key:"C", dx:-30, dy:30 }, { key:"E", dx:30, dy:30 }], refPrefix: "Q" },
];

const TYPE_LABEL: Record<PartType, string> = {
  resistor: "Resistor",
  capacitor: "Capacitor",
  switch: "Switch",
  led: "LED",
  transistor: "Transistor",
};
const TYPE_COLOR: Record<PartType, string> = {
  resistor: "#f59e0b",
  capacitor: "#3b82f6",
  switch: "#22c55e",
  led: "#ef4444",
  transistor: "#8b5cf6",
};

function snap(v: number, g = GRID) { return Math.round(v / g) * g; }
function clientToSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

// 회전 적용해서 포트 좌표 계산
function portAnchor(p: Part, portKey: string) {
  const pr = p.ports.find(pt => pt.key === portKey);
  if (!pr) return { x: p.x, y: p.y };
  const a = ((p.rot ?? 0) * Math.PI) / 180;
  const rx = pr.dx * Math.cos(a) - pr.dy * Math.sin(a);
  const ry = pr.dx * Math.sin(a) + pr.dy * Math.cos(a);
  return { x: p.x + rx, y: p.y + ry };
}
function manhattanPath(a:{x:number;y:number}, b:{x:number;y:number}) {
  const mid = { x: a.x, y: b.y };
  return [
    { x: snap(a.x), y: snap(a.y) },
    { x: snap(mid.x), y: snap(mid.y) },
    { x: snap(b.x), y: snap(b.y) },
  ];
}

function partShape(type: PartType, w: number, h: number) {
  switch (type) {
    case "resistor": {
      const bodyW = w * 0.6, bodyH = h * 0.5;
      return (
        <>
          <rect x={-bodyW/2} y={-bodyH/2} width={bodyW} height={bodyH} rx={bodyH/2}
                fill="#ffe8b0" stroke="var(--shape-stroke)" strokeWidth={2}/>
          <rect x={-bodyW/6 - 6} y={-bodyH/2} width={12} height={bodyH} fill="#8b5cf6" opacity={0.9}/>
          <rect x={-4}           y={-bodyH/2} width={8}  height={bodyH} fill="#ef4444" opacity={0.9}/>
          <rect x={ bodyW/6 - 6} y={-bodyH/2} width={12} height={bodyH} fill="#f59e0b" opacity={0.9}/>
        </>
      );
    }
    case "capacitor": {
      const canW = w * 0.36, canH = h * 0.7;
      return (
        <>
          <rect x={-canW/2} y={-canH/2} width={canW} height={canH} rx={10}
                fill="var(--cap-body)" stroke="var(--shape-stroke)" strokeWidth={2}/>
          <rect x={-canW/2} y={-canH/2 - 8} width={canW} height={12} rx={6}
                fill="var(--cap-top)" stroke="var(--shape-stroke)" strokeWidth={2}/>
          <text x={canW/2 + 8} y={-8} fontSize={14} fill="var(--text)">+</text>
        </>
      );
    }
    case "led": {
      const r = Math.min(w, h) * 0.22;
      return (
        <>
          <circle cx={0} cy={0} r={r} fill="#ffd6d9" stroke="#b11b2a" strokeWidth={2}/>
          <circle cx={0} cy={0} r={r*0.6} fill="#ff5a6a" opacity={0.5}/>
          <line x1={r+6} y1={-8} x2={r+24} y2={-18} stroke="#b11b2a" strokeWidth={2}/>
          <line x1={r+6} y1={ 8} x2={r+24} y2={ 18} stroke="#b11b2a" strokeWidth={2}/>
        </>
      );
    }
    case "switch": {
      // 네모 트랙 + 네모 노브 (모형)
      const trackW = Math.min(w * 0.78, w - 12);
      const trackH = Math.min(h * 0.38, h - 12);
      const r = 8;
      const knobSize = Math.min(trackH * 0.9, trackW * 0.34);
      const knobHalf = knobSize / 2;
      const knobX = 0;
      return (
        <>
          <rect x={-trackW/2 - 10} y={-trackH/2 - 10} width={trackW + 20} height={trackH + 20} rx={12}
                fill="var(--panel)" stroke="var(--panel-border)"/>
          <rect x={-trackW/2} y={-trackH/2} width={trackW} height={trackH} rx={r}
                fill="var(--switch-track)" stroke="var(--switch-track-border)" strokeWidth={1.6}/>
          <rect x={knobX - knobHalf} y={-knobHalf} width={knobSize} height={knobSize} rx={6}
                fill="var(--panel)" stroke="var(--button-border)" strokeWidth={1.6}/>
          <rect x={knobX - knobHalf + 3} y={-knobHalf + 3}
                width={knobSize - 6} height={Math.max(4, knobSize * 0.22)} rx={3}
                fill="var(--switch-highlight)" opacity={0.9}/>
        </>
      );
    }
    case "transistor": {
      const bodyW = w * 0.44;
      const bodyH = h * 0.56;
      const round = 16;
      const leftCurve = round * 1.6;
      const rightCurve = round * 0.8;
      const pathD = `
        M ${-bodyW/2} ${-bodyH/2 + leftCurve}
        Q ${-bodyW/2} ${-bodyH/2} ${-bodyW/2 + leftCurve} ${-bodyH/2}
        H ${bodyW/2 - rightCurve}
        Q ${bodyW/2} ${-bodyH/2} ${bodyW/2} ${-bodyH/2 + rightCurve}
        V ${bodyH/2 - rightCurve}
        Q ${bodyW/2} ${bodyH/2} ${bodyW/2 - rightCurve} ${bodyH/2}
        H ${-bodyW/2 + leftCurve}
        Q ${-bodyW/2} ${bodyH/2} ${-bodyW/2} ${bodyH/2 - leftCurve}
        Z
      `;
      return (
        <>
          <path d={pathD} fill="var(--tran-body)" stroke="var(--shape-stroke)" strokeWidth={1.6} />
          <rect x={-bodyW/2 + 8} y={-bodyH/2 + 8} width={bodyW - 16} height={bodyH * 0.42} rx={10}
                fill="var(--tran-panel)" opacity={0.95}/>
          <rect x={-bodyW/2 + 12} y={-bodyH/2 + 14} width={bodyW - 24} height={4} rx={2}
                fill="var(--tran-highlight)" opacity={0.55}/>
        </>
      );
    }
  }
}

function makePorts(type: PartType, w: number, h: number): Port[] {
  switch (type) {
    case "resistor": {
      const bodyW = w * 0.6; const dx = bodyW / 2;
      return [{ key: "A", dx: -dx, dy: 0 }, { key: "B", dx: dx, dy: 0 }];
    }
    case "capacitor": {
      const canW = w * 0.36; const dx = canW / 2;
      return [{ key: "A", dx: -dx, dy: 0 }, { key: "B", dx: dx, dy: 0 }];
    }
    case "switch": {
      const baseW = w * 0.7; const dx = baseW / 2;
      return [{ key: "A", dx: -dx, dy: 0 }, { key: "B", dx: dx, dy: 0 }];
    }
    case "led": {
      const r = Math.min(w, h) * 0.22;
      return [{ key: "A", dx: -r, dy: 0 }, { key: "B", dx: r, dy: 0 }];
    }
    case "transistor": {
      const bodyW = w * 0.38, bodyH = h * 0.5;
      const top = -bodyH / 2, bottom = bodyH / 2, side = bodyW / 2;
      return [
        { key: "B", dx: 0,     dy: top },    // 위 중앙
        { key: "C", dx: -side, dy: bottom }, // 아래 좌
        { key: "E", dx:  side, dy: bottom }, // 아래 우
      ];
    }
  }
}
function PartSymbol({ type }: { type: PartType }) {
  // 작은 라인 심볼: stroke는 테마 색 변수를 그대로 사용
  const common = { stroke: "var(--text)", strokeWidth: 2, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" as const };

  switch (type) {
    case "resistor":
      // ─ zigzag ─
      return (
        <svg width="32" height="18" viewBox="0 0 32 18" aria-hidden>
          <path {...common as any} d="M1 9 H6 L8 4 L12 14 L16 4 L20 14 L24 4 L26 9 H31" />
        </svg>
      );
    case "capacitor":
      // ─ | | ─
      return (
        <svg width="32" height="18" viewBox="0 0 32 18" aria-hidden>
          <path {...common as any} d="M1 9 H12" />
          <path {...common as any} d="M14 4 V14" />
          <path {...common as any} d="M18 4 V14" />
          <path {...common as any} d="M20 9 H31" />
        </svg>
      );
    case "switch":
      // ─o/ ─  (SPST 느낌)
      return (
        <svg width="32" height="18" viewBox="0 0 32 18" aria-hidden>
          <path {...common as any} d="M1 9 H10" />
          <circle cx="12" cy="9" r="2" fill="var(--text)" />
          <path {...common as any} d="M14 9 L23 5" />
          <path {...common as any} d="M24 9 H31" />
        </svg>
      );
    case "led":
      // 다이오드 + 빛 화살표
      return (
        <svg width="34" height="18" viewBox="0 0 34 18" aria-hidden>
          {/* 다이오드 */}
          <path {...common as any} d="M1 9 H10" />
          <path {...common as any} d="M10 4 L16 9 L10 14 Z" />
          <path {...common as any} d="M16 4 V14" />
          <path {...common as any} d="M16 9 H24" />
          {/* 빛 화살표 */}
          <path {...common as any} d="M22 4 L26 2" />
          <path {...common as any} d="M24.5 6 L28.5 4" />
          <path {...common as any} d="M26 2 L25 5" />
          <path {...common as any} d="M28.5 4 L27.5 7" />
        </svg>
      );
    case "transistor":
      // 간단한 NPN 심볼
      return (
        <svg width="34" height="18" viewBox="0 0 34 18" aria-hidden>
          <path {...common as any} d="M7 2 V16" />
          <circle cx="14" cy="9" r="4" stroke="var(--text)" strokeWidth="2" fill="none" />
          <path {...common as any} d="M18 9 H28" />
          <path {...common as any} d="M14 5 L20 2" />
          <path {...common as any} d="M14 13 L20 16" />
        </svg>
      );
  }
}
export default function CircuitBoard() {
  const [parts, setParts] = useState<Part[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [pendingPort, setPendingPort] = useState<{ partId: string; portKey: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverTrash, setDragOverTrash] = useState(false);

  // 불러오기 패널
  const [loadPanelOpen, setLoadPanelOpen] = useState(false);
  const [saveList, setSaveList] = useState<BoardListItem[]>([]);

  const dragRef = useRef<{ id: string; offx: number; offy: number } | null>(null);
  const canvasRef = useRef<SVGSVGElement | null>(null);

  // 드래그 후 클릭 억제 (끌었을 때 회전 방지)
  const dragClickBlockRef = useRef(false);
  const dragStartPosRef = useRef<{x:number;y:number}>({x:0,y:0});

  // MQTT
  const mqttClientRef = useRef<any>(null);
  if (!mqttClientRef.current) {
    mqttClientRef.current = mqtt.connect("wss://g11c1e1e.ala.eu-central-1.emqxsl.com:8084/mqtt", {
      username: "okj1812",
      password: "okj1812",
      clean: true,
    });
  }

  // ---- 서버 API: 저장/목록/불러오기/삭제 ----
  async function saveBoardToServer(name: string) {
    const payload = { version: 1, parts, conns };
    const res = await fetch("/api/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, data: payload }),
    });
    if (!res.ok) {
      const msg = await res.text().catch(()=> "");
      throw new Error(`저장 실패\n${msg}`);
    }
    const { id } = await res.json();
    alert(`저장 완료: ${id}`);
  }
  async function fetchBoardList(): Promise<BoardListItem[]> {
    const res = await fetch("/api/boards", { cache: "no-store" });
    if (!res.ok) throw new Error("목록 불러오기 실패");
    return await res.json();
  }
  async function loadBoardByIdFromServer(id: string) {
    const res = await fetch(`/api/boards/${id}`, { cache: "no-store" });
    if (!res.ok) throw new Error("불러오기 실패");
    const data = await res.json(); // {version, parts, conns}
    setParts(data.parts || []);
    setConns(data.conns || []);
    setLoadPanelOpen(false);
  }
  async function deleteBoardByIdFromServer(id: string) {
    const ok = confirm("정말 삭제할까요?");
    if (!ok) return;
    const res = await fetch(`/api/boards/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("삭제 실패");
    const list = await fetchBoardList();
    setSaveList(list);
  }
  function handleSaveClick() {
    const name = prompt("이 저장의 이름을 입력하세요:", "name");
    if (!name) return;
    saveBoardToServer(name.trim()).catch((e:any)=>alert(e?.message ?? "저장 중 오류"));
  }
  useEffect(() => {
    if (!loadPanelOpen) return;
    (async () => {
      try {
        const list = await fetchBoardList();
        setSaveList(list);
      } catch {
        setSaveList([]);
        alert("목록을 불러오지 못했습니다.");
      }
    })();
  }, [loadPanelOpen]);

  // 팔레트 드래그 시작
  function onStartCreate(e: React.DragEvent, pt: PartType) {
    e.dataTransfer.setData("type", pt);
    const img = new Image(); img.src = "data:image/svg+xml;base64,PHN2Zy8+";
    e.dataTransfer.setDragImage(img, 0, 0);
  }

  // 드롭으로 생성
  function onDrop(e: React.DragEvent) {
    const svg = canvasRef.current; if (!svg) return;
    const type = e.dataTransfer.getData("type") as PartType; if (!type) return;
    const { x: sx, y: sy } = clientToSvg(svg, e.clientX, e.clientY);
    const x = snap(sx), y = snap(sy);
    const base = PALETTE.find(p => p.type === type)!;
    const idx = parts.filter(p => p.type === type).length + 1;
    const refName = `${base.refPrefix}${idx}`;
    const id = "P" + crypto.randomUUID().slice(0, 8);
    const ports = makePorts(type, base.w, base.h);
    const p: Part = { id, refName, type, x, y, ports, w: base.w, h: base.h, rot: 0 };
    setParts(prev => [...prev, p]);
  }

  // 수동 연결
  function onPortClick(partId: string, portKey: string) {
    if (!pendingPort) setPendingPort({ partId, portKey });
    else {
      if (pendingPort.partId !== partId || pendingPort.portKey !== portKey) {
        const id = "C" + crypto.randomUUID().slice(0, 8);
        setConns(prev => [...prev, { id, a: pendingPort, b: { partId, portKey } }]);
      }
      setPendingPort(null);
    }
  }

  // 클릭 회전: 트랜지스터 0→90→180→270→0, 나머지 0↔90
  function rotatePart(id: string, type: PartType) {
    setParts(prev => prev.map(p => {
      if (p.id !== id) return p;
      const cur = p.rot ?? 0;
      if (type === "transistor") {
        return { ...p, rot: (cur + 90) % 360 };
      } else {
        return { ...p, rot: cur === 0 ? 90 : 0 };
      }
    }));
  }

  // 드래그 이동/종료 (드래그 중 클릭 회전 방지)
  function startDrag(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const svg = canvasRef.current; if (!svg) return;
    const { x: px, y: py } = clientToSvg(svg, e.clientX, e.clientY);
    const p = parts.find(pp => pp.id === id)!;
    dragRef.current = { id, offx: px - p.x, offy: py - p.y };
    setDraggingId(id);
    dragClickBlockRef.current = false;
    dragStartPosRef.current = { x: px, y: py };
  }
  function onMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const svg = canvasRef.current!;
    const { id, offx, offy } = dragRef.current;
    const { x: px, y: py } = clientToSvg(svg, e.clientX, e.clientY);

    if (!dragClickBlockRef.current) {
      const dx = Math.abs(px - dragStartPosRef.current.x);
      const dy = Math.abs(py - dragStartPosRef.current.y);
      if (dx > 3 || dy > 3) dragClickBlockRef.current = true;
    }

    const nx = snap(px - offx, SNAP);
    const ny = snap(py - offy, SNAP);
    setParts(prev => prev.map(p => (p.id === id ? { ...p, x: nx, y: ny } : p)));

    const over =
      nx >= TRASH_POS.x && nx <= TRASH_POS.x + TRASH.w &&
      ny >= TRASH_POS.y && ny <= TRASH_POS.y + TRASH.h;
    setDragOverTrash(over);
  }
  function endDrag() {
    if (!dragRef.current) return;
    const movingId = dragRef.current.id;
    const moving = parts.find(pp => pp.id === movingId);
    if (moving) {
      const over =
        moving.x >= TRASH_POS.x && moving.x <= TRASH_POS.x + TRASH.w &&
        moving.y >= TRASH_POS.y && moving.y <= TRASH_POS.y + TRASH.h;
      if (over) {
        setParts(prev => prev.filter(p => p.id !== movingId));
        setConns(prev => prev.filter(c => c.a.partId !== movingId && c.b.partId !== movingId));
      }
    }
    dragRef.current = null;
    setDraggingId(null);
    setDragOverTrash(false);
  }

  // 배선
  const wires = useMemo(() => conns.map((c) => {
    const aPart = parts.find((p) => p.id === c.a.partId);
    const bPart = parts.find((p) => p.id === c.b.partId);
    if (!aPart || !bPart) return { id: c.id, pts: [] as { x: number; y: number }[] };
    const A = portAnchor(aPart, c.a.portKey);
    const B = portAnchor(bPart, c.b.portKey);
    const pts = manhattanPath(A, B);
    return { id: c.id, pts };
  }), [conns, parts]);

  // 보기용 데이터
  const refList = parts.map(p => ({ ref: p.refName, type: p.type }));
  const edgesList = conns.map(c => {
    const a = parts.find(p => p.id === c.a.partId);
    const b = parts.find(p => p.id === c.b.partId);
    return a && b ? [a.refName, a.type, b.refName, b.type] as [string, PartType, string, PartType] : null;
  }).filter(Boolean) as [string, PartType, string, PartType][];

  // 부품 개수 표
  const partCountMap: Record<PartType, number> = { resistor:0, capacitor:0, switch:0, led:0, transistor:0 };
  parts.forEach(p => { partCountMap[p.type] += 1; });

  // MQTT publish
  function publishData() {
    const payload = {
      checkboard : 1,
      components: refList,
      edges: edgesList.map(([ar, _at, br, _bt]) => [ar, br]),
    };
    mqttClientRef.current.publish("check", JSON.stringify(payload));
    alert("MQTT 전송 완료!");
  }

  // 날짜 포맷
  function fmt(ts: number) {
    const d = new Date(ts);
    const f = (n:number)=>String(n).padStart(2,"0");
    return `${d.getFullYear()}-${f(d.getMonth()+1)}-${f(d.getDate())} ${f(d.getHours())}:${f(d.getMinutes())}`;
  }

  return (
    <>
      {/* 다크/라이트 공용 색 변수 정의 */}
      <style jsx global>{`
  /* 기본값 = 라이트 테마용 (사이트 스위치에 의해 덮어쓰기 전) */
  :root {
    --bg: #ffffff;
    --text: #0f172a;
    --muted: #6b7280;
    --panel: #ffffff;
    --panel-border: #dddddd;
    --chip-bg: #f8fafc;
    --chip-border: #e5e7eb;
    --button-bg: #ffffff;
    --button-border: #cbd5e1;
    --primary: #0d6efd;
    --primary-contrast: #003eaa;
    --wire: #0d6efd;
    --port: #0d6efd;
    --grid: #e7e7e7;
    --board-bg: #fbfbfb;

    --trash-fill: #ffefef;
    --trash-fill-hover: #ffe7e7;
    --trash-stroke: #ff6b6b;
    --trash-stroke-hover: #ff0000;

    --table-border: #eeeeee;

    --switch-track: #eef2f7;
    --switch-track-border: #c7d0db;
    --switch-highlight: #f8fafc;

    --shape-stroke: #333333;
    --cap-body: #e9f3ff;
    --cap-top: #cfe2ff;

    --tran-body: #4b525a;
    --tran-panel: #636b74;
    --tran-highlight: #a7b0b9;

    --modal-overlay: rgba(0,0,0,0.25);
  }

  /* ✅ 사이트 토글을 따르는 다크 테마 오버라이드
     - Tailwind class 전략: html.dark / body.dark
     - data-theme 전략: [data-theme="dark"]
     둘 다 지원합니다.
  */
  html.dark, body.dark, [data-theme="dark"] {
    --bg: #0b1220;
    --text: #e5e7eb;
    --muted: #a1a1aa;
    --panel: #0f172a;
    --panel-border: #1f2937;
    --chip-bg: #0f172a;
    --chip-border: #374151;
    --button-bg: #0b1220;
    --button-border: #334155;

    --primary: #60a5fa;
    --primary-contrast: #1e3a8a;
    --wire: #7dd3fc;
    --port: #60a5fa;

    --grid: rgba(255,255,255,0.08);
    --board-bg: #0a0f1a;

    --trash-fill: rgba(239,68,68,0.08);
    --trash-fill-hover: rgba(239,68,68,0.18);
    --trash-stroke: #f87171;
    --trash-stroke-hover: #ef4444;

    --table-border: #253041;

    --switch-track: #111827;
    --switch-track-border: #374151;
    --switch-highlight: #1f2937;

    --shape-stroke: #9aa4b2;
    --cap-body: #102033;
    --cap-top: #1a2a40;

    --tran-body: #2a323a;
    --tran-panel: #3b454f;
    --tran-highlight: #6b7580;

    --modal-overlay: rgba(0,0,0,0.5);
  }

  /* OS 설정이 아닌, 사이트 스위치만 따르도록 body 배경도 변수로 */
  body { background: var(--bg); color: var(--text); }
`}</style>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, height: "90vh" }}>
        {/* 왼쪽 패널 */}
        <aside
          style={{
            border: "1px solid var(--panel-border)",
            background: "var(--panel)",
            borderRadius: 10, padding: 12,
            display: "grid", gridTemplateRows: "auto auto 1fr auto",
            rowGap: 16, height: "100%", overflow: "hidden", color: "var(--text)"
          }}
        >
          {/* 팔레트 */}
          <div>
            <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 16 }}>부품 목록</div>
            {PALETTE.map((p) => (
            <div
              key={p.type}
              draggable
              onDragStart={(e) => onStartCreate(e, p.type)}
              style={{
                padding: "8px 10px", marginBottom: 8,
                border: "1px dashed var(--chip-border)", borderRadius: 8,
                cursor: "grab", background: "var(--chip-bg)",
                display: "flex", alignItems: "center", gap: 10, color: "var(--text)"
              }}
            >
              <PartSymbol type={p.type} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{TYPE_LABEL[p.type]}</span>
            </div>
          ))}

          </div>

          {/* 부품 표 */}
          <div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>부품 목록</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, color: "var(--text)" }}>
              <thead>
                <tr>
                  <th style={{ borderBottom: "1px solid var(--table-border)", textAlign: "left", padding: "6px 4px" }}>종류</th>
                  <th style={{ borderBottom: "1px solid var(--table-border)", textAlign: "right", padding: "6px 4px" }}>개수</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(TYPE_LABEL) as PartType[]).map((t) => (
                  <tr key={t}>
                    <td style={{ padding: "6px 4px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 999, background: TYPE_COLOR[t] }} />
                        {TYPE_LABEL[t]}
                      </span>
                    </td>
                    <td style={{ padding: "6px 4px", textAlign: "right" }}>{partCountMap[t]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 연결 목록 (이 영역만 스크롤) */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>연결 목록</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
              {edgesList.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>연결 없음</div>
              ) : edgesList.map(([ar, at, br, bt], i) => (
                <div
                  key={i}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
                    border: "1px solid var(--chip-border)", borderRadius: 8,
                    background: "var(--panel)", fontSize: 12, color: "var(--text)"
                  }}
                >
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "2px 8px", borderRadius: 999,
                    border: "1px solid var(--chip-border)", background: "var(--chip-bg)"
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: TYPE_COLOR[at] }} />
                    <b style={{ fontSize: 12 }}>{TYPE_LABEL[at]}</b>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>({ar})</span>
                  </span>
                  <span style={{ opacity: 0.5, fontSize: 11, color: "var(--muted)" }}>—</span>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "2px 8px", borderRadius: 999,
                    border: "1px solid var(--chip-border)", background: "var(--chip-bg)"
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: TYPE_COLOR[bt] }} />
                    <b style={{ fontSize: 12 }}>{TYPE_LABEL[bt]}</b>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>({br})</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 만들기 버튼 */}
          <div>
            <button
              onClick={publishData}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                background: "var(--primary)", color: "#fff", border: "none",
                fontWeight: 700, cursor: "pointer"
              }}
            >
              검사하기
            </button>
          </div>
        </aside>

        {/* 오른쪽 캔버스 */}
        <div style={{
          position: "relative",
          border: "1px solid var(--panel-border)", borderRadius: 10, overflow: "hidden", height: "92vh",
          background: "var(--panel)"
          
        }}>
          
          {/* 오른쪽 상단: 저장/불러오기 버튼 */}
          <div style={{ position: "absolute", top: 10, right: 10, zIndex: 5, display: "flex", gap: 8 }}>
            
            <button
              onClick={handleSaveClick}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--button-border)", background: "var(--button-bg)", cursor: "pointer", color: "var(--text)" }}
              title="현재 보드를 /database 폴더에 저장"
            >
              저장하기
            </button>
            <button
              onClick={() => setLoadPanelOpen(true)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--button-border)", background: "var(--button-bg)", cursor: "pointer", color: "var(--text)" }}
              title="저장된 보드 불러오기"
            >
              불러오기
            </button>
          </div>

          {/* 불러오기 패널(모달) */}
          {loadPanelOpen && (
            <div
              onClick={() => setLoadPanelOpen(false)}
              style={{
                position: "absolute", inset: 0, background: "var(--modal-overlay)",
                display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 600, maxHeight: "70vh", overflow: "hidden",
                  background: "var(--panel)", borderRadius: 12, border: "1px solid var(--panel-border)",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
                  display: "grid", gridTemplateRows: "auto 1fr auto", color: "var(--text)"
                }}
              >
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--panel-border)", fontWeight: 700 }}>
                  저장된 회로 불러오기
                </div>
                <div style={{ padding: 12, overflowY: "auto" }}>
                  {saveList.length === 0 ? (
                    <div style={{ color: "var(--muted)", fontSize: 13 }}>저장된 항목이 없습니다.</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: "left", borderBottom: "1px solid var(--panel-border)", padding: "8px 6px" }}>이름</th>
                          <th style={{ textAlign: "right", borderBottom: "1px solid var(--panel-border)", padding: "8px 6px" }}>크기</th>
                          <th style={{ textAlign: "left", borderBottom: "1px solid var(--panel-border)", padding: "8px 6px" }}>저장시각</th>
                          <th style={{ borderBottom: "1px solid var(--panel-border)" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {saveList.map(m => (
                          <tr key={m.id}>
                            <td style={{ padding: "8px 6px" }}>{m.name}</td>
                            <td style={{ padding: "8px 6px", textAlign: "right" }}>{(m.size/1024).toFixed(1)} KB</td>
                            <td style={{ padding: "8px 6px" }}>{fmt(m.savedAt)}</td>
                            <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                              <button
                                onClick={() => loadBoardByIdFromServer(m.id)}
                                style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--button-border)", background: "var(--button-bg)", cursor: "pointer", marginRight: 6, color: "var(--text)" }}
                              >
                                불러오기
                              </button>
                              <button
                                onClick={() => deleteBoardByIdFromServer(m.id)}
                                style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #fecaca", background: "#fee2e2", color: "#b91c1c", cursor: "pointer" }}
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div style={{ padding: 12, borderTop: "1px solid var(--panel-border)", display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => setLoadPanelOpen(false)}
                    style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--button-border)", background: "var(--button-bg)", cursor: "pointer", color: "var(--text)" }}
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 캔버스 SVG */}
          <svg
            width="100%" height="100%"
            viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
            ref={canvasRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onMouseMove={onMove}
            onMouseUp={endDrag}
            style={{
              background: `linear-gradient(transparent ${GRID - 1}px, var(--grid) ${GRID}px), linear-gradient(90deg, transparent ${GRID - 1}px, var(--grid) ${GRID}px)`,
              backgroundSize: `${GRID}px ${GRID}px`,
              backgroundColor: "var(--board-bg)"
            }}
          >
            {/* 삭제 영역 */}
            <g>
              <rect
                x={TRASH_POS.x + 8} y={TRASH_POS.y + 8}
                width={TRASH.w - 16} height={TRASH.h - 16}
                fill={dragOverTrash ? "var(--trash-fill-hover)" : "var(--trash-fill)"}
                stroke={dragOverTrash ? "var(--trash-stroke-hover)" : "var(--trash-stroke)"}
                strokeDasharray="6 6" rx={10}
              />
              <text x={TRASH_POS.x + 20} y={TRASH_POS.y + 42} fontSize={16} fill="#d33">🗑 Drop here to delete</text>
            </g>
{/* 안내 문구 - 좌상단 */}
<g
  transform={`translate(10 20)`} // 좌표 직접 지정
  pointerEvents="none"
  opacity={0.85}
>
  <text
    fontSize={25}
    fill="#999"
    textAnchor="start" // 왼쪽 기준
    x={0}
    y={-250}
  >
    <tspan x={0} dy="0">Drag parts inside</tspan>
    <tspan x={0} dy="1.2em">Click circles to connect</tspan>
  </text>
</g>
            {/* 배선 */}
            {wires.map((w) => (
              <polyline key={w.id}
                points={w.pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none" stroke="var(--wire)" strokeWidth={4} />
            ))}

            {/* 부품 */}
            {parts.map((p) => {
              const isDragTarget = p.id === draggingId && dragOverTrash;
              const rot = p.rot ?? 0;
              return (
                <g
                  key={p.id}
                  transform={`translate(${p.x} ${p.y}) rotate(${rot}) ${isDragTarget ? "scale(0.85)" : ""}`}
                  onMouseDown={(e) => startDrag(e, p.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragClickBlockRef.current) { dragClickBlockRef.current = false; return; } // 드래그 후 클릭 억제
                    rotatePart(p.id, p.type);
                  }}
                  style={{ cursor: "move", userSelect: "none", opacity: isDragTarget ? 0.8 : 1 }}
                >
                  {partShape(p.type, p.w, p.h)}
                  {p.ports.map((port) => (
                    <g
                      key={port.key}
                      transform={`translate(${port.dx} ${port.dy})`}
                      onClick={(e)=>{ e.stopPropagation(); onPortClick(p.id, port.key); }}
                      style={{ cursor: "pointer" }}
                    >
                      <circle
                        r={15}
                        fill={pendingPort?.partId===p.id && pendingPort?.portKey===port.key ? "red" : "var(--port)"}
                        stroke="var(--primary-contrast)"
                        strokeWidth={2}
                      />
                      <text x={0} y={-22} fontSize={14} textAnchor="middle" fill="var(--text)">{port.key}</text>
                    </g>
                  ))}
                  {/* 라벨: 부품 이름(항상 수평) */}
                  <g transform={`rotate(${-rot})`}>
                    <text x={0} y={p.h / 2 + 20} fontSize={14} textAnchor="middle" fill="var(--text)">
                      {TYPE_LABEL[p.type]}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </>
  );
}
