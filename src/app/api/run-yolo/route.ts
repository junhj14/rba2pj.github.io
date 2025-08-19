// src/app/api/run-yolo/route.ts
export const runtime = "nodejs";        // Node 환경에서 실행
export const dynamic = "force-dynamic"; // 캐시 방지

import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function POST() {
  return new Promise((resolve) => {
    // 실행할 detect.py 경로
    const scriptPath = path.join(
      process.cwd(),
      "src",
      "app",
      "(main)",
      "details",
      "yolo",
      "detect.py"
    );

    // Python 실행 (윈도우 Anaconda 환경 예시)
    const py = spawn("C:/Users/my/anaconda3/python.exe", [scriptPath], {
      cwd: process.cwd(),
      shell: true,
    });

    let output = "";
    let errorOutput = "";

    py.stdout.on("data", (data) => {
      output += data.toString();
      console.log(`[YOLO stdout] ${data}`);
    });

    py.stderr.on("data", (data) => {
      errorOutput += data.toString();
      console.error(`[YOLO stderr] ${data}`);
    });

    py.on("close", (code) => {
      console.log(`[YOLO] process exited with code ${code}`);
      resolve(
        NextResponse.json({
          success: code === 0,
          output,
          error: errorOutput,
        })
      );
    });
  });
}
