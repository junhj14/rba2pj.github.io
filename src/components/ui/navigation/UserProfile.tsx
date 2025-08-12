"use client"

import { Button } from "@/components/Button"
import { cx, focusRing } from "@/lib/utils"
import { RiMore2Fill, RiShieldUserFill } from "@remixicon/react"
import * as React from "react"
import { DropdownUserProfile } from "./DropdownUserProfile"

function formatNameWithCapitals(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "NA"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export const UserProfileDesktop = () => {
  const [name, setName] = React.useState("Hyojae jun")

  return (
    <DropdownUserProfile
      name={name}
      onUpdateName={setName}
    >
      <Button
        aria-label="User settings"
        variant="ghost"
        className={cx(
          focusRing,
          "group flex w-full items-center justify-between rounded-md p-2 text-sm font-medium text-gray-900 hover:bg-gray-100 data-[state=open]:bg-gray-100 data-[state=open]:bg-gray-400/10 hover:dark:bg-gray-400/10",
        )}
      >
        <span className="flex items-center gap-3">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300"
            aria-hidden
          >
            {initialsFrom(name)}
          </span>

          <span className="flex items-center gap-2">
            {formatNameWithCapitals(name)}
            <span className="flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
              <RiShieldUserFill className="size-3" aria-hidden />
              Admin
            </span>
          </span>
        </span>

        <RiMore2Fill
          className="size-4 shrink-0 text-gray-500 group-hover:text-gray-700 group-hover:dark:text-gray-400"
          aria-hidden
        />
      </Button>
    </DropdownUserProfile>
  )
}

export const UserProfileMobile = () => {
  const [name, setName] = React.useState("Hyojae jun")

  return (
    <DropdownUserProfile
      align="end"
      name={name}
      onUpdateName={setName}
    >
      <Button
        aria-label="User settings"
        variant="ghost"
        className="group flex items-center rounded-md p-1 text-sm font-medium text-gray-900 hover:bg-gray-100 data-[state=open]:bg-gray-100 data-[state=open]:bg-gray-400/10 hover:dark:bg-gray-400/10"
      >
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300"
          aria-hidden
        >
          {initialsFrom(name)}
        </span>

        <span className="ml-2 flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
          <RiShieldUserFill className="size-3" aria-hidden />
          Admin
        </span>
      </Button>
    </DropdownUserProfile>
  )
}
