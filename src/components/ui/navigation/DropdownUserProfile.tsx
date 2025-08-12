"use client"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSubMenu,
  DropdownMenuSubMenuContent,
  DropdownMenuSubMenuTrigger,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/Dropdown"
import { RiComputerLine, RiMoonLine, RiSunLine } from "@remixicon/react"
import { useTheme } from "next-themes"
import * as React from "react"

export type DropdownUserProfileProps = {
  children: React.ReactNode
  align?: "center" | "start" | "end"
  name: string
  onUpdateName: (next: string) => void
}

export function DropdownUserProfile({
  children,
  align = "start",
  name,
  onUpdateName,
}: DropdownUserProfileProps) {
  const [mounted, setMounted] = React.useState(false)
  const { theme, setTheme } = useTheme()
  const [openLogout, setOpenLogout] = React.useState(false)
  const [tempName, setTempName] = React.useState(name)

  React.useEffect(() => setMounted(true), [])
  React.useEffect(() => setTempName(name), [name])

  if (!mounted) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          {/* 이메일 라벨은 그대로 유지 */}
          <DropdownMenuLabel>emma.stone@acme.com</DropdownMenuLabel>

          {/* 테마 설정 */}
          <DropdownMenuGroup>
            <DropdownMenuSubMenu>
              <DropdownMenuSubMenuTrigger>Theme</DropdownMenuSubMenuTrigger>
              <DropdownMenuSubMenuContent>
                <DropdownMenuRadioGroup
                  value={theme}
                  onValueChange={(v) => setTheme(v)}
                >
                  <DropdownMenuRadioItem aria-label="Switch to Light Mode" value="light" iconType="check">
                    <RiSunLine className="size-4 shrink-0" aria-hidden="true" />
                    Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem aria-label="Switch to Dark Mode" value="dark" iconType="check">
                    <RiMoonLine className="size-4 shrink-0" aria-hidden="true" />
                    Dark
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem aria-label="Switch to System Mode" value="system" iconType="check">
                    <RiComputerLine className="size-4 shrink-0" aria-hidden="true" />
                    System
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubMenuContent>
            </DropdownMenuSubMenu>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          {/* 로그아웃(이름 변경) */}
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={(e) => {
              e.preventDefault() // 드롭다운 즉시 닫힘 방지
              setOpenLogout(true)
            }}>
              Change Admin
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 간단 모달: 로그아웃 창에서 이름 입력 → 저장 시 상단 표시 이름 갱신 */}
      {openLogout && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpenLogout(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-950"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-2 text-base font-semibold">Sign out</h3>
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              로그아웃하기 전에 표시될 이름을 입력하세요.
            </p>
            <label className="mb-2 block text-sm font-medium">
              Display Name
            </label>
            <input
              className="mb-4 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              placeholder="Your name"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setOpenLogout(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
                onClick={() => {
                  onUpdateName((tempName || "").trim() || name)
                  setOpenLogout(false)
                  // 실제 로그아웃 로직이 있다면 여기에서 호출하세요.
                }}
              >
                Change
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
