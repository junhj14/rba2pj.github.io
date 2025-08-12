// src/app/api/boards/route.ts
export const runtime = "nodejs";        // FS 사용 위해 Edge → Node 강제
export const dynamic = "force-dynamic"; // 캐시 금지

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const DB_DIR = path.join(process.cwd(), "database");
const pad = (n: number) => String(n).padStart(2, "0");

async function ensureDir() {
  try {
    await fs.mkdir(DB_DIR, { recursive: true });
  } catch (e) {
    console.error("[/api/boards] mkdir error:", e);
    throw e;
  }
}

// 목록: GET /api/boards
export async function GET() {
  try {
    await ensureDir();
    console.log("[/api/boards GET] DB_DIR:", DB_DIR);
    const files = await fs.readdir(DB_DIR);
    const items = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          const p = path.join(DB_DIR, f);
          const stat = await fs.stat(p);
          const id = f.replace(/\.json$/, "");
          return {
            id,
            name: id,
            savedAt: stat.mtimeMs,
            size: stat.size,
          };
        })
    );
    items.sort((a, b) => b.savedAt - a.savedAt);
    return NextResponse.json(items);
  } catch (err) {
    console.error("[/api/boards GET] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// 저장: POST /api/boards
export async function POST(req: NextRequest) {
  try {
    await ensureDir();

    let body: any;
    try {
      body = await req.json();
    } catch (e) {
      console.error("[/api/boards POST] JSON parse error:", e);
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    console.log("[/api/boards POST] body keys:", Object.keys(body || {}));
    const { name, data } = body || {};
    if (!name || !data) {
      return NextResponse.json({ error: "name, data 필요" }, { status: 400 });
    }

    const safe = String(name).replace(/[^a-zA-Z0-9_\-\.]/g, "_").slice(0, 80) || "board";
    const ts = new Date();
    const stamp = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}_${pad(ts.getHours())}${pad(ts.getMinutes())}`;
    const id = `${safe}__${stamp}`;
    const filePath = path.join(DB_DIR, `${id}.json`);

    // 순수 JSON만 기록 가능하게 체크(순환참조 방지)
    let serialized: string;
    try {
      serialized = JSON.stringify(data, null, 2);
    } catch (e) {
      console.error("[/api/boards POST] JSON stringify error:", e);
      return NextResponse.json({ error: "data 직렬화 실패(JSON.stringify 오류)" }, { status: 400 });
    }

    await fs.writeFile(filePath, serialized, "utf8");
    console.log("[/api/boards POST] Saved:", filePath);

    return NextResponse.json({ id }, { status: 200 });
  } catch (err) {
    console.error("[/api/boards POST] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
