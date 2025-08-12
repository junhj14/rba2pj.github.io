"use client"

import React from "react"
import { cx, focusInput } from "@/lib/utils"
import { RiArrowRightSLine, RiExpandUpDownLine } from "@remixicon/react"

/**
 * Desktop: 겉모습(클래스)은 그대로 유지, 드롭다운 동작/상태/모달 모두 제거
 */
export const WorkspacesDropdownDesktop = () => {
  return (
    <button
      className={cx(
        "flex w-full items-center gap-x-2.5 rounded-md border border-gray-300 bg-white p-2 text-sm shadow-sm transition-all hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-950 hover:dark:bg-gray-900",
        focusInput,
      )}
      // 동작 제거: onClick 없음
      type="button"
    >
      <span
        className="flex aspect-square size-8 items-center justify-center rounded bg-indigo-600 p-2 text-xs font-medium text-white dark:bg-indigo-500"
        aria-hidden="true"
      >
        D2
      </span>
      <div className="flex w-full items-center justify-between gap-x-4 truncate">
        <div className="truncate">
          <p className="truncate whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
            팀이름
          </p>
        <p className="whitespace-nowrap text-left text-xs text-gray-700 dark:text-gray-300">
            실시간 검사 대시보드
          </p>
        </div>

      </div>
    </button>
  )
}

/**
 * Mobile: 겉모습 유지, 드롭다운 동작/상태 제거
 */
export const WorkspacesDropdownMobile = () => {
  return (
    <button
      className="flex items-center gap-x-1.5 rounded-md p-2 hover:bg-gray-100 focus:outline-none hover:dark:bg-gray-900"
      // 동작 제거: onClick 없음
      type="button"
    >
      <span
        className={cx(
          "flex aspect-square size-7 items-center justify-center rounded bg-indigo-600 p-2 text-xs font-medium text-white dark:bg-indigo-500",
        )}
        aria-hidden="true"
      >
        RA
      </span>
      <RiArrowRightSLine
        className="size-4 shrink-0 text-gray-500"
        aria-hidden="true"
      />
      <div className="flex w-full items-center justify-between gap-x-3 truncate">
        <p className="truncate whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-50">
          Retail analytics
        </p>
        <RiExpandUpDownLine
          className="size-4 shrink-0 text-gray-500"
          aria-hidden="true"
        />
      </div>
    </button>
  )
}
