"use client"
import { Button } from "@/components/Button"
import { ArrowAnimated } from "@/components/ui/icons/ArrowAnimated"
import { TremorPlaceholder } from "@/components/ui/icons/TremorPlaceholder"
import { useState } from "react"

export default function Settings() {
  const [starting, setStarting] = useState(false)

  const handleRunYolo = async () => {
    try {
      setStarting(true)
      const res = await fetch("/api/run-yolo", { method: "POST" })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data?.error || "failed")
      alert("YOLO를 실행했습니다. 잠시 후 PC에 OpenCV 창이 뜹니다.")
    } catch (e) {
      console.error(e)
      alert("실행에 실패했습니다. 콘솔을 확인하세요.")
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="mt-4 sm:mt-6 lg:mt-10">
      <div className="my-40 flex w-full flex-col items-center justify-center">
        <TremorPlaceholder className="size-20 shrink-0" aria-hidden="true" />
        <h2 className="mt-6 text-lg font-semibold sm:text-xl">
          YOLO Detection
        </h2>
        <p className="mt-3 max-w-md text-center text-gray-500">
          버튼을 누르면 로컬에서 detect.py를 실행하고 OpenCV 창을 띄웁니다.
        </p>

        <Button
          className="group mt-6"
          variant="secondary"
          onClick={handleRunYolo}
          disabled={starting}
        >
          {starting ? "실행 중..." : "YOLO 실행"}
          <ArrowAnimated
            className="stroke-gray-900 dark:stroke-gray-50"
            aria-hidden="true"
          />
        </Button>
      </div>
    </div>
  )
}
